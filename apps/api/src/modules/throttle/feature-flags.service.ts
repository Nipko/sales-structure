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

/** Per-tenant flag of the shadow operation classifier (operations runtime PR4). */
export const OPERATION_CLASSIFIER_FLAG = 'agentRuntime.operationClassifier';

/** Per-tenant flag of the typed verified-facts ledger (operations runtime PR3). */
export const FACTS_LEDGER_FLAG = 'agentRuntime.factsLedger';

/** Per-tenant flags of the required reads (operations runtime PR5), one per pilot: restaurant and store. */
export const REQUIRED_READS_RESTAURANTS_FLAG = 'agentRuntime.requiredReads.restaurants';
export const REQUIRED_READS_CATALOG_FLAG = 'agentRuntime.requiredReads.catalog';
/** PR7: hotel / vacation rental and travel agency / tours. */
export const REQUIRED_READS_PROPERTIES_FLAG = 'agentRuntime.requiredReads.properties';
export const REQUIRED_READS_TOURS_FLAG = 'agentRuntime.requiredReads.tours';
/** Real estate (`inmobiliaria`): listing price, area, rooms and bathrooms, and what is on offer. */
export const REQUIRED_READS_LISTINGS_FLAG = 'agentRuntime.requiredReads.listings';
/** Per-tenant flag of the rendered facts (operations runtime PR6): amounts, counts and record fields come from tokens the server renders. */
export const RENDERED_FACTS_FLAG = 'agentRuntime.renderedFacts';
/** Per-tenant flag: the service catalogue decides what is offered, over a FAQ about a service it does not list (F4300-24). */
export const CATALOG_OVER_FAQ_FLAG = 'agentRuntime.catalogOverFaq';
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
    // Operations runtime PR4 (packages/shared/src/operation-catalogue.ts). SHADOW only:
    // classifies each turn into a catalogue operation and writes a trace step; it never
    // changes the reply, the tools or the routing. Costs one cheap `classify` call per turn.
    { key: OPERATION_CLASSIFIER_FLAG, label: 'Operation classifier (shadow)', description: 'Shadow-classifies each customer turn into a catalogue operation and traces its required reads (no behaviour change)', category: 'experimental', default: false },
    // Operations runtime PR3 (apps/api/src/modules/conversations/runtime/facts-ledger.ts): what the business's tools
    // returned stays a verified fact of the conversation for its TTL, bound to its subject (prompt <verified_facts>,
    // rule 22a, price guardrail). Off = the prompt and the guardrail are exactly the previous ones.
    { key: FACTS_LEDGER_FLAG, label: 'Verified facts ledger', description: 'Keeps prices, availability, record lists and attributes read by the agent as typed facts of the conversation (with subject and TTL), so a price confirmed in one turn stays confirmed in the next', category: 'experimental', default: false },
    // Operations runtime PR5 (apps/api/src/modules/conversations/runtime/required-reads.runner.ts): when the operation
    // classifier is confident (>= 0.8) the turn is one of the pilot operations, the reads that operation owes run BEFORE
    // the model (menu, my orders, order status) and reach it as tool results; a failed read is an admission, never "no
    // records". One flag per pilot vertical; off = the turn is exactly the previous one. Costs one `classify` call per turn.
    { key: REQUIRED_READS_RESTAURANTS_FLAG, label: 'Required reads: restaurants', description: 'Restaurants: menu, my orders and order-status questions run get_menu / list_my_orders / check_order_status before the reply', category: 'experimental', default: false },
    { key: REQUIRED_READS_CATALOG_FLAG, label: 'Required reads: store', description: 'Stores: my-orders questions run list_my_catalog_orders (complete list with total) before the reply; product price/stock stays on the projected catalogue', category: 'experimental', default: false },
    // Operations runtime PR7: the same runner for lodging and travel. Off = the turn is exactly the previous one.
    { key: REQUIRED_READS_PROPERTIES_FLAG, label: 'Required reads: hotel / vacation rental', description: 'Lodging: price, schedule, amenities and availability questions run list_properties / get_property_details (and check_property_availability when the message has stay dates) before the reply; without dates the nightly price is given as a "from" price', category: 'experimental', default: false },
    { key: REQUIRED_READS_TOURS_FLAG, label: 'Required reads: travel / tours', description: 'Travel: package price, inclusions and availability questions run search_packages / get_package_details / check_package_availability before the reply; an open question lists the existing packages', category: 'experimental', default: false },
    // The same runner for real estate. Off = the turn is exactly the previous one.
    { key: REQUIRED_READS_LISTINGS_FLAG, label: 'Required reads: real estate', description: 'Real estate: listing price, area, rooms, bathrooms and sale/rent questions run search_listings (with the operation, property kind and bedrooms the message states) and get_listing_details on the named or only listing before the reply; an open question lists the published listings', category: 'experimental', default: false },
    // Operations runtime PR6 (apps/api/src/modules/conversations/runtime/fact-renderer.ts): the model cites prices, counts,
    // availability and record fields as tokens (⟦fact:id⟧ / ⟦count:id⟧ / ⟦avail:id⟧) the server renders from the verified
    // facts; an amount or count the model typed itself is replaced by a template, and the claim/price corrective retries
    // are skipped. Off = the prompt and the reply pipeline are exactly the previous ones.
    { key: RENDERED_FACTS_FLAG, label: 'Rendered facts', description: 'Prices, counts, availability and record fields reach the customer as values rendered by the server from the verified facts (the model writes tokens); a figure the model typed itself is replaced by a safe template', category: 'experimental', default: false },
    // F4300-24 (apps/api/src/modules/conversations/runtime/catalog-over-faq.ts): for an agent that reads a service catalogue
    // (list_services), a FAQ or document naming a service the catalogue does not list is marked not_in_catalogue, the
    // contract says the catalogue decides what is offered (rule 20b), and a reply saying «sí, ofrecemos X» for such an X is
    // replaced by a not-offered answer that lists the catalogue. Off = the prompt and the reply pipeline are exactly the previous ones.
    { key: CATALOG_OVER_FAQ_FLAG, label: 'Catalogue over FAQ', description: 'The service catalogue decides what the business offers: a FAQ or document about a service the catalogue does not list is not presented as an offered service, and the agent answers that it is not among the services and offers the real ones', category: 'experimental', default: false },
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
