import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappSpendService } from './whatsapp-spend.service';
import { metaGraphAnswer, metaGraphClassifier } from '../../channels/provider-error-classification';

/**
 * ═══ A REFUSAL THE PROVIDER INVITED US TO REPEAT ═══
 *
 * Meta answers a rate limit with a Graph error object: code 4, 80007, 130429,
 * 131056, 133016, or `is_transient: true`. Nothing was created, nothing was
 * delivered, nobody was billed — and its own documentation says the identical
 * request may succeed a moment later.
 *
 * Both sinks got this wrong, in opposite directions and both silently:
 *
 *   · the REST path read `metaError ? rejected : timeout`. A 429 carries an
 *     error object, so it was a REJECTION: the reservation was released and its
 *     transmission right resolved. The retry found a finished effect and was
 *     refused as `effect_already_resolved`;
 *   · the durable lane recorded `retryable` as a TIMEOUT, which retains the
 *     money and moves the reservation to `indeterminate` — which `mayTransmit`
 *     also refuses. The outbox dutifully scheduled the retry and the gate
 *     turned it away.
 *
 * Either way: one rate limit, one message abandoned for ever, the row saying
 * `failed` and nothing saying why it never came back. On a platform that
 * batches campaigns, rate limits are not an edge case.
 *
 * A retryable refusal is an outcome of the ATTEMPT, not of the EFFECT. The
 * message is still owed. These tests count reservations and transmission
 * grants, which is the only way to say "no duplicate reservation and no
 * duplicate POST" and mean it.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;

integration('a retryable refusal leaves the effect owed', () => {
    const schema = `tenant_retryable_${randomUUID().replace(/-/g, '')}`;
    const TENANT = randomUUID();
    let client: Client;
    let prisma: PrismaService;
    let priorUrl: string | undefined;
    jest.setTimeout(120_000);

    const q = async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows;
    const service = () => new WhatsappSpendService(prisma as any);

    const authorize = (effectKey: string) =>
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
        } as any);

    const row = async (effectKey: string) => (await q(
        `SELECT state, transmit_state, transmit_token, attempts, reserved_minor, remote_state
           FROM "${schema}".whatsapp_spend_reservations WHERE effect_key = $1`, [effectKey]))[0];

    const reservationCount = async (effectKey: string) => Number((await q(
        `SELECT count(*)::int AS count FROM "${schema}".whatsapp_spend_reservations
          WHERE effect_key = $1`, [effectKey]))[0].count);

    const counter = async () => (await q(
        `SELECT reserved_minor, settled_minor, released_minor
           FROM "${schema}".whatsapp_spend_counters
          WHERE scope_kind = 'account' ORDER BY updated_at DESC LIMIT 1`))[0];

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
            if (!/^tenant_retryable_[a-f0-9]{32}$/.test(schema)) {
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

    // ── WHAT THE CLASSIFIER SAYS, WHICH IS WHERE THIS STARTS ────────────────

    it.each([
        ['application request limit', 4],
        ['rate limit issues', 80007],
        ['throughput reached', 130429],
        ['pair rate limit', 131056],
        ['too many requests', 133016],
    ])('calls Meta’s %s retryable', (_name, code) => {
        const verdict: any = metaGraphClassifier(
            metaGraphAnswer(429, { error: { code } }, 'messages'));
        expect({ kind: verdict.kind, retryable: verdict.retryable })
            .toEqual({ kind: 'rejected', retryable: true });
    });

    it('still calls a permanent refusal permanent', () => {
        // The distinction has to cut both ways, or "retryable" just means
        // "retry everything" and a rejected template loops for ever.
        const verdict: any = metaGraphClassifier(
            metaGraphAnswer(400, { error: { code: 132001 } }, 'messages'));
        expect({ kind: verdict.kind, retryable: verdict.retryable })
            .toEqual({ kind: 'rejected', retryable: false });
    });

    // ── AND WHAT THE LEDGER DOES WITH IT ────────────────────────────────────

    /** Claim the send right and start the request, as a real attempt does. */
    const beginAttempt = async (effectKey: string) => {
        const claim = await service().claimTransmission(schema, effectKey);
        if (claim.kind !== 'granted') throw new Error(`expected a grant, got ${claim.kind}`);
        await service().markInFlight(schema, claim.grant);
        return claim.grant;
    };

    it('keeps the reservation held and hands the send right back', async () => {
        const effectKey = `rl-${randomUUID().replace(/-/g, '')}`;
        expect((await authorize(effectKey)).outcome).toBe('reserved');
        const grant = await beginAttempt(effectKey);

        await service().recordOutcome(schema, effectKey, {
            kind: 'rejected_retryable', errorCode: 'meta_80007',
            transmitToken: grant.token,
        });

        const after = await row(effectKey);
        expect({ state: after.state, transmit: after.transmit_state })
            .toEqual({ state: 'held', transmit: 'idle' });
        // The money did not move, in either direction: nothing was delivered
        // and the message is still owed.
        const counters = await counter();
        expect(Number(counters.released_minor)).toBe(0);
        expect(Number(counters.settled_minor)).toBe(0);
        expect(Number(counters.reserved_minor)).toBe(Number(after.reserved_minor));
    });

    it('lets the next attempt re-claim THE SAME reservation', async () => {
        // The whole property, and the one the old behaviour broke: no second
        // reservation, and a second POST is authorised exactly once.
        const effectKey = `rl-${randomUUID().replace(/-/g, '')}`;
        await authorize(effectKey);
        const first = await beginAttempt(effectKey);
        await service().recordOutcome(schema, effectKey, {
            kind: 'rejected_retryable', errorCode: 'meta_80007', transmitToken: first.token,
        });

        const second = await service().claimTransmission(schema, effectKey);
        expect(second.kind).toBe('granted');
        expect(await reservationCount(effectKey)).toBe(1);
        if (second.kind !== 'granted') return;
        expect(second.grant.token).not.toBe(first.token);
    });

    it('settles the retried attempt against the original reservation', async () => {
        const effectKey = `rl-${randomUUID().replace(/-/g, '')}`;
        const reserved = await authorize(effectKey);
        const amount = Number((reserved as any).reservation.money.reservedMinor);
        const first = await beginAttempt(effectKey);
        await service().recordOutcome(schema, effectKey, {
            kind: 'rejected_retryable', errorCode: 'meta_80007', transmitToken: first.token,
        });

        const second = await beginAttempt(effectKey);
        const providerMessageId = `wamid.${randomUUID().replace(/-/g, '')}`;
        await service().recordOutcome(schema, effectKey, {
            kind: 'accepted', providerMessageId, transmitToken: second.token,
        });
        await service().applyDeliveryReceipt(schema,
            { providerMessageId, status: 'delivered' });

        expect((await row(effectKey)).state).toBe('settled');
        expect(await reservationCount(effectKey)).toBe(1);
        // Charged once, for one message.
        expect(Number((await counter()).settled_minor)).toBe(amount);
    });

    it('refuses a worker whose lease lapsed from handing the right back', async () => {
        // A slow worker must not return a right that now belongs to somebody
        // else: the holder would lose it mid-request and two attempts would be
        // live at once.
        const effectKey = `rl-${randomUUID().replace(/-/g, '')}`;
        await authorize(effectKey);
        const grant = await beginAttempt(effectKey);
        await service().recordOutcome(schema, effectKey, {
            kind: 'rejected_retryable', errorCode: 'meta_80007', transmitToken: grant.token,
        });
        const live = await service().claimTransmission(schema, effectKey);
        if (live.kind !== 'granted') throw new Error('expected a grant');

        // The lapsed worker, arriving late with its old token.
        await service().recordOutcome(schema, effectKey, {
            kind: 'rejected_retryable', errorCode: 'meta_80007', transmitToken: grant.token,
        });
        const after = await row(effectKey);
        expect(after.transmit_state).toBe('claimed');
        expect(String(after.transmit_token)).toBe(live.grant.token);
    });

    it('still releases a PERMANENT refusal, which is a different thing', async () => {
        // The contrast that makes the fix meaningful: a rejected template is
        // over, the money goes back, and no retry is authorised.
        const effectKey = `rl-${randomUUID().replace(/-/g, '')}`;
        const reserved = await authorize(effectKey);
        const amount = Number((reserved as any).reservation.money.reservedMinor);
        const grant = await beginAttempt(effectKey);
        await service().recordOutcome(schema, effectKey, {
            kind: 'rejected', errorCode: 'meta_132001', transmitToken: grant.token,
        });

        expect((await row(effectKey)).state).toBe('released');
        expect(Number((await counter()).released_minor)).toBe(amount);
        expect((await service().claimTransmission(schema, effectKey)).kind)
            .toBe('not_transmittable');
    });

    it('does not turn a rate limit into retained uncertainty', async () => {
        // What the durable lane used to record. `indeterminate` means "we
        // cannot say whether it arrived", which is false here: the provider
        // said it refused. It also means `mayTransmit` refuses the retry.
        const effectKey = `rl-${randomUUID().replace(/-/g, '')}`;
        await authorize(effectKey);
        const grant = await beginAttempt(effectKey);
        await service().recordOutcome(schema, effectKey, {
            kind: 'rejected_retryable', errorCode: 'meta_133016', transmitToken: grant.token,
        });
        expect((await row(effectKey)).state).not.toBe('indeterminate');
    });
});
