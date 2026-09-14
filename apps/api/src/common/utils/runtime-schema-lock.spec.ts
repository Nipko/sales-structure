import { isRuntimeSchemaDdl, withRuntimeSchemaLock } from './runtime-schema-lock';
import { WebhookSubscriptionService } from '../../modules/public-api/webhook-subscription.service';

describe('runtime schema initialization', () => {
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
