import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappSpendService } from './whatsapp-spend.service';

/**
 * ═══ WHAT NEVER GETS A RECEIPT ═══
 *
 * Two states outlive the webhook, and they are not the same problem.
 *
 * `pending_reconciliation` means the message ARRIVED and nobody could price it:
 * a timeout carrying a wamid, a rate card with no row, a currency that was
 * never established. The delivery is known; only the amount is missing. After a
 * grace period the reservation's own figure is the honest answer — it is an
 * upper bound by construction, so it overstates a bill rather than hiding one,
 * which is the direction a business can check and correct.
 *
 * `indeterminate` means nobody knows whether it arrived at all. Waiting does
 * not turn not-knowing into evidence, and the two possible truths have opposite
 * consequences for somebody's money. Those go to a person, and the person has
 * to say why.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;

integration('what the reconciler closes, and what it refuses to', () => {
    const schema = `tenant_reconcile_${randomUUID().replace(/-/g, '')}`;
    const TENANT = randomUUID();
    let client: Client;
    let prisma: PrismaService;
    let priorUrl: string | undefined;
    jest.setTimeout(120_000);

    const q = async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows;
    const service = () => new WhatsappSpendService(prisma as any);

    /** One reservation, forced into a state and aged by hand. */
    const reserve = async (state: string, ageHours: number) => {
        const effectKey = `rec-${randomUUID().replace(/-/g, '')}`;
        const result = await service().authorize(schema, {
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
        } as any);
        expect(result.outcome).toBe('reserved');
        // A wamid, because every state past `held` has one: it is what the POST
        // answered, and it is how an invoice line finds this row again.
        const providerMessageId = `wamid.${effectKey}`;
        await q(`UPDATE "${schema}".whatsapp_spend_reservations
                    SET state = $2, updated_at = clock_timestamp() - make_interval(hours => $3),
                        provider_message_id = $4
                  WHERE effect_key = $1`, [effectKey, state, ageHours, providerMessageId]);
        return { effectKey, providerMessageId,
            reservedMinor: Number((result as any).reservation.money.reservedMinor) };
    };

    const row = async (effectKey: string) => (await q(
        `SELECT state, charged_minor, evidence, reason
           FROM "${schema}".whatsapp_spend_reservations WHERE effect_key = $1`, [effectKey]))[0];


    /** Read from the counter table itself, never derived from the reservation. */
    const counter = async () => (await q(
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
            if (!/^tenant_reconcile_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await q(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await client.end(); }
    });

    beforeEach(async () => {
        await q(`TRUNCATE "${schema}".whatsapp_spend_allocations,
                          "${schema}".whatsapp_spend_reservations,
                          "${schema}".whatsapp_spend_counters`);
    });

    it('records a delivery that waited out the grace as an ESTIMATE, not a charge', async () => {
        // ═══ WAITING IS NOT EVIDENCE ═══
        //
        // This used to settle at the reserved amount under the evidence string
        // `reconciled_at_reserved_amount` — a phrase that reads like an invoice
        // and means "the clock ran out". The bound is the same; what changes is
        // that it is now called what it is, and nothing appears in the BILL
        // that no authority stated.
        const effect = await reserve('pending_reconciliation', 100);

        await expect(service().reconcile(schema, { graceHours: 72 }))
            .resolves.toMatchObject({ estimated: 1, estimatedMinor: effect.reservedMinor });

        const after = await counter();
        // The committed money has not moved: a ceiling still fills the same way.
        expect(Number(after.reserved_minor)).toBe(effect.reservedMinor);
        expect(Number(after.settled_minor)).toBe(0);
        const resolved = await row(effect.effectKey);
        expect(resolved.state).toBe('estimated');
        expect(resolved.reason).toBe('upper_bound_without_invoice');
        // An estimate carries no charge. The CHECK enforces it; this states why.
        expect(resolved.charged_minor).toBeNull();
    });

    it('leaves one that is still inside the grace alone', async () => {
        // The receipt may yet arrive, and while it might, "no price yet" is a
        // more accurate thing to say than "our best guess".
        const effect = await reserve('pending_reconciliation', 2);
        await expect(service().reconcile(schema, { graceHours: 72 }))
            .resolves.toMatchObject({ estimated: 0 });
        expect((await row(effect.effectKey)).state).toBe('pending_reconciliation');
    });

    it('finds nothing to do on a second pass', async () => {
        await reserve('pending_reconciliation', 100);
        await service().reconcile(schema, { graceHours: 72 });
        const afterFirst = await counter();

        await expect(service().reconcile(schema, { graceHours: 72 }))
            .resolves.toMatchObject({ estimated: 0 });
        expect(await counter()).toEqual(afterFirst);
    });

    it('never turns an acceptance into a charge, however long it waits', async () => {
        // The defect this whole state exists for: a `wamid` is Meta saying it
        // HAS the message. If it was never delivered, nobody is billed — and no
        // amount of elapsed time can establish that it was.
        const effect = await reserve('accepted', 1000);
        await expect(service().reconcile(schema, { graceHours: 72 }))
            .resolves.toMatchObject({ estimated: 0, needsPerson: 1 });
        const after = await row(effect.effectKey);
        expect(after.state).toBe('accepted');
        expect(after.charged_minor).toBeNull();
        expect(Number((await counter()).settled_minor)).toBe(0);
    });

    it('settles an estimate only against an invoice line, with its provenance', async () => {
        // THE authority, and the only road from an estimate to a charge.
        const effect = await reserve('pending_reconciliation', 100);
        await service().reconcile(schema, { graceHours: 72 });
        expect((await row(effect.effectKey)).state).toBe('estimated');

        await expect(service().settleFromInvoice(schema, [{
            providerMessageId: effect.providerMessageId, chargedMinor: 1,
            currency: 'USD', source: 'meta-waba-invoice', version: '2026-10',
        }])).resolves.toMatchObject({ applied: 1 });

        const resolved = await row(effect.effectKey);
        expect(resolved.state).toBe('settled');
        expect(Number(resolved.charged_minor)).toBe(1);
        // With the document it came from. An amount with no provenance is
        // indistinguishable from a number somebody typed.
        expect(resolved.evidence).toBe('provider_invoice:meta-waba-invoice@2026-10');
        // Read from the counter, not derived from the reservation: the whole
        // point of settling is that two numbers move together.
        expect(Number((await counter()).settled_minor)).toBe(1);
    });

    it('refuses an invoice line that charges more than was ever reserved', async () => {
        // The counters can only settle what was allocated — `applyToCounters`
        // clamps — so a larger figure would be written on the reservation and
        // silently truncated in the ceiling: two numbers disagreeing with
        // nobody told. And the disagreement matters on its own, because the
        // reserved amount is an upper bound from the published rate.
        const effect = await reserve('pending_reconciliation', 100);
        await expect(service().settleFromInvoice(schema, [{
            providerMessageId: effect.providerMessageId,
            chargedMinor: effect.reservedMinor + 1,
            currency: 'USD', source: 'meta-waba-invoice', version: '2026-10',
        }])).resolves.toMatchObject({
            applied: 0, overReserved: [effect.providerMessageId],
        });
        expect((await row(effect.effectKey)).state).toBe('pending_reconciliation');
        expect(Number((await counter()).settled_minor)).toBe(0);
    });

    it('refuses an invoice line whose currency is not the reservation’s', async () => {
        // COP minor units added to a USD counter are off by a factor of four
        // thousand and look entirely plausible.
        const effect = await reserve('pending_reconciliation', 100);
        await expect(service().settleFromInvoice(schema, [{
            providerMessageId: effect.providerMessageId, chargedMinor: 3_500,
            currency: 'COP', source: 'meta-waba-invoice', version: '2026-10',
        }])).resolves.toMatchObject({
            applied: 0, currencyMismatch: [effect.providerMessageId],
        });
        expect((await row(effect.effectKey)).state).toBe('pending_reconciliation');
        expect(Number((await counter()).settled_minor)).toBe(0);
    });

    it('names the invoice lines that match no reservation of ours', async () => {
        await expect(service().settleFromInvoice(schema, [{
            providerMessageId: 'wamid.SOMEBODY_ELSE', chargedMinor: 9,
            currency: 'USD', source: 'meta-waba-invoice', version: '2026-10',
        }])).resolves.toMatchObject({ applied: 0, unknown: ['wamid.SOMEBODY_ELSE'] });
    });

    it('never decides an effect nobody can confirm, however long it waits', async () => {
        const effect = await reserve('indeterminate', 5_000);

        const outcome = await service().reconcile(schema, { graceHours: 72 });
        expect(outcome.settled).toBe(0);
        expect(outcome.needsPerson).toBe(1);
        expect((await row(effect.effectKey)).state).toBe('indeterminate');
        // And the money is still counted, which is the honest position: it may
        // well have been spent.
        expect(Number((await counter()).reserved_minor)).toBe(effect.reservedMinor);

        const waiting = await service().awaitingResolution(schema, { graceHours: 72 });
        expect(waiting.map(entry => entry.effectKey)).toEqual([effect.effectKey]);
    });

    it('lets a person say it arrived, and records who said so and why', async () => {
        const effect = await reserve('indeterminate', 5_000);

        const resolved = await service().resolveManually(schema, {
            effectKey: effect.effectKey, decision: 'delivered',
            reason: 'confirmed against the Meta invoice line for 2026-10-05',
            actorId: 'user-42',
        });

        expect(resolved?.state).toBe('settled');
        expect(Number((await counter()).settled_minor)).toBe(effect.reservedMinor);
        const stored = await row(effect.effectKey);
        // Who and why, on the row itself. An adjustment with no stated reason is
        // indistinguishable from a mistake six months later.
        expect(stored.evidence).toContain('user-42');
        expect(stored.evidence).toContain('Meta invoice');
    });

    it('lets a person say it never arrived, and gives the money back', async () => {
        const effect = await reserve('indeterminate', 5_000);

        const resolved = await service().resolveManually(schema, {
            effectKey: effect.effectKey, decision: 'not_delivered',
            reason: 'the customer confirmed by phone that nothing arrived',
            actorId: 'user-42',
        });

        expect(resolved?.state).toBe('released');
        expect(Number((await counter()).released_minor)).toBe(effect.reservedMinor);
        expect((await row(effect.effectKey)).reason).toBe('manually_resolved_not_delivered');
    });

    it('takes the real figure when the person has one', async () => {
        // Meta's invoice is the authority when somebody is reading it. The
        // reservation was an upper bound; the invoice is the amount, and the
        // difference goes back rather than staying counted.
        const effect = await reserve('pending_reconciliation', 5_000);
        expect(effect.reservedMinor).toBeGreaterThan(1);
        await service().resolveManually(schema, {
            effectKey: effect.effectKey, decision: 'delivered',
            reason: 'the invoice line for this message says one minor unit',
            actorId: 'user-42', chargedMinor: 1,
        });
        expect(Number((await counter()).settled_minor)).toBe(1);
        expect(Number((await counter()).released_minor)).toBe(effect.reservedMinor - 1);
    });

    it('refuses a figure larger than the reservation instead of truncating it', async () => {
        // The counters can only return what they allocated, so a larger figure
        // is silently clamped: the row would say one thing and the account
        // would move by another, and the two numbers a person compares would
        // disagree for ever. A bill that exceeded its own ceiling is a real
        // event and deserves a correction, not a rounding.
        const effect = await reserve('pending_reconciliation', 5_000);
        await expect(service().resolveManually(schema, {
            effectKey: effect.effectKey, decision: 'delivered',
            reason: 'the invoice says far more than we reserved for it',
            actorId: 'user-42', chargedMinor: effect.reservedMinor + 1,
        })).rejects.toThrow('spend_manual_charge_exceeds_reservation');
        expect((await row(effect.effectKey)).state).toBe('pending_reconciliation');
    });

    it('refuses to re-decide an effect whose money already moved', async () => {
        const effect = await reserve('pending_reconciliation', 5_000);
        await service().settleFromInvoice(schema, [{
            providerMessageId: effect.providerMessageId, chargedMinor: 1,
            currency: 'USD', source: 'meta-waba-invoice', version: '2026-10',
        }]);

        await expect(service().resolveManually(schema, {
            effectKey: effect.effectKey, decision: 'not_delivered',
            reason: 'changed my mind about this one', actorId: 'user-42',
        })).resolves.toBeNull();
        expect((await row(effect.effectKey)).state).toBe('settled');
    });

    it('lets a person resolve an estimate, which is not a charge', async () => {
        // An estimate is unresolved by construction, so a person may still say
        // what happened — that is the whole difference from a settled row.
        const effect = await reserve('pending_reconciliation', 5_000);
        await service().reconcile(schema, { graceHours: 72 });
        expect((await row(effect.effectKey)).state).toBe('estimated');

        await service().resolveManually(schema, {
            effectKey: effect.effectKey, decision: 'not_delivered',
            reason: 'Meta invoice has no line for this message', actorId: 'user-42',
        });
        expect((await row(effect.effectKey)).state).toBe('released');
    });

    it('refuses a decision with no reason', async () => {
        const effect = await reserve('indeterminate', 5_000);
        await expect(service().resolveManually(schema, {
            effectKey: effect.effectKey, decision: 'delivered', reason: '   ', actorId: 'user-42',
        })).rejects.toThrow('spend_manual_resolution_requires_a_reason');
        expect((await row(effect.effectKey)).state).toBe('indeterminate');
    });
});
