import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { WebhookSubscriptionService } from '../../modules/public-api/webhook-subscription.service';
import { FaqsService } from '../../modules/faqs/faqs.service';
import { withRuntimeSchemaLock } from './runtime-schema-lock';
import { ensureWidgetSchema } from '../../modules/widget/widget-schema';
import { WidgetTriggersService } from '../../modules/widget/widget-triggers.service';

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;
(databaseUrl ? describe : describe.skip)('runtime DDL concurrency on PostgreSQL', () => {
    const schema = `tenant_ddl_${randomUUID().replace(/-/g, '')}`;
    let client: PrismaClient;
    let prisma: PrismaService;
    jest.setTimeout(60_000);

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        // Exercise the production tenant wrappers against real connections.
        prisma = Object.create(PrismaService.prototype);
        Object.defineProperty(prisma, '$transaction', { value: client.$transaction.bind(client) });
    });

    afterAll(async () => {
        if (!client) return;
        await client.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
        await client.$disconnect();
    });

    it('initializes the actual webhook outbox concurrently with cold Redis hints', async () => {
        // Relocate only this service's two tables so the test never drops shared tables.
        const adapter = {
            $transaction: (callback: any, options: any) => client.$transaction(tx => callback({
                $queryRawUnsafe: (sql: string, ...params: any[]) => tx.$queryRawUnsafe(
                    sql.replace(/public\.webhook_/g, `"${schema}".webhook_`), ...params,
                ),
            }), options),
        };
        const services = Array.from({ length: 12 }, () => new WebhookSubscriptionService(
            adapter as any, { get: async () => null, set: jest.fn() } as any, {} as any, {} as any,
        ));
        await Promise.all(services.map(service => (service as any).ensureTable()));
        const tables = await client.$queryRawUnsafe(
            "SELECT tablename FROM pg_tables WHERE schemaname = $1 AND tablename LIKE 'webhook_%' ORDER BY tablename", schema,
        ) as any[];
        expect(tables.map(row => row.tablename)).toEqual(['webhook_delivery_outbox', 'webhook_subscriptions']);
        const indexes = await client.$queryRawUnsafe(
            'SELECT indexname FROM pg_indexes WHERE schemaname = $1', schema,
        ) as any[];
        expect(indexes.map(row => row.indexname)).toEqual(expect.arrayContaining([
            'idx_webhook_delivery_outbox_pending', 'idx_webhook_subs_tenant_event',
        ]));
    });

    it('uses the full widget definition even when the trigger service initializes first', async () => {
        const adapter = {
            $transaction: (callback: any, options: any) => client.$transaction(tx => callback({
                $queryRawUnsafe: (sql: string, ...params: any[]) => tx.$queryRawUnsafe(
                    sql.replace(/public\.widget_/g, `"${schema}".widget_`), ...params,
                ),
            }), options),
        };
        const triggers = new WidgetTriggersService(adapter as any,
            { get: async () => null, set: jest.fn() } as any);
        await (triggers as any).ensureTable();
        await Promise.all(Array.from({ length: 6 }, () => ensureWidgetSchema(adapter as any)));
        const constraints = await client.$queryRawUnsafe(
            `SELECT contype FROM pg_constraint
             WHERE conrelid = $1::regclass AND contype = 'f'`, `${schema}.widget_triggers`,
        ) as any[];
        expect(constraints).toHaveLength(1);
        const columns = await client.$queryRawUnsafe(
            `SELECT is_nullable FROM information_schema.columns
             WHERE table_schema=$1 AND table_name='widget_triggers' AND column_name='action_type'`, schema,
        ) as any[];
        expect(columns[0].is_nullable).toBe('NO');
    });

    it('coordinates both tenant query APIs with a direct initializer using the same scope', async () => {
        let release!: () => void;
        let locked!: () => void;
        const acquired = new Promise<void>(resolve => { locked = resolve; });
        const hold = new Promise<void>(resolve => { release = resolve; });
        const holder = withRuntimeSchemaLock(client, schema, async tx => {
            await tx.$executeRawUnsafe(`CREATE TABLE "${schema}".lock_sentinel(id integer)`);
            locked();
            await hold;
        });
        await acquired;
        let complete = 0;
        const direct = prisma.executeInTenantSchema(schema, 'CREATE TABLE IF NOT EXISTS raced(id integer)')
            .then(() => { complete += 1; });
        const transaction = prisma.transactionInTenantSchema(schema, async query => {
            await query('CREATE TABLE IF NOT EXISTS raced(id integer)');
            await query('CREATE INDEX IF NOT EXISTS raced_id ON raced(id)');
        }).then(() => { complete += 1; });
        // Observe actual blocked database requests rather than assuming a sleep proves locking.
        try {
            let blocked = 0;
            for (let attempt = 0; attempt < 100 && blocked < 2; attempt += 1) {
                const rows = await client.$queryRawUnsafe(
                    `SELECT COUNT(*)::int AS count FROM pg_locks
                     WHERE locktype = 'advisory' AND NOT granted
                       AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
                ) as any[];
                blocked = rows[0].count;
                if (blocked < 2) await new Promise(resolve => setTimeout(resolve, 10));
            }
            expect(blocked).toBeGreaterThanOrEqual(2);
            expect(complete).toBe(0);
        } finally {
            release();
            await Promise.all([holder, direct, transaction]);
        }
        expect(complete).toBe(2);
    });

    it('rolls back incomplete FAQ initialization and does not cache a failed attempt', async () => {
        let fail = true;
        const adapter = {
            $transaction: (callback: any, options: any) => client.$transaction(tx => callback({
                $queryRawUnsafe: tx.$queryRawUnsafe.bind(tx),
                $executeRawUnsafe: (sql: string, ...params: any[]) => {
                    if (fail && sql.includes('CREATE INDEX')) return tx.$executeRawUnsafe('SELECT 1/0');
                    return tx.$executeRawUnsafe(sql, ...params);
                },
            }), options),
        };
        const faqs = new FaqsService(adapter as any, {} as any,
            { getSchemaName: async () => schema } as any);
        await expect((faqs as any).ensureSchema('test-tenant')).rejects.toThrow();
        const absent = await client.$queryRawUnsafe('SELECT to_regclass($1)::text AS relation', `${schema}.faqs`) as any[];
        expect(absent[0].relation).toBeNull();
        fail = false;
        await (faqs as any).ensureSchema('test-tenant');
        const present = await client.$queryRawUnsafe('SELECT to_regclass($1)::text AS relation', `${schema}.faqs`) as any[];
        expect(present[0].relation).toBe(`${schema}.faqs`);
    });
});
