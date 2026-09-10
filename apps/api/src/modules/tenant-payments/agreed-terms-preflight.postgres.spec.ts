import { randomUUID } from 'crypto';
import { Client } from 'pg';
import {
    preflightAgreedTerms,
    preflightSummaryLine,
    preflightTenant,
} from './agreed-terms-preflight';
import type { OrphanQuery } from './agreed-terms-orphans';
import { isDisposableDatabase } from '../../common/__fixtures__/disposable-database';

/**
 * The gate against a real PostgreSQL, on the two schemas that actually exist in
 * the world: the one this release produces, and the one it is about to replace.
 *
 * The unit spec beside this controls the SHAPE of an answer — a float where a
 * count belongs, a probe returning nothing — which a real database will not
 * produce on request. This one controls the opposite: that `to_regclass`,
 * `information_schema` and the counting SQL mean what the gate thinks they mean
 * when a real server answers them, including on a schema that predates the
 * acceptance store.
 *
 * The old-schema case is the one that decides whether this gate is worth
 * having. It runs BEFORE the release's own migrations, so `commitment_proposals`
 * is not there yet — and "not there" has to come back as "every live row is at
 * risk", never as zero.
 */

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const integration = connection ? describe : describe.skip;

integration('the agreed-terms gate against a real database', () => {
    const suffix = randomUUID().replace(/-/g, '');
    const modern = `tenant_pf_new_${suffix}`;
    const legacy = `tenant_pf_old_${suffix}`;
    const clinic = `tenant_pf_clinic_${suffix}`;
    let client: Client;

    // Typed as the module's own query shape rather than inferred: the generic
    // return of `OrphanQuery` cannot be satisfied by a concrete `any[]`.
    const query: OrphanQuery = (async (sql: string, params: any[] = []) =>
        (await client.query(sql, params)).rows) as OrphanQuery;
    const run = (sql: string) => client.query(sql);

    /** The columns the gate reads, and nothing it does not. */
    const familyTables = (schema: string) => [
        `CREATE TABLE "${schema}".orders (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            status TEXT NOT NULL, catalog_terms JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`,
        `CREATE TABLE "${schema}".appointments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            status TEXT NOT NULL, metadata JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW())`,
        `CREATE TABLE "${schema}".property_bookings (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            status TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`,
        `CREATE TABLE "${schema}".tour_bookings (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            status TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`,
        `CREATE TABLE "${schema}".food_orders (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            status TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`,
    ];

    const acceptanceStore = (schema: string) =>
        `CREATE TABLE "${schema}".commitment_proposals (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            consumed_entity_id UUID, accepted_at TIMESTAMPTZ)`;

    beforeAll(async () => {
        if (!isDisposableDatabase(connection)) throw new Error('disposable_loopback_database_required');
        client = new Client({ connectionString: connection });
        await client.connect();

        // ── The schema this release produces ────────────────────────────────
        await run(`CREATE SCHEMA "${modern}"`);
        for (const sql of familyTables(modern)) await run(sql);
        await run(acceptanceStore(modern));

        // ── The schema it replaces: same families, no acceptance store, and no
        //    `catalog_terms` on orders either ─────────────────────────────────
        await run(`CREATE SCHEMA "${legacy}"`);
        for (const sql of familyTables(legacy)) await run(sql);
        await run(`ALTER TABLE "${legacy}".orders DROP COLUMN catalog_terms`);

        // ── A clinic: appointments only ─────────────────────────────────────
        await run(`CREATE SCHEMA "${clinic}"`);
        await run(`CREATE TABLE "${clinic}".appointments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            status TEXT NOT NULL, metadata JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW())`);
        await run(acceptanceStore(clinic));
    }, 120000);

    afterAll(async () => {
        if (!client) return;
        for (const schema of [modern, legacy, clinic]) {
            // The guard is the condition, not a throw: this runs in `afterAll`
            // and a name that does not match is simply not dropped.
            if (/^tenant_pf_[a-z]+_[a-f0-9]{32}$/.test(schema)) {
                await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
            }
        }
        await client.end().catch(() => undefined);
    });

    it('finds nothing when every live row carries its acceptance', async () => {
        await run(`INSERT INTO "${modern}".appointments (status, metadata)
                   VALUES ('confirmed', '{"serviceTerms":{"price":"65000","currency":"COP"}}'::jsonb)`);
        await run(`INSERT INTO "${modern}".orders (status, catalog_terms)
                   VALUES ('pending', '{"action":"create","totalAmountCents":"2470"}'::jsonb)`);
        const report = await preflightTenant(query, 'tenant-modern', modern);
        expect(report).toMatchObject({ schemaPresent: true, orphans: 0, failures: 0 });
        expect(report.families.every(f => f.outcome === 'counted')).toBe(true);
    }, 60000);

    it('counts the live rows that have no acceptance, and leaves the settled ones alone', async () => {
        await run(`INSERT INTO "${modern}".appointments (status) VALUES ('confirmed'), ('pending')`);
        // Cancelled and completed are nobody's charge either way.
        await run(`INSERT INTO "${modern}".appointments (status) VALUES ('cancelled'), ('completed'), ('no_show')`);
        await run(`INSERT INTO "${modern}".orders (status) VALUES ('pending')`);
        await run(`INSERT INTO "${modern}".orders (status) VALUES ('paid'), ('refunded')`);

        const report = await preflightTenant(query, 'tenant-modern', modern);
        const byFamily = Object.fromEntries(report.families.map(f => [f.family, f]));
        expect(byFamily.appointments).toMatchObject({ outcome: 'counted', orphans: 2 });
        expect(byFamily.catalog_orders).toMatchObject({ outcome: 'counted', orphans: 1 });
        expect(report.orphans).toBe(3);
        expect(report.failures).toBe(0);
    }, 60000);

    it('does not read one tenant while asked about another', async () => {
        // The modern schema now has rows without acceptance. The clinic has
        // none, and must come back clean: a gate that leaks across schemas would
        // block every deploy for one tenant's history.
        const report = await preflightTenant(query, 'tenant-clinic', clinic);
        expect(report).toMatchObject({ orphans: 0, failures: 0 });
        expect(report.families.filter(f => f.outcome === 'not_provisioned')).toHaveLength(4);
    }, 60000);

    it('treats a missing acceptance store as every live row, not as zero', async () => {
        // The old schema, which is what the gate meets when it runs before the
        // release's migrations. `commitment_proposals` does not exist and
        // `orders.catalog_terms` has not been added.
        await run(`INSERT INTO "${legacy}".property_bookings (status) VALUES ('confirmed'), ('pending')`);
        await run(`INSERT INTO "${legacy}".property_bookings (status) VALUES ('cancelled')`);
        await run(`INSERT INTO "${legacy}".food_orders (status) VALUES ('pending')`);
        await run(`INSERT INTO "${legacy}".orders (status) VALUES ('pending'), ('confirmed')`);
        await run(`INSERT INTO "${legacy}".appointments (status, metadata)
                   VALUES ('confirmed', '{"serviceTerms":{"price":"1","currency":"COP"}}'::jsonb)`);

        const report = await preflightTenant(query, 'tenant-legacy', legacy);
        const byFamily = Object.fromEntries(report.families.map(f => [f.family, f]));
        expect(byFamily.property_bookings).toMatchObject({ outcome: 'acceptance_store_absent', orphans: 2 });
        expect(byFamily.restaurant_orders).toMatchObject({ outcome: 'acceptance_store_absent', orphans: 1 });
        expect(byFamily.catalog_orders).toMatchObject({ outcome: 'acceptance_store_absent', orphans: 2 });
        // Appointments keep their real answer: `metadata` predates the release,
        // so that family is genuinely countable on the old schema.
        expect(byFamily.appointments).toMatchObject({ outcome: 'counted', orphans: 0 });
        expect(report.failures).toBe(0);
        expect(report.orphans).toBe(5);
    }, 60000);

    it('says a schema is absent rather than calling it clean', async () => {
        const report = await preflightTenant(query, 'tenant-gone', `${legacy}_missing`);
        expect(report).toMatchObject({ schemaPresent: false, inspected: 0, failures: 0, orphans: 0 });
    }, 60000);

    it('reports a broken inspection as a failure, never as a count', async () => {
        // A table shaped in a way the query cannot use: `status` is gone, so the
        // count fails. That is not zero rows — it is an unknown, and a gate that
        // rounds unknowns down to zero is worse than no gate.
        const broken = `${clinic}_broken`;
        await run(`CREATE SCHEMA "${broken}"`);
        await run(`CREATE TABLE "${broken}".appointments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            metadata JSONB DEFAULT '{}'::jsonb)`);
        try {
            const report = await preflightTenant(query, 'tenant-broken', broken);
            const appointments = report.families.find(f => f.family === 'appointments')!;
            expect(appointments).toMatchObject({ outcome: 'failed', orphans: null });
            expect(appointments.error).toBe('42703');
            expect(report.failures).toBe(1);
        } finally {
            if (/^tenant_pf_clinic_[a-f0-9]{32}_broken$/.test(broken)) {
                await client.query(`DROP SCHEMA IF EXISTS "${broken}" CASCADE`).catch(() => undefined);
            }
        }
    }, 60000);

    it('adds several tenants into one verdict a pipeline can act on', async () => {
        const summary = await preflightAgreedTerms(query, [
            { id: 'tenant-modern', schema: modern },
            { id: 'tenant-legacy', schema: legacy },
            { id: 'tenant-clinic', schema: clinic },
        ]);
        expect(summary.tenantsInspected).toBe(3);
        expect(summary.orphans).toBe(3 + 5);
        expect(summary.errors).toBe(0);
        expect(summary.blocksDeploy).toBe(true);
        expect(preflightSummaryLine(summary))
            .toMatch(/^AGREED_TERMS_PREFLIGHT tenants=3 families=\d+ orphans=8 errors=0 blocks=1$/);
    }, 60000);

    it('writes nothing: the rows it found are exactly as it found them', async () => {
        const before = await query(`SELECT count(*)::int AS n FROM "${legacy}".property_bookings`);
        const beforeTerms = await query(
            `SELECT count(*)::int AS n FROM "${modern}".appointments WHERE metadata ? 'serviceTerms'`);
        await preflightAgreedTerms(query, [
            { id: 'tenant-modern', schema: modern }, { id: 'tenant-legacy', schema: legacy },
        ]);
        expect(await query(`SELECT count(*)::int AS n FROM "${legacy}".property_bookings`)).toEqual(before);
        expect(await query(
            `SELECT count(*)::int AS n FROM "${modern}".appointments WHERE metadata ? 'serviceTerms'`))
            .toEqual(beforeTerms);
        // And the acceptance store it could not find is still not there: the
        // gate does not create what it needs in order to pass.
        const [store] = await query(`SELECT to_regclass($1)::text AS name`, [`"${legacy}"."commitment_proposals"`]);
        expect(store.name).toBeNull();
    }, 60000);
});
