import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PipelineService } from './pipeline.service';

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;
(databaseUrl ? describe : describe.skip)('pipeline schema lock ordering on PostgreSQL', () => {
    const schema = `tenant_pipeline_lock_${randomUUID().replace(/-/g, '')}`;
    const tenantId = randomUUID();
    let client: PrismaClient;
    jest.setTimeout(30_000);

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await client.$executeRawUnsafe(`CREATE TABLE "${schema}".pipelines(
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,name text,description text,
            is_default boolean,is_active boolean,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now())`);
        await client.$executeRawUnsafe(`CREATE TABLE "${schema}".pipeline_stages(
            id uuid PRIMARY KEY,tenant_id uuid,pipeline_id uuid,slug text,transition_rules jsonb)`);
        await client.$executeRawUnsafe(`CREATE TABLE "${schema}".deals(id uuid PRIMARY KEY,stage_id uuid,pipeline_id uuid)`);
        await client.$executeRawUnsafe(`INSERT INTO "${schema}".pipelines(tenant_id,name,is_default,is_active)
            VALUES($1::uuid,'Synthetic pipeline',true,true)`, tenantId);
    });
    afterAll(async () => {
        if (client) {
            await client.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
            await client.$disconnect();
        }
    });

    it('finishes ownership reconciliation while a concurrent table repair waits', async () => {
        let release!: () => void;
        let reached!: () => void;
        const hold = new Promise<void>(resolve => { release = resolve; });
        const ownershipRead = new Promise<void>(resolve => { reached = resolve; });
        let contenderPid = 0;
        function adapter(pause: boolean) {
            const prisma = Object.create(PrismaService.prototype) as PrismaService;
            Object.defineProperty(prisma, '$transaction', { value: (callback: any, options: any) =>
                client.$transaction(async tx => {
                    const [{ pid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid') as any[];
                    if (!pause) contenderPid = pid;
                    return callback({
                        $executeRawUnsafe: tx.$executeRawUnsafe.bind(tx),
                        $queryRawUnsafe: async (sql: string, ...params: any[]) => {
                            const rows = await tx.$queryRawUnsafe(sql, ...params);
                            if (pause && sql.includes('AS has_owned_duplicates')) { reached(); await hold; }
                            return rows;
                        },
                    });
                }, options),
            });
            return prisma;
        }
        const service = new PipelineService(adapter(true), {} as any, {} as any, {} as any, {} as any);
        const migrate = (service as any).migrateToMultiPipeline(schema, tenantId)
            .then((value: string) => ({ value }), (error: any) => ({ error }));
        await ownershipRead;
        const repair = adapter(false).executeInTenantSchema(schema,
            "ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS transition_rules JSONB DEFAULT '[]'::jsonb")
            .then(value => ({ value }), error => ({ error }));
        try {
            let blocked = false;
            for (let attempt = 0; attempt < 200 && !blocked; attempt++) {
                if (contenderPid) {
                    const [row] = await client.$queryRawUnsafe(
                        'SELECT cardinality(pg_blocking_pids($1::int)) > 0 AS blocked', contenderPid,
                    ) as any[];
                    blocked = row.blocked;
                }
                if (!blocked) await new Promise(resolve => setTimeout(resolve, 10));
            }
            expect(blocked).toBe(true);
        } finally { release(); }
        const results = await Promise.all([migrate, repair]);
        expect(results.map(result => 'error' in result ? result.error : null)).toEqual([null, null]);
        const [index] = await client.$queryRawUnsafe('SELECT to_regclass($1)::text AS name',
            `${schema}.uidx_pipeline_stages_pipeline_slug`) as any[];
        expect(index.name).not.toBeNull();
    });
});
