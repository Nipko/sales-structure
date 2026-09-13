import type { RedisService } from '../redis/redis.service';

/**
 * How long the two durable steps of a dispatch actually take, in production.
 *
 * The load harness measured them (p95 of 3 ms idle, 178 ms for `admit` and
 * 104 ms for `settle` under 360 concurrent attempts) and the runbook turned
 * that into an SLO of p95 < 500 ms — but nothing measured it outside the
 * harness. The closest signals were PgBouncer wait time, which is a different
 * quantity, and the depth of `outbound-messages`, which only rises *after* the
 * latency has already degraded. So the one number the SLO is written about was
 * the one number production never produced.
 *
 * Bounded by construction: fixed buckets in a hash per operation per minute,
 * expiring after an hour. That is at most 120 small hashes for the whole
 * platform regardless of traffic, which is why this can sit on the hot path.
 *
 * The cost of naming it honestly: a bucketed percentile is an UPPER BOUND, not
 * a sample the system saw. `p95UpperBoundMs` says so in its name, because the
 * runbook's own rule is that a printed p95 must be a latency that really
 * happened, and this one is not — it is the ceiling of the bucket the 95th
 * sample fell into. Compared against a threshold that is itself a bucket edge,
 * the comparison stays sound: crossing it means the real p95 crossed it too.
 */

/** Upper bounds in milliseconds; the last bucket is everything above. */
export const DISPATCH_LATENCY_BUCKETS_MS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000] as const;
export const DISPATCH_LATENCY_OPERATIONS = ['admit', 'settle'] as const;
export type DispatchLatencyOperation = (typeof DISPATCH_LATENCY_OPERATIONS)[number];

/** Minutes of history a reader folds together. */
export const DISPATCH_LATENCY_WINDOW_MINUTES = 15;
const KEY_TTL_SECONDS = 3600;

const OVERFLOW = 'inf';

function bucketFor(milliseconds: number): string {
    for (const bound of DISPATCH_LATENCY_BUCKETS_MS) if (milliseconds <= bound) return String(bound);
    return OVERFLOW;
}

/** `dispatch:latency:admit:202609082254`. Platform-wide: an SLO about the path, not about a tenant. */
export function dispatchLatencyKey(operation: DispatchLatencyOperation, at: Date): string {
    const stamp = `${at.getUTCFullYear()}${String(at.getUTCMonth() + 1).padStart(2, '0')}`
        + `${String(at.getUTCDate()).padStart(2, '0')}${String(at.getUTCHours()).padStart(2, '0')}`
        + `${String(at.getUTCMinutes()).padStart(2, '0')}`;
    return `dispatch:latency:${operation}:${stamp}`;
}

/**
 * Never throws and never delays the dispatch it measures.
 *
 * A telemetry write that can fail a send would make the platform less reliable
 * for the sake of observing its reliability.
 */
export async function recordDispatchLatency(redis: Pick<RedisService, 'hincrBy' | 'expire'> | null | undefined,
    operation: DispatchLatencyOperation, milliseconds: number, at: Date = new Date()): Promise<void> {
    if (!redis || !Number.isFinite(milliseconds) || milliseconds < 0) return;
    const key = dispatchLatencyKey(operation, at);
    try {
        await redis.hincrBy(key, bucketFor(milliseconds), 1);
        await redis.expire(key, KEY_TTL_SECONDS);
    } catch { /* observing the path may never break it */ }
}

export interface DispatchLatencySummary {
    readonly operation: DispatchLatencyOperation;
    readonly samples: number;
    /** Ceiling of the bucket the 95th sample fell into; null when nothing was measured. */
    readonly p95UpperBoundMs: number | null;
    /** True when the 95th sample landed above the last bucket, so no ceiling exists. */
    readonly overflowed: boolean;
}

/**
 * Fold the last `minutes` of one operation into a summary.
 *
 * Absence of samples is reported as absence, never as zero latency: a path that
 * carried no traffic has not met its SLO, it simply has not been tested.
 */
export async function readDispatchLatency(redis: Pick<RedisService, 'hgetall'>,
    operation: DispatchLatencyOperation, minutes = DISPATCH_LATENCY_WINDOW_MINUTES,
    now: Date = new Date()): Promise<DispatchLatencySummary> {
    const totals = new Map<string, number>();
    for (let back = 0; back < minutes; back += 1) {
        const at = new Date(now.getTime() - back * 60_000);
        let hash: Record<string, string> = {};
        try { hash = (await redis.hgetall(dispatchLatencyKey(operation, at))) || {}; } catch { continue; }
        for (const [bucket, count] of Object.entries(hash)) {
            const value = Number(count);
            if (!Number.isFinite(value) || value <= 0) continue;
            totals.set(bucket, (totals.get(bucket) ?? 0) + value);
        }
    }
    const samples = [...totals.values()].reduce((sum, value) => sum + value, 0);
    if (!samples) return { operation, samples: 0, p95UpperBoundMs: null, overflowed: false };
    // Nearest-rank over the buckets, in ascending bound order, so the answer is
    // the bucket that contains the 95th sample rather than an interpolation
    // between two bounds the run never observed.
    const target = Math.ceil(0.95 * samples);
    let seen = 0;
    for (const bound of DISPATCH_LATENCY_BUCKETS_MS) {
        seen += totals.get(String(bound)) ?? 0;
        if (seen >= target) return { operation, samples, p95UpperBoundMs: bound, overflowed: false };
    }
    return { operation, samples, p95UpperBoundMs: null, overflowed: true };
}
