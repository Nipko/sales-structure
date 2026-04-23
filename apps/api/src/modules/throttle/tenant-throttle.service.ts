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
 */

type ActionType = 'automation' | 'outbound' | 'broadcast';

interface PlanLimits {
    automation: number;   // max automation jobs per hour
    outbound: number;     // max outbound messages per hour
    broadcast: number;    // max broadcast messages per hour
    priority: number;     // BullMQ job priority (1=highest)
    maxPendingJobs: number; // max jobs queued per tenant
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
     * Check if a tenant has exceeded their rate limit for a given action.
     * Returns true if the action should be BLOCKED.
     */
    async isLimited(tenantId: string, action: ActionType): Promise<boolean> {
        const plan = await this.getTenantPlan(tenantId);
        const limits = PLAN_LIMITS[plan] || PLAN_LIMITS[DEFAULT_PLAN];
        const limit = limits[action];

        if (!limit) return false;

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
     * Get the BullMQ job priority for a tenant based on their plan.
     * Lower number = higher priority.
     */
    async getPriority(tenantId: string): Promise<number> {
        const plan = await this.getTenantPlan(tenantId);
        return (PLAN_LIMITS[plan] || PLAN_LIMITS[DEFAULT_PLAN]).priority;
    }

    /**
     * Get max pending jobs allowed for a tenant.
     */
    async getMaxPendingJobs(tenantId: string): Promise<number> {
        const plan = await this.getTenantPlan(tenantId);
        return (PLAN_LIMITS[plan] || PLAN_LIMITS[DEFAULT_PLAN]).maxPendingJobs;
    }

    /**
     * Get current usage count for a tenant + action in the current window.
     */
    async getUsage(tenantId: string, action: ActionType): Promise<{ current: number; limit: number; plan: string }> {
        const plan = await this.getTenantPlan(tenantId);
        const limits = PLAN_LIMITS[plan] || PLAN_LIMITS[DEFAULT_PLAN];
        const key = `throttle:${action}:${tenantId}:${Math.floor(Date.now() / (WINDOW_SECONDS * 1000))}`;
        const current = Number(await this.redis.get(key) || 0);
        return { current, limit: limits[action], plan };
    }

    /**
     * Get plan feature limits (max agents, templates, custom prompt)
     */
    async getPlanFeatures(tenantId: string): Promise<typeof PLAN_FEATURES[string]> {
        const plan = await this.getTenantPlan(tenantId);
        return PLAN_FEATURES[plan] || PLAN_FEATURES.starter;
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
