import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappSpendService } from './whatsapp-spend.service';

/**
 * ═══ TWO AUTHORISATIONS OF ONE EFFECT ═══
 *
 * The unique index on `effect_key` guarantees one reservation. It does not
 * guarantee one set of counter increments, and the ceilings are the only thing
 * between a bug and a bill.
 *
 * The order that failed:
 *
 *     A: find → nothing        B: find → nothing
 *     A: grant, reserve ×N     B: grant, reserve ×N     ← both moved money
 *     A: claim → wins          B: claim → nothing, adopts A's row
 *
 * B commits its increments and holds no allocations, so nothing can ever give
 * them back. One message, one reservation, two charges against every ceiling.
 *
 * These tests drive the REAL `authorize()` through the production Prisma
 * adapter, from two connections at once. Testing the primitives separately is
 * what let this through: each one was correct and the ORDER was not.
 */
const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;

integration('authorising one effect from two places at once', () => {
    const schema = `tenant_spendrace_${randomUUID().replace(/-/g, '')}`;
    const TENANT = randomUUID();
    let client: Client;
    let prisma: PrismaService;
    let priorUrl: string | undefined;
    jest.setTimeout(120_000);

    const q = async (sql: string, params: any[] = []) => (await client.query(sql, params)).rows;

    const identity = (over: Record<string, unknown> = {}) => ({
        tenantId: TENANT, channelType: 'whatsapp', channelAccountId: '15550001111',
        channelAddress: '+1 555 000 1111',
        payerKind: 'business_direct' as const, payerWabaId: 'waba-1', payerBusinessId: 'biz-1',
        credentialId: 'cred-1', credentialSource: 'system_user' as const,
        recipientScope: 'customer' as const, recipientRef: 'contact-1',
        category: 'service', market: 'CO', currency: 'USD', ...over,
    });

    const authorize = (service: WhatsappSpendService, effectKey: string, over: Record<string, unknown> = {}) =>
        service.authorize(schema, {
            effectKey,
            identity: identity(over.identity as any ?? {}) as any,
            contactId: 'contact-1',
            deliveries: 1,
            wabaTimeZone: 'America/Bogota',
            admissionReason: 'inbound_reply',
            disposition: 'reactive',
            allowUnknownCost: true,
            at: new Date('2026-10-05T12:00:00.000Z'),
            ...over,
        });

    const counters = async () => q(
        `SELECT scope_kind, scope_key, reserved_minor, settled_minor, used_deliveries, free_deliveries
           FROM "${schema}".whatsapp_spend_counters ORDER BY scope_kind, scope_key`);

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
            if (!/^tenant_spendrace_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await q(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await client.end(); }
    });

    beforeEach(async () => {
        await q(`TRUNCATE "${schema}".whatsapp_spend_allocations,
                          "${schema}".whatsapp_spend_reservations,
                          "${schema}".whatsapp_spend_counters`);
    });

    /** One service per call, so nothing is shared but the database. */
    const service = () => new WhatsappSpendService(prisma as any);

    it('leaves one reservation and one set of increments', async () => {
        const effectKey = `race-${randomUUID().replace(/-/g, '')}`;
        // The month counter is seeded with a real allowance rather than left as
        // the `observe` row `ensureCounters` creates, so that EVERY ceiling in
        // this assertion is one that actually counts. An observe counter reads
        // zero whether it was touched once or twice, which is exactly the kind
        // of row that makes a race test pass without testing anything.
        await q(`INSERT INTO "${schema}".whatsapp_spend_counters
            (scope_kind, scope_key, period_key, cap_kind, cap_deliveries, currency)
            VALUES ('number_month','15550001111','2026-10','deliveries',1000,'USD')`);

        // Genuinely at once. The advisory lock is what makes this safe; without
        // it both transactions reach the counters before either claims the row.
        const [left, right] = await Promise.all([
            authorize(service(), effectKey),
            authorize(service(), effectKey),
        ]);

        const rows = await q(
            `SELECT effect_key FROM "${schema}".whatsapp_spend_reservations`);
        expect(rows).toHaveLength(1);

        // One authorised, one adopted — in either order, because which
        // connection wins a lock is not a property worth asserting.
        expect([left.outcome, right.outcome].sort()).toEqual(['adopted', 'reserved']);

        // And exactly ONE delivery counted. Two is what the old order produced:
        // a second increment held by no allocation, which nothing could ever
        // give back.
        //
        // The month counter is where it shows. The money ceilings read zero here
        // BECAUSE the delivery was free — an effect that costs nothing reserves
        // no money — and a test that demanded 1 from them would be demanding
        // that a free message be charged.
        const byScope = new Map((await counters()).map(row => [row.scope_kind, row]));
        expect(Number(byScope.get('number_month')?.used_deliveries)).toBe(1);
        expect(Number(byScope.get('number_month')?.free_deliveries)).toBe(1);
        for (const [scope, row] of byScope) {
            if (scope === 'number_month') continue;
            expect({ scope, reserved: Number(row.reserved_minor) })
                .toEqual({ scope, reserved: 0 });
        }
    });

    it('gives the free allowance to the effect once, not once per attempt', async () => {
        const effectKey = `race-free-${randomUUID().replace(/-/g, '')}`;
        // A number-month counter with a real allowance, so the grant has
        // somewhere to come from.
        await q(`INSERT INTO "${schema}".whatsapp_spend_counters
            (scope_kind, scope_key, period_key, cap_kind, cap_deliveries, currency)
            VALUES ('number_month','15550001111','2026-10','deliveries',1000,'USD')`);

        await Promise.all([
            authorize(service(), effectKey),
            authorize(service(), effectKey),
        ]);

        const [allowance] = await q(
            `SELECT used_deliveries, free_deliveries FROM "${schema}".whatsapp_spend_counters
              WHERE scope_kind='number_month'`);
        expect({ used: Number(allowance.used_deliveries), free: Number(allowance.free_deliveries) })
            .toEqual({ used: 1, free: 1 });
    });

    it('never writes a price for a cost it could not compute', async () => {
        // The defect: a substituted currency plus a real market and category
        // found a genuine row and wrote `basis: 'priced'` with an exact amount
        // — in money nobody established. Asserted on the ROW, because that is
        // what a reconciliation and an invoice comparison will read.
        const effectKey = `unpriceable-${randomUUID().replace(/-/g, '')}`;
        await service().authorize(schema, {
            effectKey,
            identity: identity() as any,
            contactId: 'contact-1', deliveries: 1,
            wabaTimeZone: 'America/Bogota', admissionReason: 'inbound_reply',
            disposition: 'reactive', allowUnknownCost: true,
            costUnknowable: { reason: 'currency_unestablished: no evidence' },
            at: new Date('2026-10-05T12:00:00.000Z'),
        });
        const [row] = await q(
            `SELECT basis, decision, reserved_minor, charged_minor
               FROM "${schema}".whatsapp_spend_reservations WHERE effect_key = $1`, [effectKey]);
        expect({ basis: row.basis, decision: row.decision, charged: row.charged_minor })
            .toEqual({ basis: 'unknown', decision: 'unknown', charged: null });
        // And the exposure is the declared ceiling, which is the honest number
        // to reconcile against — not zero, and not an invented price.
        expect(Number(row.reserved_minor)).toBeGreaterThan(0);
    });

    it('does write a price when everything needed was established', async () => {
        // The control. Without it the test above passes against an engine that
        // never prices anything.
        const effectKey = `priceable-${randomUUID().replace(/-/g, '')}`;
        await service().authorize(schema, {
            effectKey,
            identity: identity({ category: 'marketing' }) as any,
            contactId: 'contact-1', deliveries: 1,
            wabaTimeZone: 'America/Bogota', admissionReason: 'campaign',
            disposition: 'proactive', allowUnknownCost: false,
            at: new Date('2026-10-05T12:00:00.000Z'),
        });
        const [row] = await q(
            `SELECT basis, decision FROM "${schema}".whatsapp_spend_reservations
              WHERE effect_key = $1`, [effectKey]);
        expect({ basis: row.basis, decision: row.decision })
            .toEqual({ basis: 'priced', decision: 'accepted' });
    });

    it('still lets two DIFFERENT effects both through', async () => {
        // The lock is per effect key. A lock that serialised everything would
        // turn the busiest path in the platform into a queue of one.
        const [left, right] = await Promise.all([
            authorize(service(), `race-a-${randomUUID().replace(/-/g, '')}`),
            authorize(service(), `race-b-${randomUUID().replace(/-/g, '')}`),
        ]);
        expect([left.outcome, right.outcome]).toEqual(['reserved', 'reserved']);
        expect(await q(`SELECT 1 FROM "${schema}".whatsapp_spend_reservations`)).toHaveLength(2);
    });

    it('writes exactly one allocation per counter the effect touched', async () => {
        const effectKey = `race-alloc-${randomUUID().replace(/-/g, '')}`;
        await Promise.all([
            authorize(service(), effectKey),
            authorize(service(), effectKey),
        ]);
        const allocations = await q(
            `SELECT scope_kind, scope_key, count(*)::int AS n
               FROM "${schema}".whatsapp_spend_allocations
              GROUP BY scope_kind, scope_key`);
        expect(allocations.length).toBeGreaterThan(0);
        for (const row of allocations) expect(row.n).toBe(1);
    });

    it('does not let the adopting side report the ceiling as empty', async () => {
        // The adopting transaction reserves nothing. Reporting `clear` on that
        // basis would say a full account is empty on every retry.
        const effectKey = `race-pressure-${randomUUID().replace(/-/g, '')}`;
        await q(`INSERT INTO "${schema}".whatsapp_spend_counters
            (scope_kind, scope_key, period_key, cap_kind, cap_minor, currency,
             warn_permille, soft_permille)
            VALUES ('account','15550001111','2026-10','money',1,'USD',1000,1000)`);

        const [left, right] = await Promise.all([
            authorize(service(), effectKey),
            authorize(service(), effectKey),
        ]);
        const adopted = [left, right].find(result => result.outcome === 'adopted');
        expect(adopted).toBeDefined();
        expect((adopted as any).pressure).toBe('hard_stop');
    });
});
