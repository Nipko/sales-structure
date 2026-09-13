import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { MediaThrottleService } from './media-throttle.service';

const redisUrl = process.env.DISPATCH_QUEUE_TEST_REDIS_URL;

(redisUrl ? describe : describe.skip)('media quota reservations against real Redis', () => {
    let client: Redis;
    let tenantId: string;
    let service: MediaThrottleService;
    const limits = {
        audioPerMonth: 3,
        imagePerMonth: 3,
        maxAudioDurationSec: 60,
        perContactPerDay: 3,
        perConvPer5min: 3,
        perTenantPerHour: 3,
        dailyBudgetCentsUsd: 3,
    };

    beforeAll(() => {
        const parsed = new URL(redisUrl!);
        if (!['localhost', '127.0.0.1'].includes(parsed.hostname)) {
            throw new Error('disposable_loopback_redis_required');
        }
        client = new Redis(redisUrl!);
        service = new MediaThrottleService(
            { getClient: () => client } as any,
            { getPlanFeatures: jest.fn().mockResolvedValue({ mediaProcessing: limits }) } as any,
        );
    });

    beforeEach(() => { tenantId = randomUUID(); });

    afterEach(async () => {
        const keys = await client.keys(`media:*${tenantId}*`);
        if (keys.length) await client.del(...keys);
    });

    afterAll(async () => { await client.quit(); });

    it('admits exactly the shared ceiling under concurrent effects', async () => {
        const results = await Promise.all(Array.from({ length: 12 }, (_, index) =>
            service.reserveQuota(
                tenantId, 'image', `contact-${index}`, `conversation-${index}`, `message-${index}`,
            )));

        expect(results.filter(result => result.allowed)).toHaveLength(3);
        expect(results.filter(result => !result.allowed)).toHaveLength(9);
        expect(results.filter(result => result.mayProcess)).toHaveLength(3);
    });

    it('lets one of many webhook retries pay the provider', async () => {
        const results = await Promise.all(Array.from({ length: 10 }, () =>
            service.reserveQuota(
                tenantId, 'audio', 'contact-one', 'conversation-one', 'same-provider-message',
            )));

        expect(results.every(result => result.allowed)).toBe(true);
        expect(results.filter(result => result.mayProcess)).toHaveLength(1);
        expect(results.filter(result => result.adopted)).toHaveLength(9);
        const month = new Date().toISOString().slice(0, 7);
        expect(await client.get(`media:audio:${tenantId}:${month}`)).toBe('1');
    });

    it('releases every counter after failure and keeps a settled reservation immutable', async () => {
        const failed = await service.reserveQuota(
            tenantId, 'image', 'contact-one', 'conversation-one', 'failed-effect',
        );
        await service.releaseQuota(failed.reservationId!);

        const retried = await service.reserveQuota(
            tenantId, 'image', 'contact-one', 'conversation-one', 'failed-effect',
        );
        expect(retried).toMatchObject({ allowed: true, mayProcess: true, adopted: false });
        await service.settleQuota(retried.reservationId!, 1);
        await service.releaseQuota(retried.reservationId!);

        const duplicate = await service.reserveQuota(
            tenantId, 'image', 'contact-one', 'conversation-one', 'failed-effect',
        );
        expect(duplicate).toMatchObject({ allowed: true, mayProcess: false, adopted: true });
        const month = new Date().toISOString().slice(0, 7);
        expect(await client.get(`media:image:${tenantId}:${month}`)).toBe('1');
    });

    it('reserves budget before work and restores it on a conclusive failure', async () => {
        const reservations = await Promise.all(Array.from({ length: 4 }, (_, index) =>
            service.reserveQuota(
                tenantId, 'image', `contact-${index}`, `conversation-${index}`, `budget-${index}`,
            )));
        expect(reservations.filter(result => result.allowed)).toHaveLength(3);

        await service.releaseQuota(reservations.find(result => result.allowed)!.reservationId!);
        const replacement = await service.reserveQuota(
            tenantId, 'image', 'replacement-contact', 'replacement-conversation', 'replacement',
        );
        expect(replacement.allowed).toBe(true);
    });
});
