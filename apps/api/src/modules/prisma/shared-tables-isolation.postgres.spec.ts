import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { SHARED_TABLE_NAMES } from './shared-tables';
import { TENANT_CONTEXT_SQL, tenantContextIdForSchema, tenantSearchPath } from './tenant-context';

/**
 * ═══ A TENANT NEVER SEES ANOTHER TENANT'S ROWS IN A SHARED TABLE (ADR 0034) ═══
 *
 * Runs against a real, migrated PostgreSQL, and every data statement runs AS `parallext_app`: the role the
 * application connects with. The role that owns the database in CI is a superuser, and a superuser ignores
 * row-level security, so a test that did not switch roles would prove nothing.
 *
 * Two halves:
 *   1. the mechanism, on a probe table created here through `shared.apply_tenant_isolation`;
 *   2. the inventory: every table that exists in `shared` is in the registry, and the other way round, and
 *      each one has row-level security enabled, forced, and the `tenant_isolation` policy.
 *
 * Own variable, as in `legacy-schema-repoint.postgres.spec.ts`: it needs a database with the real migrations
 * applied, not the per-worker synthetic fixture.
 */
const url = process.env.LEGACY_SCHEMA_TEST_URL;
const suite = url ? describe : describe.skip;

suite('shared tables: isolation between tenants', () => {
    jest.setTimeout(60_000);
    let db: PrismaClient;
    const probe = `isolation_probe_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const schemaOf = (tenantId: string) => `tenant_probe_${tenantId.replace(/-/g, '')}`;

    /** One transaction as the application role, with the context the tenant helpers would set. */
    async function asTenant<T>(schemaName: string, run: (tx: any) => Promise<T>): Promise<T> {
        return db.$transaction(async (tx: any) => {
            await tx.$executeRawUnsafe('SET LOCAL ROLE parallext_app');
            await tx.$executeRawUnsafe(TENANT_CONTEXT_SQL, tenantSearchPath(schemaName), tenantContextIdForSchema(schemaName));
            return run(tx);
        });
    }

    /** One transaction as the application role with no tenant context at all. */
    async function asAppRole<T>(run: (tx: any) => Promise<T>): Promise<T> {
        return db.$transaction(async (tx: any) => {
            await tx.$executeRawUnsafe('SET LOCAL ROLE parallext_app');
            return run(tx);
        });
    }

    beforeAll(async () => {
        db = new PrismaClient({ datasources: { db: { url } } });
        await db.$executeRawUnsafe(
            `CREATE TABLE shared."${probe}" (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id uuid NOT NULL DEFAULT current_setting('app.tenant_id')::uuid,
                note text NOT NULL
            )`);
        await db.$executeRawUnsafe(`SELECT shared.apply_tenant_isolation($1)`, probe);
    });

    afterAll(async () => {
        await db.$executeRawUnsafe(`DROP TABLE IF EXISTS shared."${probe}"`);
        await db.$executeRawUnsafe(`DROP TABLE IF EXISTS shared."${probe}_bad"`);
        await db.$disconnect();
    });

    it('the application role cannot bypass row-level security', async () => {
        const rows = await db.$queryRawUnsafe(
            `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'parallext_app'`) as any[];
        expect(rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    });

    it('a row written without naming the tenant belongs to the tenant of the transaction', async () => {
        await asTenant(schemaOf(tenantA), (tx) => tx.$executeRawUnsafe(`INSERT INTO ${probe} (note) VALUES ('from A')`));
        const rows = await db.$queryRawUnsafe(`SELECT tenant_id::text AS tenant_id, note FROM shared."${probe}"`) as any[];
        expect(rows).toEqual([{ tenant_id: tenantA, note: 'from A' }]);
    });

    it('another tenant cannot read, update or delete it', async () => {
        const seen = await asTenant(schemaOf(tenantB), (tx) => tx.$queryRawUnsafe(`SELECT note FROM ${probe}`)) as any[];
        expect(seen).toEqual([]);
        const updated = await asTenant(schemaOf(tenantB), (tx) => tx.$executeRawUnsafe(`UPDATE ${probe} SET note = 'taken'`));
        expect(updated).toBe(0);
        const deleted = await asTenant(schemaOf(tenantB), (tx) => tx.$executeRawUnsafe(`DELETE FROM ${probe}`));
        expect(deleted).toBe(0);
        const own = await asTenant(schemaOf(tenantA), (tx) => tx.$queryRawUnsafe(`SELECT note FROM ${probe}`)) as any[];
        expect(own).toEqual([{ note: 'from A' }]);
    });

    it('another tenant cannot write a row in its name, nor move its own row to it', async () => {
        await expect(asTenant(schemaOf(tenantB), (tx) => tx.$executeRawUnsafe(
            `INSERT INTO ${probe} (tenant_id, note) VALUES ($1::uuid, 'forged')`, tenantA))).rejects.toThrow(/row-level security/i);
        await asTenant(schemaOf(tenantB), (tx) => tx.$executeRawUnsafe(`INSERT INTO ${probe} (note) VALUES ('from B')`));
        await expect(asTenant(schemaOf(tenantB), (tx) => tx.$executeRawUnsafe(
            `UPDATE ${probe} SET tenant_id = $1::uuid`, tenantA))).rejects.toThrow(/row-level security/i);
    });

    it('without a tenant context the statement fails instead of returning rows', async () => {
        await expect(asTenant('tenant_without_id', (tx) => tx.$queryRawUnsafe(`SELECT note FROM ${probe}`))).rejects.toThrow();
        await expect(asAppRole((tx) => tx.$queryRawUnsafe(`SELECT note FROM shared."${probe}"`))).rejects.toThrow();
    });

    it('the application role cannot change the structure of the shared schema', async () => {
        await expect(asAppRole((tx) => tx.$executeRawUnsafe(`CREATE TABLE shared."${probe}_app" (id uuid)`)))
            .rejects.toThrow(/permission denied/i);
        await expect(asAppRole((tx) => tx.$executeRawUnsafe(`ALTER TABLE shared."${probe}" DISABLE ROW LEVEL SECURITY`)))
            .rejects.toThrow(/must be owner|permission denied/i);
    });

    it('apply_tenant_isolation refuses a table whose tenant_id does not default to the context', async () => {
        await db.$executeRawUnsafe(`CREATE TABLE shared."${probe}_bad" (id uuid, tenant_id uuid NOT NULL)`);
        await expect(db.$executeRawUnsafe(`SELECT shared.apply_tenant_isolation($1)`, `${probe}_bad`)).rejects.toThrow(/must default/i);
    });

    it('every table in shared is registered, and every registered table is isolated', async () => {
        const rows = await db.$queryRawUnsafe(
            `SELECT c.relname::text AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
                    EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS policy
               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'shared' AND c.relkind IN ('r', 'p') AND c.relname NOT LIKE 'isolation\\_probe\\_%'
              ORDER BY c.relname`) as Array<{ name: string; enabled: boolean; forced: boolean; policy: boolean }>;
        expect(rows.map((row) => row.name)).toEqual([...SHARED_TABLE_NAMES].sort());
        expect(rows.filter((row) => !row.enabled || !row.forced || !row.policy)).toEqual([]);
    });
});
