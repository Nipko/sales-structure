import { Logger } from '@nestjs/common';
import { PoliciesService } from './policies.service';

/** Actual policy read/write service with deterministic SQL/cache/event boundaries. */
describe('policy authoritative reads and committed cache failures', () => {
    const tenant = '11111111-1111-4111-8111-111111111111';
    const row = { id: '22222222-2222-4222-8222-222222222222', type: 'privacy', title: 'Synthetic current', content: 'Synthetic current text', version: 2, is_active: true };
    function harness(rows: any[] = [row]) {
        const s = Object.create(PoliciesService.prototype) as any;
        s.logger = new Logger('SyntheticPolicyCache');
        jest.spyOn(s.logger, 'warn').mockImplementation(() => undefined);
        s.ensureSchema = jest.fn().mockResolvedValue('tenant_synthetic');
        s.prisma = {
            $executeRawUnsafe: jest.fn().mockResolvedValue(1),
            $queryRawUnsafe: jest.fn(async (sql: string) => {
                if (sql.includes('MAX(version)')) return [{ next_version: 2 }];
                if (sql.includes('pg_advisory_xact_lock')) return [{ lock: '' }];
                if (sql.includes('DELETE FROM')) return [{ type: 'privacy' }];
                return rows;
            }),
            $transaction: jest.fn(async (fn: any) => fn(s.prisma)),
        };
        s.redis = { getJson: jest.fn().mockResolvedValue(null), setJson: jest.fn().mockResolvedValue(undefined), del: jest.fn().mockResolvedValue(undefined) };
        s.events = { emit: jest.fn() };
        return s;
    }
    function noReadCache(s: any) { expect(s.redis.getJson).not.toHaveBeenCalled(); expect(s.redis.setJson).not.toHaveBeenCalled(); }
    it('POLICYCACHE_A_STALE returns the authoritative active version despite a stale Redis object', async () => {
        const s = harness(); s.redis.getJson.mockResolvedValue({ ...row, version: 1, content: 'Synthetic retired text' });
        expect(await s.getActive(tenant, 'privacy')).toMatchObject({ version: 2, content: row.content }); noReadCache(s);
        expect(s.prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    });
    it('POLICYCACHE_A_DELETED returns null when the database has no active policy despite cached text', async () => {
        const s = harness([]); s.redis.getJson.mockResolvedValue({ ...row, version: 1 });
        expect(await s.getActive(tenant, 'privacy')).toBeNull(); noReadCache(s); expect(s.prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    });
    it('POLICYCACHE_A_GETFAIL reads the database without depending on a rejected Redis GET', async () => {
        const s = harness(); s.redis.getJson.mockImplementation(async () => { throw Error('synthetic_cache_get_failure'); });
        expect(await s.getActive(tenant, 'privacy')).toMatchObject({ id: row.id, version: 2 }); noReadCache(s);
    });
    it('POLICYCACHE_B_UPSERT returns a committed replacement and emits once when legacy invalidation fails', async () => {
        const s = harness(); s.redis.del.mockImplementation(async () => { throw Error('synthetic_cache_delete_failure'); });
        expect(await s.upsert(tenant, { type: 'privacy', title: row.title, content: row.content })).toMatchObject({ id: row.id, version: 2 });
        expect(s.prisma.$transaction).toHaveBeenCalledTimes(1); expect(s.redis.del).toHaveBeenCalledTimes(1); expect(s.events.emit).toHaveBeenCalledTimes(1);
        expect(s.logger.warn).toHaveBeenCalledTimes(1);
    });
    it('POLICYCACHE_B_DELETE reports a committed removal and emits once when legacy invalidation fails', async () => {
        const s = harness(); s.redis.del.mockImplementation(async () => { throw Error('synthetic_cache_delete_failure'); });
        await expect(s.delete(tenant, row.id)).resolves.toBeUndefined(); expect(s.prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
        expect(s.redis.del).toHaveBeenCalledTimes(1); expect(s.events.emit).toHaveBeenCalledTimes(1); expect(s.logger.warn).toHaveBeenCalledTimes(1);
    });
    it('POLICYCACHE_B_SETFAIL returns exact database text without attempting a failed Redis SET', async () => {
        const s = harness(); s.redis.setJson.mockImplementation(async () => { throw Error('synthetic_cache_set_failure'); });
        expect(await s.getActive(tenant, 'privacy')).toMatchObject({ title: row.title, content: row.content, version: 2 }); noReadCache(s);
    });
});
