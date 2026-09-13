import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { TenantThrottleService } from './tenant-throttle.service';

const redisUrl = process.env.DISPATCH_QUEUE_TEST_REDIS_URL;
const ready = !!redisUrl;

(ready ? describe : describe.skip)('AI message reservations against real Redis', () => {
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
    });

    beforeEach(() => { tenantId = randomUUID(); });

    afterEach(async () => {
        const keys = await client.keys(`ai_msg:*${tenantId}*`);
        if (keys.length) await client.del(...keys);
    });

    afterAll(async () => { await client.quit(); });

    it('admits exactly the finite limit under concurrency', async () => {
        const results = await Promise.all(Array.from({ length: 12 }, (_, index) =>
            service.reserveAiMessageCount(tenantId, `whatsapp:effect-${index}`, 3)));

        expect(results.filter(result => result.allowed)).toHaveLength(3);
        expect(results.filter(result => !result.allowed)).toHaveLength(9);
        expect(Math.max(...results.map(result => result.count))).toBe(3);
    });

    it('adopts one effect concurrently instead of consuming the quota twice', async () => {
        const results = await Promise.all(Array.from({ length: 8 }, () =>
            service.reserveAiMessageCount(tenantId, 'whatsapp:same-inbound', 2)));

        expect(results.every(result => result.allowed)).toBe(true);
        expect(results.filter(result => !result.adopted)).toHaveLength(1);
        expect(results.every(result => result.count === 1)).toBe(true);
    });

    it('releases a failed generation but never releases a committed reply', async () => {
        await service.reserveAiMessageCount(tenantId, 'whatsapp:failed', 1);
        await service.releaseAiMessageCount(tenantId, 'whatsapp:failed');
        expect((await service.reserveAiMessageCount(tenantId, 'whatsapp:next', 1)).allowed).toBe(true);

        await service.commitAiMessageCount(tenantId, 'whatsapp:next');
        await service.releaseAiMessageCount(tenantId, 'whatsapp:next');
        expect((await service.reserveAiMessageCount(tenantId, 'whatsapp:third', 1)).allowed).toBe(false);
    });
});
