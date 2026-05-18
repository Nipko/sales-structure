import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/**
 * Plan-based rate limiting and feature gating for multi-tenant fairness.
 *
 * Rate limits (per-hour sliding windows) are hardcoded here because they
 * are operational knobs, not customer-facing features.
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
    automation?: number;
    outbound?: number;
    broadcast?: number;
    priority?: number;
    maxPendingJobs?: number;
    maxAgents?: number;
    maxCalendars?: number;
    reason?: string;
    setBy?: string;
    setAt?: string;
}

const PLAN_LIMITS: Record<string, PlanLimits> = {
    emprendedor: { automation: 0,    outbound: 100,   broadcast: 0,      priority: 6, maxPendingJobs: 20 },
    starter:     { automation: 50,   outbound: 200,   broadcast: 500,    priority: 5, maxPendingJobs: 50 },
    pro:         { automation: 500,  outbound: 2000,  broadcast: 5000,   priority: 3, maxPendingJobs: 200 },
    enterprise:  { automation: 5000, outbound: 20000, broadcast: 50000,  priority: 1, maxPendingJobs: 1000 },
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
        const planDefaults = PLAN_LIMITS[plan] || PLAN_LIMITS[DEFAULT_PLAN];
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

        if (!limit) return false;
        if (limit === Number.POSITIVE_INFINITY) return false;

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
    async getPlanFeatures(tenantId: string): Promise<Record<string, any>> {
        const cacheKey = `plan_features:${tenantId}`;
        const cached = await this.redis.getJson(cacheKey);
        if (cached) {
            const overrides = await this.getQuotaOverrides(tenantId);
            return this.applyOverrides(cached as Record<string, any>, overrides);
        }

        const plan = await this.getTenantPlan(tenantId);
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

        await this.redis.setJson(cacheKey, base, FEATURES_CACHE_TTL);

        const overrides = await this.getQuotaOverrides(tenantId);
        return this.applyOverrides(base, overrides);
    }

    private applyOverrides(base: Record<string, any>, overrides: QuotaOverrides): Record<string, any> {
        return {
            ...base,
            maxAgents: overrides.maxAgents ?? base.maxAgents,
            maxCalendars: overrides.maxCalendars ?? base.maxCalendars,
        };
    }

    /**
     * Check if a boolean feature flag is enabled for this tenant's plan.
     * Returns false if the key doesn't exist.
     */
    async isFeatureEnabled(tenantId: string, featureKey: string): Promise<boolean> {
        const features = await this.getPlanFeatures(tenantId);
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
        const existing = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        const settings = (existing?.settings as any) || {};
        const stamped: QuotaOverrides = {
            ...overrides,
            setBy: setBy || 'super_admin',
            setAt: new Date().toISOString(),
        };
        for (const k of ['automation', 'outbound', 'broadcast', 'priority', 'maxPendingJobs', 'maxAgents', 'maxCalendars'] as const) {
            if (stamped[k] === null || stamped[k] === undefined || (typeof stamped[k] === 'number' && Number.isNaN(stamped[k] as any))) {
                delete stamped[k];
            }
        }
        settings.quotaOverrides = stamped;
        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { settings },
        });
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
        const rawLimit = planRow?.maxAiMessages ?? 0;
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

    async hasAiMessageQuota(tenantId: string): Promise<boolean> {
        const { used, limit } = await this.getAiMessageUsage(tenantId);
        if (!Number.isFinite(limit)) return true;
        return used < (limit as number);
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
    async getTenantPlan(tenantId: string): Promise<string> {
        const cacheKey = `tenant_plan:${tenantId}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return cached;

        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { plan: true },
            });
            const plan = tenant?.plan || DEFAULT_PLAN;
            await this.redis.set(cacheKey, plan, PLAN_CACHE_TTL);
            return plan;
        } catch {
            return DEFAULT_PLAN;
        }
    }
}
