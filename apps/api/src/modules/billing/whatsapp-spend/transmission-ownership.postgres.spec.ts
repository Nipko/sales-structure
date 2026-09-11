import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappSpendService } from './whatsapp-spend.service';
import {
    claimTransmission, markTransmissionInFlight, releaseTransmission,
    settleReservation, sweepTransmissionLeases, type SpendQuery,
} from './spend-ledger';

/**
 * ═══ ONE EFFECT, ONE RESERVATION, EXACTLY ONE TRANSPORT ═══
 *
 * The effect lock already gives one reservation and one set of allocations. It
 * does not give one POST: the losing authorisation adopts a perfectly good
 * `held` row, and "may I send?" was answered by looking at that state alone.
 *
 * These tests count TRANSPORTS. Not admissions, not log lines — how many times
 * something was actually authorised to hit the network, which is the only
 * number Meta will bill.
 *
 * The crash cases are the reason `claimed` and `in_flight` are two states:
 *
 *   · crashed while `claimed` — provably nothing went out, so the effect is
 *     still owed to the customer and another worker must be able to send it;
 *   · crashed while `in_flight` — the request had begun, so nobody can say, and
 *     a blind retry is the duplicate.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;

integration('the right to transmit', () => {
    const schema = `tenant_transmit_${randomUUID().replace(/-/g, '')}`;
    const TENANT = randomUUID();
    let client: Client;
    let prisma: PrismaService;
    let priorUrl: string | undefined;
    jest.setTimeout(120_000);

    const q = async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows;
    const query: SpendQuery = async <R = any[]>(sql: string, params: any[] = []): Promise<R> =>
        (await client.query(sql, params)).rows as any;

    const authorize = (service: WhatsappSpendService, effectKey: string) =>
        service.authorize(schema, {
            effectKey,
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
        });

    const service = () => new WhatsappSpendService(prisma as any);

    /** One reserved effect, ready to be transmitted. */
    const reserved = async () => {
        const effectKey = `tx-${randomUUID().replace(/-/g, '')}`;
        const result = await authorize(service(), effectKey);
        expect(result.outcome).toBe('reserved');
        return effectKey;
    };

    const row = async (effectKey: string) => (await q(
        `SELECT state, transmit_state, transmit_token, transmit_expires_at, attempts
           FROM "${schema}".whatsapp_spend_reservations WHERE effect_key = $1`, [effectKey]))[0];

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
            if (!/^tenant_transmit_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await q(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await client.end(); }
    });

    beforeEach(async () => {
        await q(`TRUNCATE "${schema}".whatsapp_spend_allocations,
                          "${schema}".whatsapp_spend_reservations,
                          "${schema}".whatsapp_spend_counters`);
    });

    describe('two workers, one message', () => {
        it('grants the right to exactly one of them', async () => {
            const effectKey = await reserved();
            const [left, right] = await Promise.all([
                service().claimTransmission(schema, effectKey),
                service().claimTransmission(schema, effectKey),
            ]);
            const granted = [left, right].filter(claim => claim.kind === 'granted');
            const refused = [left, right].filter(claim => claim.kind === 'held_by_other');
            expect(granted).toHaveLength(1);
            expect(refused).toHaveLength(1);
        });

        it('produces one reservation, one allocation set and one transport', async () => {
            // The whole property, end to end: two concurrent authorisations of
            // one effect, and a count of how many were told to send.
            const effectKey = `tx-both-${randomUUID().replace(/-/g, '')}`;
            const [first, second] = await Promise.all([
                authorize(service(), effectKey),
                authorize(service(), effectKey),
            ]);
            expect([first.outcome, second.outcome].sort()).toEqual(['adopted', 'reserved']);

            const claims = await Promise.all([
                service().claimTransmission(schema, effectKey),
                service().claimTransmission(schema, effectKey),
            ]);
            expect(claims.filter(claim => claim.kind === 'granted')).toHaveLength(1);

            expect(await q(`SELECT 1 FROM "${schema}".whatsapp_spend_reservations`)).toHaveLength(1);
            const allocations = await q(
                `SELECT scope_kind, count(*)::int AS n
                   FROM "${schema}".whatsapp_spend_allocations GROUP BY scope_kind`);
            for (const allocation of allocations) expect(allocation.n).toBe(1);
        });

        it('lets the second in once the first hands the right back', async () => {
            // Handing back is what a caller does when it decides not to send —
            // a ceiling reached between admission and transport, a suppression.
            const effectKey = await reserved();
            const first = await claimTransmission(query, schema, { effectKey, leaseSeconds: 900 });
            expect(first.kind).toBe('granted');
            if (first.kind !== 'granted') return;

            expect((await claimTransmission(query, schema, { effectKey, leaseSeconds: 900 })).kind)
                .toBe('held_by_other');
            expect(await releaseTransmission(query, schema, first.grant)).toBe(true);
            expect((await claimTransmission(query, schema, { effectKey, leaseSeconds: 900 })).kind)
                .toBe('granted');
        });
    });

    describe('the crash before the POST', () => {
        it('returns the right, because nothing provably went out', async () => {
            // A worker took the right and died before touching the network. The
            // customer is still owed the message.
            const effectKey = await reserved();
            await claimTransmission(query, schema, { effectKey, leaseSeconds: -1 });
            expect((await row(effectKey)).transmit_state).toBe('claimed');

            const swept = await sweepTransmissionLeases(query, schema);
            expect(swept.recovered).toEqual([effectKey]);
            expect(swept.uncertain).toEqual([]);

            const after = await row(effectKey);
            expect({ state: after.state, transmit: after.transmit_state, token: after.transmit_token })
                .toEqual({ state: 'held', transmit: 'idle', token: null });
            // And another worker can now send it. Once.
            expect((await claimTransmission(query, schema, { effectKey, leaseSeconds: 900 })).kind)
                .toBe('granted');
        });
    });

    describe('the crash after the POST', () => {
        it('becomes uncertain, because nobody can say it did not happen', async () => {
            const effectKey = await reserved();
            const claim = await claimTransmission(query, schema, { effectKey, leaseSeconds: -1 });
            expect(claim.kind).toBe('granted');
            if (claim.kind !== 'granted') return;
            // The line written immediately before the request.
            expect(await markTransmissionInFlight(query, schema, claim.grant)).toBe(true);

            const swept = await sweepTransmissionLeases(query, schema);
            expect(swept.uncertain).toEqual([effectKey]);
            expect(swept.recovered).toEqual([]);

            const after = await row(effectKey);
            expect({ state: after.state, transmit: after.transmit_state })
                .toEqual({ state: 'indeterminate', transmit: 'resolved' });
            // And NOBODY may send it again — the duplicate this exists to stop.
            expect((await claimTransmission(query, schema, { effectKey, leaseSeconds: 900 })).kind)
                .toBe('not_transmittable');
        });

        it('cannot be handed back, because that would be a claim nobody can make', async () => {
            const effectKey = await reserved();
            const claim = await claimTransmission(query, schema, { effectKey, leaseSeconds: 900 });
            if (claim.kind !== 'granted') throw new Error('expected a grant');
            await markTransmissionInFlight(query, schema, claim.grant);
            expect(await releaseTransmission(query, schema, claim.grant)).toBe(false);
        });
    });

    describe('the crash before persisting the result', () => {
        it('leaves the outcome writable only by the attempt that sent', async () => {
            // A worker sends, crashes before writing the outcome, its lease
            // expires, the sweeper marks the effect uncertain. When the process
            // comes back and tries to write its old result, it must not: that
            // result belongs to a state the reconciler now owns.
            const effectKey = await reserved();
            const claim = await claimTransmission(query, schema, { effectKey, leaseSeconds: -1 });
            if (claim.kind !== 'granted') throw new Error('expected a grant');
            await markTransmissionInFlight(query, schema, claim.grant);
            await sweepTransmissionLeases(query, schema);

            const late = await settleReservation(query, schema, {
                effectKey, chargedMinor: 8, evidence: 'late_writer',
                transmitToken: claim.grant.token,
            });
            expect(late).toBeNull();
            expect((await row(effectKey)).state).toBe('indeterminate');
        });

        it('refuses a writer holding a token that is no longer the live one', async () => {
            // Two attempts, the first one slow. The first must not overwrite the
            // result of the attempt that replaced it.
            const effectKey = await reserved();
            const stale = await claimTransmission(query, schema, { effectKey, leaseSeconds: -1 });
            if (stale.kind !== 'granted') throw new Error('expected a grant');
            const fresh = await claimTransmission(query, schema, { effectKey, leaseSeconds: 900 });
            expect(fresh.kind).toBe('granted');

            expect(await settleReservation(query, schema, {
                effectKey, chargedMinor: 8, evidence: 'stale_writer',
                transmitToken: stale.grant.token,
            })).toBeNull();

            if (fresh.kind !== 'granted') return;
            expect(await settleReservation(query, schema, {
                effectKey, chargedMinor: 8, evidence: 'status_webhook',
                transmitToken: fresh.grant.token,
            })).not.toBeNull();
        });

        it('still lets a status webhook settle, which held no right at all', async () => {
            // The reconciler and the webhook did not transmit, so gating them on
            // a token they could never have would make the ledger unclosable.
            const effectKey = await reserved();
            const claim = await claimTransmission(query, schema, { effectKey, leaseSeconds: 900 });
            if (claim.kind !== 'granted') throw new Error('expected a grant');
            await markTransmissionInFlight(query, schema, claim.grant);

            expect(await settleReservation(query, schema, {
                effectKey, chargedMinor: 8, evidence: 'status_webhook',
            })).not.toBeNull();
        });
    });

    describe('what a resolved effect allows', () => {
        it('nothing', async () => {
            const effectKey = await reserved();
            const claim = await claimTransmission(query, schema, { effectKey, leaseSeconds: 900 });
            if (claim.kind !== 'granted') throw new Error('expected a grant');
            await settleReservation(query, schema, {
                effectKey, chargedMinor: 8, evidence: 'status_webhook',
                transmitToken: claim.grant.token,
            });
            const again = await claimTransmission(query, schema, { effectKey, leaseSeconds: 900 });
            expect(again).toEqual({ kind: 'not_transmittable', state: 'settled' });
        });

        it('and an effect that never existed is not transmittable either', async () => {
            expect(await claimTransmission(query, schema,
                { effectKey: 'never-reserved', leaseSeconds: 900 }))
                .toEqual({ kind: 'not_transmittable', state: null });
        });
    });
});
