import { Injectable, Logger } from '@nestjs/common';
import { persistenceDisabled, type ServiceExecutionContext } from '../../common/types/execution-context';
import { PrismaService } from '../prisma/prisma.service';
import { replaceTenantSettingsBranch } from '../../common/utils/tenant-settings-branch.util';
import { RedisService } from '../redis/redis.service';
import { OVERRIDABLE_QUOTA_KEYS, isOverridableQuotaKey, CHANNEL_ACCOUNT_KEYS } from './plan-features.registry';
import { applyPlanFeatureOverrides } from './plan-feature-overrides';
import { createHash } from 'crypto';

/**
 * Plan-based rate limiting and feature gating for multi-tenant fairness.
 *
 * Rate limits are stored in billing_plans.features.rateLimits so they
 * can be edited by super_admin via the admin plans page.
 *
 * Feature limits (resource counts, boolean flags) are read from the
 * billing_plans table — the seed file is the single source of truth.
 */

type ActionType = 'automation' | 'outbound' | 'broadcast';

interface PlanLimits {
    automation: number;
    outbound: number;
    broadcast: number;
    priority: number;
    maxPendingJobs: number;
}

export interface QuotaOverrides {
    // Rate-limit overrides (consumed in resolveLimits) — kept as explicit typed
    // fields so the numeric dot-access there stays type-safe.
    automation?: number;
    outbound?: number;
    broadcast?: number;
    priority?: number;
    maxPendingJobs?: number;
    // Nested per-channel-type connected-account overrides ({ whatsapp: 2, ... }).
    // Validated in setQuotaOverrides; read in getChannelAccountLimit (NOT applied
    // by applyOverrides, which only handles flat numeric keys).
    maxChannelAccounts?: Record<string, number>;
    // Metadata
    reason?: string;
    setBy?: string;
    setAt?: string;
    // Any other overridable numeric feature key (validated against the registry
    // in setQuotaOverrides; applied generically in applyOverrides).
    [key: string]: number | string | Record<string, number> | undefined;
}

const FALLBACK_LIMITS: PlanLimits = {
    automation: 50, outbound: 200, broadcast: 500, priority: 5, maxPendingJobs: 50,
};

const DEFAULT_PLAN = 'starter';
const WINDOW_SECONDS = 3600;
const PLAN_CACHE_TTL = 300;
const FEATURES_CACHE_TTL = 300;

@Injectable()
export class TenantThrottleService {
    private readonly logger = new Logger(TenantThrottleService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {}

    private async resolveLimits(tenantId: string): Promise<{ plan: string; limits: PlanLimits; overrides: QuotaOverrides }> {
        const plan = await this.getTenantPlan(tenantId);
        const features = await this.getPlanFeatures(tenantId);
        const rl = (features.rateLimits as Record<string, number>) || {};
        const planDefaults: PlanLimits = {
            automation: rl.automation ?? FALLBACK_LIMITS.automation,
            outbound: rl.outbound ?? FALLBACK_LIMITS.outbound,
            broadcast: rl.broadcast ?? FALLBACK_LIMITS.broadcast,
            priority: rl.priority ?? FALLBACK_LIMITS.priority,
            maxPendingJobs: rl.maxPendingJobs ?? FALLBACK_LIMITS.maxPendingJobs,
        };
        const overrides = await this.getQuotaOverrides(tenantId);
        const merged: PlanLimits = {
            automation: overrides.automation ?? planDefaults.automation,
            outbound: overrides.outbound ?? planDefaults.outbound,
            broadcast: overrides.broadcast ?? planDefaults.broadcast,
            priority: overrides.priority ?? planDefaults.priority,
            maxPendingJobs: overrides.maxPendingJobs ?? planDefaults.maxPendingJobs,
        };
        for (const k of ['automation', 'outbound', 'broadcast', 'maxPendingJobs'] as const) {
            if (merged[k] === -1) merged[k] = Number.POSITIVE_INFINITY;
        }
        return { plan, limits: merged, overrides };
    }

    async isLimited(tenantId: string, action: ActionType): Promise<boolean> {
        const { plan, limits } = await this.resolveLimits(tenantId);
        const limit = limits[action];

        if (limit === Number.POSITIVE_INFINITY) return false; // -1 → unlimited
        if (limit <= 0) return true; // 0 means BLOCKED for this action, not unlimited

        const key = `throttle:${action}:${tenantId}:${Math.floor(Date.now() / (WINDOW_SECONDS * 1000))}`;
        const current = await this.redis.incrementRateLimit(key, WINDOW_SECONDS);

        if (current > limit) {
            this.logger.warn(
                `[Throttle] Tenant ${tenantId} (${plan}) exceeded ${action} limit: ${current}/${limit} per hour`,
            );
            return true;
        }

        return false;
    }

    /**
     * Read-only limit check (does NOT consume quota). Use this to gate retries/
     * re-checks so the counter isn't incremented multiple times for one logical
     * action; call recordUsage() once after the action actually succeeds.
     */
    async isOverLimit(tenantId: string, action: ActionType): Promise<boolean> {
        const { limits } = await this.resolveLimits(tenantId);
        const limit = limits[action];
        if (limit === Number.POSITIVE_INFINITY) return false;
        if (limit <= 0) return true;
        const key = `throttle:${action}:${tenantId}:${Math.floor(Date.now() / (WINDOW_SECONDS * 1000))}`;
        const current = Number(await this.redis.get(key) || 0);
        return current >= limit;
    }

    /** Record one consumed action against the per-hour quota (INCR + EXPIRE). */
    async recordUsage(tenantId: string, action: ActionType): Promise<void> {
        const key = `throttle:${action}:${tenantId}:${Math.floor(Date.now() / (WINDOW_SECONDS * 1000))}`;
        await this.redis.incrementRateLimit(key, WINDOW_SECONDS);
    }

    /**
     * Atomically reserve one rate-limited action for a stable logical effect.
     *
     * `isOverLimit()` followed by `recordUsage()` is useful for display, but it
     * cannot authorise a provider call: two workers can both read the last free
     * slot. The marker below makes the limit decision and the increment one
     * Redis operation, while a retry of the same effect adopts the reservation
     * instead of consuming a second slot.
     */
    async reserveActionUsage(
        tenantId: string,
        action: ActionType,
        effectId: string,
    ): Promise<{ allowed: boolean; count: number; adopted: boolean }> {
        const { limits } = await this.resolveLimits(tenantId);
        const limit = limits[action];
        const window = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
        const countKey = `throttle:${action}:${tenantId}:${window}`;
        const effectHash = createHash('sha256').update(effectId).digest('hex');
        const reservationKey = `throttle:reservation:${action}:${tenantId}:${effectHash}`;
        const markerTtl = WINDOW_SECONDS * 2;
        const finiteLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : -1;

        const result = await this.redis.getClient().eval(
            `local marker = redis.call('GET', KEYS[2])
             local current = tonumber(redis.call('GET', KEYS[1]) or '0')
             local quota = tonumber(ARGV[1])
             if marker then
                 if string.sub(marker, 1, 5) ~= 'held:' then return {1, current, 1} end
                 local heldWindow = string.sub(marker, 6)
                 if heldWindow == ARGV[4] then return {1, current, 1} end
                 if quota >= 0 and current >= quota then return {0, current, 1} end
                 if quota < 0 then return {1, current, 1} end
                 local oldCountKey = 'throttle:' .. ARGV[5] .. ':' .. ARGV[6] .. ':' .. heldWindow
                 local oldCount = tonumber(redis.call('GET', oldCountKey) or '0')
                 if oldCount > 0 then redis.call('DECR', oldCountKey) end
                 current = redis.call('INCR', KEYS[1])
                 redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
                 redis.call('SET', KEYS[2], 'held:' .. ARGV[4], 'EX', tonumber(ARGV[3]))
                 return {1, current, 1}
             end
             if quota >= 0 and current >= quota then return {0, current, 0} end
             if quota < 0 then return {1, current, 0} end
             current = redis.call('INCR', KEYS[1])
             redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
             redis.call('SET', KEYS[2], 'held:' .. ARGV[4], 'EX', tonumber(ARGV[3]))
             return {1, current, 0}`,
            2,
            countKey,
            reservationKey,
            String(finiteLimit),
            String(WINDOW_SECONDS),
            String(markerTtl),
            String(window),
            action,
            tenantId,
        ) as [number, number, number];
        return { allowed: result[0] === 1, count: Number(result[1]), adopted: result[2] === 1 };
    }

    /** Keep a successful or possibly-transmitted effect counted across retries. */
    async commitActionUsage(tenantId: string, action: ActionType, effectId: string): Promise<void> {
        const effectHash = createHash('sha256').update(effectId).digest('hex');
        const reservationKey = `throttle:reservation:${action}:${tenantId}:${effectHash}`;
        await this.redis.getClient().eval(
            `if redis.call('EXISTS', KEYS[1]) == 1 then
                 redis.call('SET', KEYS[1], 'committed', 'EX', tonumber(ARGV[1]))
                 return 1
             end
             return 0`,
            1,
            reservationKey,
            String(WINDOW_SECONDS * 2),
        );
    }

    /** Release only a pre-provider reservation; committed effects are immutable. */
    async releaseActionUsage(tenantId: string, action: ActionType, effectId: string): Promise<void> {
        const effectHash = createHash('sha256').update(effectId).digest('hex');
        const reservationKey = `throttle:reservation:${action}:${tenantId}:${effectHash}`;
        await this.redis.getClient().eval(
            `local marker = redis.call('GET', KEYS[1])
             if not marker or string.sub(marker, 1, 5) ~= 'held:' then return 0 end
             local window = string.sub(marker, 6)
             local countKey = 'throttle:' .. ARGV[1] .. ':' .. ARGV[2] .. ':' .. window
             redis.call('DEL', KEYS[1])
             local current = tonumber(redis.call('GET', countKey) or '0')
             if current > 0 then redis.call('DECR', countKey) end
             return 1`,
            1,
            reservationKey,
            action,
            tenantId,
        );
    }

    async getPriority(tenantId: string): Promise<number> {
        const { limits } = await this.resolveLimits(tenantId);
        return limits.priority;
    }

    async getMaxPendingJobs(tenantId: string): Promise<number> {
        const { limits } = await this.resolveLimits(tenantId);
        return limits.maxPendingJobs;
    }

    async getUsage(tenantId: string, action: ActionType): Promise<{ current: number; limit: number; plan: string; overridden: boolean }> {
        const { plan, limits, overrides } = await this.resolveLimits(tenantId);
        const key = `throttle:${action}:${tenantId}:${Math.floor(Date.now() / (WINDOW_SECONDS * 1000))}`;
        const current = Number(await this.redis.get(key) || 0);
        return {
            current,
            limit: limits[action] === Number.POSITIVE_INFINITY ? -1 : limits[action],
            plan,
            overridden: overrides[action] !== undefined,
        };
    }

    /**
     * Read all plan features from billing_plans table, merged with tenant
     * overrides. Cached in Redis for 5 minutes per tenant.
     *
     * Returns a flat object with all feature keys from the seed.
     * Callers should access specific keys (e.g. result.maxAgents).
     */
    async getPlanFeatures(tenantId: string, executionContext?: ServiceExecutionContext): Promise<Record<string, any>> {
        const cacheKey = `plan_features:${tenantId}`;
        const cached = persistenceDisabled(executionContext) ? null : await this.redis.getJson(cacheKey);
        if (cached) {
            const overrides = await this.getQuotaOverrides(tenantId);
            return this.applyOverrides(cached as Record<string, any>, overrides);
        }

        const plan = await this.getTenantPlan(tenantId, executionContext);
        const row = await this.prisma.billingPlan.findUnique({
            where: { slug: plan },
            select: { maxAgents: true, maxAiMessages: true, features: true },
        });

        const features = (row?.features ?? {}) as Record<string, any>;
        const base: Record<string, any> = {
            ...features,
            maxAgents: row?.maxAgents ?? 1,
            maxAiMessages: row?.maxAiMessages ?? 0,
        };

        if (!persistenceDisabled(executionContext)) await this.redis.setJson(cacheKey, base, FEATURES_CACHE_TTL);

        const overrides = await this.getQuotaOverrides(tenantId);
        return this.applyOverrides(base, overrides);
    }

    private applyOverrides(base: Record<string, any>, overrides: QuotaOverrides): Record<string, any> {
        return applyPlanFeatureOverrides(base, overrides);
    }

    /**
     * Check if a boolean feature flag is enabled for this tenant's plan.
     * Returns false if the key doesn't exist.
     */
    async isFeatureEnabled(tenantId: string, featureKey: string, executionContext?: ServiceExecutionContext): Promise<boolean> {
        const features = await this.getPlanFeatures(tenantId, executionContext);
        return features[featureKey] === true;
    }

    // ── Quota override management (super_admin) ────────────────────

    async getQuotaOverrides(tenantId: string): Promise<QuotaOverrides> {
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { settings: true },
            });
            const settings = (tenant?.settings as any) || {};
            return (settings.quotaOverrides || {}) as QuotaOverrides;
        } catch {
            return {};
        }
    }

    async setQuotaOverrides(tenantId: string, overrides: QuotaOverrides, setBy?: string): Promise<QuotaOverrides> {
        // Reject unknown keys instead of silently storing a no-op (the old
        // behavior persisted any key but only ever read a fixed subset).
        const META = new Set(['reason', 'setBy', 'setAt']);
        // Nested object overrides (not flat numeric keys) validated separately below.
        const NESTED_OVERRIDE = new Set(['maxChannelAccounts']);
        const unknown = Object.keys(overrides).filter(k => !META.has(k) && !NESTED_OVERRIDE.has(k) && !isOverridableQuotaKey(k));
        if (unknown.length) {
            const { BadRequestException } = await import('@nestjs/common');
            throw new BadRequestException({
                error: 'invalid_override_keys',
                unknownKeys: unknown,
                message: `Estas claves no se pueden overridear por tenant: ${unknown.join(', ')}.`,
            });
        }

        for (const key of OVERRIDABLE_QUOTA_KEYS) {
            const value = (overrides as Record<string, any>)[key];
            if (value === undefined || value === null) continue;
            if (!Number.isSafeInteger(value) || (key === 'priority' ? value < 1 : value < -1)) {
                const { BadRequestException } = await import('@nestjs/common');
                throw new BadRequestException({ error: 'invalid_override_value', key });
            }
        }

        // Validate the nested maxChannelAccounts override: object of { channelType: number }.
        const mca = (overrides as Record<string, any>).maxChannelAccounts;
        if (mca !== undefined) {
            const { BadRequestException } = await import('@nestjs/common');
            if (typeof mca !== 'object' || mca === null || Array.isArray(mca)) {
                throw new BadRequestException({
                    error: 'invalid_override_keys',
                    message: 'maxChannelAccounts debe ser un objeto { canal: número }.',
                });
            }
            const allowed = new Set<string>(CHANNEL_ACCOUNT_KEYS as readonly string[]);
            const badInner = Object.keys(mca).filter(k => !allowed.has(k) || !Number.isSafeInteger(mca[k]) || mca[k] < -1);
            if (badInner.length) {
                throw new BadRequestException({
                    error: 'invalid_override_keys',
                    unknownKeys: badInner.map(k => `maxChannelAccounts.${k}`),
                    message: `Claves inválidas en maxChannelAccounts: ${badInner.join(', ')}.`,
                });
            }
        }

        const stamped: QuotaOverrides = {
            ...overrides,
            setBy: setBy || 'super_admin',
            setAt: new Date().toISOString(),
        };
        for (const k of OVERRIDABLE_QUOTA_KEYS) {
            const v = (stamped as Record<string, any>)[k];
            if (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) {
                delete (stamped as Record<string, any>)[k];
            }
        }
        await replaceTenantSettingsBranch(this.prisma, tenantId, 'quotaOverrides', stamped);
        await this.redis.del(`tenant_plan:${tenantId}`);
        await this.redis.del(`plan_features:${tenantId}`);
        return stamped;
    }

    async invalidatePlanCacheForSlug(planSlug: string): Promise<number> {
        const tenants = await this.prisma.tenant.findMany({
            where: { plan: planSlug },
            select: { id: true },
        });
        for (const t of tenants) {
            await this.redis.del(`plan_features:${t.id}`);
            await this.redis.del(`tenant_plan:${t.id}`);
        }
        return tenants.length;
    }

    /**
     * Resolve a granular per-resource limit from billing_plans.features.
     * Returns Infinity for -1 (unlimited).
     * Falls back to 0 if the key doesn't exist (safe default — blocks creation
     * until seed runs, which is better than silently allowing unlimited).
     */
    async getPlanLimit(tenantId: string, limitKey: string): Promise<number> {
        const features = await this.getPlanFeatures(tenantId);
        const raw = features[limitKey];
        if (typeof raw !== 'number') return 0;
        return raw === -1 ? Number.POSITIVE_INFINITY : raw;
    }

    /**
     * Generic quota guard. Throws 403 with { error: 'plan_limit_reached', ... }
     * when the current count has reached the plan's allowed maximum.
     */
    async enforcePlanLimit(tenantId: string, limitKey: string, currentCount: number, resourceLabel?: string): Promise<void> {
        const { ForbiddenException } = await import('@nestjs/common');
        const max = await this.getPlanLimit(tenantId, limitKey);
        if (currentCount >= max) {
            const plan = await this.getTenantPlan(tenantId);
            throw new ForbiddenException({
                error: 'plan_limit_reached',
                limitKey,
                resource: resourceLabel ?? limitKey,
                currentCount,
                maxAllowed: Number.isFinite(max) ? max : null,
                plan,
                message: `Tu plan ${plan} permite hasta ${Number.isFinite(max) ? max : '∞'} ${resourceLabel ?? limitKey}. Actualizá tu plan para agregar más.`,
            });
        }
    }

    // ── Per-channel-type connected-account limit ───────────────────

    /**
     * How many connected accounts of a given channel type this tenant may have.
     * Resolution order: per-tenant override (quotaOverrides.maxChannelAccounts) →
     * plan feature (features.maxChannelAccounts[type]) → default 1.
     *
     * The default is 1 (NOT 0): before this feature every plan implicitly allowed
     * one account per type, and getPlanLimit's fail-closed-to-0 would wrongly block
     * the FIRST connection whenever the seed hasn't populated the key yet.
     * Returns Infinity for -1 (unlimited).
     */
    async getChannelAccountLimit(tenantId: string, channelType: string): Promise<number> {
        let raw: any;
        const overrides = await this.getQuotaOverrides(tenantId);
        const ovMap = (overrides as Record<string, any>).maxChannelAccounts;
        if (ovMap && typeof ovMap === 'object' && typeof ovMap[channelType] === 'number') {
            raw = ovMap[channelType];
        } else {
            const features = await this.getPlanFeatures(tenantId);
            const map = (features.maxChannelAccounts as Record<string, number>) || {};
            raw = map[channelType];
        }
        if (typeof raw !== 'number') return 1;
        return raw === -1 ? Number.POSITIVE_INFINITY : raw;
    }

    /**
     * Throws 403 { error: 'plan_limit_reached', limitKey: 'maxChannelAccounts', ... }
     * when connecting one more account of `channelType` would exceed the plan.
     * Pass the count of DISTINCT active accounts of that type that already exist
     * EXCLUDING the one being (re)connected, so reconnecting an existing account
     * never blocks.
     */
    async enforceChannelAccountLimit(tenantId: string, channelType: string, currentCount: number): Promise<void> {
        const { ForbiddenException } = await import('@nestjs/common');
        const max = await this.getChannelAccountLimit(tenantId, channelType);
        if (currentCount >= max) {
            const plan = await this.getTenantPlan(tenantId);
            throw new ForbiddenException({
                error: 'plan_limit_reached',
                limitKey: 'maxChannelAccounts',
                resource: `${channelType}_accounts`,
                channelType,
                currentCount,
                maxAllowed: Number.isFinite(max) ? max : null,
                plan,
                message: `Tu plan ${plan} permite hasta ${Number.isFinite(max) ? max : '∞'} cuenta(s) de ${channelType}. Actualizá tu plan o desconectá otra para conectar una nueva.`,
            });
        }
    }

    // ── AI message monthly quota ───────────────────────────────────

    async getAiMessageUsage(tenantId: string): Promise<{
        used: number;
        limit: number;
        remaining: number | null;
        percent: number;
        monthKey: string;
        plan: string;
    }> {
        const monthKey = this.currentMonthKey();
        const used = Number((await this.redis.get(`ai_msg:${tenantId}:${monthKey}`)) || 0);
        const plan = await this.getTenantPlan(tenantId);
        const planRow = await this.prisma.billingPlan.findUnique({
            where: { slug: plan },
            select: { maxAiMessages: true },
        });
        const overrides = await this.getQuotaOverrides(tenantId);
        const rawLimit = typeof overrides.maxAiMessages === 'number'
            ? overrides.maxAiMessages
            : (planRow?.maxAiMessages ?? 0);
        const limit = rawLimit === -1 ? Number.POSITIVE_INFINITY : rawLimit;
        const remaining = Number.isFinite(limit) ? Math.max(0, (limit as number) - used) : null;
        const percent = Number.isFinite(limit) && (limit as number) > 0
            ? Math.min(100, Math.round((used / (limit as number)) * 100))
            : 0;
        return { used, limit, remaining, percent, monthKey, plan };
    }

    async incrementAiMessageCount(tenantId: string, by = 1): Promise<number> {
        const key = `ai_msg:${tenantId}:${this.currentMonthKey()}`;
        const newCount = await this.redis.incrBy(key, by);
        if (newCount === by) {
            await this.redis.expire(key, 35 * 24 * 60 * 60);
        }
        return newCount;
    }

    /**
     * Reserve one monthly AI reply for a stable inbound effect.
     *
     * The old read-then-increment path was not a quota: concurrent turns could
     * both observe the last free slot, and retries counted the same inbound
     * message again. This Lua script decides the limit and records the effect
     * identity in one Redis transaction. A retry adopts its existing marker.
     */
    async reserveAiMessageCount(
        tenantId: string,
        effectId: string,
        limit: number,
    ): Promise<{ allowed: boolean; count: number; adopted: boolean }> {
        const monthKey = this.currentMonthKey();
        const countKey = `ai_msg:${tenantId}:${monthKey}`;
        const effectHash = createHash('sha256').update(effectId).digest('hex');
        const reservationKey = `ai_msg:reservation:${tenantId}:${monthKey}:${effectHash}`;
        const ttl = 35 * 24 * 60 * 60;
        const finiteLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : -1;
        const result = await this.redis.getClient().eval(
            `local marker = redis.call('GET', KEYS[2])
             local current = tonumber(redis.call('GET', KEYS[1]) or '0')
             if marker then return {1, current, 1} end
             local quota = tonumber(ARGV[1])
             if quota >= 0 and current >= quota then return {0, current, 0} end
             current = redis.call('INCR', KEYS[1])
             redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
             redis.call('SET', KEYS[2], 'held', 'EX', tonumber(ARGV[2]))
             return {1, current, 0}`,
            2, countKey, reservationKey, String(finiteLimit), String(ttl),
        ) as [number, number, number];
        return { allowed: result[0] === 1, count: Number(result[1]), adopted: result[2] === 1 };
    }

    /** The generated reply is now an accounted fact; retries keep adopting it. */
    async commitAiMessageCount(tenantId: string, effectId: string): Promise<void> {
        const monthKey = this.currentMonthKey();
        const effectHash = createHash('sha256').update(effectId).digest('hex');
        const reservationKey = `ai_msg:reservation:${tenantId}:${monthKey}:${effectHash}`;
        const ttl = 35 * 24 * 60 * 60;
        await this.redis.getClient().eval(
            `if redis.call('EXISTS', KEYS[1]) == 1 then
                 redis.call('SET', KEYS[1], 'committed', 'EX', tonumber(ARGV[1]))
                 return 1
             end
             return 0`,
            1, reservationKey, String(ttl),
        );
    }

    /** Release only a still-held reservation; a committed retry is immutable. */
    async releaseAiMessageCount(tenantId: string, effectId: string): Promise<void> {
        const monthKey = this.currentMonthKey();
        const effectHash = createHash('sha256').update(effectId).digest('hex');
        const reservationKey = `ai_msg:reservation:${tenantId}:${monthKey}:${effectHash}`;
        const countKey = `ai_msg:${tenantId}:${monthKey}`;
        await this.redis.getClient().eval(
            `if redis.call('GET', KEYS[1]) ~= 'held' then return 0 end
             redis.call('DEL', KEYS[1])
             local current = tonumber(redis.call('GET', KEYS[2]) or '0')
             if current > 0 then redis.call('DECR', KEYS[2]) end
             return 1`,
            2, reservationKey, countKey,
        );
    }

    async hasAiMessageQuota(tenantId: string): Promise<boolean> {
        const { used, limit } = await this.getAiMessageUsage(tenantId);
        if (!Number.isFinite(limit)) return true;
        return used < (limit as number);
    }

    // ── Platform-paid demo replies (D19) ───────────────────────────

    /**
     * Lifetime counter of platform-paid demo replies for one tenant.
     *
     * Deliberately NO month segment and NO TTL: the allowance is "the first N
     * replies on the demo link, ever", not a monthly quota. Redis runs with
     * `noeviction`, so the key is never dropped under memory pressure; only a
     * Redis flush resets it, and for a free demo allowance that is acceptable
     * (worst case the platform gives one tenant a second allowance; nobody is
     * charged and no plan quota is touched).
     */
    private demoMessageCountKey(tenantId: string): string {
        return `demo_msg:${tenantId}`;
    }

    /** Effect marker: 'held' while the reply is being generated, 'committed' once it is a fact. */
    private demoMessageReservationKey(tenantId: string, effectId: string): string {
        const effectHash = createHash('sha256').update(effectId).digest('hex');
        return `demo_msg:reservation:${tenantId}:${effectHash}`;
    }

    /**
     * Reserve one platform-paid demo reply for a stable effect (one inbound
     * message on the tenant's public demo link).
     *
     * Same contract and Lua shape as `reserveAiMessageCount`: the limit
     * decision and the increment are one Redis operation, and a retry of the
     * same effect adopts its existing marker instead of consuming a second
     * reply. `limit` is supplied by the caller (DemoAllowanceService's
     * `messagesPerTenant`, or a per-tenant override); a non-finite limit means
     * unlimited. Never reads or writes `ai_msg:*`: a demo reply is not a plan
     * message and must not move the plan quota either way.
     */
    async reserveDemoMessageCount(
        tenantId: string,
        effectId: string,
        limit: number,
    ): Promise<{ allowed: boolean; count: number; adopted: boolean }> {
        const countKey = this.demoMessageCountKey(tenantId);
        const reservationKey = this.demoMessageReservationKey(tenantId, effectId);
        const ttl = 35 * 24 * 60 * 60;
        const finiteLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : -1;
        const result = await this.redis.getClient().eval(
            `local marker = redis.call('GET', KEYS[2])
             local current = tonumber(redis.call('GET', KEYS[1]) or '0')
             if marker then return {1, current, 1} end
             local quota = tonumber(ARGV[1])
             if quota >= 0 and current >= quota then return {0, current, 0} end
             current = redis.call('INCR', KEYS[1])
             redis.call('SET', KEYS[2], 'held', 'EX', tonumber(ARGV[2]))
             return {1, current, 0}`,
            2, countKey, reservationKey, String(finiteLimit), String(ttl),
        ) as [number, number, number];
        return { allowed: result[0] === 1, count: Number(result[1]), adopted: result[2] === 1 };
    }

    /** The demo reply is now an accounted fact; retries keep adopting it. */
    async commitDemoMessageCount(tenantId: string, effectId: string): Promise<void> {
        const reservationKey = this.demoMessageReservationKey(tenantId, effectId);
        const ttl = 35 * 24 * 60 * 60;
        await this.redis.getClient().eval(
            `if redis.call('EXISTS', KEYS[1]) == 1 then
                 redis.call('SET', KEYS[1], 'committed', 'EX', tonumber(ARGV[1]))
                 return 1
             end
             return 0`,
            1, reservationKey, String(ttl),
        );
    }

    /** Release only a still-held demo reservation; a committed retry is immutable. */
    async releaseDemoMessageCount(tenantId: string, effectId: string): Promise<void> {
        const reservationKey = this.demoMessageReservationKey(tenantId, effectId);
        const countKey = this.demoMessageCountKey(tenantId);
        await this.redis.getClient().eval(
            `if redis.call('GET', KEYS[1]) ~= 'held' then return 0 end
             redis.call('DEL', KEYS[1])
             local current = tonumber(redis.call('GET', KEYS[2]) or '0')
             if current > 0 then redis.call('DECR', KEYS[2]) end
             return 1`,
            2, reservationKey, countKey,
        );
    }

    /**
     * Lifetime platform-paid demo replies consumed by a tenant. The limit is
     * not this service's to know (it comes from DemoAllowanceService or an
     * override), so it is `null` unless the caller passes one to echo back.
     */
    async getDemoMessageUsage(
        tenantId: string,
        limit?: number,
    ): Promise<{ used: number; limit: number | null }> {
        const used = Number((await this.redis.get(this.demoMessageCountKey(tenantId))) || 0);
        return { used, limit: typeof limit === 'number' && Number.isFinite(limit) ? limit : null };
    }

    // ── LLM cost circuit breaker ───────────────────────────────────

    /**
     * Month-to-date LLM spend for a tenant, in USD cents.
     * The LLM router writes `llm:cost:{tenantId}:{YYYY-MM}` in centi-USD
     * (USD*10000) per call; we divide by 100 to return USD cents (USD*100),
     * matching the unit of the plan's `llmCostBudgetUsdCents` feature.
     */
    async getLlmSpendUsdCents(tenantId: string): Promise<number> {
        const raw = Number((await this.redis.get(`llm:cost:${tenantId}:${this.currentMonthKey()}`)) || 0);
        return raw / 100;
    }

    private currentMonthKey(): string {
        const now = new Date();
        const yyyy = now.getUTCFullYear();
        const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
        return `${yyyy}-${mm}`;
    }

    /**
     * Resolve tenant plan with Redis caching (5 min TTL).
     */
    async getTenantPlan(tenantId: string, executionContext?: ServiceExecutionContext): Promise<string> {
        const cacheKey = `tenant_plan:${tenantId}`;
        const cached = persistenceDisabled(executionContext) ? null : await this.redis.get(cacheKey);
        if (cached) return cached;

        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { plan: true },
            });
            const plan = tenant?.plan || DEFAULT_PLAN;
            if (!persistenceDisabled(executionContext)) await this.redis.set(cacheKey, plan, PLAN_CACHE_TTL);
            return plan;
        } catch (error) {
            if (persistenceDisabled(executionContext)) throw error;
            return DEFAULT_PLAN;
        }
    }
}
