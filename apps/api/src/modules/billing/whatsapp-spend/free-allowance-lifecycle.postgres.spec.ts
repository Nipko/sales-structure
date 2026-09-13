import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappSpendService } from './whatsapp-spend.service';

/**
 * ═══ META GIVES AWAY DELIVERIES, NOT ATTEMPTS ═══
 *
 * A thousand free service messages per number per calendar month, charged by
 * Meta on DELIVERY. We consumed them in `authorize`, before the POST, and never
 * gave one back:
 *
 *   · a thousand failures exhausted the month's allowance, and from then on the
 *     business paid for every reply while Meta was still giving them away;
 *   · a number with a configuration problem — a rejected template, a closed
 *     window, an invalid recipient — burned the whole allowance in minutes
 *     without a single message arriving.
 *
 * The same shape applied to any delivery-capped counter: `used_deliveries` went
 * up on reservation and never came down, so a refusal consumed ceiling exactly
 * like a delivery.
 *
 * ── THE PROVISIONAL ALLOCATION ──────────────────────────────────────────────
 *
 *   authorize / accepted   HOLDS    — committed; a ceiling must count it
 *   delivered / read       CONFIRMS — once, and the hold stays
 *   failed / rejected      RETURNS  — Meta bills nothing, so neither do we
 *   indeterminate          HOLDS    — nobody knows; it stays committed
 *
 * Every number below is read from the counter table, never from the return
 * value of the call that wrote it: the property is that two records agree, and
 * a probe that computed one from the other would agree with the bug.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;

integration('the free allowance is spent on delivery, not on attempts', () => {
    const schema = `tenant_allowlife_${randomUUID().replace(/-/g, '')}`;
    const TENANT = randomUUID();
    const NUMBER = '15550001111';
    let client: Client;
    let prisma: PrismaService;
    let priorUrl: string | undefined;
    jest.setTimeout(180_000);

    const q = async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows;
    const service = () => new WhatsappSpendService(prisma as any);

    const authorize = (effectKey: string, over: Record<string, unknown> = {}) =>
        service().authorize(schema, {
            effectKey,
            identity: {
                tenantId: TENANT, channelType: 'whatsapp', channelAccountId: NUMBER,
                channelAddress: '+1 555 000 1111',
                payerKind: 'business_direct', payerWabaId: 'waba-1', payerBusinessId: 'biz-1',
                credentialId: 'cred-1', credentialSource: 'system_user',
                recipientScope: 'customer', recipientRef: 'contact-1',
                // `service` is the only category Meta's allowance covers.
                category: 'service', market: 'CO', currency: 'USD',
            } as any,
            contactId: 'contact-1', deliveries: 1,
            wabaTimeZone: 'America/Bogota', admissionReason: 'inbound_reply',
            disposition: 'reactive', allowUnknownCost: true,
            freeAllowanceEligible: true, freeAllowance: 1_000,
            at: new Date('2026-10-05T12:00:00.000Z'),
            ...over,
        } as any);

    /** One authorised, sent effect holding a free slot. */
    const sent = async (over: Record<string, unknown> = {}) => {
        const effectKey = `fa-${randomUUID().replace(/-/g, '')}`;
        const providerMessageId = `wamid.${randomUUID().replace(/-/g, '')}`;
        const result = await authorize(effectKey, over);
        expect(result.outcome).toBe('reserved');
        await q(`UPDATE "${schema}".whatsapp_spend_reservations
                    SET provider_message_id = $2 WHERE effect_key = $1`,
            [effectKey, providerMessageId]);
        return {
            effectKey, providerMessageId,
            freeDeliveries: Number((result as any).reservation.money.freeDeliveries),
        };
    };

    /** The allowance counter, straight from the table. */
    const allowance = async (period = '2026-10') => (await q(
        `SELECT cap_deliveries, used_deliveries, free_deliveries, confirmed_deliveries
           FROM "${schema}".whatsapp_spend_counters
          WHERE scope_kind = 'number_month' AND period_key = $1`, [period]))[0];

    const held = async (period?: string) => Number((await allowance(period)).used_deliveries);
    const confirmed = async (period?: string) =>
        Number((await allowance(period)).confirmed_deliveries);

    const receipt = (providerMessageId: string, status: 'delivered' | 'read' | 'failed') =>
        service().applyDeliveryReceipt(schema, { providerMessageId, status });

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
        for (const statement of block.replace(/^\s*--.*$/gm, '').split(';')
            .filter(value => value.trim())) {
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
            if (!/^tenant_allowlife_[a-f0-9]{32}$/.test(schema)) {
                throw new Error('invalid_cleanup_scope');
            }
            await q(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await client.end(); }
    });

    beforeEach(async () => {
        await q(`TRUNCATE "${schema}".whatsapp_spend_allocations,
                          "${schema}".whatsapp_spend_reservations,
                          "${schema}".whatsapp_spend_counters,
                          "${schema}".whatsapp_receipt_inbox`);
    });

    // ── THE FOUR TRANSITIONS ────────────────────────────────────────────────

    it('holds a slot at authorisation, without confirming it', async () => {
        const effect = await sent();
        expect(effect.freeDeliveries).toBe(1);
        expect(await held()).toBe(1);
        // Held is not delivered. Meta has not billed anything yet, and neither
        // have we decided it never will.
        expect(await confirmed()).toBe(0);
    });

    it('confirms the slot once, on delivery', async () => {
        const effect = await sent();
        await receipt(effect.providerMessageId, 'delivered');
        expect(await held()).toBe(1);
        expect(await confirmed()).toBe(1);
    });

    it('confirms only once when `read` follows `delivered`', async () => {
        // Meta sends both for the same message, and `read` can arrive first.
        const effect = await sent();
        await receipt(effect.providerMessageId, 'delivered');
        await receipt(effect.providerMessageId, 'read');
        expect(await confirmed()).toBe(1);
    });

    it('gives the slot back when the message never arrived', async () => {
        // THE DEFECT. Meta does not bill an undelivered message, so the free
        // slot it would have used was never used.
        const effect = await sent();
        expect(await held()).toBe(1);
        await receipt(effect.providerMessageId, 'failed');
        expect(await held()).toBe(0);
        expect(await confirmed()).toBe(0);
    });

    it('keeps the slot held while nobody can say what happened', async () => {
        // `indeterminate` is not a release. The request went out; the slot may
        // well have been spent, and giving it back would be inventing evidence
        // in the direction that overspends.
        const effect = await sent();
        await q(`UPDATE "${schema}".whatsapp_spend_reservations
                    SET state = 'indeterminate' WHERE effect_key = $1`, [effect.effectKey]);
        expect(await held()).toBe(1);
        expect(await confirmed()).toBe(0);
    });

    it('gives the slot back on a crash before the POST', async () => {
        // The one recovery that is PROVABLE: the worker took the send right and
        // died before touching the network, so nothing was delivered and the
        // slot is owed back the moment the effect is released.
        const effect = await sent();
        await service().recordOutcome(schema, effect.effectKey,
            { kind: 'rejected', errorCode: 'never_sent' });
        expect(await held()).toBe(0);
    });

    it('a thousand failures leave the allowance untouched', async () => {
        // The headline. Twenty is enough to establish it — the property is that
        // the number returns to where it started, not that it survives exactly
        // a thousand.
        for (let attempt = 0; attempt < 20; attempt += 1) {
            const effect = await sent();
            await receipt(effect.providerMessageId, 'failed');
        }
        expect(await held()).toBe(0);
        expect(await confirmed()).toBe(0);
    });

    // ── THE BOUNDARY ────────────────────────────────────────────────────────

    it('gives the thousandth away free and charges the thousand-and-first', async () => {
        // Seeded straight into the counter: sending 999 real messages through
        // the engine would prove the same thing much more slowly.
        await authorize(`seed-${randomUUID()}`);
        await q(`UPDATE "${schema}".whatsapp_spend_counters
                    SET used_deliveries = 999, free_deliveries = 999, confirmed_deliveries = 999
                  WHERE scope_kind = 'number_month'`);

        const thousandth = await sent();
        expect(thousandth.freeDeliveries).toBe(1);
        expect(await held()).toBe(1_000);

        const overflow = await sent();
        expect(overflow.freeDeliveries).toBe(0);
        // Unchanged: the allowance is full and the effect is chargeable.
        expect(await held()).toBe(1_000);
        const [row] = await q(
            `SELECT free_deliveries, charged_deliveries FROM
                "${schema}".whatsapp_spend_reservations WHERE effect_key = $1`,
            [overflow.effectKey]);
        expect({ free: Number(row.free_deliveries), charged: Number(row.charged_deliveries) })
            .toEqual({ free: 0, charged: 1 });
    });

    it('re-opens the last slot when the message that took it failed', async () => {
        // 1000 held, one fails, 999 held — and the next message is free again.
        // Under the old behaviour the month was over.
        await authorize(`seed-${randomUUID()}`);
        await q(`UPDATE "${schema}".whatsapp_spend_counters
                    SET used_deliveries = 999, free_deliveries = 999, confirmed_deliveries = 999
                  WHERE scope_kind = 'number_month'`);
        const thousandth = await sent();
        expect(await held()).toBe(1_000);

        await receipt(thousandth.providerMessageId, 'failed');
        expect(await held()).toBe(999);

        const next = await sent();
        expect(next.freeDeliveries).toBe(1);
    });

    // ── THE MONTH, WHICH IS THE WABA'S OWN ──────────────────────────────────

    it('starts a fresh allowance in the next calendar month of the WABA', async () => {
        const first = await sent();
        await receipt(first.providerMessageId, 'delivered');
        expect(await confirmed('2026-10')).toBe(1);

        // November in Bogotá. A different counter row entirely.
        const second = await sent({ at: new Date('2026-11-03T12:00:00.000Z') });
        expect(second.freeDeliveries).toBe(1);
        expect(await held('2026-11')).toBe(1);
        // And October is untouched by it.
        expect(await held('2026-10')).toBe(1);
    });

    it('returns a slot to the month it was taken from, not the month it failed in', async () => {
        // A message sent on the 31st can fail on the 1st. Giving the slot back
        // to the new month would inflate it and quietly shrink the old one.
        const october = await sent({ at: new Date('2026-10-31T20:00:00.000Z') });
        expect(await held('2026-10')).toBe(1);
        await receipt(october.providerMessageId, 'failed');
        expect(await held('2026-10')).toBe(0);
        const november = await allowance('2026-11');
        expect(november).toBeUndefined();
    });

    // ── CONCURRENCY AND REPLAY ──────────────────────────────────────────────

    it('never grants the same last slot to two workers', async () => {
        await authorize(`seed-${randomUUID()}`);
        await q(`UPDATE "${schema}".whatsapp_spend_counters
                    SET used_deliveries = 999, free_deliveries = 999, confirmed_deliveries = 999
                  WHERE scope_kind = 'number_month'`);

        const [a, b] = await Promise.all([
            authorize(`race-a-${randomUUID()}`), authorize(`race-b-${randomUUID()}`),
        ]);
        const granted = [a, b].map(result =>
            Number((result as any).reservation?.money?.freeDeliveries ?? 0));
        expect(granted.filter(value => value === 1)).toHaveLength(1);
        expect(await held()).toBe(1_000);
    });

    it('does not double-return a slot when the receipt is redelivered', async () => {
        const effect = await sent();
        await receipt(effect.providerMessageId, 'failed');
        expect(await held()).toBe(0);
        // Meta redelivers. The reservation refuses to leave `released`, so the
        // counter is not touched a second time and cannot go negative.
        await receipt(effect.providerMessageId, 'failed');
        expect(await held()).toBe(0);
    });

    it('does not let a retry of one effect eat the month a slot at a time', async () => {
        // A retry storm on a single effect: each attempt asks for a slot, and
        // each attempt after the first must hand back what it took, because the
        // reservation it adopts already holds one.
        const effectKey = `retry-${randomUUID().replace(/-/g, '')}`;
        expect((await authorize(effectKey)).outcome).toBe('reserved');
        for (let attempt = 0; attempt < 5; attempt += 1) {
            expect((await authorize(effectKey)).outcome).toBe('adopted');
        }
        expect(await held()).toBe(1);
    });

    it('holds nothing for a category the allowance does not cover', async () => {
        // Only `service` is free. A marketing or utility message consumes no
        // slot, and granting one on a guess is how a business loses the
        // allowance twice: once on the guess and once on the real reply.
        const marketing = await sent({
            identity: {
                tenantId: TENANT, channelType: 'whatsapp', channelAccountId: NUMBER,
                channelAddress: '+1 555 000 1111',
                payerKind: 'business_direct', payerWabaId: 'waba-1', payerBusinessId: 'biz-1',
                credentialId: 'cred-1', credentialSource: 'system_user',
                recipientScope: 'customer', recipientRef: 'contact-1',
                category: 'marketing', market: 'CO', currency: 'USD',
            },
            freeAllowanceEligible: false,
        });
        expect(marketing.freeDeliveries).toBe(0);
        expect(await held()).toBe(0);
    });
});
