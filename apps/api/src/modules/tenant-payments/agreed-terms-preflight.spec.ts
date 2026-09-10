import {
    preflightAgreedTerms,
    preflightFamily,
    preflightFindings,
    preflightSummaryLine,
    preflightTenant,
    PREFLIGHT_FAMILIES,
    type PreflightTenantRef,
} from './agreed-terms-preflight';
import { AGREED_TERMS_FAMILIES } from './agreed-terms-orphans';

/**
 * The gate that decides whether a deploy may change what a charge takes.
 *
 * Every case here is a way the check could report "nothing to worry about" when
 * there is something to worry about, because that is the only failure mode that
 * matters: a gate that blocks wrongly costs an hour, and a gate that passes
 * wrongly meets customers holding payment links that do not work.
 */

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

type Row = Record<string, unknown>;

/**
 * A database that answers exactly what the test says and nothing else.
 *
 * Deliberately not a real driver: the point is to control the SHAPE of the
 * answer — including the shapes a real driver should never produce — and a real
 * PostgreSQL cannot be asked to return a float where a count belongs. The
 * behaviour against a real database is covered by the postgres spec beside this
 * one.
 */
function fakeDb(options: {
    schemas?: string[];
    relations?: string[];
    columns?: string[];
    counts?: Record<string, unknown>;
    fail?: (sql: string, params: any[]) => Error | null;
} = {}) {
    const schemas = options.schemas ?? ['tenant_demo'];
    const relations = new Set(options.relations
        ?? [...Object.values(PREFLIGHT_FAMILIES).map(spec => spec.table), 'commitment_proposals']);
    const columns = new Set(options.columns ?? ['orders.catalog_terms', 'appointments.metadata']);
    const seen: string[] = [];

    const query = async (sql: string, params: any[] = []): Promise<any> => {
        seen.push(sql.replace(/\s+/g, ' ').trim().slice(0, 70));
        const failure = options.fail?.(sql, params);
        if (failure) throw failure;
        if (sql.includes('pg_namespace')) {
            return [{ n: schemas.includes(String(params[0])) ? 1 : 0 }];
        }
        if (sql.includes('to_regclass')) {
            const table = String(params[0]).split('.').pop()!.replace(/"/g, '');
            return [{ name: relations.has(table) ? `x.${table}` : null }];
        }
        if (sql.includes('information_schema.columns')) {
            return [{ n: columns.has(`${params[1]}.${params[2]}`) ? 1 : 0 }];
        }
        const table = /FROM "[^"]+"\.(\w+) target/.exec(sql)?.[1] ?? '?';
        const keyed = sql.includes('serviceTerms') || sql.includes('catalog_terms')
            || sql.includes('commitment_proposals')
            ? `${table}:orphans` : `${table}:live`;
        // `hasOwnProperty`, not `??`: a test that wants the column to come back
        // as `undefined` has to be able to say so, and `?? 0` would quietly
        // turn that case into the one it is meant to distinguish.
        const counts = options.counts ?? {};
        const key = Object.prototype.hasOwnProperty.call(counts, keyed) ? keyed
            : Object.prototype.hasOwnProperty.call(counts, table) ? table : null;
        return [{ orphans: key === null ? 0 : counts[key] }];
    };
    return { query: query as any, seen };
}

const refs = (...ids: string[]): PreflightTenantRef[] =>
    ids.map((id, index) => ({ id, schema: index ? `tenant_other${index}` : 'tenant_demo' }));

describe('the deploy gate for rows nobody agreed to', () => {
    it('passes a tenant whose every family is bound', async () => {
        const db = fakeDb();
        const summary = await preflightAgreedTerms(db.query, refs(TENANT));
        expect(summary).toMatchObject({ orphans: 0, errors: 0, blocksDeploy: false, tenantsInspected: 1 });
        expect(summary.familiesInspected).toBe(AGREED_TERMS_FAMILIES.length);
        expect(preflightSummaryLine(summary))
            .toBe('AGREED_TERMS_PREFLIGHT tenants=1 families=5 orphans=0 errors=0 blocks=1'.replace('blocks=1', 'blocks=0'));
        expect(preflightFindings(summary)).toEqual([]);
    });

    it('blocks on one family with orphans, and names it without naming a customer', async () => {
        const db = fakeDb({ counts: { 'appointments:orphans': 3 } });
        const summary = await preflightAgreedTerms(db.query, refs(TENANT));
        expect(summary).toMatchObject({ orphans: 3, errors: 0, blocksDeploy: true });
        const findings = preflightFindings(summary);
        expect(findings).toEqual([`tenant=${TENANT} family=appointments outcome=counted orphans=3`]);
        // A deploy log is not a place for a customer list.
        expect(findings.join(' ')).not.toMatch(/@|\+\d|name|phone|email/i);
    });

    it('adds up across tenants instead of reporting the first one', async () => {
        const db = fakeDb({
            schemas: ['tenant_demo', 'tenant_other1'],
            counts: { 'orders:orphans': 2, 'food_orders:orphans': 5 },
        });
        const summary = await preflightAgreedTerms(db.query, refs(TENANT, OTHER));
        expect(summary.tenantsInspected).toBe(2);
        expect(summary.orphans).toBe((2 + 5) * 2);
        expect(summary.blocksDeploy).toBe(true);
    });

    it('treats a family this tenant does not have as nothing, not as a finding', async () => {
        // A clinic has no menu. Reporting `food_orders` as a problem would make
        // the gate cry wolf on every tenant that is not a restaurant.
        const db = fakeDb({ relations: ['appointments', 'orders', 'commitment_proposals'] });
        const summary = await preflightAgreedTerms(db.query, refs(TENANT));
        expect(summary).toMatchObject({ orphans: 0, errors: 0, blocksDeploy: false });
        expect(summary.familiesInspected).toBe(2);
        expect(summary.tenants[0].families.filter(f => f.outcome === 'not_provisioned')).toHaveLength(3);
    });

    it('counts every live row when the acceptance store is not there yet', async () => {
        // THE case this gate exists for. `commitment_proposals` arrives with
        // this release, so on the old schema it is absent — and absent means no
        // row has a recorded acceptance, which makes every live row exactly the
        // thing being looked for. Reporting zero here would be the easiest
        // possible answer and the most dangerous.
        const db = fakeDb({
            relations: ['orders', 'appointments', 'property_bookings', 'tour_bookings', 'food_orders'],
            counts: { 'property_bookings:live': 4, 'tour_bookings:live': 1, 'food_orders:live': 2 },
        });
        const summary = await preflightAgreedTerms(db.query, refs(TENANT));
        expect(summary.orphans).toBe(7);
        expect(summary.blocksDeploy).toBe(true);
        expect(preflightFindings(summary)).toEqual(expect.arrayContaining([
            `tenant=${TENANT} family=property_bookings outcome=acceptance_store_absent orphans=4`,
        ]));
    });

    it('counts every live order when the terms column has not been added', async () => {
        const db = fakeDb({ columns: ['appointments.metadata'], counts: { 'orders:live': 9 } });
        const family = await preflightFamily(db.query, 'tenant_demo', 'catalog_orders');
        expect(family).toMatchObject({ outcome: 'acceptance_store_absent', orphans: 9 });
    });

    it('never turns a broken query into a zero', async () => {
        const failure = Object.assign(new Error('relation "orders" does not exist'), { code: '42P01' });
        const db = fakeDb({ fail: sql => (/FROM "[^"]+"\.orders target/.test(sql) ? failure : null) });
        const summary = await preflightAgreedTerms(db.query, refs(TENANT));
        expect(summary.errors).toBe(1);
        expect(summary.blocksDeploy).toBe(true);
        const order = summary.tenants[0].families.find(f => f.family === 'catalog_orders')!;
        expect(order).toMatchObject({ outcome: 'failed', orphans: null, error: '42P01' });
        // The code travels; the driver's sentence does not — it carries the
        // query, and the query carries values.
        expect(JSON.stringify(summary)).not.toContain('does not exist');
    });

    it('refuses an answer that is not a count', async () => {
        for (const value of [null, 'nine', 1.5, -1, undefined]) {
            const db = fakeDb({ counts: { 'appointments:orphans': value } });
            const family = await preflightFamily(db.query, 'tenant_demo', 'appointments');
            expect(family).toMatchObject({ outcome: 'failed', orphans: null, error: 'invalid_count_shape' });
        }
        // And a well-formed zero is still a zero.
        const ok = await preflightFamily(fakeDb({ counts: { 'appointments:orphans': 0 } }).query,
            'tenant_demo', 'appointments');
        expect(ok).toMatchObject({ outcome: 'counted', orphans: 0 });
    });

    it('refuses a probe that answers with the wrong shape', async () => {
        const db = { query: (async (sql: string) => (sql.includes('to_regclass') ? [] : [{ n: 1 }])) as any };
        const family = await preflightFamily(db.query, 'tenant_demo', 'appointments');
        expect(family).toMatchObject({ outcome: 'failed', error: 'invalid_relation_probe' });
    });

    it('says a schema is absent instead of calling it clean', async () => {
        const db = fakeDb({ schemas: [] });
        const summary = await preflightAgreedTerms(db.query, refs(TENANT));
        expect(summary.tenants[0]).toMatchObject({ schemaPresent: false, inspected: 0, failures: 0 });
        expect(preflightFindings(summary)).toEqual([`tenant=${TENANT} schema=tenant_demo schema_absent`]);
        // Not provisioned is not a defect, so it does not block on its own.
        expect(summary.blocksDeploy).toBe(false);
    });

    it('blocks when the database cannot be reached at all', async () => {
        const db = { query: (async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); }) as any };
        const summary = await preflightAgreedTerms(db.query, refs(TENANT));
        expect(summary).toMatchObject({ errors: 1, blocksDeploy: true });
        expect(summary.tenants[0].families[0]).toMatchObject({ outcome: 'failed', error: 'ECONNREFUSED' });
    });

    it('reads only, and says so in the SQL it sends', async () => {
        // The gate must not be able to fix what it finds: an acceptance nobody
        // gave is not something a deploy script may invent.
        const db = fakeDb({ counts: { 'orders:orphans': 1 } });
        await preflightAgreedTerms(db.query, refs(TENANT));
        for (const sql of db.seen) {
            expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE)\b/i);
        }
        expect(db.seen.some(sql => sql.startsWith('SELECT'))).toBe(true);
    });

    it('keeps the summary line stable, because a workflow greps it', async () => {
        const summary = await preflightAgreedTerms(
            fakeDb({ counts: { 'appointments:orphans': 2 } }).query, refs(TENANT));
        expect(preflightSummaryLine(summary))
            .toBe('AGREED_TERMS_PREFLIGHT tenants=1 families=5 orphans=2 errors=0 blocks=1');
        expect(preflightSummaryLine(summary)).toMatch(
            /^AGREED_TERMS_PREFLIGHT tenants=\d+ families=\d+ orphans=\d+ errors=\d+ blocks=[01]$/);
    });

    it('inspects every declared family, so adding one cannot be forgotten', async () => {
        const db = fakeDb();
        await preflightTenant(db.query, TENANT, 'tenant_demo');
        for (const family of AGREED_TERMS_FAMILIES) {
            expect(PREFLIGHT_FAMILIES[family]).toBeDefined();
        }
        expect(Object.keys(PREFLIGHT_FAMILIES).sort()).toEqual([...AGREED_TERMS_FAMILIES].sort());
    });
});
