import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import type { MediaProcessingLimits } from '@parallext/shared';
import { createHash } from 'crypto';

const DEFAULT_LIMITS: MediaProcessingLimits = {
    audioPerMonth: 0,
    imagePerMonth: 0,
    maxAudioDurationSec: 0,
    perContactPerDay: 0,
    perConvPer5min: 0,
    perTenantPerHour: 0,
    dailyBudgetCentsUsd: 0,
};

export interface ThrottleCheckResult {
    allowed: boolean;
    reason?: string;
    limits: MediaProcessingLimits;
}

export interface MediaQuotaReservation extends ThrottleCheckResult {
    reservationId?: string;
    /** Exactly one concurrent caller may pay the provider for this effect. */
    mayProcess: boolean;
    adopted: boolean;
}

@Injectable()
export class MediaThrottleService {
    constructor(
        private readonly redis: RedisService,
        private readonly throttle: TenantThrottleService,
    ) {}

    /**
     * Atomically reserve every counter and the worst-case provider cost before
     * any download or model call. A stable effect identity makes concurrent
     * webhook retries adopt the same reservation instead of paying twice.
     */
    async reserveQuota(
        tenantId: string,
        mediaType: 'audio' | 'image',
        contactId: string,
        conversationId: string,
        effectId: string,
    ): Promise<MediaQuotaReservation> {
        const limits = await this.getLimits(tenantId);
        if (!limits || (limits.audioPerMonth === 0 && limits.imagePerMonth === 0)) {
            return { allowed: false, mayProcess: false, adopted: false,
                reason: 'media_processing_not_available', limits: limits || DEFAULT_LIMITS };
        }

        const now = new Date();
        const monthKey = this.currentMonthKey(now);
        const today = now.toISOString().slice(0, 10);
        const fiveMinWindow = Math.floor(now.getTime() / 300_000);
        const hourWindow = Math.floor(now.getTime() / 3_600_000);
        const effectHash = createHash('sha256').update(effectId).digest('hex');
        const reservationKey = `media:reservation:${tenantId}:${monthKey}:${effectHash}`;
        const keys = [
            reservationKey,
            `media:${mediaType}:${tenantId}:${monthKey}`,
            `media:contact:${tenantId}:${contactId}:${today}`,
            `media:conv:${tenantId}:${conversationId}:${fiveMinWindow}`,
            `media:tenant_hour:${tenantId}:${hourWindow}`,
            `media:cost:${tenantId}:${today}`,
        ];
        const finite = (value: number) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : -1;
        const monthlyLimit = mediaType === 'audio' ? limits.audioPerMonth : limits.imagePerMonth;
        // Whisper is $0.006/min = one cent per 100 seconds after provider
        // rounding. Vision providers currently all settle to one cent.
        const reservedCost = mediaType === 'audio'
            ? Math.max(1, Math.ceil(limits.maxAudioDurationSec / 100))
            : 1;
        const ttl = 35 * 24 * 60 * 60;
        const result = await this.redis.getClient().eval(
            `local state = redis.call('HGET', KEYS[1], 'state')
             if state then
                 return {1, 0, 1, state}
             end
             local current = {}
             for i=2,6 do current[i] = tonumber(redis.call('GET', KEYS[i]) or '0') end
             local limits = {tonumber(ARGV[1]),tonumber(ARGV[2]),tonumber(ARGV[3]),tonumber(ARGV[4])}
             for i=1,4 do
                 if limits[i] >= 0 and current[i+1] >= limits[i] then
                     return {0, i, 0, 'blocked'}
                 end
             end
             local budget = tonumber(ARGV[5])
             local reserve = tonumber(ARGV[6])
             if budget >= 0 and current[6] + reserve > budget then
                 return {0, 5, 0, 'blocked'}
             end
             redis.call('HSET', KEYS[1],
                 'state', 'held', 'reserved_cost', reserve,
                 'media_type', ARGV[8], 'contact_key', KEYS[3],
                 'conv_key', KEYS[4], 'hour_key', KEYS[5], 'cost_key', KEYS[6])
             redis.call('EXPIRE', KEYS[1], tonumber(ARGV[7]))
             for i=2,5 do
                 redis.call('INCR', KEYS[i])
                 redis.call('EXPIRE', KEYS[i], tonumber(ARGV[7]))
             end
             if reserve > 0 then
                 redis.call('INCRBY', KEYS[6], reserve)
                 redis.call('EXPIRE', KEYS[6], tonumber(ARGV[7]))
             end
             return {1, 0, 0, 'held'}`,
            6,
            ...keys,
            String(finite(monthlyLimit)),
            String(finite(limits.perContactPerDay)),
            String(finite(limits.perConvPer5min)),
            String(finite(limits.perTenantPerHour)),
            String(finite(limits.dailyBudgetCentsUsd)),
            String(reservedCost),
            String(ttl),
            mediaType,
        ) as [number, number, number, string];
        const reasons = [
            '', `monthly_${mediaType}_quota_exhausted`, 'contact_daily_limit',
            'conversation_burst_limit', 'tenant_hourly_limit', 'daily_budget_exhausted',
        ];
        if (result[0] !== 1) {
            return { allowed: false, mayProcess: false, adopted: false,
                reason: reasons[Number(result[1])] || 'media_quota_exhausted', limits };
        }
        const adopted = result[2] === 1;
        return {
            allowed: true,
            mayProcess: !adopted,
            adopted,
            reservationId: reservationKey,
            limits,
        };
    }

    /** Replace the reserved maximum by the amount the provider reported. */
    async settleQuota(reservationId: string, actualCostCentsUsd: number): Promise<void> {
        const actual = Math.max(0, Math.ceil(actualCostCentsUsd));
        const costKey = await this.redis.getClient().hget(reservationId, 'cost_key');
        if (!costKey) return;
        await this.redis.getClient().eval(
            `if redis.call('HGET', KEYS[1], 'state') ~= 'held' then return 0 end
             local reserved = tonumber(redis.call('HGET', KEYS[1], 'reserved_cost') or '0')
             local delta = tonumber(ARGV[1]) - reserved
             if delta ~= 0 then redis.call('INCRBY', KEYS[2], delta) end
             redis.call('HSET', KEYS[1], 'state', 'committed', 'actual_cost', ARGV[1])
             return 1`,
            2,
            reservationId,
            costKey,
            String(actual),
        );
    }

    /** Release all counters only while the reservation is still held. */
    async releaseQuota(reservationId: string): Promise<void> {
        const parts = reservationId.split(':');
        if (parts.length !== 5 || parts[0] !== 'media' || parts[1] !== 'reservation') return;
        const tenantId = parts[2];
        const month = parts[3];
        const snapshot = await this.redis.getClient().hmget(
            reservationId, 'media_type', 'contact_key', 'conv_key', 'hour_key', 'cost_key',
        );
        // New reservations store the exact keys below. A missing snapshot is a
        // fail-closed no-op; guessing time-window keys could decrement another
        // customer's legitimate usage after midnight.
        if (snapshot.some(value => !value)) return;
        const [mediaType, contactKey, convKey, hourKey, costKey] = snapshot as string[];
        const monthCountKey = `media:${mediaType}:${tenantId}:${month}`;
        await this.redis.getClient().eval(
            `if redis.call('HGET', KEYS[1], 'state') ~= 'held' then return 0 end
             local reserved = tonumber(redis.call('HGET', KEYS[1], 'reserved_cost') or '0')
             for i=2,5 do
                 local current = tonumber(redis.call('GET', KEYS[i]) or '0')
                 if current > 0 then redis.call('DECR', KEYS[i]) end
             end
             local cost = tonumber(redis.call('GET', KEYS[6]) or '0')
             if reserved > 0 and cost > 0 then
                 redis.call('INCRBY', KEYS[6], -math.min(cost, reserved))
             end
             redis.call('DEL', KEYS[1])
             return 1`,
            6,
            reservationId, monthCountKey, contactKey, convKey, hourKey, costKey,
        );
    }


    async getUsageStats(tenantId: string): Promise<{
        audio: { used: number; limit: number };
        image: { used: number; limit: number };
        dailyCostCents: number;
        dailyBudgetCents: number;
    }> {
        const limits = await this.getLimits(tenantId);
        const monthKey = this.currentMonthKey();
        const today = new Date().toISOString().slice(0, 10);

        const [audioUsed, imageUsed, dailyCost] = await Promise.all([
            this.redis.get(`media:audio:${tenantId}:${monthKey}`).then(v => Number(v || 0)),
            this.redis.get(`media:image:${tenantId}:${monthKey}`).then(v => Number(v || 0)),
            this.redis.get(`media:cost:${tenantId}:${today}`).then(v => Number(v || 0)),
        ]);

        return {
            audio: { used: audioUsed, limit: limits.audioPerMonth },
            image: { used: imageUsed, limit: limits.imagePerMonth },
            dailyCostCents: dailyCost,
            dailyBudgetCents: limits.dailyBudgetCentsUsd,
        };
    }

    private async getLimits(tenantId: string): Promise<MediaProcessingLimits> {
        const features = await this.throttle.getPlanFeatures(tenantId);
        const mp = features.mediaProcessing as MediaProcessingLimits | undefined;
        if (!mp) return DEFAULT_LIMITS;

        // Resolve -1 sentinel to Infinity at runtime
        return {
            audioPerMonth: mp.audioPerMonth === -1 ? Number.POSITIVE_INFINITY : mp.audioPerMonth,
            imagePerMonth: mp.imagePerMonth === -1 ? Number.POSITIVE_INFINITY : mp.imagePerMonth,
            maxAudioDurationSec: mp.maxAudioDurationSec,
            perContactPerDay: mp.perContactPerDay === -1 ? Number.POSITIVE_INFINITY : mp.perContactPerDay,
            perConvPer5min: mp.perConvPer5min === -1 ? Number.POSITIVE_INFINITY : mp.perConvPer5min,
            perTenantPerHour: mp.perTenantPerHour === -1 ? Number.POSITIVE_INFINITY : mp.perTenantPerHour,
            dailyBudgetCentsUsd: mp.dailyBudgetCentsUsd === -1 ? Number.POSITIVE_INFINITY : mp.dailyBudgetCentsUsd,
        };
    }

    async getMaxAudioDuration(tenantId: string): Promise<number> {
        const limits = await this.getLimits(tenantId);
        return limits.maxAudioDurationSec;
    }

    private currentMonthKey(now = new Date()): string {
        return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    }
}
