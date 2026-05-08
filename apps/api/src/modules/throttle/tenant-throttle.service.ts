import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/**
 * Plan-based rate limiting for multi-tenant automation fairness.
 *
 * Prevents any single tenant from monopolizing shared queues.
 * Limits are enforced per hour using Redis sliding windows.
 *
 * Plans:
 *   starter    →   50 automation/h,   200 outbound/h
 *   pro        →  500 automation/h,  2000 outbound/h
 *   enterprise → 5000 automation/h, 20000 outbound/h
 *
 * Override mechanism:
 * super_admin can set per-tenant overrides at `tenant.settings.quotaOverrides`
 * to bump any limit above the plan default — useful for enterprise tenants
 * with traffic spikes or for testing without changing pricing tier. Pass
 * -1 to mean unlimited; omit a key to fall back to the plan default.
 */

type ActionType = 'automation' | 'outbound' | 'broadcast';

interface PlanLimits {
    automation: number;   // max automation jobs per hour
    outbound: number;     // max outbound messages per hour
    broadcast: number;    // max broadcast messages per hour
    priority: number;     // BullMQ job priority (1=highest)
    maxPendingJobs: number; // max jobs queued per tenant
}

export interface QuotaOverrides {
    automation?: number;
    outbound?: number;
    broadcast?: number;
    priority?: number;
    maxPendingJobs?: number;
    maxAgents?: number;
    maxCalendars?: number;
    /** Optional metadata for the audit trail */
    reason?: string;
    setBy?: string;
    setAt?: string;
}

const PLAN_LIMITS: Record<string, PlanLimits> = {
    starter:    { automation: 50,   outbound: 200,   broadcast: 500,    priority: 5, maxPendingJobs: 50 },
    pro:        { automation: 500,  outbound: 2000,  broadcast: 5000,   priority: 3, maxPendingJobs: 200 },
    enterprise: { automation: 5000, outbound: 20000, broadcast: 50000,  priority: 1, maxPendingJobs: 1000 },
};

const PLAN_FEATURES: Record<string, { maxAgents: number; maxCalendars: number; templates: boolean; customPrompt: boolean }> = {
    starter:    { maxAgents: 1,  maxCalendars: 1,   templates: false, customPrompt: false },
    pro:        { maxAgents: 3,  maxCalendars: 3,   templates: true,  customPrompt: true },
    enterprise: { maxAgents: 10, maxCalendars: 10,  templates: true,  customPrompt: true },
    custom:     { maxAgents: 999, maxCalendars: 999, templates: true, customPrompt: true },
};

const DEFAULT_PLAN = 'starter';
const WINDOW_SECONDS = 3600; // 1 hour
const PLAN_CACHE_TTL = 300;  // 5 minutes

@Injectable()
export class TenantThrottleService {
    private readonly logger = new Logger(TenantThrottleService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {}

    /**
     * Resolve effective limits for a tenant (plan defaults merged with overrides).
     */
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
        // -1 means unlimited — convert to Infinity for safe comparisons
        for (const k of ['automation', 'outbound', 'broadcast', 'maxPendingJobs'] as const) {
            if (merged[k] === -1) merged[k] = Number.POSITIVE_INFINITY;
        }
        return { plan, limits: merged, overrides };
    }

    /**
     * Check if a tenant has exceeded their rate limit for a given action.
     * Returns true if the action should be BLOCKED.
     */
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

    /**
     * Get the BullMQ job priority for a tenant based on their plan + overrides.
     */
    async getPriority(tenantId: string): Promise<number> {
        const { limits } = await this.resolveLimits(tenantId);
        return limits.priority;
    }

    /**
     * Get max pending jobs allowed for a tenant.
     */
    async getMaxPendingJobs(tenantId: string): Promise<number> {
        const { limits } = await this.resolveLimits(tenantId);
        return limits.maxPendingJobs;
    }

    /**
     * Get current usage count for a tenant + action in the current window.
     */
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
     * Get plan feature limits (max agents, templates, custom prompt) merged
     * with tenant overrides.
     */
    async getPlanFeatures(tenantId: string): Promise<typeof PLAN_FEATURES[string]> {
        const plan = await this.getTenantPlan(tenantId);
        const base = PLAN_FEATURES[plan] || PLAN_FEATURES.starter;
        const overrides = await this.getQuotaOverrides(tenantId);
        return {
            maxAgents: overrides.maxAgents ?? base.maxAgents,
            maxCalendars: overrides.maxCalendars ?? base.maxCalendars,
            templates: base.templates,
            customPrompt: base.customPrompt,
        };
    }

    // ── Quota override management (super_admin) ────────────────────

    /**
     * Read tenant's quota overrides from settings.quotaOverrides JSONB.
     */
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

    /**
     * Persist quota overrides for a tenant. Pass an empty object to clear all.
     * Invalidates the plan cache so the new limits take effect immediately.
     */
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
        // Strip undefined/null entries (except metadata) so toggling back to
        // plan default is a clean delete, not a stored 'undefined' that
        // confuses the merge logic.
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
        // Invalidate plan cache (which is implicitly the limits cache)
        await this.redis.del(`tenant_plan:${tenantId}`);
        return stamped;
    }

    /**
     * Resolve a granular per-resource limit from billing_plans.features (the
     * source of truth populated by the seed). Returns Infinity for -1
     * (unlimited) so callers can compare with `>=`.
     *
     * Falls back to 0 if the plan row does not exist yet, which keeps fresh
     * installs safe — enforcePlanLimit then rejects every create call until
     * seed-billing-plans.js runs. That is preferable to silently letting
     * unlimited resources through in a half-initialised deploy.
     */
    async getPlanLimit(tenantId: string, limitKey: string): Promise<number> {
        const plan = await this.getTenantPlan(tenantId);
        const row = await this.prisma.billingPlan.findUnique({
            where: { slug: plan },
            select: { features: true },
        });
        const features = (row?.features ?? {}) as Record<string, unknown>;
        const raw = features[limitKey];
        if (typeof raw !== 'number') return 0;
        return raw === -1 ? Number.POSITIVE_INFINITY : raw;
    }

    /**
     * Generic quota guard. Throws 403 with { error: 'plan_limit_reached', ... }
     * when the current count has already reached the plan's allowed maximum.
     * Use from any resource-creation path (services, automation rules,
     * broadcasts, etc.) to replicate the maxAgents pattern.
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
    //
    // Plans cap monthly AI message volume (BillingPlan.maxAiMessages):
    //   starter    →   5,000/mes
    //   pro        →  25,000/mes
    //   enterprise → 100,000/mes
    //   custom     → unlimited (-1)
    //
    // Counters live in Redis with monthly key `ai_msg:{tenantId}:{YYYY-MM}`
    // and a 35-day TTL so the next cycle naturally resets. We never block
    // the conversation pipeline outright when over quota — instead the
    // caller decides what to do (typically: send a fallback reply and
    // skip the LLM call).

    /**
     * Get current AI-message usage for the running calendar month.
     * Returns { used, limit, remaining, percent, monthKey }.
     * `limit` is Infinity for unlimited plans; remaining is null in that case.
     */
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

    /**
     * Increment counter atomically. Sets TTL on first write so old months
     * vanish without manual cleanup. Returns the new used count.
     */
    async incrementAiMessageCount(tenantId: string, by = 1): Promise<number> {
        const key = `ai_msg:${tenantId}:${this.currentMonthKey()}`;
        const newCount = await this.redis.incrBy(key, by);
        // First write of the month — set TTL so Redis evicts the bucket
        // a few days into the next month (35d covers month-end edge cases).
        if (newCount === by) {
            await this.redis.expire(key, 35 * 24 * 60 * 60);
        }
        return newCount;
    }

    /**
     * Returns true if the tenant has remaining AI-message quota for the
     * current month. Cheap call — uses the cached counter and plan slug.
     * Never blocks: it's the caller's job to decide what to do when false.
     */
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
    private async getTenantPlan(tenantId: string): Promise<string> {
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
