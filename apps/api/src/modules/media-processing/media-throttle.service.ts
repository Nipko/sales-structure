import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import type { MediaProcessingLimits } from '@parallext/shared';

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

@Injectable()
export class MediaThrottleService {
    private readonly logger = new Logger(MediaThrottleService.name);

    constructor(
        private readonly redis: RedisService,
        private readonly throttle: TenantThrottleService,
    ) {}

    async checkQuota(
        tenantId: string,
        mediaType: 'audio' | 'image',
        contactId: string,
        conversationId: string,
    ): Promise<ThrottleCheckResult> {
        const limits = await this.getLimits(tenantId);

        if (!limits || (limits.audioPerMonth === 0 && limits.imagePerMonth === 0)) {
            return { allowed: false, reason: 'media_processing_not_available', limits: limits || DEFAULT_LIMITS };
        }

        const monthKey = this.currentMonthKey();

        // 1. Monthly quota check
        const monthlyKey = `media:${mediaType}:${tenantId}:${monthKey}`;
        const monthlyCount = Number(await this.redis.get(monthlyKey) || 0);
        const monthlyLimit = mediaType === 'audio' ? limits.audioPerMonth : limits.imagePerMonth;

        if (monthlyLimit !== -1 && monthlyCount >= monthlyLimit) {
            this.logger.warn(`[MediaThrottle] Tenant ${tenantId} exhausted monthly ${mediaType} quota: ${monthlyCount}/${monthlyLimit}`);
            return { allowed: false, reason: `monthly_${mediaType}_quota_exhausted`, limits };
        }

        // 2. Per-contact/day limit
        const today = new Date().toISOString().slice(0, 10);
        const contactKey = `media:contact:${tenantId}:${contactId}:${today}`;
        const contactCount = Number(await this.redis.get(contactKey) || 0);

        if (limits.perContactPerDay !== -1 && contactCount >= limits.perContactPerDay) {
            this.logger.warn(`[MediaThrottle] Contact ${contactId} hit daily media limit: ${contactCount}/${limits.perContactPerDay}`);
            return { allowed: false, reason: 'contact_daily_limit', limits };
        }

        // 3. Per-conversation/5min burst limit
        const fiveMinWindow = Math.floor(Date.now() / 300_000);
        const convKey = `media:conv:${conversationId}:${fiveMinWindow}`;
        const convCount = Number(await this.redis.get(convKey) || 0);

        if (limits.perConvPer5min !== -1 && convCount >= limits.perConvPer5min) {
            this.logger.warn(`[MediaThrottle] Conversation ${conversationId} burst limit: ${convCount}/${limits.perConvPer5min}`);
            return { allowed: false, reason: 'conversation_burst_limit', limits };
        }

        // 4. Per-tenant/hour sliding window
        const hourWindow = Math.floor(Date.now() / 3_600_000);
        const tenantHourKey = `media:tenant_hour:${tenantId}:${hourWindow}`;
        const tenantHourCount = Number(await this.redis.get(tenantHourKey) || 0);

        if (limits.perTenantPerHour !== -1 && tenantHourCount >= limits.perTenantPerHour) {
            this.logger.warn(`[MediaThrottle] Tenant ${tenantId} hourly limit: ${tenantHourCount}/${limits.perTenantPerHour}`);
            return { allowed: false, reason: 'tenant_hourly_limit', limits };
        }

        // 5. Daily budget circuit breaker
        const costKey = `media:cost:${tenantId}:${today}`;
        const dailyCostCents = Number(await this.redis.get(costKey) || 0);

        if (limits.dailyBudgetCentsUsd !== -1 && dailyCostCents >= limits.dailyBudgetCentsUsd) {
            this.logger.warn(`[MediaThrottle] Tenant ${tenantId} daily budget exhausted: ${dailyCostCents}/${limits.dailyBudgetCentsUsd} cents`);
            return { allowed: false, reason: 'daily_budget_exhausted', limits };
        }

        return { allowed: true, limits };
    }

    async recordUsage(
        tenantId: string,
        mediaType: 'audio' | 'image',
        contactId: string,
        conversationId: string,
        costCentsUsd: number,
    ): Promise<void> {
        const monthKey = this.currentMonthKey();
        const today = new Date().toISOString().slice(0, 10);
        const fiveMinWindow = Math.floor(Date.now() / 300_000);
        const hourWindow = Math.floor(Date.now() / 3_600_000);

        const keys = [
            { key: `media:${mediaType}:${tenantId}:${monthKey}`, ttl: 35 * 86400 },
            { key: `media:contact:${tenantId}:${contactId}:${today}`, ttl: 86400 },
            { key: `media:conv:${conversationId}:${fiveMinWindow}`, ttl: 600 },
            { key: `media:tenant_hour:${tenantId}:${hourWindow}`, ttl: 7200 },
        ];

        const costKey = `media:cost:${tenantId}:${today}`;
        const costAmount = Math.ceil(costCentsUsd);

        await Promise.allSettled([
            ...keys.map(({ key, ttl }) => this.redis.incrBy(key, 1).then(() => this.redis.expire(key, ttl))),
            costAmount > 0 ? this.redis.incrBy(costKey, costAmount).then(() => this.redis.expire(costKey, 86400)) : Promise.resolve(),
        ]);
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

    private currentMonthKey(): string {
        const now = new Date();
        return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    }
}
