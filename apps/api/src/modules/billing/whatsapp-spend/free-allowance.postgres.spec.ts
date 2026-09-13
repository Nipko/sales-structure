import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappSpendService } from './whatsapp-spend.service';
import {
    FREE_SERVICE_MESSAGES_PER_NUMBER_MONTH, consumesFreeAllowance, freeAllowanceFor,
    freeAllowanceFromMetadata,
} from './free-allowance';

/**
 * ═══ THE THOUSAND FREE MESSAGES, ACTUALLY GRANTED ═══
 *
 * `grantFreeDeliveries` was written correctly, tested for concurrency, and
 * granted nothing at all. It matches rows with `cap_kind = 'deliveries'`, and
 * `ensureCounters` created every scope — including the one the allowance lives
 * in — as `cap_kind = 'observe'` with a null `cap_deliveries`. So the statement
 * found no row, returned zero, and every tenant was charged from their first
 * message while the panel showed a thousand free ones waiting.
 *
 * That is the shape this repository keeps producing: a correct implementation
 * nothing reaches. The counter is now seeded WITH the allowance, in the same
 * INSERT that creates it, so the two cannot come apart.
 *
 * The boundary cases are the point of running this against real PostgreSQL:
 * 999, 1000, 1001 and a month change are where an off-by-one costs a business
 * either a message they should have had free or a charge they should not have
 * seen — and the split is decided inside the statement, so only the statement
 * can be asked.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;

describe('what the free allowance is, before any database is involved', () => {
    it('is Meta’s published figure, per number, per month', () => {
        expect(FREE_SERVICE_MESSAGES_PER_NUMBER_MONTH).toBe(1000);
        expect(freeAllowanceFor(undefined)).toBe(1000);
        expect(freeAllowanceFor(null)).toBe(1000);
        expect(freeAllowanceFor('')).toBe(1000);
    });

    it('takes an override only when it is a whole number of messages', () => {
        expect(freeAllowanceFor(2000)).toBe(2000);
        expect(freeAllowanceFor('2000')).toBe(2000);
        expect(freeAllowanceFor(0)).toBe(0);
        // Not coerced. `-5` and `unlimited` fall back to the published figure
        // rather than becoming a number nobody intended.
        expect(freeAllowanceFor(-5)).toBe(1000);
        expect(freeAllowanceFor('unlimited')).toBe(1000);
        expect(freeAllowanceFor(1.5)).toBe(1000);
    });

    it('reads the override off an account’s metadata blob', () => {
        expect(freeAllowanceFromMetadata({ whatsappFreeServiceMessages: 2500 })).toBe(2500);
        expect(freeAllowanceFromMetadata({})).toBe(1000);
        expect(freeAllowanceFromMetadata(null)).toBe(1000);
    });

    it('is consumed by service messages and by nothing else', () => {
        // Utility inside the window became chargeable in the same Meta update
        // and explicitly does NOT consume the quota. Marketing and
        // authentication never did.
        expect(consumesFreeAllowance('service')).toBe(true);
        expect(consumesFreeAllowance('SERVICE')).toBe(true);
        for (const category of ['utility', 'marketing', 'authentication', 'referral_conversion']) {
            expect(consumesFreeAllowance(category)).toBe(false);
        }
        // And an unknown is not eligible: an allowance handed out on a guess is
        // wrong precisely when a utility template went out.
        expect(consumesFreeAllowance(null)).toBe(false);
        expect(consumesFreeAllowance('category_unknown')).toBe(false);
    });
});

integration('the free allowance, granted against a real counter', () => {
    const schema = `tenant_allowance_${randomUUID().replace(/-/g, '')}`;
    const TENANT = randomUUID();
    let client: Client;
    let prisma: PrismaService;
    let priorUrl: string | undefined;
    jest.setTimeout(120_000);

    const q = async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows;
    const service = () => new WhatsappSpendService(prisma as any);

    const send = (over: Record<string, unknown> = {}) => service().authorize(schema, {
        effectKey: `fa-${randomUUID().replace(/-/g, '')}`,
        identity: {
            tenantId: TENANT, channelType: 'whatsapp', channelAccountId: '15550001111',
            channelAddress: '+1 555 000 1111',
            payerKind: 'business_direct', payerWabaId: 'waba-1', payerBusinessId: 'biz-1',
            credentialId: 'cred-1', credentialSource: 'system_user',
            recipientScope: 'customer', recipientRef: 'contact-1',
            category: 'service', market: 'CO', currency: 'USD',
        } as any,
        contactId: 'contact-1', deliveries: 1,
        wabaTimeZone: 'America/Bogota', admissionReason: 'inbound_reply',
        disposition: 'reactive', allowUnknownCost: true,
        at: new Date('2026-10-05T12:00:00.000Z'),
        ...over,
    } as any);

    /** The allowance counter itself, read straight from the table. */
    const allowance = async (period = '2026-10') => (await q(
        `SELECT cap_kind, cap_deliveries, used_deliveries, free_deliveries
           FROM "${schema}".whatsapp_spend_counters
          WHERE scope_kind = 'number_month' AND period_key = $1`, [period]))[0];

    beforeAll(async () => {
        const url = new URL(connection!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new Client({ connectionString: connection });
        await client.connect();
        await q(`CREATE SCHEMA "${schema}"`);
        const tenantSchema = readFileSync(resolve(__dirname, '../../../../prisma/tenant-schema.sql'), 'utf8');
        const block = tenantSchema.split('-- BEGIN WHATSAPP SPEND LEDGER')[1]
            ?.split('-- END WHATSAPP SPEND LEDGER')[0];
        if (!block) throw new Error('tenant_schema_block_missing');
        for (const statement of block.replace(/^\s*--.*$/gm, '').split(';').filter(value => value.trim())) {
            await q(statement.replaceAll('{{SCHEMA_NAME}}', schema));
        }
        priorUrl = process.env.DATABASE_URL;
        process.env.DATABASE_URL = connection!;
        prisma = new PrismaService();
        await prisma.$connect();
    });

    afterAll(async () => {
        try { await prisma?.$disconnect(); } catch { /* already closed */ }
        if (priorUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = priorUrl;
        if (!client) return;
        try {
            if (!/^tenant_allowance_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await q(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await client.end(); }
    });

    beforeEach(async () => {
        await q(`TRUNCATE "${schema}".whatsapp_spend_allocations,
                          "${schema}".whatsapp_spend_reservations,
                          "${schema}".whatsapp_spend_counters`);
    });

    it('creates the allowance counter with the published figure on the first send', async () => {
        const result = await send();
        expect(result.outcome).toBe('reserved');
        const row = await allowance();
        expect(row.cap_kind).toBe('deliveries');
        expect(Number(row.cap_deliveries)).toBe(1000);
        expect(Number(row.free_deliveries)).toBe(1);
        // Free means free: nothing was reserved against the money.
        expect(Number((result as any).reservation.money.reservedMinor)).toBe(0);
        expect((result as any).reservation.money.basis).toBe('free_allowance');
    });

    it('is still free at the 1000th and charges from the 1001st', async () => {
        // The boundary Meta states in words: "Meta will only charge as of the
        // 1,001st service message delivered."
        await send();
        await q(`UPDATE "${schema}".whatsapp_spend_counters
                    SET used_deliveries = 998, free_deliveries = 998
                  WHERE scope_kind = 'number_month'`);

        const nineHundredNinetyNinth = await send();
        expect(Number((nineHundredNinetyNinth as any).reservation.money.freeDeliveries)).toBe(1);
        const thousandth = await send();
        expect(Number((thousandth as any).reservation.money.freeDeliveries)).toBe(1);

        const thousandAndFirst = await send();
        expect(Number((thousandAndFirst as any).reservation.money.freeDeliveries)).toBe(0);
        expect(Number((thousandAndFirst as any).reservation.money.chargedDeliveries)).toBe(1);
        expect(Number((await allowance()).used_deliveries)).toBe(1000);
    });

    it('gives each number of a tenant its own thousand', async () => {
        // Per PHONE NUMBER, not per WABA and not per tenant. A Pro plan with
        // two numbers has two thousand, and saying otherwise both understates
        // the customer's benefit and overstates their bill.
        await send();
        await send({ identity: {
            tenantId: TENANT, channelType: 'whatsapp', channelAccountId: '15550002222',
            channelAddress: '+1 555 000 2222',
            payerKind: 'business_direct', payerWabaId: 'waba-1', payerBusinessId: 'biz-1',
            credentialId: 'cred-1', credentialSource: 'system_user',
            recipientScope: 'customer', recipientRef: 'contact-1',
            category: 'service', market: 'CO', currency: 'USD',
        } });

        const rows = await q(
            `SELECT scope_key, cap_deliveries, used_deliveries
               FROM "${schema}".whatsapp_spend_counters
              WHERE scope_kind = 'number_month' ORDER BY scope_key`);
        expect(rows).toHaveLength(2);
        for (const row of rows) {
            expect(Number(row.cap_deliveries)).toBe(1000);
            expect(Number(row.used_deliveries)).toBe(1);
        }
    });

    it('is ONE thousand for the number, however many countries it writes to', async () => {
        // The half of the R5 row that says "no multiplicada por mercado". Meta
        // grants the allowance per NUMBER per month; a tenant answering
        // Colombia, Germany and the United States from one number has a
        // thousand free service messages in total, not a thousand each.
        //
        // Structurally true — the counter is keyed `number_month` — and
        // untested, which is a different thing. A rate resolver that started
        // keying the counter by market would break this and nothing else.
        const markets = ['CO', 'DE', 'US'];
        for (const market of markets) {
            const result = await send({
                identity: {
                    tenantId: TENANT, channelType: 'whatsapp', channelAccountId: '15550001111',
                    channelAddress: '+1 555 000 1111',
                    payerKind: 'business_direct', payerWabaId: 'waba-1', payerBusinessId: 'biz-1',
                    credentialId: 'cred-1', credentialSource: 'system_user',
                    recipientScope: 'customer', recipientRef: `contact-${market}`,
                    category: 'service', market, currency: 'USD',
                },
            });
            expect(result.outcome).toBe('reserved');
        }

        const counters = await q(
            `SELECT scope_key, used_deliveries, free_deliveries
               FROM "${schema}".whatsapp_spend_counters
              WHERE scope_kind = 'number_month' AND period_key = '2026-10'`);
        // ONE row for the number, not one per market.
        expect(counters).toHaveLength(1);
        expect(Number(counters[0].free_deliveries)).toBe(markets.length);
    });

    it('resets with the month in the WABA’s own zone, and never rolls over', async () => {
        // 03:00 UTC on 1 November is still 22:00 on 31 October in Bogotá. The
        // allowance belongs to October until the number's OWN month turns.
        await send({ at: new Date('2026-11-01T03:00:00.000Z') });
        expect(Number((await allowance('2026-10')).used_deliveries)).toBe(1);
        expect(await allowance('2026-11')).toBeUndefined();

        // And two hours later it is November there, with a fresh thousand — and
        // October's unused 999 do not follow it.
        await send({ at: new Date('2026-11-01T06:00:00.000Z') });
        const november = await allowance('2026-11');
        expect(Number(november.cap_deliveries)).toBe(1000);
        expect(Number(november.used_deliveries)).toBe(1);
    });

    it('never lets a utility template eat a free service message', async () => {
        // Utility inside the window is chargeable AND does not consume the
        // quota. Letting it draw on the allowance makes the business pay twice:
        // once for the template, and once for the service reply whose free slot
        // it took.
        const utility = await send({
            identity: {
                tenantId: TENANT, channelType: 'whatsapp', channelAccountId: '15550001111',
                channelAddress: '+1 555 000 1111',
                payerKind: 'business_direct', payerWabaId: 'waba-1', payerBusinessId: 'biz-1',
                credentialId: 'cred-1', credentialSource: 'system_user',
                recipientScope: 'customer', recipientRef: 'contact-1',
                category: 'utility', market: 'CO', currency: 'USD',
            },
        });
        expect(Number((utility as any).reservation.money.freeDeliveries)).toBe(0);
        expect(Number((utility as any).reservation.money.chargedDeliveries)).toBe(1);
        // The counter it did not touch still has its thousand intact.
        const row = await allowance();
        expect(Number(row.used_deliveries)).toBe(0);
    });

    it('refuses to hand out the allowance on a guess', async () => {
        // An unclassifiable message writes `service` into the identity because
        // the column is constrained and that is what fits. The caller says
        // whether it MEANT it.
        const unknown = await send({ freeAllowanceEligible: false });
        expect(Number((unknown as any).reservation.money.freeDeliveries)).toBe(0);
        expect(Number((await allowance()).used_deliveries)).toBe(0);
    });

    it('honours a figure Meta gave this particular number', async () => {
        await send({ freeAllowance: 5 });
        expect(Number((await allowance()).cap_deliveries)).toBe(5);
    });

    it('keeps a month at the figure it started with', async () => {
        // Raising a ceiling mid-period would retroactively rewrite what a
        // business was told it had. The seed happens on INSERT only.
        await send();
        await send({ freeAllowance: 5 });
        expect(Number((await allowance()).cap_deliveries)).toBe(1000);
    });
});
