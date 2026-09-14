import { isRuntimeSchemaDdl, withRuntimeSchemaLock } from './runtime-schema-lock';
import { WebhookSubscriptionService } from '../../modules/public-api/webhook-subscription.service';
import { PrismaService } from '../../modules/prisma/prisma.service';

describe('runtime schema initialization', () => {
    function tenantFixture() {
        const tx = { $executeRawUnsafe: jest.fn().mockResolvedValue(0), $queryRawUnsafe: jest.fn().mockResolvedValue([]) };
        const prisma = Object.create(PrismaService.prototype) as PrismaService;
        Object.defineProperty(prisma, '$transaction', { value: async (work: any) => work(tx) });
        return { prisma, tx };
    }

    it('takes the declared schema lock before the business callback can read a table', async () => {
        const { prisma, tx } = tenantFixture();
        await prisma.transactionInTenantSchema('tenant_test', async query => {
            expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), 'runtime-schema:tenant_test');
            await query('SELECT * FROM pipeline_stages');
            await query('ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS transition_rules jsonb');
        }, { schemaLock: true });
        expect(tx.$queryRawUnsafe.mock.calls.filter(([sql]) => sql.includes('pg_advisory_xact_lock'))).toHaveLength(1);
    });

    it('refuses a late schema lock instead of waiting while holding relation locks', async () => {
        const { prisma, tx } = tenantFixture();
        await expect(prisma.transactionInTenantSchema('tenant_test', async query => {
            await query('SELECT * FROM pipeline_stages');
            await query('CREATE INDEX IF NOT EXISTS stage_id ON pipeline_stages(id)');
        })).rejects.toThrow('runtime_schema_lock_required_at_transaction_start');
        expect(tx.$queryRawUnsafe.mock.calls).toEqual([['SELECT * FROM pipeline_stages']]);
    });

    it('keeps ordinary business transactions free of the schema mutex', async () => {
        const { prisma, tx } = tenantFixture();
        await prisma.transactionInTenantSchema('tenant_test', query => query('SELECT * FROM pipeline_stages'));
        expect(tx.$queryRawUnsafe.mock.calls).toEqual([['SELECT * FROM pipeline_stages']]);
    });

    it.each([
        'CREATE TABLE IF NOT EXISTS foo(id uuid)',
        '/* outer /* nested */ migration */ CREATE TABLE IF NOT EXISTS foo(id uuid)',
        ' -- compatibility\n /* cold start */ CREATE UNIQUE INDEX IF NOT EXISTS foo ON bar(id)',
        'ALTER TABLE foo ADD COLUMN IF NOT EXISTS id uuid',
        'DO $upgrade$ BEGIN NULL; END $upgrade$',
        'CREATE OR REPLACE FUNCTION foo() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql',
    ])('recognizes DDL: %s', sql => expect(isRuntimeSchemaDdl(sql)).toBe(true));

    it.each([
        "SELECT 'CREATE TABLE foo'",
        "-- CREATE TABLE foo\nSELECT 1",
        "INSERT INTO events(payload) VALUES ('ALTER TABLE')",
        'UPDATE foo SET id = 1',
    ])('does not lock ordinary queries: %s', sql => expect(isRuntimeSchemaDdl(sql)).toBe(false));

    function fixture() {
        const tx = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) };
        const db = {
            $queryRawUnsafe: jest.fn(() => { throw new Error('DDL escaped its transaction'); }),
            $transaction: jest.fn(async (callback: any) => callback(tx)),
        };
        const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };
        const service = new WebhookSubscriptionService(db as any, redis as any, {} as any, {} as any);
        return { tx, db, redis, service };
    }

    it('waits for the database lock before issuing any DDL', async () => {
        const { tx, db } = fixture();
        let release!: () => void;
        tx.$queryRawUnsafe.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
        const initialize = jest.fn();
        const pending = withRuntimeSchemaLock(db as any, 'public', initialize);
        expect(initialize).not.toHaveBeenCalled();
        release();
        await pending;
        expect(initialize).toHaveBeenCalledWith(tx);
    });

    it('publishes Redis readiness only after COMMIT, not when DDL finishes', async () => {
        const { tx, db, redis, service } = fixture();
        db.$transaction.mockImplementation(async callback => {
            await callback(tx);
            expect(redis.set).not.toHaveBeenCalled();
            throw new Error('commit failed');
        });
        await expect((service as any).ensureTable()).rejects.toThrow('commit failed');
        expect(redis.set).not.toHaveBeenCalled();
    });

    it('propagates a DDL failure and retries initialization on the next call', async () => {
        const { tx, redis, service } = fixture();
        let fail = true;
        tx.$queryRawUnsafe.mockImplementation(async (sql: string) => {
            if (fail && sql.includes('CREATE TABLE IF NOT EXISTS public.webhook_delivery_outbox')) {
                throw new Error('catalog unavailable');
            }
            return [];
        });
        await expect((service as any).ensureTable()).rejects.toThrow('catalog unavailable');
        expect(redis.set).not.toHaveBeenCalled();
        fail = false;
        await (service as any).ensureTable();
        expect(redis.set).toHaveBeenCalledTimes(1);
    });
});
