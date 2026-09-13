import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappSpendService } from './whatsapp-spend.service';

/**
 * ═══ A RECEIPT TOUCHES TWO RECORDS, AND ONLY ONE WAS DURABLE ═══
 *
 * Meta's webhook changes the customer's history and the money. Those live in
 * two transactions. The second used to be attempted, and when it failed —
 * PgBouncer saturated, a deadlock, a failover — the process wrote a log line
 * and carried on. The webhook was acknowledged; Meta never redelivers what we
 * said we had; the reservation stayed counted for ever.
 *
 * There is no distributed transaction to be had between "what Meta already told
 * us" and "what our database managed to write". Pretending otherwise only moves
 * the point where the event is lost. What is possible is to make the FACT
 * durable before acting on it, and to mark it applied only once its
 * consequences landed.
 *
 * Real PostgreSQL, because the property is about what survives a crash, and a
 * crash is a thing that happens between two COMMITs.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;

integration('the durable inbox of delivery receipts', () => {
    const schema = `tenant_inbox_${randomUUID().replace(/-/g, '')}`;
    const TENANT = randomUUID();
    let client: Client;
    let prisma: PrismaService;
    let priorUrl: string | undefined;
    jest.setTimeout(120_000);

    const q = async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows;
    const service = (pauses?: any) => new WhatsappSpendService(prisma as any, pauses);

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
    const sent = async () => {
        const effectKey = `ib-${randomUUID().replace(/-/g, '')}`;
        const providerMessageId = `wamid.${randomUUID().replace(/-/g, '')}`;
        const result = await authorize(effectKey);
        expect(result.outcome).toBe('reserved');
        await q(`UPDATE "${schema}".whatsapp_spend_reservations
                    SET provider_message_id = $2 WHERE effect_key = $1`,
            [effectKey, providerMessageId]);
        return { effectKey, providerMessageId };
    };

    /** Read straight from the table, never from the call that wrote it. */
    const inbox = async (providerMessageId: string, status: string) => (await q(
        `SELECT state, attempts, outcome, last_error, error_code, error_detail, pricing,
                tenant_id, channel_account_id, next_attempt_at, first_seen_at
           FROM "${schema}".whatsapp_receipt_inbox
          WHERE provider_message_id = $1 AND status = $2`, [providerMessageId, status]))[0];

    const reservation = async (effectKey: string) => (await q(
        `SELECT state, charged_minor FROM "${schema}".whatsapp_spend_reservations
          WHERE effect_key = $1`, [effectKey]))[0];

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
            if (!/^tenant_inbox_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await q(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await client.end(); }
    });

    beforeEach(async () => {
        await q(`TRUNCATE "${schema}".whatsapp_spend_allocations,
                          "${schema}".whatsapp_spend_reservations,
                          "${schema}".whatsapp_spend_counters,
                          "${schema}".whatsapp_receipt_inbox`);
    });

    // ── THE FACT IS WRITTEN DOWN BEFORE ANYTHING ACTS ON IT ─────────────────

    it('records what Meta said, even for a receipt that matches no reservation', async () => {
        // The receipt for a message sent before metering existed, or by another
        // tool on the same number. There is nothing to settle — and the event
        // is still evidence, so it is still written down.
        const outcome = await service().applyDeliveryReceipt(schema, {
            providerMessageId: 'wamid.ORPHAN', status: 'delivered',
        });
        expect(outcome).toBe('unknown_receipt');
        const row = await inbox('wamid.ORPHAN', 'delivered');
        // ── HELD, NOT FILED ─────────────────────────────────────────────────
        //
        // See the race below. "No reservation names this message" is not the
        // same statement as "this message is not ours", and treating it as one
        // is how a delivered message stayed counted for ever.
        expect(row.state).toBe('pending');
        expect(row.last_error).toBe('no_reservation_names_this_message_yet');
    });

    /**
     * ═══ THE RECEIPT THAT ARRIVES BEFORE THE SEND HAS COMMITTED ═══
     *
     * The POST answers with a `wamid`, and the sending transaction writes it on
     * the reservation. Meta's `sent` webhook is a separate round trip that
     * starts at the same moment — and the trip from Meta is not reliably slower
     * than the trip to our own database.
     *
     * So a receipt routinely arrives while no reservation names that message
     * yet. That answered `unknown_receipt`, which the inbox filed as APPLIED:
     * terminal, never retried. A second later the `wamid` appeared, and nothing
     * ever came back to resolve the reservation. The money stayed counted for a
     * message that had been delivered, the ceiling filled with it, and the
     * receipt inbox said the event had been handled.
     *
     * It is not a rare race. It is the ordinary shape of a fast network.
     */
    describe('a receipt that is not ours YET', () => {
        /** A reservation with no `wamid` on it: the send has not committed. */
        const unsent = async () => {
            const effectKey = `race-${randomUUID().replace(/-/g, '')}`;
            const providerMessageId = `wamid.${randomUUID().replace(/-/g, '')}`;
            expect((await authorize(effectKey)).outcome).toBe('reserved');
            return { effectKey, providerMessageId };
        };

        it('keeps it pending instead of filing it as somebody else’s', async () => {
            const effect = await unsent();
            await service().applyDeliveryReceipt(schema,
                { providerMessageId: effect.providerMessageId, status: 'delivered' });
            const row = await inbox(effect.providerMessageId, 'delivered');
            expect(row.state).toBe('pending');
            expect(Number(row.attempts)).toBe(1);
        });

        it('resolves it once the send commits its wamid', async () => {
            // THE REPRODUCTION, end to end. Receipt first, association second,
            // and the sweep is what closes the gap.
            const effect = await unsent();
            await service().applyDeliveryReceipt(schema,
                { providerMessageId: effect.providerMessageId, status: 'delivered' });
            expect((await reservation(effect.effectKey)).state).toBe('held');

            // The POST's own transaction, landing a moment later.
            await q(`UPDATE "${schema}".whatsapp_spend_reservations
                        SET provider_message_id = $2 WHERE effect_key = $1`,
                [effect.effectKey, effect.providerMessageId]);

            const swept = await service().retryPendingReceipts(schema,
                { at: new Date(Date.now() + 3_600_000) });
            expect(swept).toMatchObject({ applied: 1 });
            expect((await reservation(effect.effectKey)).state).toBe('settled');
            expect((await inbox(effect.providerMessageId, 'delivered')).state).toBe('applied');
        });

        it('releases on a `failed` that arrived before the association', async () => {
            const effect = await unsent();
            await service().applyDeliveryReceipt(schema, {
                providerMessageId: effect.providerMessageId, status: 'failed',
                errorCode: 'wa_131026',
            });
            await q(`UPDATE "${schema}".whatsapp_spend_reservations
                        SET provider_message_id = $2 WHERE effect_key = $1`,
                [effect.effectKey, effect.providerMessageId]);
            await service().retryPendingReceipts(schema, { at: new Date(Date.now() + 3_600_000) });
            expect((await reservation(effect.effectKey)).state).toBe('released');
        });

        it('pauses the number on a 131042 that arrived before the association', async () => {
            // The funding signal must not be lost to the race either: a number
            // that cannot be billed keeps burning attempts until somebody says
            // so, and the receipt that says so is exactly this one.
            const effect = await unsent();
            const pauses = { observeFunding: jest.fn(async () => ({ state: 'paused' })) };
            await service(pauses).applyDeliveryReceipt(schema, {
                providerMessageId: effect.providerMessageId, status: 'failed',
                errorCode: 'wa_131042', tenantId: TENANT, channelAccountId: '15550001111',
            });
            expect(pauses.observeFunding).toHaveBeenCalled();
            expect((await inbox(effect.providerMessageId, 'failed')).state).toBe('pending');
        });

        it('keeps the three events of one message apart while they wait', async () => {
            // `sent`, `delivered` and `read` are three rows, and a redelivery of
            // any of them is a no-op. Holding them must not collapse them.
            const effect = await unsent();
            for (const status of ['sent', 'delivered', 'read'] as const) {
                await service().applyDeliveryReceipt(schema,
                    { providerMessageId: effect.providerMessageId, status });
                await service().applyDeliveryReceipt(schema,
                    { providerMessageId: effect.providerMessageId, status });
            }
            const rows = await q(
                `SELECT status, state FROM "${schema}".whatsapp_receipt_inbox
                  WHERE provider_message_id = $1 ORDER BY status`, [effect.providerMessageId]);
            expect(rows).toEqual([
                { status: 'delivered', state: 'pending' },
                { status: 'read', state: 'pending' },
                { status: 'sent', state: 'pending' },
            ]);
        });

        it('does not let two sweepers resolve it twice', async () => {
            const effect = await unsent();
            await service().applyDeliveryReceipt(schema,
                { providerMessageId: effect.providerMessageId, status: 'delivered' });
            await q(`UPDATE "${schema}".whatsapp_spend_reservations
                        SET provider_message_id = $2 WHERE effect_key = $1`,
                [effect.effectKey, effect.providerMessageId]);

            const at = new Date(Date.now() + 3_600_000);
            const [first, second] = await Promise.all([
                service().retryPendingReceipts(schema, { at }),
                service().retryPendingReceipts(schema, { at }),
            ]);
            // Whichever order they ran in, the money moved once: the
            // reservation refuses to leave `settled`.
            expect(first.applied + second.applied).toBeLessThanOrEqual(2);
            const settled = await reservation(effect.effectKey);
            expect(settled.state).toBe('settled');
            const [{ count }] = await q(
                `SELECT count(*)::int AS count FROM "${schema}".whatsapp_spend_reservations
                  WHERE effect_key = $1 AND state = 'settled'`, [effect.effectKey]);
            expect(count).toBe(1);
        });

        it('gives up once no association could plausibly still appear', async () => {
            // The association is written inside the send's own transaction. If
            // it has not appeared in twenty minutes the sending process died
            // before the commit, and the receipt really does belong to
            // something else — a message sent before metering existed, or
            // another tool on the same number.
            await service().applyDeliveryReceipt(schema,
                { providerMessageId: 'wamid.GENUINELY_NOT_OURS', status: 'delivered' });
            await q(`UPDATE "${schema}".whatsapp_receipt_inbox
                        SET first_seen_at = clock_timestamp() - interval '1 hour'
                      WHERE provider_message_id = $1`, ['wamid.GENUINELY_NOT_OURS']);

            await service().retryPendingReceipts(schema, { at: new Date(Date.now() + 3_600_000) });
            const row = await inbox('wamid.GENUINELY_NOT_OURS', 'delivered');
            expect(row.state).toBe('applied');
            expect(row.outcome).toBe('unknown_receipt');
        });
    });

    it('keeps every field the retry would need', async () => {
        await service().applyDeliveryReceipt(schema, {
            providerMessageId: 'wamid.FIELDS', status: 'failed',
            errorCode: 'wa_131042', errorDetail: 'business eligibility payment issue',
            tenantId: TENANT, channelAccountId: '15550001111',
            pricing: { billable: false, category: 'service', model: 'PMP' },
        });
        const row = await inbox('wamid.FIELDS', 'failed');
        expect(row.error_code).toBe('wa_131042');
        expect(row.error_detail).toBe('business eligibility payment issue');
        expect(row.tenant_id).toBe(TENANT);
        expect(row.channel_account_id).toBe('15550001111');
        expect(row.pricing).toEqual({ billable: false, category: 'service', model: 'PMP' });
    });

    it('keys on (receipt, status), because one message produces three events', async () => {
        const effect = await sent();
        for (const status of ['sent', 'delivered', 'read'] as const) {
            await service().applyDeliveryReceipt(schema,
                { providerMessageId: effect.providerMessageId, status });
        }
        const rows = await q(
            `SELECT status FROM "${schema}".whatsapp_receipt_inbox
              WHERE provider_message_id = $1 ORDER BY status`, [effect.providerMessageId]);
        expect(rows.map(row => row.status)).toEqual(['delivered', 'read', 'sent']);
    });

    // ── AND A FAILURE LEAVES IT PENDING RATHER THAN LOSING IT ───────────────

    /**
     * Break the SECOND write only.
     *
     * By then the inbox row is committed, so this reproduces exactly the crash
     * the design is about: Meta's fact is safe, its consequence is not.
     */
    const breakNthTransaction = (nth: (call: number) => boolean) => {
        const broken = service();
        const real = (prisma as any).transactionInTenantSchema.bind(prisma);
        let calls = 0;
        (broken as any).prisma = {
            transactionInTenantSchema: (s: string, work: any) => {
                calls += 1;
                if (nth(calls)) return Promise.reject(new Error('pgbouncer unavailable'));
                return real(s, work);
            },
        };
        return broken;
    };

    it('leaves the receipt pending when the money could not be written', async () => {
        const effect = await sent();
        const broken = breakNthTransaction(call => call === 2);
        await expect(broken.applyDeliveryReceipt(schema,
            { providerMessageId: effect.providerMessageId, status: 'delivered' }))
            .rejects.toThrow('pgbouncer unavailable');

        const row = await inbox(effect.providerMessageId, 'delivered');
        expect(row.state).toBe('pending');
        expect(Number(row.attempts)).toBe(1);
        expect(row.last_error).toContain('pgbouncer unavailable');
        // And the reservation is untouched, which is the point: nothing was
        // half-applied, it simply has not been applied yet.
        expect((await reservation(effect.effectKey)).state).toBe('held');
    });

    it('backs off rather than hammering the same broken receipt', async () => {
        const effect = await sent();
        // One attempt is three statements — remember, resolve, note — so the
        // resolve of the first attempt is call 2 and of the second is call 5.
        const broken = breakNthTransaction(call => call === 2 || call === 5);
        for (let attempt = 0; attempt < 2; attempt += 1) {
            await broken.applyDeliveryReceipt(schema,
                { providerMessageId: effect.providerMessageId, status: 'delivered' })
                .catch(() => { /* expected */ });
        }
        const row = await inbox(effect.providerMessageId, 'delivered');
        expect(Number(row.attempts)).toBe(2);
        expect(new Date(row.next_attempt_at).getTime())
            .toBeGreaterThan(new Date(row.first_seen_at).getTime());
    });

    it('applies the pending receipt on the next sweep, and the money moves then', async () => {
        const effect = await sent();
        const broken = breakNthTransaction(call => call === 2);
        await broken.applyDeliveryReceipt(schema,
            { providerMessageId: effect.providerMessageId, status: 'delivered' })
            .catch(() => { /* the point of the test */ });
        expect((await reservation(effect.effectKey)).state).toBe('held');

        // The sweep, with a healthy connection and a clock past the backoff.
        const swept = await service().retryPendingReceipts(schema,
            { at: new Date(Date.now() + 3_600_000) });
        expect(swept).toMatchObject({ retried: 1, applied: 1 });
        expect((await reservation(effect.effectKey)).state).toBe('settled');
        expect((await inbox(effect.providerMessageId, 'delivered')).state).toBe('applied');
    });

    it('does not re-apply a receipt it already applied', async () => {
        const effect = await sent();
        await service().applyDeliveryReceipt(schema,
            { providerMessageId: effect.providerMessageId, status: 'delivered' });
        const settled = await reservation(effect.effectKey);
        expect(settled.state).toBe('settled');

        // Meta redelivers. The inbox is a no-op AND the reservation refuses to
        // move — belt and braces on purpose, because only the second of those
        // is what actually protects the money.
        await service().applyDeliveryReceipt(schema,
            { providerMessageId: effect.providerMessageId, status: 'delivered' });
        const after = await reservation(effect.effectKey);
        expect(after.charged_minor).toBe(settled.charged_minor);
        const swept = await service().retryPendingReceipts(schema,
            { at: new Date(Date.now() + 3_600_000) });
        expect(swept.retried).toBe(0);
    });

    it('stops retrying a receipt no attempt can resolve, and says so', async () => {
        const effect = await sent();
        await q(`INSERT INTO "${schema}".whatsapp_receipt_inbox
                     (provider_message_id, status, attempts, next_attempt_at)
                 VALUES ($1, 'delivered', 40, clock_timestamp() - interval '1 hour')`,
            [`${effect.providerMessageId}.stuck`]);
        const swept = await service().retryPendingReceipts(schema, { maxAttempts: 24 });
        expect(swept.abandoned).toBe(1);
        // Given up on BEFORE the pass spends its budget re-attempting it: a
        // queue of exhausted receipts would otherwise crowd out the ones that
        // are merely late.
        expect(swept.retried).toBe(0);
        // Abandoned, never deleted: an operator asking why a reservation is
        // still held has to be able to find the receipt nobody could apply.
        expect((await inbox(`${effect.providerMessageId}.stuck`, 'delivered')).state)
            .toBe('abandoned');
    });

    // ── THE SECOND CONSEQUENCE: THE NUMBER THAT CANNOT PAY ──────────────────

    it('pauses the number on a funding refusal, and only marks applied if it did', async () => {
        const effect = await sent();
        const observed: any[] = [];
        const pauses = {
            observeFunding: jest.fn(async (tenant: string, account: string, input: any) => {
                observed.push({ tenant, account, input });
                return { state: 'paused' };
            }),
        };
        await service(pauses).applyDeliveryReceipt(schema, {
            providerMessageId: effect.providerMessageId, status: 'failed',
            errorCode: 'wa_131042', errorDetail: 'business eligibility payment issue',
            tenantId: TENANT, channelAccountId: '15550001111',
        });
        expect(observed).toHaveLength(1);
        expect(observed[0]).toMatchObject({ tenant: TENANT, account: '15550001111' });
        expect((await inbox(effect.providerMessageId, 'failed')).state).toBe('applied');
        expect((await reservation(effect.effectKey)).state).toBe('released');
    });

    it('keeps the receipt pending when the pause could not be written', async () => {
        // `observeFunding` swallows its own failures and answers `null`, so a
        // pause that never persisted used to be indistinguishable from one that
        // was not needed — and an unpaused number burns attempts against a wall
        // nobody can see.
        const effect = await sent();
        const pauses = { observeFunding: jest.fn(async () => null) };
        await expect(service(pauses).applyDeliveryReceipt(schema, {
            providerMessageId: effect.providerMessageId, status: 'failed',
            errorCode: 'wa_131042', tenantId: TENANT, channelAccountId: '15550001111',
        })).rejects.toThrow('funding_pause_not_recorded');
        expect((await inbox(effect.providerMessageId, 'failed')).state).toBe('pending');
    });

    it('does not call the pause for an ordinary failure', async () => {
        // `131047` is re-engagement, `131026` is undeliverable. Pausing a
        // working account on either is a self-inflicted outage.
        const effect = await sent();
        const pauses = { observeFunding: jest.fn(async () => null) };
        await service(pauses).applyDeliveryReceipt(schema, {
            providerMessageId: effect.providerMessageId, status: 'failed',
            errorCode: 'wa_131047', tenantId: TENANT, channelAccountId: '15550001111',
        });
        expect(pauses.observeFunding).not.toHaveBeenCalled();
        expect((await inbox(effect.providerMessageId, 'failed')).state).toBe('applied');
    });

    it('reads Meta’s words when the numeric code is generic', async () => {
        const effect = await sent();
        const pauses = { observeFunding: jest.fn(async () => ({ state: 'paused' })) };
        await service(pauses).applyDeliveryReceipt(schema, {
            providerMessageId: effect.providerMessageId, status: 'failed',
            errorCode: 'wa_131000', errorDetail: 'please add a valid payment method',
            tenantId: TENANT, channelAccountId: '15550001111',
        });
        expect(pauses.observeFunding).toHaveBeenCalled();
    });
});
