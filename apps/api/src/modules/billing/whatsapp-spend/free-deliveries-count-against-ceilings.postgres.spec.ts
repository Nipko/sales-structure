import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappSpendService } from './whatsapp-spend.service';
import { declareSpendCeiling, type SpendQuery } from './spend-ledger';

/**
 * ═══ A CEILING ON MESSAGES HAS TO COUNT THE FREE ONES ═══
 *
 * `cap_kind = 'both'` exists for exactly one scenario, and the migration that
 * introduced it says so in as many words: *"Un tenant puede quemar la franquicia
 * entera sin gastar un centavo… que es el momento en que el techo de dinero
 * empieza a servir, ya tarde."* A thousand free service messages a month, per
 * number, cost nothing — so a money ceiling cannot see them, and a business
 * that wants to bound how much its agent TALKS has to bound the count.
 *
 * It could not. `reserve` computed `chargeable = deliveries - freeGranted`,
 * which is zero for every free message, and passed THAT as the delivery count
 * for the `account`, `business`, `contact` and `task` counters. So a free
 * delivery moved neither `used_deliveries` nor the money, on any ceiling a
 * tenant had set. With `both` configured, the whole free thousand still went
 * out untouched — the one thing the ceiling was built to prevent.
 *
 * ── WHY THE OLD TEST DID NOT SEE IT ─────────────────────────────────────────
 *
 * `spend-ceiling.postgres.spec.ts` asserts the message ceiling stops a send,
 * and it is right: it calls `reserveAgainstCounter` directly with
 * `{ deliveries: 1, amountMinor: 0 }`. The SQL was never the defect. The only
 * production caller never passed those arguments, so the suite proved a
 * property of a statement nothing invoked that way. These cases therefore drive
 * `WhatsappSpendService.authorize` — the path the processor actually takes —
 * and read the counters back from the table rather than from a return value.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;

(connection ? describe : describe.skip)('free deliveries against a tenant-set ceiling', () => {
    const schema = `tenant_freecap_${randomUUID().replace(/-/g, '')}`;
    const TENANT = randomUUID();
    const ACCOUNT = '15550001111';
    let client: Client;
    let prisma: PrismaService;
    let priorUrl: string | undefined;
    jest.setTimeout(180_000);

    const q = async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows;
    const query: SpendQuery = async <R = any[]>(sql: string, params: any[] = []): Promise<R> =>
        (await client.query(sql, params)).rows as any;

    /** One free service message, through the path production takes. */
    const send = (over: Record<string, unknown> = {}) =>
        new WhatsappSpendService(prisma as any).authorize(schema, {
            effectKey: `fc-${randomUUID().replace(/-/g, '')}`,
            identity: {
                tenantId: TENANT, channelType: 'whatsapp', channelAccountId: ACCOUNT,
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

    const counter = async (kind: string) => (await q(
        `SELECT cap_kind, cap_minor, cap_deliveries, used_deliveries, free_deliveries,
                reserved_minor, settled_minor
           FROM "${schema}".whatsapp_spend_counters
          WHERE scope_kind = $1 AND period_key = '2026-10'`, [kind]))[0];

    beforeAll(async () => {
        const url = new URL(connection!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)
            || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new Client({ connectionString: connection });
        await client.connect();
        await q(`CREATE SCHEMA "${schema}"`);
        const tenantSchema = readFileSync(
            resolve(__dirname, '../../../../prisma/tenant-schema.sql'), 'utf8');
        const block = tenantSchema.split('-- BEGIN WHATSAPP SPEND LEDGER')[1]
            ?.split('-- END WHATSAPP SPEND LEDGER')[0];
        if (!block) throw new Error('tenant_schema_block_missing');
        for (const statement of block.replace(/^\s*--.*$/gm, '').split(';').filter(v => v.trim())) {
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
            if (!/^tenant_freecap_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await q(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await client.end(); }
    });

    beforeEach(async () => {
        await q(`TRUNCATE "${schema}".whatsapp_spend_allocations,
                          "${schema}".whatsapp_spend_reservations,
                          "${schema}".whatsapp_spend_counters`);
    });

    /** A standing ceiling of three messages on this account, with money too. */
    const ceilingOfThree = () => declareSpendCeiling(query, schema, {
        scope: { kind: 'account', key: ACCOUNT, period: '2026-10' },
        capMinor: 100_000, capDeliveries: 3, currency: 'USD',
    } as any);

    it('moves the account counter even when the delivery costs nothing', async () => {
        await send();
        await ceilingOfThree();
        await send();

        const account = await counter('account');
        // The whole defect in one number. It was 0: `chargeable` is zero for a
        // free message, and that zero was what the account counter was told.
        //
        // Two, not one: the counter accumulates from the start of the month, and
        // declaring a ceiling half way through does not wipe what the number has
        // already sent. A ceiling that reset the count would be a ceiling a
        // tenant could raise by re-declaring it.
        expect(Number(account.used_deliveries)).toBe(2);
        // And no money moved, which was always right: free is free.
        expect(Number(account.reserved_minor)).toBe(0);
    });

    it('stops at the message ceiling while the free thousand is still untouched', async () => {
        // THE CASE `both` EXISTS FOR. The allowance has 997 free messages left,
        // the money ceiling is nowhere near, and the tenant said "three".
        await ceilingOfThree();
        expect((await send()).outcome).toBe('reserved');
        expect((await send()).outcome).toBe('reserved');
        expect((await send()).outcome).toBe('reserved');

        const fourth = await send();
        expect(fourth.outcome).toBe('blocked');
        expect((fourth as any).block.code).toMatch(/cap_/);

        const allowance = await counter('number_month');
        // Proof the refusal came from the tenant's ceiling and not from Meta's
        // quota: the free thousand has barely been touched.
        expect(Number(allowance.free_deliveries)).toBe(3);
        expect(Number(allowance.cap_deliveries)).toBe(1000);
    });

    it('gives the count back when the effect is released', async () => {
        // Counting a free delivery is only safe if it comes back. Meta charges
        // on DELIVERY, so a send that never happened must not hold a slot on a
        // tenant's ceiling any more than it holds one on the allowance.
        await ceilingOfThree();
        const effectKey = `fc-release-${randomUUID().replace(/-/g, '')}`;
        const first = await send({ effectKey });
        expect(first.outcome).toBe('reserved');
        expect(Number((await counter('account')).used_deliveries)).toBe(1);

        // The provider refused it, so nothing was delivered and nothing is owed.
        await new WhatsappSpendService(prisma as any).recordOutcome(schema, effectKey,
            { kind: 'rejected', errorCode: 'not_sent' } as any);

        const account = await counter('account');
        expect(Number(account.used_deliveries)).toBe(0);
        const allowance = await counter('number_month');
        expect(Number(allowance.free_deliveries)).toBe(0);
    });

    it('still charges money only for the chargeable half', async () => {
        // The other half of the contract. Counting free deliveries against a
        // message ceiling must not make them cost anything: a tenant who set
        // only a MONEY ceiling must see the free thousand pass untouched.
        await declareSpendCeiling(query, schema, {
            scope: { kind: 'account', key: ACCOUNT, period: '2026-10' },
            capMinor: 1, currency: 'USD',
        } as any);
        for (let n = 0; n < 3; n++) expect((await send()).outcome).toBe('reserved');

        const account = await counter('account');
        expect({ used: Number(account.used_deliveries), reserved: Number(account.reserved_minor) })
            .toEqual({ used: 3, reserved: 0 });
    });
});
