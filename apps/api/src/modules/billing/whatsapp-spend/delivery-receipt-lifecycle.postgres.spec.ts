import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappSpendService } from './whatsapp-spend.service';

/**
 * ═══ ACCEPTED IS NOT DELIVERED, AND DELIVERED IS WHAT META BILLS ═══
 *
 * The POST answers with a wamid. That is Meta saying "I have it" — not "the
 * phone has it", and from October 2026 the charge lands on DELIVERY. So the
 * sending attempt can never be the last word on the money: it reserves, it
 * sends, and it leaves the effect counted-but-unresolved.
 *
 * Nothing used to resolve it. Every reservation stayed on the books for ever;
 * every ceiling filled with messages that had arrived or failed hours earlier;
 * the exposure report showed a month of held money for an account that had
 * settled its bill. The status webhook carried the missing fact and dropped it
 * on the floor.
 *
 * These tests run against real PostgreSQL because the property is about what
 * the COUNTERS say afterwards, and the counters are SQL. The oracle for each
 * one is read independently: the counter row, not the return value of the call
 * that wrote it.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;

integration('what a delivery receipt does to the money', () => {
    const schema = `tenant_receipt_${randomUUID().replace(/-/g, '')}`;
    const TENANT = randomUUID();
    let client: Client;
    let prisma: PrismaService;
    let priorUrl: string | undefined;
    jest.setTimeout(120_000);

    const q = async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows;
    const service = () => new WhatsappSpendService(prisma as any);

    const authorize = (effectKey: string, over: Record<string, unknown> = {}) =>
        service().authorize(schema, {
            effectKey,
            identity: {
                tenantId: TENANT, channelType: 'whatsapp', channelAccountId: '15550001111',
                channelAddress: '+1 555 000 1111',
                payerKind: 'business_direct', payerWabaId: 'waba-1', payerBusinessId: 'biz-1',
                credentialId: 'cred-1', credentialSource: 'system_user',
                recipientScope: 'customer', recipientRef: 'contact-1',
                category: 'marketing', market: 'CO', currency: 'USD',
            } as any,
            contactId: 'contact-1', deliveries: 1,
            wabaTimeZone: 'America/Bogota', admissionReason: 'campaign',
            disposition: 'proactive', allowUnknownCost: true,
            at: new Date('2026-10-05T12:00:00.000Z'),
            ...over,
        } as any);

    /** One reserved, sent effect with a wamid on it — the state after a POST. */
    const sent = async (over: Record<string, unknown> = {}) => {
        const effectKey = `rc-${randomUUID().replace(/-/g, '')}`;
        const providerMessageId = `wamid.${randomUUID().replace(/-/g, '')}`;
        const result = await authorize(effectKey, over);
        expect(result.outcome).toBe('reserved');
        await q(`UPDATE "${schema}".whatsapp_spend_reservations
                    SET provider_message_id = $2 WHERE effect_key = $1`,
            [effectKey, providerMessageId]);
        return { effectKey, providerMessageId,
            reservedMinor: Number((result as any).reservation.money.reservedMinor) };
    };

    const row = async (effectKey: string) => (await q(
        `SELECT state, charged_minor, evidence, remote_state, transmit_state
           FROM "${schema}".whatsapp_spend_reservations WHERE effect_key = $1`, [effectKey]))[0];

    /**
     * The account's own counter, read straight from the table.
     *
     * Deliberately not derived from the reservation: the whole point of
     * settling is that two numbers move together, and a probe that computed one
     * from the other would agree with the bug.
     */
    const accountCounter = async () => (await q(
        `SELECT reserved_minor, settled_minor, released_minor
           FROM "${schema}".whatsapp_spend_counters
          WHERE scope_kind = 'account' ORDER BY updated_at DESC LIMIT 1`))[0];

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
            if (!/^tenant_receipt_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await q(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await client.end(); }
    });

    beforeEach(async () => {
        await q(`TRUNCATE "${schema}".whatsapp_spend_allocations,
                          "${schema}".whatsapp_spend_reservations,
                          "${schema}".whatsapp_spend_counters`);
    });

    it('settles a delivered message, and moves the counter with it', async () => {
        const effect = await sent();
        const before = await accountCounter();
        expect(Number(before.reserved_minor)).toBe(effect.reservedMinor);

        await expect(service().applyDeliveryReceipt(schema, {
            providerMessageId: effect.providerMessageId, status: 'delivered',
        })).resolves.toBe('settled');

        const after = await accountCounter();
        expect(Number(after.reserved_minor)).toBe(0);
        expect(Number(after.settled_minor)).toBe(effect.reservedMinor);
        expect(Number(after.released_minor)).toBe(0);
        const stored = await row(effect.effectKey);
        expect(stored.state).toBe('settled');
        expect(stored.evidence).toBe('provider_reported_delivery');
        // The right to send is spent with the outcome: nothing may claim it again.
        expect(stored.transmit_state).toBe('resolved');
    });

    it('gives the whole reservation back when the message never arrived', async () => {
        const effect = await sent();

        await expect(service().applyDeliveryReceipt(schema, {
            providerMessageId: effect.providerMessageId, status: 'failed',
            errorCode: 'wa_131047',
        })).resolves.toBe('released');

        const after = await accountCounter();
        expect(Number(after.reserved_minor)).toBe(0);
        expect(Number(after.settled_minor)).toBe(0);
        expect(Number(after.released_minor)).toBe(effect.reservedMinor);
        expect((await row(effect.effectKey)).state).toBe('released');
    });

    it('settles at zero when Meta says the delivery was not billable', async () => {
        // The ONLY authority that can price a delivered message at zero. The
        // reservation was pessimistic on purpose; Meta saying `billable: false`
        // is what makes the free allowance real rather than assumed.
        const effect = await sent();

        await expect(service().applyDeliveryReceipt(schema, {
            providerMessageId: effect.providerMessageId, status: 'delivered',
            pricing: { billable: false, category: 'marketing', model: 'PMP' },
        })).resolves.toBe('settled');

        const after = await accountCounter();
        expect(Number(after.settled_minor)).toBe(0);
        // Nothing was spent, so everything reserved goes back.
        expect(Number(after.released_minor)).toBe(effect.reservedMinor);
        expect((await row(effect.effectKey)).evidence).toBe('provider_reported_free');
    });

    it('treats a read receipt as the delivery it implies, even arriving first', async () => {
        // Meta does not promise an order. `read` before `delivered` used to mean
        // the money was never resolved at all, because only one of the two was
        // modelled.
        const effect = await sent();
        await expect(service().applyDeliveryReceipt(schema, {
            providerMessageId: effect.providerMessageId, status: 'read',
        })).resolves.toBe('settled');
        expect(Number((await accountCounter()).settled_minor)).toBe(effect.reservedMinor);
    });

    it('changes nothing on a second receipt for the same message', async () => {
        const effect = await sent();
        await service().applyDeliveryReceipt(schema,
            { providerMessageId: effect.providerMessageId, status: 'delivered' });
        const afterFirst = await accountCounter();

        // Meta redelivers webhooks. Two more receipts for the same message, one
        // of them the `read` that normally follows.
        await expect(service().applyDeliveryReceipt(schema,
            { providerMessageId: effect.providerMessageId, status: 'delivered' }))
            .resolves.toBe('ignored');
        await expect(service().applyDeliveryReceipt(schema,
            { providerMessageId: effect.providerMessageId, status: 'read' }))
            .resolves.toBe('ignored');

        const afterAll = await accountCounter();
        expect(afterAll).toEqual(afterFirst);
    });

    it('never un-bills a message a later failure claims did not arrive', async () => {
        // Out of order and contradictory. Once Meta has billed a delivery, a
        // stray `failed` behind it must not hand the money back: the settled
        // state is the record of a charge that happened.
        const effect = await sent();
        await service().applyDeliveryReceipt(schema,
            { providerMessageId: effect.providerMessageId, status: 'delivered' });

        await expect(service().applyDeliveryReceipt(schema,
            { providerMessageId: effect.providerMessageId, status: 'failed', errorCode: 'wa_131026' }))
            .resolves.toBe('ignored');

        const after = await accountCounter();
        expect(Number(after.settled_minor)).toBe(effect.reservedMinor);
        expect(Number(after.released_minor)).toBe(0);
    });

    it('does nothing on acceptance, which the send path already recorded', async () => {
        const effect = await sent();
        await expect(service().applyDeliveryReceipt(schema,
            { providerMessageId: effect.providerMessageId, status: 'sent' }))
            .resolves.toBe('ignored');
        expect(Number((await accountCounter()).reserved_minor)).toBe(effect.reservedMinor);
    });

    it('says so plainly when a receipt belongs to no reservation', async () => {
        // Messages sent before metering existed, or from another tool on the
        // same number. Not an error, and not something to invent a row for.
        await expect(service().applyDeliveryReceipt(schema,
            { providerMessageId: 'wamid.NOT_OURS', status: 'delivered' }))
            .resolves.toBe('unknown_receipt');
    });

    it('resolves an effect the send path had to leave pending', async () => {
        // The normal shape for a timeout: the POST answered too late or not at
        // all, the attempt retained the exposure, and the receipt arrives
        // afterwards. `settleReservation` used to accept `held` and nothing
        // else, so this row could never be resolved by anything.
        const effect = await sent();
        await service().recordOutcome(schema, effect.effectKey,
            { kind: 'delivered_unpriced', providerMessageId: effect.providerMessageId });
        expect((await row(effect.effectKey)).state).toBe('pending_reconciliation');

        await expect(service().applyDeliveryReceipt(schema,
            { providerMessageId: effect.providerMessageId, status: 'delivered' }))
            .resolves.toBe('settled');

        const after = await accountCounter();
        expect(Number(after.reserved_minor)).toBe(0);
        expect(Number(after.settled_minor)).toBe(effect.reservedMinor);
    });

    it('resolves an effect nobody could say anything about', async () => {
        // `indeterminate`: the request went out and no answer came back. The
        // receipt is the first thing that can say what happened, and a failure
        // here is a genuine release rather than a guess.
        const effect = await sent();
        await q(`UPDATE "${schema}".whatsapp_spend_reservations
                    SET state = 'indeterminate' WHERE effect_key = $1`, [effect.effectKey]);

        await expect(service().applyDeliveryReceipt(schema, {
            providerMessageId: effect.providerMessageId, status: 'failed', errorCode: 'wa_131026',
        })).resolves.toBe('released');
        expect(Number((await accountCounter()).released_minor)).toBe(effect.reservedMinor);
    });

    it('survives two receipts racing for the same message', async () => {
        // Two workers, one webhook redelivered. Exactly one may move the money,
        // and the loser must not double it — enforced by the state in the WHERE
        // clause rather than by anything this process remembers.
        const effect = await sent();
        const [left, right] = await Promise.all([
            service().applyDeliveryReceipt(schema,
                { providerMessageId: effect.providerMessageId, status: 'delivered' }),
            service().applyDeliveryReceipt(schema,
                { providerMessageId: effect.providerMessageId, status: 'read' }),
        ]);
        expect([left, right].filter(result => result === 'settled')).toHaveLength(1);
        expect(Number((await accountCounter()).settled_minor)).toBe(effect.reservedMinor);
    });
});
