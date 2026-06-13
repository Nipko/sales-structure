/**
 * Canonical schema for plan `features` (billing_plans.features JSONB).
 *
 * This is the single source of truth for which feature keys exist and their
 * types. It backs:
 *   - PUT /billing-admin/plans/:slug validation (reject typos / wrong types,
 *     which would otherwise silently create dead keys read as false/0).
 *   - GET /billing-admin/feature-registry (lets the dashboard editor render
 *     every key dynamically instead of a hardcoded subset that drifts).
 *   - Per-tenant quota-override validation (which numeric keys are tunable).
 *
 * Keep this in sync with prisma/seed-billing-plans.js. The seed is what
 * populates the rows; this registry is what guards edits to them.
 */

export type PlanFeatureType = 'boolean' | 'number' | 'string' | 'array' | 'object';

export interface PlanFeatureDef {
    key: string;
    type: PlanFeatureType;
    category: 'resource' | 'channel' | 'ai' | 'operational' | 'enterprise' | 'module' | 'rate' | 'media';
}

/** Inner numeric keys of features.rateLimits */
export const RATE_LIMIT_KEYS = ['automation', 'outbound', 'broadcast', 'priority', 'maxPendingJobs'] as const;

/** Inner numeric keys of features.mediaProcessing */
export const MEDIA_PROCESSING_KEYS = [
    'audioPerMonth', 'imagePerMonth', 'maxAudioDurationSec', 'perContactPerDay',
    'perConvPer5min', 'perTenantPerHour', 'dailyBudgetCentsUsd',
] as const;

/** Top-level feature keys (everything inside billing_plans.features). */
export const PLAN_FEATURE_REGISTRY: PlanFeatureDef[] = [
    // ── Resource limits ──
    { key: 'seats', type: 'number', category: 'resource' },
    { key: 'maxCalendars', type: 'number', category: 'resource' },
    { key: 'maxContacts', type: 'number', category: 'resource' },
    { key: 'maxProperties', type: 'number', category: 'resource' },
    { key: 'automationRules', type: 'number', category: 'resource' },
    { key: 'maxDripSequences', type: 'number', category: 'resource' },
    { key: 'broadcastCampaigns', type: 'number', category: 'resource' },
    { key: 'appointmentsServices', type: 'number', category: 'resource' },
    { key: 'knowledgeArticles', type: 'number', category: 'resource' },
    { key: 'knowledgeMaxCharsPerDoc', type: 'number', category: 'resource' },
    { key: 'knowledgeEmbeddingsPerMonth', type: 'number', category: 'resource' },
    { key: 'knowledgeCrawlPages', type: 'number', category: 'resource' },
    { key: 'knowledgeAnalytics', type: 'boolean', category: 'resource' },
    { key: 'customAttributes', type: 'number', category: 'resource' },
    { key: 'emailTemplates', type: 'number', category: 'resource' },
    { key: 'pipelineStages', type: 'number', category: 'resource' },
    { key: 'maxPipelines', type: 'number', category: 'resource' },
    { key: 'segments', type: 'number', category: 'resource' },
    { key: 'mediaStorageMb', type: 'number', category: 'resource' },
    { key: 'externalCrm', type: 'number', category: 'resource' },
    { key: 'outboundWebhooks', type: 'number', category: 'resource' },
    { key: 'maxWebhookSubscriptions', type: 'number', category: 'resource' },

    // ── Channel access ──
    { key: 'channels', type: 'array', category: 'channel' },

    // ── AI & engagement ──
    { key: 'llmTier', type: 'string', category: 'ai' },
    { key: 'llmCostBudgetUsdCents', type: 'number', category: 'ai' },
    { key: 'customPrompt', type: 'boolean', category: 'ai' },
    { key: 'customTemplates', type: 'boolean', category: 'ai' },
    { key: 'aiInsights', type: 'boolean', category: 'ai' },
    { key: 'recall', type: 'boolean', category: 'ai' },

    // ── Operational ──
    { key: 'scheduledReports', type: 'boolean', category: 'operational' },
    { key: 'dataRetentionDays', type: 'number', category: 'operational' },
    { key: 'whatsappCreditUsdCents', type: 'number', category: 'operational' },

    // ── Enterprise features ──
    { key: 'sso', type: 'boolean', category: 'enterprise' },
    { key: 'auditLog', type: 'boolean', category: 'enterprise' },
    { key: 'biApi', type: 'boolean', category: 'enterprise' },
    { key: 'customDomainKb', type: 'boolean', category: 'enterprise' },
    { key: 'whiteLabel', type: 'boolean', category: 'enterprise' },
    { key: 'prioritySupport', type: 'boolean', category: 'enterprise' },
    { key: 'salesLed', type: 'boolean', category: 'enterprise' },
    { key: 'multiTenantSubAccounts', type: 'boolean', category: 'enterprise' },
    { key: 'publicApi', type: 'boolean', category: 'enterprise' },
    { key: 'publicApiKeys', type: 'number', category: 'enterprise' },
    { key: 'publicApiRateLimit', type: 'number', category: 'enterprise' },

    // ── Module access ──
    { key: 'staffScheduling', type: 'boolean', category: 'module' },
    { key: 'vehicleInventory', type: 'boolean', category: 'module' },
    { key: 'ecommerce', type: 'boolean', category: 'module' },
    { key: 'channelManager', type: 'boolean', category: 'module' },
    { key: 'widget', type: 'boolean', category: 'module' },
    { key: 'httpRequestAction', type: 'boolean', category: 'module' },
    { key: 'abTestBroadcasts', type: 'boolean', category: 'module' },
    { key: 'widgetTriggers', type: 'number', category: 'module' },

    // ── Nested config objects ──
    { key: 'rateLimits', type: 'object', category: 'rate' },
    { key: 'mediaProcessing', type: 'object', category: 'media' },
];

const REGISTRY_BY_KEY = new Map(PLAN_FEATURE_REGISTRY.map(d => [d.key, d]));

/** Nested object keys that should be 1-level deep-merged (not replaced) on edit. */
export const NESTED_OBJECT_KEYS = ['rateLimits', 'mediaProcessing'] as const;

/**
 * Numeric feature/limit keys that can be tuned per-tenant via quota overrides.
 * Splits into flat feature-level keys (applied in applyOverrides) and the
 * nested rate-limit keys (applied in resolveLimits).
 */
export const RATE_LIMIT_OVERRIDE_KEYS = [...RATE_LIMIT_KEYS] as string[];

export const FEATURE_OVERRIDE_KEYS: string[] = [
    'maxAgents', 'maxAiMessages', // top-level BillingPlan columns merged into features
    'maxCalendars', 'maxContacts', 'maxProperties', 'appointmentsServices',
    'customAttributes', 'emailTemplates', 'pipelineStages', 'maxPipelines', 'segments',
    'mediaStorageMb', 'automationRules', 'maxDripSequences', 'broadcastCampaigns',
    'outboundWebhooks', 'maxWebhookSubscriptions', 'externalCrm', 'widgetTriggers',
    'knowledgeArticles', 'knowledgeMaxCharsPerDoc', 'knowledgeEmbeddingsPerMonth', 'knowledgeCrawlPages',
    'publicApiKeys', 'publicApiRateLimit', 'llmCostBudgetUsdCents',
];

/** All keys a quota-override payload may contain (besides metadata). */
export const OVERRIDABLE_QUOTA_KEYS: string[] = [...RATE_LIMIT_OVERRIDE_KEYS, ...FEATURE_OVERRIDE_KEYS];

const OVERRIDABLE_SET = new Set(OVERRIDABLE_QUOTA_KEYS);
export const isOverridableQuotaKey = (key: string): boolean => OVERRIDABLE_SET.has(key);

function typeMatches(def: PlanFeatureDef, value: any): boolean {
    switch (def.type) {
        case 'boolean': return typeof value === 'boolean';
        case 'number': return typeof value === 'number' && Number.isFinite(value);
        case 'string': return typeof value === 'string';
        case 'array': return Array.isArray(value);
        case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
        default: return false;
    }
}

export interface FeatureValidationResult {
    unknownKeys: string[];
    typeErrors: string[];
}

/**
 * Validate a (possibly partial) features payload against the registry.
 * Shallow on top-level keys; for rateLimits/mediaProcessing it also checks
 * that inner keys are known numeric values.
 */
export function validatePlanFeatures(features: Record<string, any> | undefined | null): FeatureValidationResult {
    const unknownKeys: string[] = [];
    const typeErrors: string[] = [];
    if (!features || typeof features !== 'object') return { unknownKeys, typeErrors };

    const RATE_SET = new Set<string>(RATE_LIMIT_KEYS as readonly string[]);
    const MEDIA_SET = new Set<string>(MEDIA_PROCESSING_KEYS as readonly string[]);

    for (const [key, value] of Object.entries(features)) {
        const def = REGISTRY_BY_KEY.get(key);
        if (!def) {
            unknownKeys.push(key);
            continue;
        }
        if (!typeMatches(def, value)) {
            typeErrors.push(`${key} expected ${def.type}`);
            continue;
        }
        if (key === 'rateLimits') {
            for (const [rk, rv] of Object.entries(value as Record<string, any>)) {
                if (!RATE_SET.has(rk)) unknownKeys.push(`rateLimits.${rk}`);
                else if (typeof rv !== 'number') typeErrors.push(`rateLimits.${rk} expected number`);
            }
        } else if (key === 'mediaProcessing') {
            for (const [mk, mv] of Object.entries(value as Record<string, any>)) {
                if (!MEDIA_SET.has(mk)) unknownKeys.push(`mediaProcessing.${mk}`);
                else if (typeof mv !== 'number') typeErrors.push(`mediaProcessing.${mk} expected number`);
            }
        }
    }
    return { unknownKeys, typeErrors };
}

/** Keys present in a stored features object that are NOT in the registry (dead keys / typos). */
export function unknownFeatureKeys(features: Record<string, any> | undefined | null): string[] {
    if (!features || typeof features !== 'object') return [];
    return Object.keys(features).filter(k => !REGISTRY_BY_KEY.has(k));
}
