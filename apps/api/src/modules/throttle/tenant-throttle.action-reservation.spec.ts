import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { TenantThrottleService } from './tenant-throttle.service';

const redisUrl = process.env.DISPATCH_QUEUE_TEST_REDIS_URL;
const ready = !!redisUrl;

(ready ? describe : describe.skip)('action reservations against real Redis', () => {
    let client: Redis;
    let service: TenantThrottleService;
    let tenantId: string;

    beforeAll(() => {
        const parsed = new URL(redisUrl!);
        if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
            throw new Error('disposable_loopback_redis_required');
        }
        client = new Redis(redisUrl!);
        service = new TenantThrottleService({} as any, { getClient: () => client } as any);
        jest.spyOn(service as any, 'resolveLimits').mockResolvedValue({
            plan: 'test',
            limits: { automation: 2, outbound: 3, broadcast: 4, priority: 1, maxPendingJobs: 10 },
            overrides: {},
        });
    });

    beforeEach(() => { tenantId = randomUUID(); });

    afterEach(async () => {
        const keys = await client.keys(`*${tenantId}*`);
        if (keys.length) await client.del(...keys);
    });

    afterAll(async () => { await client.quit(); });

    it('admits exactly the hourly limit under concurrency', async () => {
        const results = await Promise.all(Array.from({ length: 12 }, (_, index) =>
            service.reserveActionUsage(tenantId, 'outbound', `effect-${index}`)));

        expect(results.filter(result => result.allowed)).toHaveLength(3);
        expect(Math.max(...results.map(result => result.count))).toBe(3);
    });

    it('adopts one logical effect without charging the slot twice', async () => {
        const results = await Promise.all(Array.from({ length: 8 }, () =>
            service.reserveActionUsage(tenantId, 'outbound', 'same-effect')));

        expect(results.every(result => result.allowed)).toBe(true);
        expect(results.filter(result => !result.adopted)).toHaveLength(1);
        expect(results.every(result => result.count === 1)).toBe(true);
    });

    it('releases only held effects and preserves committed usage', async () => {
        await service.reserveActionUsage(tenantId, 'outbound', 'failed');
        await service.releaseActionUsage(tenantId, 'outbound', 'failed');
        expect((await service.reserveActionUsage(tenantId, 'outbound', 'next')).count).toBe(1);

        await service.commitActionUsage(tenantId, 'outbound', 'next');
        await service.releaseActionUsage(tenantId, 'outbound', 'next');
        expect((await service.reserveActionUsage(tenantId, 'outbound', 'third')).count).toBe(2);
    });
});
