import { randomUUID } from 'crypto';
import { IsolatedEvalNamespace, isolatedDefault } from './isolated-eval-namespace';

describe('isolated evaluation SQL policy', () => {
    it('rebinds serial defaults and permits only reviewed built-in defaults', () => {
        expect(isolatedDefault("nextval('tenant_live.services_id_seq'::regclass)", '"tenant_eval_owned"."new_sequence"'))
            .toBe('nextval(\'"tenant_eval_owned"."new_sequence"\'::regclass)');
        expect(isolatedDefault('uuid_generate_v4()')).toBe('pg_catalog.gen_random_uuid()');
        expect(isolatedDefault('public.uuid_generate_v4()')).toBe('pg_catalog.gen_random_uuid()');
        for (const value of ['now()', 'false', "'{}'::jsonb", "'pending'::character varying", '100']) expect(isolatedDefault(value)).toBe(value);
        for (const value of ['public.create_order()', 'setval(\'live_seq\', 1)', '0; DELETE FROM contacts']) {
            expect(() => isolatedDefault(value)).toThrow('eval_unsafe_default');
        }
        expect(() => isolatedDefault("nextval('tenant_live.seq'::regclass)")).toThrow('eval_sequence_metadata_missing');
    });
    it('rejects unreviewed tables, sources and forged cleanup namespaces before I/O', async () => {
        const database = { transaction: jest.fn() }; const service = new IsolatedEvalNamespace(database);
        await expect(service.provision(randomUUID(), 'public', ['contacts'])).rejects.toThrow('eval_invalid_source');
        await expect(service.provision(randomUUID(), 'tenant_source', ['payment_credentials'])).rejects.toThrow('eval_table_not_reviewed');
        await expect(service.dispose({ schemaName: 'tenant_production', token: randomUUID(), tenantId: randomUUID() } as any)).rejects.toThrow('eval_invalid_lease');
        expect(database.transaction).not.toHaveBeenCalled();
    });
});

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const databaseTests = connection ? describe : describe.skip;
databaseTests('isolated namespaces on PostgreSQL (explicit disposable database only)', () => {
    let client: any; let service: IsolatedEvalNamespace;
    const tenantId = randomUUID();
    const source = `tenant_source_${randomUUID().replace(/-/g, '')}`;
    const leases: any[] = [];
    beforeAll(async () => {
        const url = new URL(connection!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/parallly_eval_isolation')) throw new Error('disposable_eval_database_required');
        const { Client } = require('pg'); client = new Client({ connectionString: connection }); await client.connect();
        service = new IsolatedEvalNamespace({ transaction: async work => {
            await client.query('BEGIN');
            try { const result = await work(async (sql, params) => (await client.query(sql, params)).rows); await client.query('COMMIT'); return result; }
            catch (error) { await client.query('ROLLBACK'); throw error; }
        } });
        await client.query('CREATE TABLE IF NOT EXISTS public.tenants (id uuid PRIMARY KEY,schema_name text NOT NULL)');
        await client.query('INSERT INTO public.tenants VALUES ($1,$2)', [tenantId, source]);
        await client.query(`CREATE SCHEMA "${source}"`);
        await client.query(`CREATE TABLE "${source}".contacts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL DEFAULT 'test')`);
        await client.query(`CREATE TABLE "${source}".services (id serial PRIMARY KEY,price numeric NOT NULL DEFAULT 0 CHECK (price>=0),name text DEFAULT 'service')`);
        await client.query(`CREATE TABLE "${source}".appointments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),contact_id uuid NOT NULL REFERENCES "${source}".contacts(id),service_id integer NOT NULL REFERENCES "${source}".services(id),status text DEFAULT 'pending' CHECK (status IN ('pending','confirmed')))`);
        await client.query(`CREATE TABLE "${source}".members (id bigint GENERATED ALWAYS AS IDENTITY (START WITH 50) PRIMARY KEY)`);
        await client.query(`INSERT INTO "${source}".services(price) VALUES (10)`);
        await client.query(`SELECT setval('"${source}".services_id_seq',100)`);
    });
    afterAll(async () => {
        if (!client) return;
        for (const lease of leases) await service.dispose(lease);
        await client.query(`DROP TABLE "${source}".appointments,"${source}".services,"${source}".contacts,"${source}".members RESTRICT`);
        await client.query(`DROP SCHEMA "${source}" RESTRICT`);
        await client.query('DELETE FROM public.tenants WHERE id=$1', [tenantId]);
        await client.end();
    });
    it('keeps UUID defaults, checks and FKs while starting an independent serial sequence', async () => {
        const lease = await service.provision(tenantId, source, ['contacts', 'services', 'appointments']); leases.push(lease);
        await service.assertOwned(lease);
        const target = `"${lease.schemaName}"`;
        expect((await client.query(`SELECT count(*)::int AS n FROM ${target}.services`)).rows[0].n).toBe(0);
        const contact = (await client.query(`INSERT INTO ${target}.contacts DEFAULT VALUES RETURNING id`)).rows[0];
        const offer = (await client.query(`INSERT INTO ${target}.services DEFAULT VALUES RETURNING id`)).rows[0];
        expect(offer.id).toBe(1);
        expect((await client.query(`SELECT last_value::int AS n FROM "${source}".services_id_seq`)).rows[0].n).toBe(100);
        await client.query(`INSERT INTO ${target}.appointments(contact_id,service_id) VALUES ($1,$2)`, [contact.id, offer.id]);
        await expect(client.query(`INSERT INTO ${target}.appointments(contact_id,service_id) VALUES ($1,$2)`, [randomUUID(), offer.id])).rejects.toMatchObject({ code: '23503' });
        await expect(client.query(`INSERT INTO ${target}.services(price) VALUES (-1)`)).rejects.toMatchObject({ code: '23514' });
        expect((await client.query(`SELECT count(*)::int AS n FROM "${source}".appointments`)).rows[0].n).toBe(0);
        await service.dispose(lease); await service.dispose(lease);
        expect((await client.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [lease.schemaName])).rowCount).toBe(0);
    });
    it('rejects a missing FK dependency before leaving any cloned objects', async () => {
        await expect(service.provision(tenantId, source, ['appointments'])).rejects.toThrow('eval_dependency_not_cloned');
        expect((await client.query("SELECT 1 FROM pg_namespace WHERE nspname ~ '^tenant_eval_[a-f0-9]{8}_[a-f0-9]{24}$'")).rowCount).toBe(0);
    });
    it('recovers expired namespaces after a crash without removing a live lease or source', async () => {
        const expired=await service.provision(tenantId,source,['contacts']);leases.push(expired);
        const active=await service.provision(tenantId,source,['contacts']);leases.push(active);
        await client.query(`UPDATE "${expired.schemaName}".__eval_namespace SET expires_at=clock_timestamp()-interval '1 second'`);
        expect(await service.reapExpired(tenantId,source)).toBe(1);
        await service.assertOwned(active);
        expect((await client.query('SELECT 1 FROM pg_namespace WHERE nspname=$1',[source])).rows).toHaveLength(1);
        expect(await service.reapExpired(tenantId,source)).toBe(0);
    });
    it('rejects custom operator code hidden inside a check constraint', async () => {
        await client.query(`CREATE FUNCTION "${source}".custom_equal(integer,integer) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT $1=$2'`);
        await client.query(`CREATE OPERATOR "${source}".=== (LEFTARG=integer,RIGHTARG=integer,FUNCTION="${source}".custom_equal)`);
        await client.query(`CREATE TABLE "${source}".enrollments(id integer CHECK (id OPERATOR("${source}".===) 1))`);
        try {
            await expect(service.provision(tenantId,source,['enrollments'])).rejects.toThrow('eval_unreviewed_database_function');
        } finally {
            await client.query(`DROP TABLE "${source}".enrollments RESTRICT`);
            await client.query(`DROP OPERATOR "${source}".=== (integer,integer) RESTRICT`);
            await client.query(`DROP FUNCTION "${source}".custom_equal(integer,integer) RESTRICT`);
        }
    });
    it('uses a separate identity sequence with the original sequence definition', async () => {
        const lease = await service.provision(tenantId, source, ['members']); leases.push(lease);
        const sourceId = (await client.query(`INSERT INTO "${source}".members DEFAULT VALUES RETURNING id::int`)).rows[0].id;
        const clonedId = (await client.query(`INSERT INTO "${lease.schemaName}".members DEFAULT VALUES RETURNING id::int`)).rows[0].id;
        expect(sourceId).toBe(50); expect(clonedId).toBe(50);
        const nextSource = (await client.query(`INSERT INTO "${source}".members DEFAULT VALUES RETURNING id::int`)).rows[0].id;
        expect(nextSource).toBe(51);
        await service.dispose(lease);
    });
    it('replaces the UUID extension default without invoking a source function', async () => {
        await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        await client.query(`ALTER TABLE "${source}".contacts ALTER COLUMN id SET DEFAULT public.uuid_generate_v4()`);
        const lease = await service.provision(tenantId, source, ['contacts']); leases.push(lease);
        const created = (await client.query(`INSERT INTO "${lease.schemaName}".contacts DEFAULT VALUES RETURNING id`)).rows[0].id;
        expect(created).toMatch(/^[a-f0-9-]{36}$/);
        const expression = (await client.query(`SELECT column_default FROM information_schema.columns WHERE table_schema=$1 AND table_name='contacts' AND column_name='id'`, [lease.schemaName])).rows[0].column_default;
        expect(expression).toContain('gen_random_uuid()');
        expect(expression).not.toContain('uuid_generate_v4');
        await service.dispose(lease);
    });
    it('rejects source CHECK functions and generated expressions instead of copying unreviewed code', async () => {
        const fn = `eval_check_${randomUUID().replace(/-/g, '')}`;
        await client.query(`CREATE FUNCTION public."${fn}"(numeric) RETURNS boolean LANGUAGE sql AS 'SELECT true'`);
        await client.query(`ALTER TABLE "${source}".services ADD CONSTRAINT external_check CHECK(public."${fn}"(price))`);
        try { await expect(service.provision(tenantId, source, ['services'])).rejects.toThrow('eval_unreviewed_database_function'); }
        finally {
            await client.query(`ALTER TABLE "${source}".services DROP CONSTRAINT external_check`);
            await client.query(`DROP FUNCTION public."${fn}"(numeric)`);
        }
        await client.query(`ALTER TABLE "${source}".services ADD COLUMN doubled numeric GENERATED ALWAYS AS (price*2) STORED`);
        try { await expect(service.provision(tenantId, source, ['services'])).rejects.toThrow('eval_unsupported_column_definition'); }
        finally { await client.query(`ALTER TABLE "${source}".services DROP COLUMN doubled`); }
    });
    it('does not drop a namespace with a forged owner token or an external dependent view', async () => {
        const lease = await service.provision(tenantId, source, ['contacts']); leases.push(lease);
        await expect(service.dispose({ ...lease, token: randomUUID() })).rejects.toThrow('eval_namespace_owner_mismatch');
        const view = `view_${randomUUID().replace(/-/g, '')}`;
        await client.query(`CREATE VIEW public."${view}" AS SELECT id FROM "${lease.schemaName}".contacts`);
        await expect(service.dispose(lease)).rejects.toMatchObject({ code: '2BP01' });
        await service.assertOwned(lease);
        await client.query(`DROP VIEW public."${view}"`);
        await service.dispose(lease);
    });
    it('rejects expired execution leases but still lets the owner clean up', async () => {
        const lease = await service.provision(tenantId, source, ['contacts']); leases.push(lease);
        await client.query(`UPDATE "${lease.schemaName}".__eval_namespace SET expires_at=NOW()-interval '1 second'`);
        await expect(service.assertOwned(lease)).rejects.toThrow('eval_namespace_lease_lost');
        await service.dispose(lease);
    });
});
