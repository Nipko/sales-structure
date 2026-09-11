import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappSpendService } from './whatsapp-spend.service';

/**
 * ═══ OBSERVING IS NOT DOING LESS BOOKKEEPING ═══
 *
 * A tenant in `observe` has no enforcement: whatever the ceiling says, the
 * message goes out. So when a cap refused, the whole authorising transaction
 * rolled back and the caller was told `permitted: true` with no reservation at
 * all — which meant a chargeable POST with:
 *
 *   · no reservation, so no exposure and nothing for a receipt to resolve;
 *   · no allocation, so the counters never learned the money existed;
 *   · no transmission right, so two workers could both send it;
 *   · no durable identity to retry against.
 *
 * That is the one state this subsystem cannot recover from, and it happened
 * precisely to the tenants nobody was watching yet — an observation that
 * stopped observing the moment there was something to see.
 *
 * The separation the reviewer asked for is between IGNORING A CEILING and
 * LOSING THE ACCOUNTING. Observing may do the first; nothing may do the second.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;

integration('a tenant in observe still has a complete ledger', () => {
    const schema = `tenant_observe_${randomUUID().replace(/-/g, '')}`;
    const TENANT = randomUUID();
    const NUMBER = '15550001111';
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
                tenantId: TENANT, channelType: 'whatsapp', channelAccountId: NUMBER,
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

    /** Shut the account's ceiling completely. */
    const closeTheCeiling = async () => {
        await q(`UPDATE "${schema}".whatsapp_spend_counters
                    SET cap_kind = 'money', cap_minor = 0, currency = 'USD'
                  WHERE scope_kind = 'account'`);
    };

    const reservation = async (effectKey: string) => (await q(
        `SELECT id, state, reserved_minor, transmit_state, currency, payer_waba_id
           FROM "${schema}".whatsapp_spend_reservations WHERE effect_key = $1`, [effectKey]))[0];

    const allocationsOf = async (reservationId: string) => await q(
        `SELECT scope_kind, amount_minor, deliveries FROM "${schema}".whatsapp_spend_allocations
          WHERE reservation_id = $1::uuid ORDER BY scope_kind`, [reservationId]);

    const accountCounter = async () => (await q(
        `SELECT reserved_minor, cap_minor, used_deliveries FROM "${schema}".whatsapp_spend_counters
          WHERE scope_kind = 'account'`))[0];

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
            if (!/^tenant_observe_[a-f0-9]{32}$/.test(schema)) {
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

    it('refuses under enforcement, so the ceiling in these tests is real', async () => {
        await authorize(`warm-${randomUUID()}`);
        await closeTheCeiling();
        const result = await authorize(`enforced-${randomUUID()}`, { caps: 'enforce' });
        expect(result.outcome).toBe('blocked');
        expect((result as any).block.code).toBe('cap_exhausted');
    });

    it('lets the message through under observation — and reserves it', async () => {
        await authorize(`warm-${randomUUID()}`);
        await closeTheCeiling();
        const effectKey = `observed-${randomUUID()}`;
        const result = await authorize(effectKey, { caps: 'observe' });

        expect(result.outcome).toBe('reserved');
        const row = await reservation(effectKey);
        expect(row.state).toBe('held');
        // The exposure is real money on a real row, over the ceiling.
        expect(Number(row.reserved_minor)).toBeGreaterThan(0);
    });

    it('names what enforcement would have stopped', async () => {
        // The entire product of an observation. Without it the business turns
        // enforcement on and discovers the answer by going silent.
        await authorize(`warm-${randomUUID()}`);
        await closeTheCeiling();
        const result: any = await authorize(`named-${randomUUID()}`, { caps: 'observe' });
        expect(result.observedBlock?.code).toBe('cap_exhausted');
    });

    it('moves the counter past its own ceiling, so the overspend is visible', async () => {
        await authorize(`warm-${randomUUID()}`);
        await closeTheCeiling();
        const before = await accountCounter();
        await authorize(`counted-${randomUUID()}`, { caps: 'observe' });
        const after = await accountCounter();

        expect(Number(after.reserved_minor)).toBeGreaterThan(Number(before.reserved_minor));
        // Over the cap, on purpose and on the record: "this tenant is over
        // their limit and nobody is stopping them" is a different fact from
        // "this tenant is inside their limit", and it used to be unwritable.
        expect(Number(after.reserved_minor)).toBeGreaterThan(Number(after.cap_minor));
    });

    it('writes the allocations, so the exposure can come back', async () => {
        // Without these the money could never be released or settled: the
        // reservation would know what it holds and no counter would.
        await authorize(`warm-${randomUUID()}`);
        await closeTheCeiling();
        const effectKey = `allocated-${randomUUID()}`;
        await authorize(effectKey, { caps: 'observe' });
        const row = await reservation(effectKey);
        expect((await allocationsOf(row.id)).length).toBeGreaterThan(0);
    });

    it('leaves an effect a receipt can actually resolve', async () => {
        // The end-to-end consequence. An admitted-but-unreserved POST had
        // nothing for `delivered` to settle; this one settles.
        await authorize(`warm-${randomUUID()}`);
        await closeTheCeiling();
        const effectKey = `resolvable-${randomUUID()}`;
        await authorize(effectKey, { caps: 'observe' });
        const providerMessageId = `wamid.${randomUUID().replace(/-/g, '')}`;
        await q(`UPDATE "${schema}".whatsapp_spend_reservations
                    SET provider_message_id = $2 WHERE effect_key = $1`,
            [effectKey, providerMessageId]);

        await expect(service().applyDeliveryReceipt(schema,
            { providerMessageId, status: 'delivered' })).resolves.toBe('settled');
        expect((await reservation(effectKey)).state).toBe('settled');
    });

    it('still hands the send right to exactly one worker', async () => {
        // Observing a ceiling must not cost the exclusivity that stops two
        // workers posting the same message.
        await authorize(`warm-${randomUUID()}`);
        await closeTheCeiling();
        const effectKey = `exclusive-${randomUUID()}`;
        await authorize(effectKey, { caps: 'observe' });
        const first = await service().claimTransmission(schema, effectKey);
        const second = await service().claimTransmission(schema, effectKey);
        expect([first.kind, second.kind].filter(kind => kind === 'granted')).toHaveLength(1);
    });

    it('refuses a currency mix even under observation', async () => {
        // Not a ceiling. A measurement in the wrong units is not a
        // measurement, and no amount of observing makes 3 500 centavos
        // comparable to 8 cents.
        await authorize(`warm-${randomUUID()}`);
        await q(`UPDATE "${schema}".whatsapp_spend_counters
                    SET cap_kind = 'money', cap_minor = 100000, currency = 'USD'
                  WHERE scope_kind = 'account'`);
        const result: any = await authorize(`cop-${randomUUID()}`, {
            caps: 'observe',
            identity: {
                tenantId: TENANT, channelType: 'whatsapp', channelAccountId: NUMBER,
                channelAddress: '+1 555 000 1111',
                payerKind: 'business_direct', payerWabaId: 'waba-1', payerBusinessId: 'biz-1',
                credentialId: 'cred-1', credentialSource: 'system_user',
                recipientScope: 'customer', recipientRef: 'contact-1',
                category: 'marketing', market: 'CO', currency: 'COP',
            },
        });
        expect(result.outcome).toBe('blocked');
        expect(result.block.code).toBe('counter_currency_mismatch');
    });

    it('refuses an effect with no payer, whatever the mode', async () => {
        // There is no reservation to write: nobody can say which WABA is
        // billed. Permitting it is the unaccountable POST all over again.
        const result: any = await authorize(`nopayer-${randomUUID()}`, {
            caps: 'observe',
            identity: {
                tenantId: TENANT, channelType: 'whatsapp', channelAccountId: NUMBER,
                payerKind: 'unknown', payerWabaId: null, payerBusinessId: null,
                credentialId: 'cred-1', credentialSource: 'system_user',
                recipientScope: 'customer', recipientRef: 'contact-1',
                category: 'marketing', market: 'CO', currency: 'USD',
            },
        });
        expect(result.outcome).toBe('blocked');
        expect(result.block.code).toBe('payer_unknown');
    });

    it('refuses an effect with no time zone, whatever the mode', async () => {
        // Without one there is no calendar month, so there is no allowance
        // period and no counter to put the effect in.
        const result: any = await authorize(`nozone-${randomUUID()}`,
            { caps: 'observe', wabaTimeZone: '' });
        expect(result.outcome).toBe('blocked');
        expect(result.block.code).toBe('timezone_missing');
    });

    it('defaults to enforcing, so a caller that says nothing spends less', async () => {
        await authorize(`warm-${randomUUID()}`);
        await closeTheCeiling();
        expect((await authorize(`default-${randomUUID()}`)).outcome).toBe('blocked');
    });
});
