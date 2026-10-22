import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { mutateTenantSettingsAtomic } from '../../common/utils/tenant-settings.util';

/**
 * Per-tenant feature flag service. Lets super_admin enable / disable
 * specific features for individual tenants without a deploy. Pattern is
 * close to LaunchDarkly's targeted rollout — useful for:
 *   - Beta-gating new verticals to specific customers
 *   - Killing a feature that's misbehaving for one tenant during an incident
 *   - Sales-driven enablement (e.g., a particular client paid for a flag)
 *
 * Source of truth: tenant.settings.featureFlags JSONB. Cached in Redis
 * for 5 min so check sites don't hit the DB on every request.
 */

const CACHE_PREFIX = 'feature_flags:';

/** Per-tenant flag of the health safety triage runtime. */
export const SAFETY_TRIAGE_FLAG = 'agentRuntime.safetyTriage';
const CACHE_TTL = 300;

/**
 * Registry of known flags. Adding a flag here makes it appear in the
 * super_admin UI. The default applies when the tenant has no explicit
 * setting — typically `false` for opt-in features and `true` for
 * killswitches (so toggling them off disables a feature).
 */
export const FEATURE_FLAGS_REGISTRY: Array<{
    key: string;
    label: string;
    description: string;
    category: 'beta' | 'killswitch' | 'experimental';
    default: boolean;
}> = [
    { key: 'experimentalAi',     label: 'Experimental AI routing',     description: 'Enables advanced model routing with cost-aware fallback', category: 'experimental', default: false },
    { key: 'betaTours',          label: 'Tours module (beta)',         description: 'Beta access to the turismo/tours vertical features',     category: 'beta',         default: false },
    { key: 'betaCompliance',     label: 'Compliance exports (beta)',   description: 'GDPR/LGPD data subject access exports',                  category: 'beta',         default: false },
    { key: 'killAutomations',    label: 'Disable automations',          description: 'Stop all automation rules from firing for this tenant',  category: 'killswitch',   default: false },
    { key: 'killBroadcasts',     label: 'Disable broadcasts',           description: 'Block all broadcast/campaign sending',                    category: 'killswitch',   default: false },
    { key: 'killHandoff',        label: 'Disable handoff escalation',   description: 'Skip the handoff trigger pipeline',                       category: 'killswitch',   default: false },
    { key: 'experimentalCopilot', label: 'AI Copilot suggestions',      description: 'Show AI-generated reply suggestions in the inbox',       category: 'experimental', default: false },
    // Health safety triage (packages/shared/src/safety-policy.ts). OFF by default and
    // must stay off until a clinician has reviewed the urgency templates
    // (SAFETY_TEMPLATE_REVIEW); turning it off again is the killswitch.
    { key: SAFETY_TRIAGE_FLAG, label: 'Health safety triage', description: 'Red-flag triage for health/pet businesses: urgency advice + priority human handoff (requires clinical review of templates)', category: 'experimental', default: false },
    { key: 'agentRuntime.slotWindow', label: 'Part-of-day availability window', description: 'The agent reads "mañana en la tarde" / "after 3 pm" as a time window and offers only slots inside it (or says the window is full and offers the nearest)', category: 'experimental', default: false },
];

/**
 * Pure resolution of one flag against a tenant's `settings.featureFlags`
 * record: explicit value wins, otherwise the registry default; unknown keys
 * are off. Shared by the cached service path and by readers that already hold
 * the tenant's settings (the Agent Test snapshot capture).
 */
export function resolveFeatureFlag(flags: unknown, flagKey: string): boolean {
    const definition = FEATURE_FLAGS_REGISTRY.find(f => f.key === flagKey);
    if (!definition) return false;
    if (flags && typeof flags === 'object' && Object.prototype.hasOwnProperty.call(flags, flagKey)) {
        return Boolean((flags as Record<string, unknown>)[flagKey]);
    }
    return definition.default;
}

/** Agent runtime flag: part-of-day / range availability window (PR8). Default off. */
export const SLOT_WINDOW_FLAG = 'agentRuntime.slotWindow';

@Injectable()
export class FeatureFlagsService {
    private readonly logger = new Logger(FeatureFlagsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {}

    async getFlags(tenantId: string): Promise<Record<string, boolean>> {
        const cached = await this.redis.getJson<Record<string, boolean>>(`${CACHE_PREFIX}${tenantId}`);
        if (cached) return cached;

        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { settings: true },
            });
            const settings = (tenant?.settings as any) || {};
            const flags = (settings.featureFlags || {}) as Record<string, boolean>;
            await this.redis.setJson(`${CACHE_PREFIX}${tenantId}`, flags, CACHE_TTL);
            return flags;
        } catch (e: any) {
            this.logger.warn(`Failed to load flags for ${tenantId}: ${e.message}`);
            return {};
        }
    }

    /**
     * Check whether a feature is enabled for a tenant. Falls back to the
     * registry default when the tenant has no explicit setting. Returns
     * false when the flag isn't in the registry — defensive.
     */
    async isFeatureEnabled(tenantId: string, flagKey: string): Promise<boolean> {
        if (!FEATURE_FLAGS_REGISTRY.some(f => f.key === flagKey)) return false;
        return resolveFeatureFlag(await this.getFlags(tenantId), flagKey);
    }

    /**
     * Set a single flag. Pass `undefined` to revert to the registry default.
     */
    async setFlag(tenantId: string, flagKey: string, value: boolean | undefined, setBy?: string): Promise<Record<string, boolean>> {
        const setAt = new Date().toISOString();
        const next = await mutateTenantSettingsAtomic(this.prisma, tenantId, current => {
            const flags = {
                ...((current.featureFlags && typeof current.featureFlags === 'object'
                    ? current.featureFlags
                    : {}) as Record<string, boolean>),
            };
            if (value === undefined) delete flags[flagKey];
            else flags[flagKey] = Boolean(value);
            return {
                ...current,
                featureFlags: flags,
                featureFlagsMeta: {
                    ...((current.featureFlagsMeta && typeof current.featureFlagsMeta === 'object'
                        ? current.featureFlagsMeta
                        : {}) as Record<string, unknown>),
                    [flagKey]: { setBy: setBy || 'super_admin', setAt },
                },
            };
        });
        const flags = next.featureFlags as Record<string, boolean>;
        // Invalidate cache
        await this.redis.del(`${CACHE_PREFIX}${tenantId}`);
        return flags;
    }

    /**
     * Replace the entire flag map for a tenant (used by the bulk PUT endpoint).
     */
    async setFlags(tenantId: string, flags: Record<string, boolean>, setBy?: string): Promise<Record<string, boolean>> {
        // Strip unknown keys defensively
        const known = new Set(FEATURE_FLAGS_REGISTRY.map(f => f.key));
        const sanitized: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(flags)) {
            if (known.has(k)) sanitized[k] = Boolean(v);
        }
        const setAt = new Date().toISOString();
        await mutateTenantSettingsAtomic(this.prisma, tenantId, current => ({
            ...current,
            featureFlags: sanitized,
            featureFlagsMeta: {
                ...((current.featureFlagsMeta && typeof current.featureFlagsMeta === 'object'
                    ? current.featureFlagsMeta
                    : {}) as Record<string, unknown>),
                __lastBulk: { setBy: setBy || 'super_admin', setAt },
            },
        }));
        await this.redis.del(`${CACHE_PREFIX}${tenantId}`);
        return sanitized;
    }
}
