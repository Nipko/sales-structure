import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { VerticalReadinessService } from '../verticals/vertical-readiness.service';
import { EvaluationRevisionService } from './evaluation-revision.service';
import { LodgingSourceOfTruthService } from '../channel-manager/lodging-source-of-truth.service';
import { isDisposableDatabaseUrl } from '../../common/__fixtures__/disposable-database';
import { assertServiceCatalogCurrent, captureServiceCatalog, withCapturedServiceCatalog,
    serviceCatalogCaptureDatabase, type CaptureDatabase, type CaptureQuery } from './evaluation-service-catalog-capture';

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
(connection ? describe : describe.skip)('candidate read capture under traffic in disposable PostgreSQL', () => {
    const tenantId = randomUUID(), serviceId = randomUUID();
    const source = `tenant_capture_${randomUUID().replace(/-/g, '')}`;
    const sandbox = `tenant_eval_${randomUUID().replace(/-/g, '')}`;
    let pool: any, database: CaptureDatabase, revision: EvaluationRevisionService;
    let afterRead: (() => Promise<void>) | undefined;
    const query = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows;
    beforeAll(async () => {
        const url = new URL(connection!);
        if (!['localhost','127.0.0.1'].includes(url.hostname) || !isDisposableDatabaseUrl(url))
            throw new Error('disposable_eval_database_required');
        pool = new Pool({ connectionString: connection });
        await query('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)', [tenantId,source]);
        await query(`CREATE SCHEMA "${source}"`);
        await query(`CREATE SCHEMA "${sandbox}"`);
        await query(`CREATE TABLE "${source}".services(id uuid PRIMARY KEY,name text,description text,
            duration_minutes integer,buffer_minutes integer,price numeric,currency text,is_active boolean,
            duration_type text,duration_minutes_max integer,payment_policy text,deposit_percent numeric,deposit_amount numeric,
            location_type text,location_address text,meeting_link text,is_public boolean,sort_order integer)`);
        await query(`INSERT INTO "${source}".services VALUES($1::uuid,'Consulta','Consulta general',30,0,100,'COP',true,
            'fixed',null,'none',null,null,'in_person','Sede principal',null,true,1)`, [serviceId]);
        await query(`CREATE TABLE "${source}".messages(id uuid PRIMARY KEY,content_text text)`);
        await query(`CREATE TABLE "${source}".contacts(id uuid PRIMARY KEY,name text)`);
        for (const table of ['agent_personas','knowledge_documents','knowledge_embeddings']) {
            await query(`CREATE TABLE "${source}".${table}(id uuid PRIMARY KEY,body jsonb)`);
            await query(`INSERT INTO "${source}".${table} VALUES($1::uuid,'{"version":1}')`, [randomUUID()]);
        }
        await query(`CREATE TABLE "${sandbox}".services(id uuid PRIMARY KEY,is_active boolean)`);
        for (const schema of [source,sandbox]) await query(`CREATE TABLE "${schema}".cm_listings(id uuid PRIMARY KEY,
            property_id uuid,provider text,status text,is_deleted boolean,last_synced_at timestamptz)`);
        await query(`INSERT INTO "${source}".cm_listings VALUES($1::uuid,$2::uuid,'hostaway','active',false,NOW())`,[randomUUID(),serviceId]);
        database = { readTransaction: async work => {
            const client = await pool.connect();
            await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
            try {
                const result = await work(async (sql, params = []) => {
                    const rows = (await client.query(sql, params)).rows;
                    if (afterRead && sql.includes('FROM pg_class')) { const hook = afterRead; afterRead = undefined; await hook(); }
                    return rows;
                });
                await client.query('COMMIT'); return result;
            } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
        } };
        revision = new EvaluationRevisionService({ $transaction: async (work: any, options: any) => {
            expect(options.isolationLevel).toBe('RepeatableRead');
            return database.readTransaction(q => work({ $queryRawUnsafe: (sql: string,...params: unknown[]) => q(sql,params) }));
        } } as any, { evaluationRoutingSignature: async () => 'fixed-routing' } as any);
    }, 30000);
    afterAll(async () => {
        if (!pool) return;
        for (const schema of [source,sandbox]) {
            if (!/^tenant_(capture|eval)_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        }
        await query('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2', [tenantId,source]);
        await pool.end();
    });
    it('reproduces the current whole-tenant invalidation caused by an unrelated operational message', async () => {
        const full = await revision.capture(tenantId);
        const capture = await captureServiceCatalog(database,tenantId);
        await query(`INSERT INTO "${source}".messages VALUES($1::uuid,'Mensaje privado irrelevante al catálogo')`, [randomUUID()]);
        await expect(revision.assertCurrent(full)).rejects.toThrow('tenant.messages');
        await expect(assertServiceCatalogCurrent(database,capture,tenantId)).resolves.toBeUndefined();
        expect(JSON.stringify(capture)).not.toContain('Mensaje privado');
        expect(capture.replacesGlobalManifest).toBe(false);
    });
    it('still invalidates the candidate catalog when canonical price or payment terms change', async () => {
        for (const assignment of ["price=price+1", "payment_policy='deposit',deposit_percent=20"]) {
            const full = await revision.capture(tenantId);
            const capture = await captureServiceCatalog(database,tenantId);
            await query(`UPDATE "${source}".services SET ${assignment} WHERE id=$1::uuid`, [serviceId]);
            await expect(revision.assertCurrent(full)).rejects.toThrow('tenant.services');
            await expect(assertServiceCatalogCurrent(database,capture,tenantId)).rejects.toThrow('capture_catalog_changed');
        }
    });
    it('keeps configuration and knowledge changes behind the unmodified global guard', async () => {
        for (const table of ['agent_personas','knowledge_documents','knowledge_embeddings']) {
            const full = await revision.capture(tenantId);
            await query(`UPDATE "${source}".${table} SET body=$1::jsonb`, [JSON.stringify({ changed:randomUUID() })]);
            await expect(revision.assertCurrent(full)).rejects.toThrow(`tenant.${table}`);
        }
    });
    it('captures a coherent catalog in one MVCC snapshot during a concurrent edit', async () => {
        const before = await captureServiceCatalog(database,tenantId);
        afterRead = () => query(`UPDATE "${source}".services SET price=price+1`).then(() => {});
        const during = await captureServiceCatalog(database,tenantId);
        expect(during.dependencyHash).toBe(before.dependencyHash);
        await expect(assertServiceCatalogCurrent(database,during,tenantId)).rejects.toThrow('capture_catalog_changed');
    });
    it('tracks result membership, including the empty result becoming nonempty', async () => {
        await query(`UPDATE "${source}".services SET is_public=false`);
        const empty = await captureServiceCatalog(database,tenantId);
        expect(empty.rows).toEqual([]);
        await query(`UPDATE "${source}".services SET is_public=true`);
        await expect(assertServiceCatalogCurrent(database,empty,tenantId)).rejects.toThrow('capture_catalog_changed');
        const populated = await captureServiceCatalog(database,tenantId);
        await query(`UPDATE "${source}".services SET is_active=false`);
        await expect(assertServiceCatalogCurrent(database,populated,tenantId)).rejects.toThrow('capture_catalog_changed');
        await query(`UPDATE "${source}".services SET is_active=true`);
    });
    it('detects relevant schema drift and refuses a missing projection column', async () => {
        const capture = await captureServiceCatalog(database,tenantId);
        await query(`ALTER TABLE "${source}".services ALTER COLUMN price TYPE numeric(16,2)`);
        await expect(assertServiceCatalogCurrent(database,capture,tenantId)).rejects.toThrow('capture_catalog_changed');
        await query(`ALTER TABLE "${source}".services RENAME COLUMN description TO description_hidden`);
        await expect(captureServiceCatalog(database,tenantId)).rejects.toThrow('capture_catalog_schema_incomplete');
        await query(`ALTER TABLE "${source}".services RENAME COLUMN description_hidden TO description`);
    });
    it('holds the live authority/erasure fence through each consumption and never falls back to source', async () => {
        const capture = await captureServiceCatalog(database,tenantId);
        let fenceHeld = false;
        const guard = jest.fn(async () => {});
        const fence = async <T>(work: () => Promise<T>): Promise<T> => {
            await guard(); fenceHeld = true;
            try { return await work(); } finally { fenceHeld = false; }
        };
        await withCapturedServiceCatalog(capture,tenantId,fence,async rows => {
            expect(fenceHeld).toBe(true);
            await Promise.resolve(); expect(fenceHeld).toBe(true);
            rows[0].name = 'caller mutation';
        });
        expect(fenceHeld).toBe(false);
        await withCapturedServiceCatalog(capture,tenantId,fence,async rows => { expect(rows[0].name).toBe('Consulta'); });
        expect(guard).toHaveBeenCalledTimes(2);
        const unused = jest.fn(async () => {});
        await expect(withCapturedServiceCatalog(capture,tenantId,async () => { throw new Error('source_erased'); },unused)).rejects.toThrow('source_erased');
        expect(unused).not.toHaveBeenCalled();
        await expect(withCapturedServiceCatalog(capture,randomUUID(),fence,unused)).rejects.toThrow('capture_scope_mismatch');
        const tampered = structuredClone(capture); tampered.rows[0].price = 1;
        await expect(withCapturedServiceCatalog(tampered,tenantId,fence,unused)).rejects.toThrow('capture_integrity_mismatch');
        const clock = jest.spyOn(Date,'now').mockReturnValue(Date.parse(capture.expiresAt));
        try { await expect(withCapturedServiceCatalog(capture,tenantId,fence,unused)).rejects.toThrow('capture_expired'); }
        finally { clock.mockRestore(); }
    });
    it('queries real namespace readiness despite populated production catalog and a warm production cache', async () => {
        const redis = { getJson: jest.fn(async () => ({ checks: [{ count: 999 }], unmet: [], degraded:false })), setJson: jest.fn() };
        const service = new VerticalReadinessService({ executeInTenantSchema: async (schema: string,sql: string) => {
            if (![source,sandbox].includes(schema)) throw new Error('unexpected_schema');
            return query(sql.replace('FROM services',`FROM "${schema}".services`));
        } } as any, redis as any);
        const live = await service.evaluate(tenantId,source,['appointment_services'],AGENT_TEST_EXECUTION_CONTEXT);
        const isolated = await service.evaluate(tenantId,sandbox,['appointment_services'],AGENT_TEST_EXECUTION_CONTEXT);
        expect(live.checks[0].count).toBe(1);
        expect(isolated.unmet).toEqual(['appointment_services']);
        expect(redis.getJson).not.toHaveBeenCalled(); expect(redis.setJson).not.toHaveBeenCalled();
    });
    it('runs the candidate capture transaction read-only', async () => {
        await expect(database.readTransaction((q: CaptureQuery) => q(`INSERT INTO "${source}".messages VALUES($1::uuid,'forbidden')`,[randomUUID()]))).rejects.toThrow(/read-only/i);
    });
    it('has a usable Prisma transaction adapter that enforces read-only before any projection', async () => {
        const adapter = serviceCatalogCaptureDatabase({ $transaction: async (work,options) => {
            expect(options.isolationLevel).toBe('RepeatableRead');
            const client = await pool.connect(); await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
            try {
                const result = await work({ $executeRawUnsafe:(sql:string) => client.query(sql),
                    $queryRawUnsafe:async (sql:string,...params:unknown[]) => (await client.query(sql,params)).rows });
                await client.query('COMMIT'); return result;
            } catch(error) { await client.query('ROLLBACK'); throw error; } finally {client.release();}
        } });
        expect((await captureServiceCatalog(adapter,tenantId)).rows).toHaveLength(1);
        await expect(adapter.readTransaction(q => q(`INSERT INTO "${source}".messages VALUES($1::uuid,'forbidden')`,[randomUUID()]))).rejects.toThrow(/read-only/i);
    });
    it('does not reuse source lodging mappings for the same property ID in an isolated namespace', async () => {
        const redis = { get:jest.fn(async () => '1'),getJson:jest.fn(async () => ({sor:'channel_manager',listingId:serviceId})),setJson:jest.fn() };
        const service = new LodgingSourceOfTruthService({ executeInTenantSchema:async (schema:string,sql:string,params:unknown[]) => {
            if (![source,sandbox].includes(schema)) throw new Error('unexpected_schema');
            return query(sql.replace('FROM cm_listings',`FROM "${schema}".cm_listings`),params);
        } } as any,redis as any,{getOwnershipConfig:async () => ({provider:'hostaway',syncInterval:60})} as any);
        const live = await service.resolveForProperty(tenantId,source,serviceId,AGENT_TEST_EXECUTION_CONTEXT);
        const isolated = await service.resolveForProperty(tenantId,sandbox,serviceId,AGENT_TEST_EXECUTION_CONTEXT);
        expect(live.sor).toBe('channel_manager');
        expect(isolated.sor).toBe('unknown'); // no fabricated local booking authority
        expect(isolated.listingId).toBeUndefined();
        expect(redis.get).not.toHaveBeenCalled();expect(redis.getJson).not.toHaveBeenCalled();expect(redis.setJson).not.toHaveBeenCalled();
    });
});
