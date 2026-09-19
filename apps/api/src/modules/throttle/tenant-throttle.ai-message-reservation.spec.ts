import { createHash, randomUUID } from 'crypto';
import Redis from 'ioredis';
import { TenantThrottleService } from './tenant-throttle.service';

const redisUrl = process.env.DISPATCH_QUEUE_TEST_REDIS_URL;
const ready = !!redisUrl;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

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
        service = new TenantThrottleService(
            {} as any,
            { getClient: () => client, get: (key: string) => client.get(key) } as any,
        );
    });

    beforeEach(() => { tenantId = randomUUID(); });

    afterEach(async () => {
        const keys = [
            ...await client.keys(`ai_msg:*${tenantId}*`),
            ...await client.keys(`demo_msg:*${tenantId}*`),
        ];
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

    /**
     * D19: the platform pays the first N demo replies per tenant. The demo trio
     * is a clone of the AI one over a LIFETIME counter, so every guarantee
     * above has to hold here too, plus the ones the lifetime counter adds.
     */
    describe('platform-paid demo replies (D19) mirror the same contract', () => {
        it('admits exactly the lifetime limit under concurrency and refuses the rest', async () => {
            const results = await Promise.all(Array.from({ length: 12 }, (_, index) =>
                service.reserveDemoMessageCount(tenantId, `demo:effect-${index}`, 3)));

            expect(results.filter(result => result.allowed)).toHaveLength(3);
            expect(results.filter(result => !result.allowed)).toHaveLength(9);
            expect(Math.max(...results.map(result => result.count))).toBe(3);
            // A refusal is not a reservation: nothing is held for it.
            expect(await client.keys(`demo_msg:reservation:${tenantId}:*`)).toHaveLength(3);
        });

        it('allows under the limit with the running count, then refuses at the limit', async () => {
            expect(await service.reserveDemoMessageCount(tenantId, 'demo:a', 2))
                .toEqual({ allowed: true, count: 1, adopted: false });
            expect(await service.reserveDemoMessageCount(tenantId, 'demo:b', 2))
                .toEqual({ allowed: true, count: 2, adopted: false });
            expect(await service.reserveDemoMessageCount(tenantId, 'demo:c', 2))
                .toEqual({ allowed: false, count: 2, adopted: false });
        });

        it('a limit of zero refuses the first reply; a non-finite limit never refuses', async () => {
            expect((await service.reserveDemoMessageCount(tenantId, 'demo:zero', 0)).allowed).toBe(false);
            for (let index = 0; index < 5; index++) {
                const result = await service.reserveDemoMessageCount(
                    tenantId, `demo:unlimited-${index}`, Number.POSITIVE_INFINITY);
                expect(result).toEqual({ allowed: true, count: index + 1, adopted: false });
            }
        });

        it('adopts one effect concurrently and on a later retry instead of charging it twice', async () => {
            const results = await Promise.all(Array.from({ length: 8 }, () =>
                service.reserveDemoMessageCount(tenantId, 'demo:same-inbound', 2)));

            expect(results.every(result => result.allowed)).toBe(true);
            expect(results.filter(result => !result.adopted)).toHaveLength(1);
            expect(results.every(result => result.count === 1)).toBe(true);

            // A retry after the fact adopts too, even once the limit is exhausted:
            // the reply it belongs to was already paid for.
            expect(await service.reserveDemoMessageCount(tenantId, 'demo:same-inbound', 1))
                .toEqual({ allowed: true, count: 1, adopted: true });
        });

        it('releases a failed generation but never releases a committed reply', async () => {
            await service.reserveDemoMessageCount(tenantId, 'demo:failed', 1);
            await service.releaseDemoMessageCount(tenantId, 'demo:failed');
            expect((await service.reserveDemoMessageCount(tenantId, 'demo:next', 1)).allowed).toBe(true);

            await service.commitDemoMessageCount(tenantId, 'demo:next');
            expect(await client.get(`demo_msg:reservation:${tenantId}:${sha256('demo:next')}`)).toBe('committed');
            await service.releaseDemoMessageCount(tenantId, 'demo:next');
            expect((await service.reserveDemoMessageCount(tenantId, 'demo:third', 1)).allowed).toBe(false);

            // Releasing what was never reserved is a no-op, not a negative count.
            await service.releaseDemoMessageCount(tenantId, 'demo:never-reserved');
            expect((await service.getDemoMessageUsage(tenantId)).used).toBe(1);
        });

        it('commit only marks an existing reservation; it never creates one', async () => {
            await service.commitDemoMessageCount(tenantId, 'demo:ghost');
            expect(await client.keys(`demo_msg:*${tenantId}*`)).toEqual([]);
        });

        it('counts for life: one key per tenant, no month segment, no TTL on the counter', async () => {
            await service.reserveDemoMessageCount(tenantId, 'demo:one', 10);
            await service.reserveDemoMessageCount(tenantId, 'demo:two', 10);

            expect(await client.get(`demo_msg:${tenantId}`)).toBe('2');
            expect(await client.ttl(`demo_msg:${tenantId}`)).toBe(-1);
            // The marker does expire: it only has to outlive a retry storm.
            expect(await client.ttl(`demo_msg:reservation:${tenantId}:${sha256('demo:one')}`)).toBeGreaterThan(0);

            expect(await service.getDemoMessageUsage(tenantId)).toEqual({ used: 2, limit: null });
            expect(await service.getDemoMessageUsage(tenantId, 200)).toEqual({ used: 2, limit: 200 });
        });

        it('never touches the plan quota: ai_msg keys and counts stay exactly as they were', async () => {
            await service.reserveAiMessageCount(tenantId, 'whatsapp:plan-reply', 10);
            const planKeys = (await client.keys(`ai_msg:*${tenantId}*`)).sort();
            const planCountKey = planKeys.find(key => key.startsWith(`ai_msg:${tenantId}:`))!;
            expect(await client.get(planCountKey)).toBe('1');

            await service.reserveDemoMessageCount(tenantId, 'demo:x', 10);
            await service.commitDemoMessageCount(tenantId, 'demo:x');
            await service.reserveDemoMessageCount(tenantId, 'demo:y', 10);
            await service.releaseDemoMessageCount(tenantId, 'demo:y');

            expect((await client.keys(`ai_msg:*${tenantId}*`)).sort()).toEqual(planKeys);
            expect(await client.get(planCountKey)).toBe('1');
            expect((await service.getDemoMessageUsage(tenantId)).used).toBe(1);
        });

        it('never puts the raw effect id in a key', async () => {
            const rawEffect = 'demo:conversation-7f3a/turn-12';
            await service.reserveDemoMessageCount(tenantId, rawEffect, 5);
            await service.commitDemoMessageCount(tenantId, rawEffect);

            const keys = (await client.keys(`demo_msg:*${tenantId}*`)).sort();
            expect(keys).toEqual([
                `demo_msg:${tenantId}`,
                `demo_msg:reservation:${tenantId}:${sha256(rawEffect)}`,
            ].sort());
            expect(keys.some(key => key.includes('conversation-7f3a') || key.includes('turn-12'))).toBe(false);
        });
    });
});

/**
 * Runs without Redis. The key shape is what the widget, the onboarding and a
 * super_admin panel will address in production, so it is pinned where every
 * machine executes it, not only where a disposable Valkey is configured.
 */
describe('demo message reservation key contract', () => {
    const tenantId = '0b3f7b3a-1c4e-4a3b-9e11-5f7a2c1d9e01';
    const rawEffect = 'demo:conversation-7f3a/turn-12';
    const countKey = `demo_msg:${tenantId}`;
    const reservationKey = `demo_msg:reservation:${tenantId}:${sha256(rawEffect)}`;

    const build = () => {
        const evalFn = jest.fn(async (): Promise<[number, number, number]> => [1, 1, 0]);
        const get = jest.fn(async (): Promise<string | null> => '7');
        const redis = { getClient: () => ({ eval: evalFn }), get };
        return { service: new TenantThrottleService({} as any, redis as any), evalFn, get };
    };
    const callsOf = (evalFn: jest.Mock): any[][] => evalFn.mock.calls as unknown as any[][];

    it('addresses only demo_msg keys and hashes the effect id in every operation', async () => {
        const { service, evalFn } = build();

        await service.reserveDemoMessageCount(tenantId, rawEffect, 3);
        await service.commitDemoMessageCount(tenantId, rawEffect);
        await service.releaseDemoMessageCount(tenantId, rawEffect);

        const [reserve, commit, release] = callsOf(evalFn);
        expect(reserve.slice(1, 4)).toEqual([2, countKey, reservationKey]);
        expect(commit.slice(1, 3)).toEqual([1, reservationKey]);
        expect(release.slice(1, 4)).toEqual([2, reservationKey, countKey]);

        for (const call of callsOf(evalFn)) {
            const everything = call.map(String);
            expect(everything.some(part => part.includes('conversation-7f3a') || part.includes('turn-12'))).toBe(false);
            expect(everything.some(part => part.includes('ai_msg'))).toBe(false);
        }
    });

    it('maps the limit exactly like the plan quota: floor, clamp at zero, non-finite means unlimited', async () => {
        const { service, evalFn } = build();

        for (const limit of [3, 2.9, -5, Number.POSITIVE_INFINITY, Number.NaN]) {
            await service.reserveDemoMessageCount(tenantId, rawEffect, limit);
        }

        expect(callsOf(evalFn).map(call => call[4])).toEqual(['3', '2', '0', '-1', '-1']);
    });

    it('translates the script reply into the shared result shape', async () => {
        const { service, evalFn } = build();
        evalFn.mockResolvedValueOnce([0, 3, 0]).mockResolvedValueOnce([1, 3, 1]);

        expect(await service.reserveDemoMessageCount(tenantId, rawEffect, 3))
            .toEqual({ allowed: false, count: 3, adopted: false });
        expect(await service.reserveDemoMessageCount(tenantId, rawEffect, 3))
            .toEqual({ allowed: true, count: 3, adopted: true });
    });

    it('reads lifetime usage from the tenant key and echoes only a finite limit', async () => {
        const { service, get } = build();

        expect(await service.getDemoMessageUsage(tenantId)).toEqual({ used: 7, limit: null });
        expect(await service.getDemoMessageUsage(tenantId, 200)).toEqual({ used: 7, limit: 200 });
        expect(await service.getDemoMessageUsage(tenantId, Number.POSITIVE_INFINITY)).toEqual({ used: 7, limit: null });
        expect(get).toHaveBeenCalledWith(countKey);

        get.mockResolvedValueOnce(null);
        expect((await service.getDemoMessageUsage(tenantId)).used).toBe(0);
    });
});
