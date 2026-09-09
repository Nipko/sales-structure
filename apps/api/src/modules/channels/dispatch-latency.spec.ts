import {
    DISPATCH_LATENCY_BUCKETS_MS, dispatchLatencyKey, readDispatchLatency, recordDispatchLatency,
} from './dispatch-latency';

/**
 * The SLO the runbook wrote an objective for and nothing measured.
 *
 * The load harness produced the numbers (p95 178 ms admit / 104 ms settle under
 * 360 concurrent attempts); production produced none. PgBouncer wait time is a
 * different quantity and queue depth only rises after the latency has already
 * degraded, so the one number the objective is about was the one number nobody
 * could see.
 *
 * What these tests pin is mostly honesty: a bucketed percentile is a ceiling
 * and must never be presented as an observation, and silence is not success.
 */
describe('how long a dispatch actually takes', () => {
    const at = new Date('2026-09-08T22:54:31.000Z');

    const redis = () => {
        const hashes = new Map<string, Record<string, string>>();
        return {
            hashes,
            hincrBy: jest.fn(async (key: string, field: string, by: number) => {
                const hash = hashes.get(key) ?? {};
                hash[field] = String(Number(hash[field] ?? 0) + by);
                hashes.set(key, hash);
                return Number(hash[field]);
            }),
            expire: jest.fn(async () => undefined),
            hgetall: jest.fn(async (key: string) => hashes.get(key) ?? {}),
        };
    };

    const fill = async (store: ReturnType<typeof redis>, samples: number[], when = at) => {
        for (const value of samples) await recordDispatchLatency(store, 'admit', value, when);
    };

    it('keys one hash per operation per minute, so the cost does not follow traffic', async () => {
        const store = redis();
        await fill(store, Array.from({ length: 500 }, (_, i) => i % 40));
        expect(store.hashes.size).toBe(1);
        expect([...store.hashes.keys()][0]).toBe('dispatch:latency:admit:202609082254');
        // Every write refreshes the expiry: a key can never outlive its hour.
        expect(store.expire).toHaveBeenCalledTimes(500);
    });

    it('separates the two operations', () => {
        expect(dispatchLatencyKey('admit', at)).not.toBe(dispatchLatencyKey('settle', at));
        expect(dispatchLatencyKey('settle', at)).toBe('dispatch:latency:settle:202609082254');
    });

    it('reports a ceiling the 95th sample fell under, not an interpolation', async () => {
        const store = redis();
        // 95 fast, 5 slow: the 95th sample is the last fast one.
        await fill(store, [...Array(95).fill(8), ...Array(5).fill(900)]);
        const summary = await readDispatchLatency(store, 'admit', 5, at);
        expect(summary).toMatchObject({ samples: 100, p95UpperBoundMs: 10, overflowed: false });
        // A latency of 8 ms landed in the ≤10 bucket, and 10 is what is reported:
        // an upper bound, which is why the field is not called `p95Ms`.
        expect(DISPATCH_LATENCY_BUCKETS_MS).toContain(summary.p95UpperBoundMs as any);
    });

    it('says nothing rather than zero when nothing was measured', async () => {
        const store = redis();
        // A path that carried no traffic has not met its objective; it has not
        // been tested. Reporting 0 ms would read as the best possible result.
        expect(await readDispatchLatency(store, 'admit', 15, at))
            .toEqual({ operation: 'admit', samples: 0, p95UpperBoundMs: null, overflowed: false });
    });

    it('admits when the 95th sample is off the top of the scale', async () => {
        const store = redis();
        await fill(store, Array(20).fill(60_000));
        const summary = await readDispatchLatency(store, 'admit', 5, at);
        // No bucket contains it, so there is no ceiling to quote — and claiming
        // the largest bucket would understate it.
        expect(summary).toMatchObject({ overflowed: true, p95UpperBoundMs: null, samples: 20 });
    });

    it('folds the whole window together, and only the window', async () => {
        const store = redis();
        await fill(store, Array(60).fill(8), at);
        await fill(store, Array(40).fill(900), new Date(at.getTime() - 3 * 60_000));
        // Outside the window on purpose.
        await fill(store, Array(1000).fill(4000), new Date(at.getTime() - 30 * 60_000));

        const summary = await readDispatchLatency(store, 'admit', 5, at);
        expect(summary.samples).toBe(100);
        expect(summary.p95UpperBoundMs).toBe(1000);
    });

    it('never lets telemetry break the dispatch it is measuring', async () => {
        const broken = {
            hincrBy: jest.fn(async () => { throw new Error('redis down'); }),
            expire: jest.fn(async () => undefined),
            hgetall: jest.fn(async () => { throw new Error('redis down'); }),
        };
        await expect(recordDispatchLatency(broken, 'admit', 12, at)).resolves.toBeUndefined();
        await expect(recordDispatchLatency(null, 'admit', 12, at)).resolves.toBeUndefined();
        // A read that cannot reach Redis reports absence, not a false success.
        await expect(readDispatchLatency(broken, 'admit', 3, at))
            .resolves.toMatchObject({ samples: 0, p95UpperBoundMs: null });
    });

    it('ignores a duration that is not one', async () => {
        const store = redis();
        for (const value of [NaN, Infinity, -5]) await recordDispatchLatency(store, 'admit', value, at);
        expect(store.hincrBy).not.toHaveBeenCalled();
    });
});
