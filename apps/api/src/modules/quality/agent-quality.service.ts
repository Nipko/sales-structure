import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
    AgentQualityCheck,
    AgentQualityDimension,
    AgentQualityDimensionResult,
    AgentQualityOverview,
    AgentQualityPillarStatus,
    AgentQualityPreparationPillar,
    AgentQualityProductionIssue,
    AgentQualityProductionPillar,
    AgentQualityRecommendation,
    AgentQualitySeverity,
    AgentQualityTestedPillar,
    TenantConfig,
} from '@parallext/shared';
import { AGENT_QUALITY_DIMENSIONS } from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';

const PRODUCTION_DAYS = 30;
const MINIMUM_PRODUCTION_SAMPLE = 20;
const HEALTHY_VERIFIED_RESOLUTION_RATE = 70;
const CRITICAL_VERIFIED_RESOLUTION_RATE = 50;
const RECURRING_ISSUE_COUNT = 3;
const OPERATIONAL_CHANNELS = new Set(['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget']);
const DIMENSION_WEIGHTS: Record<AgentQualityDimension, number> = {
    business_scope: 15,
    knowledge_grounding: 20,
    conversation_brand: 15,
    actions_outcomes: 20,
    safety_handoff: 20,
    robustness_operations: 10,
};

type AgentRow = {
    id: string;
    name: string;
    is_active: boolean;
    config_json: TenantConfig;
    channels: string[] | null;
    channel_bindings: string[] | null;
    version: number | null;
    updated_at: Date | string;
};

type TenantContext = {
    settings: Record<string, any>;
    industry: string | null;
    updatedAt: Date | string | null;
    activeChannelTypes: Set<string>;
    activeAccountBindings: Set<string>;
    activeHumanCount: number;
};

type ReadinessFacts = {
    company: any | null;
    companyUpdatedAt: Date | string | null;
    knowledgeChunks: number;
    knowledgeUpdatedAt: Date | string | null;
    faqs: number;
    faqsUpdatedAt: Date | string | null;
    policies: number;
    policiesUpdatedAt: Date | string | null;
    services: number;
    availabilitySlots: number;
    products: number;
    orders: number;
    offers: number;
    verticalCatalogs: Record<string, number>;
};

type TestRows = { latestEval: any | null; latestSimulation: any | null };

type ProductionFacts = {
    available: boolean;
    attributedSince: Date | string | null;
    sampleSize: number;
    avgOverall: number | null;
    verifiedResolutionTotal: number;
    verifiedResolutionSuccess: number;
    conversationCount: number;
    handoffCount: number;
    flagRows: Array<{
        conversation_id: string;
        flags: unknown;
        overall_score?: number | string | null;
        resolution_verified?: boolean | null;
    }>;
    lowQualityConversationIds: string[];
    unverifiedConversationIds: string[];
    toolTotal: number;
    toolFailures: number;
    toolReconciliations: number;
    toolFailureConversationIds: string[];
    knowledgeGaps: number;
    knowledgeGapConversationIds: string[];
};

type CheckInput = Omit<AgentQualityCheck, 'evidence'> & {
    evidence?: AgentQualityCheck['evidence'];
};

@Injectable()
export class AgentQualityService {
    private readonly logger = new Logger(AgentQualityService.name);

    constructor(private readonly prisma: PrismaService) {}

    async listAgents(tenantId: string): Promise<Array<{ id: string; name: string; is_default: boolean; is_active: boolean }>> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) throw new NotFoundException('Tenant not found');
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, name, is_default, is_active
               FROM agent_personas
           ORDER BY is_default DESC, name ASC`,
            [],
        );
        return (rows || []).map((row) => ({
            id: String(row.id),
            name: String(row.name || ''),
            is_default: row.is_default === true,
            is_active: row.is_active === true,
        }));
    }

    async getOverview(tenantId: string, agentId: string): Promise<AgentQualityOverview> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) throw new NotFoundException('Tenant not found');

        const [agent, tenantContext] = await Promise.all([
            this.loadAgent(schemaName, agentId),
            this.loadTenantContext(tenantId),
        ]);
        if (!agent) throw new NotFoundException('Agent not found');

        const [facts, tests, production] = await Promise.all([
            this.loadReadinessFacts(schemaName),
            this.loadTestRows(schemaName, agentId),
            this.loadProductionFacts(schemaName, agentId, Number(agent.version) || 1),
        ]);

        const preparation = this.buildPreparation(agent, tenantContext, facts);
        const sourceUpdatedAt = this.latestDate([
            tenantContext.updatedAt,
            facts.companyUpdatedAt,
            facts.knowledgeUpdatedAt,
            facts.faqsUpdatedAt,
            facts.policiesUpdatedAt,
        ]);
        const tested = this.buildTestedPillar(agent, tests, sourceUpdatedAt);
        const productionPillar = this.buildProductionPillar(production);
        const recommendations = this.buildRecommendations(preparation, tested, productionPillar, production);
        const status = this.resolveStatus(preparation, tested, productionPillar, production);

        return {
            generatedAt: new Date().toISOString(),
            agent: {
                id: agent.id,
                name: agent.name,
                version: Number(agent.version) || 1,
                isActive: agent.is_active === true,
                updatedAt: this.iso(agent.updated_at),
            },
            status,
            nextMilestone: preparation.criticalBlockers.length > 0
                ? 'complete_configuration'
                : tested.status === 'unknown' || tested.status === 'blocked' || tested.status === 'stale'
                    ? 'pass_critical_tests'
                    : preparation.status !== 'ready'
                        ? 'complete_configuration'
                        : productionPillar.status === 'insufficient_evidence'
                            ? 'collect_production_evidence'
                            : 'maintain_quality',
            preparation,
            tested,
            production: productionPillar,
            recommendations,
        };
    }

    private async loadAgent(schemaName: string, agentId: string): Promise<AgentRow | null> {
        const rows = await this.prisma.executeInTenantSchema<AgentRow[]>(
            schemaName,
            `SELECT id, name, is_active, config_json, channels, channel_bindings, version, updated_at
               FROM agent_personas
              WHERE id = $1::uuid
              LIMIT 1`,
            [agentId],
        );
        return rows?.[0] || null;
    }

    private async loadTenantContext(tenantId: string): Promise<TenantContext> {
        const [tenant, channels, widgets, humans] = await Promise.all([
            this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { settings: true, industry: true, updatedAt: true },
            }),
            this.prisma.$queryRawUnsafe(
                `SELECT channel_type, account_id
                   FROM channel_accounts
                  WHERE tenant_id = $1::uuid AND is_active = true`,
                tenantId,
            ).catch(() => [] as any[]),
            this.prisma.$queryRawUnsafe(
                `SELECT 'web_widget' AS channel_type, widget_id AS account_id
                   FROM public.widget_configs
                  WHERE tenant_id = $1::uuid AND is_active = true`,
                tenantId,
            ).catch(() => [] as any[]),
            this.prisma.$queryRawUnsafe(
                `SELECT COUNT(*)::int AS count
                   FROM users
                  WHERE tenant_id = $1::uuid
                    AND is_active = true
                    AND role IN ('tenant_admin', 'tenant_supervisor', 'tenant_agent')`,
                tenantId,
            ).catch(() => [{ count: 0 }]),
        ]);
        const channelRows = [
            ...(Array.isArray(channels) ? channels as any[] : []),
            ...(Array.isArray(widgets) ? widgets as any[] : []),
        ];
        const humanRows = Array.isArray(humans) ? humans as any[] : [];
        return {
            settings: (tenant?.settings as Record<string, any>) || {},
            industry: tenant?.industry || null,
            updatedAt: tenant?.updatedAt || null,
            activeChannelTypes: new Set(channelRows.map((row) => String(row.channel_type))),
            activeAccountBindings: new Set(channelRows.map((row) => `${row.channel_type}:${row.account_id}`)),
            activeHumanCount: Number(humanRows[0]?.count) || 0,
        };
    }

    private async loadReadinessFacts(schemaName: string): Promise<ReadinessFacts> {
        const safe = <T>(query: string, params: any[] = [], fallback: T): Promise<T> =>
            this.prisma.executeInTenantSchema<T>(schemaName, query, params).catch((error: any) => {
                this.logger.debug(`[Agent quality] Optional readiness probe skipped: ${error?.message || error}`);
                return fallback;
            });

        const [companies, knowledge, faqRows, policyRows, appointmentRows, productRows, orderRows, offerRows, verticalRows] = await Promise.all([
            safe<any[]>(
                `SELECT name, industry, about, phone, email, website, address, city, country, updated_at
                   FROM companies
               ORDER BY is_primary DESC, updated_at DESC
                  LIMIT 1`, [], [],
            ),
            safe<any[]>(
                `SELECT COUNT(ke.id)::int AS count,
                        MAX(GREATEST(kd.updated_at, ke.created_at)) AS updated_at
                   FROM knowledge_embeddings ke
                   JOIN knowledge_documents kd ON kd.id = ke.document_id
                  WHERE kd.status = 'ready' AND btrim(ke.chunk_text) <> ''`, [], [{ count: 0, updated_at: null }],
            ),
            safe<any[]>(
                `SELECT COUNT(*)::int AS count, MAX(updated_at) AS updated_at
                   FROM faqs
                  WHERE is_published = true AND btrim(question) <> '' AND btrim(answer) <> ''`, [], [{ count: 0, updated_at: null }],
            ),
            safe<any[]>(
                `SELECT COUNT(*)::int AS count, MAX(updated_at) AS updated_at
                   FROM policies
                  WHERE is_active = true
                    AND (effective_from IS NULL OR effective_from <= NOW())
                    AND (effective_to IS NULL OR effective_to > NOW())
                    AND btrim(content) <> ''`, [], [{ count: 0, updated_at: null }],
            ),
            safe<any[]>(
                `SELECT
                    (SELECT COUNT(*)::int FROM services WHERE is_active = true AND btrim(name) <> '' AND duration_minutes > 0) AS services,
                    (SELECT COUNT(*)::int FROM availability_slots WHERE is_active = true AND start_time < end_time) AS slots`, [], [{ services: 0, slots: 0 }],
            ),
            safe<any[]>(`SELECT COUNT(*)::int AS count FROM products WHERE is_available = true AND btrim(name) <> ''`, [], [{ count: 0 }]),
            safe<any[]>(`SELECT COUNT(*)::int AS count FROM orders`, [], [{ count: 0 }]),
            safe<any[]>(`SELECT COUNT(*)::int AS count FROM commercial_offers WHERE active = true`, [], [{ count: 0 }]),
            safe<any[]>(
                `SELECT
                    (SELECT COUNT(*)::int FROM properties WHERE is_active = true) AS properties,
                    (SELECT COUNT(*)::int FROM tour_packages WHERE is_active = true) AS tours,
                    (SELECT COUNT(*)::int FROM services WHERE is_active = true) AS treatments,
                    (SELECT COUNT(*)::int FROM real_estate_listings WHERE is_active = true AND status = 'available') AS real_estate,
                    (SELECT COUNT(*)::int FROM services WHERE is_active = true) AS pets,
                    (SELECT COUNT(*)::int FROM menu_items WHERE is_active = true AND is_available = true) AS restaurants,
                    (SELECT COUNT(*)::int FROM membership_plans WHERE is_active = true) AS gyms,
                    (SELECT COUNT(*)::int FROM courses WHERE is_active = true) AS education,
                    (SELECT COUNT(*)::int FROM insurance_plans WHERE is_active = true) AS insurance,
                    (SELECT COUNT(*)::int FROM services WHERE is_active = true) AS home_services,
                    (SELECT COUNT(*)::int FROM services WHERE is_active = true) AS pet_services,
                    (SELECT COUNT(*)::int FROM services WHERE is_active = true) AS photography,
                    (SELECT COUNT(*)::int FROM services WHERE is_active = true) AS professional_services`, [], [{}],
            ),
        ]);

        const company = companies[0] || null;
        const vertical = verticalRows[0] || {};
        return {
            company,
            companyUpdatedAt: company?.updated_at || null,
            knowledgeChunks: Number(knowledge[0]?.count) || 0,
            knowledgeUpdatedAt: knowledge[0]?.updated_at || null,
            faqs: Number(faqRows[0]?.count) || 0,
            faqsUpdatedAt: faqRows[0]?.updated_at || null,
            policies: Number(policyRows[0]?.count) || 0,
            policiesUpdatedAt: policyRows[0]?.updated_at || null,
            services: Number(appointmentRows[0]?.services) || 0,
            availabilitySlots: Number(appointmentRows[0]?.slots) || 0,
            products: Number(productRows[0]?.count) || 0,
            orders: Number(orderRows[0]?.count) || 0,
            offers: Number(offerRows[0]?.count) || 0,
            verticalCatalogs: Object.fromEntries(Object.entries(vertical).map(([key, value]) => [key, Number(value) || 0])),
        };
    }

    private async loadTestRows(schemaName: string, agentId: string): Promise<TestRows> {
        const safe = <T>(query: string, fallback: T): Promise<T> =>
            this.prisma.executeInTenantSchema<T>(schemaName, query, [agentId]).catch(() => fallback);
        const [evalRows, simulationRows] = await Promise.all([
            safe<any[]>(
                `SELECT id, k, threshold, passed, avg_score, eval_activable, trigger, created_at
                   FROM eval_runs
                  WHERE agent_id = $1::uuid
               ORDER BY created_at DESC
                  LIMIT 1`, [],
            ),
            safe<any[]>(
                `SELECT id, persona_version, scenario_source, status, scenario_count, avg_score, resolved_rate, created_at, completed_at
                   FROM simulation_runs
                  WHERE agent_id = $1::uuid AND status = 'completed'
               ORDER BY completed_at DESC NULLS LAST, created_at DESC
                  LIMIT 1`, [],
            ),
        ]);
        return { latestEval: evalRows[0] || null, latestSimulation: simulationRows[0] || null };
    }

    private async loadProductionFacts(schemaName: string, agentId: string, agentVersion: number): Promise<ProductionFacts> {
        const unavailable: ProductionFacts = {
            available: false,
            attributedSince: null,
            sampleSize: 0,
            avgOverall: null,
            verifiedResolutionTotal: 0,
            verifiedResolutionSuccess: 0,
            conversationCount: 0,
            handoffCount: 0,
            flagRows: [],
            lowQualityConversationIds: [],
            unverifiedConversationIds: [],
            toolTotal: 0,
            toolFailures: 0,
            toolReconciliations: 0,
            toolFailureConversationIds: [],
            knowledgeGaps: 0,
            knowledgeGapConversationIds: [],
        };

        const hasColumns = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT
                EXISTS (
                    SELECT 1 FROM information_schema.columns
                     WHERE table_schema = current_schema()
                       AND table_name = 'conversation_quality_scores'
                       AND column_name = 'agent_id'
                ) AS quality_agent,
                EXISTS (
                    SELECT 1 FROM information_schema.columns
                     WHERE table_schema = current_schema()
                       AND table_name = 'conversations'
                       AND column_name = 'agent_persona_id'
                ) AS conversation_agent,
                EXISTS (
                    SELECT 1 FROM information_schema.columns
                     WHERE table_schema = current_schema()
                       AND table_name = 'conversations'
                       AND column_name = 'agent_attribution_conflicted'
                ) AS conversation_conflict`,
            [],
        ).catch(() => []);
        if (!hasColumns[0]?.quality_agent || !hasColumns[0]?.conversation_agent
            || !hasColumns[0]?.conversation_conflict) return unavailable;

        try {
            const [qualityRows, conversationRows, issueRows, toolRows, gaps] = await Promise.all([
                this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `WITH latest_quality AS (
                        SELECT DISTINCT ON (cqs.conversation_id)
                               cqs.conversation_id, cqs.overall_score, cqs.resolution_type,
                               cqs.resolution_verified, cqs.created_at
                          FROM conversation_quality_scores cqs
                          JOIN conversations c ON c.id = cqs.conversation_id
                         WHERE cqs.agent_id = $1::uuid
                           AND cqs.agent_config_version = $2
                           AND COALESCE(c.agent_attribution_conflicted, false) = false
                           AND COALESCE(c.was_handed_off, false) = false
                           AND cqs.created_at >= NOW() - INTERVAL '30 days'
                      ORDER BY cqs.conversation_id, cqs.created_at DESC
                    )
                    SELECT COUNT(*) FILTER (WHERE resolution_type = 'ai_resolved')::int AS sample_size,
                            AVG(overall_score) FILTER (WHERE resolution_type = 'ai_resolved') AS avg_overall,
                            COUNT(*) FILTER (WHERE resolution_type = 'ai_resolved')::int AS verified_total,
                            COUNT(*) FILTER (WHERE resolution_type = 'ai_resolved' AND resolution_verified = true)::int AS verified_success,
                            MIN(created_at) AS attributed_since
                       FROM latest_quality`,
                    [agentId, agentVersion],
                ),
                this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `SELECT COUNT(*)::int AS conversations,
                            COUNT(*) FILTER (WHERE COALESCE(was_handed_off, false) = true)::int AS handoffs,
                            MIN(created_at) AS attributed_since
                       FROM conversations
                      WHERE agent_persona_id = $1::uuid
                        AND agent_config_version = $2
                        AND COALESCE(agent_attribution_conflicted, false) = false
                        AND created_at >= NOW() - INTERVAL '30 days'`,
                    [agentId, agentVersion],
                ),
                this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `WITH latest_quality AS (
                        SELECT DISTINCT ON (cqs.conversation_id)
                               cqs.conversation_id, cqs.flags, cqs.overall_score,
                               cqs.resolution_type, cqs.resolution_verified, cqs.created_at
                          FROM conversation_quality_scores cqs
                          JOIN conversations c ON c.id = cqs.conversation_id
                         WHERE cqs.agent_id = $1::uuid
                           AND cqs.agent_config_version = $2
                           AND COALESCE(c.agent_attribution_conflicted, false) = false
                           AND COALESCE(c.was_handed_off, false) = false
                           AND cqs.created_at >= NOW() - INTERVAL '30 days'
                      ORDER BY cqs.conversation_id, cqs.created_at DESC
                    )
                    SELECT conversation_id, flags, overall_score, resolution_verified
                       FROM latest_quality
                      WHERE resolution_type = 'ai_resolved'
                        AND (
                            (jsonb_typeof(flags) = 'array' AND jsonb_array_length(flags) > 0)
                            OR overall_score < 6
                            OR resolution_verified = false
                        )
                   ORDER BY created_at DESC
                      LIMIT 200`,
                    [agentId, agentVersion],
                ),
                this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `SELECT COUNT(*)::int AS total,
                            COUNT(*) FILTER (WHERE tel.status IN ('failed', 'reconciliation_required'))::int AS failures,
                            COUNT(*) FILTER (WHERE tel.status = 'reconciliation_required')::int AS reconciliations,
                            COALESCE(
                                array_agg(DISTINCT tel.conversation_id::text)
                                    FILTER (WHERE tel.status IN ('failed', 'reconciliation_required')
                                            AND tel.conversation_id IS NOT NULL),
                                ARRAY[]::text[]
                            ) AS conversation_ids
                       FROM tool_execution_ledger tel
                       JOIN conversations c ON c.id = tel.conversation_id
                      WHERE c.agent_persona_id = $1::uuid
                        AND c.agent_config_version = $2
                        AND COALESCE(c.agent_attribution_conflicted, false) = false
                        AND COALESCE(c.was_handed_off, false) = false
                        AND tel.created_at >= NOW() - INTERVAL '30 days'`,
                    [agentId, agentVersion],
                ).catch(() => [{ total: 0, failures: 0, reconciliations: 0, conversation_ids: [] }]),
                this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `WITH matching AS (
                        SELECT krl.conversation_id, krl.created_at
                          FROM kb_retrieval_log krl
                          JOIN conversations c ON c.id = krl.conversation_id
                         WHERE c.agent_persona_id = $1::uuid
                           AND c.agent_config_version = $2
                           AND COALESCE(c.agent_attribution_conflicted, false) = false
                           AND COALESCE(c.was_handed_off, false) = false
                           AND krl.document_id IS NULL
                           AND krl.was_used = false
                           AND krl.created_at >= NOW() - INTERVAL '30 days'
                    )
                    SELECT (SELECT COUNT(*)::int FROM matching) AS count,
                           COALESCE((
                               SELECT array_agg(recent.conversation_id::text)
                                 FROM (
                                     SELECT conversation_id
                                       FROM matching
                                   GROUP BY conversation_id
                                   ORDER BY MAX(created_at) DESC
                                      LIMIT 20
                                 ) recent
                           ), ARRAY[]::text[]) AS conversation_ids`,
                    [agentId, agentVersion],
                ).catch(() => [{ count: 0, conversation_ids: [] }]),
            ]);

            const q = qualityRows[0] || {};
            const c = conversationRows[0] || {};
            const t = toolRows[0] || {};
            const observedRows = issueRows || [];
            return {
                available: true,
                attributedSince: q.attributed_since || c.attributed_since || null,
                sampleSize: Number(q.sample_size) || 0,
                avgOverall: q.avg_overall == null ? null : this.round(Number(q.avg_overall), 2),
                verifiedResolutionTotal: Number(q.verified_total) || 0,
                verifiedResolutionSuccess: Number(q.verified_success) || 0,
                conversationCount: Number(c.conversations) || 0,
                handoffCount: Number(c.handoffs) || 0,
                flagRows: observedRows,
                lowQualityConversationIds: observedRows
                    .filter((row) => row.overall_score != null && Number(row.overall_score) < 6)
                    .map((row) => String(row.conversation_id)).slice(0, 20),
                unverifiedConversationIds: observedRows
                    .filter((row) => row.resolution_verified === false)
                    .map((row) => String(row.conversation_id)).slice(0, 20),
                toolTotal: Number(t.total) || 0,
                toolFailures: Number(t.failures) || 0,
                toolReconciliations: Number(t.reconciliations) || 0,
                toolFailureConversationIds: Array.isArray(t.conversation_ids) ? t.conversation_ids.slice(0, 20) : [],
                knowledgeGaps: Number(gaps[0]?.count) || 0,
                knowledgeGapConversationIds: Array.isArray(gaps[0]?.conversation_ids) ? gaps[0].conversation_ids.slice(0, 20) : [],
            };
        } catch (error: any) {
            this.logger.warn(`[Agent quality] Production evidence unavailable during rollout: ${error?.message || error}`);
            return unavailable;
        }
    }

    private buildPreparation(agent: AgentRow, tenant: TenantContext, facts: ReadinessFacts): AgentQualityPreparationPillar {
        const config = (agent.config_json || {}) as TenantConfig;
        const persona: any = config.persona || {};
        const behavior: any = config.behavior || {};
        const hours: any = tenant.settings.businessHours || config.hours || {};
        const tools = (config.tools || {}) as Record<string, any>;
        const channels = Array.isArray(agent.channels) ? agent.channels : [];
        const bindings = Array.isArray(agent.channel_bindings) ? agent.channel_bindings : [];
        const operationalChannels = channels.filter((channel) => OPERATIONAL_CHANNELS.has(channel));
        const operationalBindings = bindings.filter((binding) => OPERATIONAL_CHANNELS.has(binding.split(':', 1)[0]));
        const assignedCount = operationalChannels.length + operationalBindings.length;
        const unsupportedCount = channels.length + bindings.length - assignedCount;
        const connectedAssignments = operationalChannels.filter((channel) => tenant.activeChannelTypes.has(channel)).length
            + operationalBindings.filter((binding) => tenant.activeAccountBindings.has(binding)).length;

        const checks: AgentQualityCheck[] = [];
        const add = (check: CheckInput) => checks.push(check);
        const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
        const list = (value: unknown) => Array.isArray(value) && value.some((item) => text(item));
        const status = (ok: boolean, missing: 'warning' | 'fail' = 'fail') => ok ? 'pass' as const : missing;

        add({ code: 'agent_active', dimension: 'business_scope', status: status(agent.is_active), critical: true, weight: 4, href: `/admin/agent/${agent.id}`, evidence: { active: agent.is_active } });
        const promptMode = (config as any).editorMode === 'prompt' || (config as any)._mode === 'prompt';
        const customPrompt = (config as any).customPrompt ?? (config as any)._customPrompt;
        add({ code: 'persona_identity', dimension: 'business_scope', status: promptMode ? 'not_applicable' : status(text(persona.name) && text(persona.role)), critical: !promptMode, weight: 4, href: `/admin/agent/${agent.id}`, evidence: { hasName: text(persona.name), hasRole: text(persona.role) } });
        add({ code: 'business_identity', dimension: 'business_scope', status: status(!!facts.company && text(facts.company.name) && text(facts.company.about)), critical: true, weight: 4, href: '/admin/settings/business-info', evidence: { configured: !!facts.company, hasAbout: text(facts.company?.about) } });
        const businessContactMethods = [facts.company?.phone, facts.company?.email, facts.company?.website, facts.company?.address].filter(text).length;
        add({ code: 'business_contact', dimension: 'business_scope', status: status(businessContactMethods > 0, 'warning'), critical: false, weight: 2, href: '/admin/settings/business-info', evidence: { contactMethods: businessContactMethods } });
        const goals = tenant.settings.chatReasons;
        const audiences = tenant.settings.customerTypes;
        add({ code: 'business_context', dimension: 'business_scope', status: status(list(goals) && list(audiences), 'warning'), critical: false, weight: 2, href: '/admin/settings/business-info', evidence: { goals: Array.isArray(goals) ? goals.length : 0, audiences: Array.isArray(audiences) ? audiences.length : 0 } });

        add({ code: 'agent_language', dimension: 'conversation_brand', status: status(text(config.language), 'warning'), critical: false, weight: 2, href: `/admin/agent/${agent.id}`, evidence: { configured: text(config.language) } });
        add({ code: 'brand_voice', dimension: 'conversation_brand', status: promptMode ? 'not_applicable' : status(text(persona.personality?.tone) && text(persona.personality?.formality), 'warning'), critical: false, weight: 3, href: `/admin/agent/${agent.id}`, evidence: { hasTone: text(persona.personality?.tone), hasFormality: text(persona.personality?.formality) } });
        add({ code: 'greeting', dimension: 'conversation_brand', status: promptMode ? 'not_applicable' : status(text(persona.greeting), 'warning'), critical: false, weight: 2, href: `/admin/agent/${agent.id}`, evidence: { configured: text(persona.greeting) } });
        add({ code: 'fallback_message', dimension: 'conversation_brand', status: promptMode ? 'not_applicable' : status(text(persona.fallbackMessage)), critical: !promptMode, weight: 3, href: `/admin/agent/${agent.id}`, evidence: { configured: text(persona.fallbackMessage) } });
        add({ code: 'behavior_rules', dimension: 'conversation_brand', status: promptMode ? 'not_applicable' : status(list(behavior.rules)), critical: !promptMode, weight: 3, href: `/admin/agent/${agent.id}`, evidence: { count: Array.isArray(behavior.rules) ? behavior.rules.length : 0 } });
        add({ code: 'custom_prompt', dimension: 'conversation_brand', status: promptMode ? status(text(customPrompt)) : 'not_applicable', critical: promptMode, weight: 4, href: `/admin/agent/${agent.id}`, evidence: { promptMode, configured: text(customPrompt) } });

        const knowledgeRequired = config.rag?.enabled === true || tools.knowledge?.enabled === true;
        const availableKnowledgeSources = facts.knowledgeChunks + facts.faqs + facts.policies + facts.products
            + facts.services + Object.values(facts.verticalCatalogs).reduce((sum, count) => sum + count, 0);
        add({ code: 'knowledge_coverage', dimension: 'knowledge_grounding', status: availableKnowledgeSources > 0 ? 'pass' : 'warning', critical: false, weight: 4, href: '/admin/knowledge', evidence: { availableSources: availableKnowledgeSources } });
        add({ code: 'rag_knowledge', dimension: 'knowledge_grounding', status: knowledgeRequired ? status(facts.knowledgeChunks > 0) : 'not_applicable', critical: knowledgeRequired, weight: 6, href: '/admin/knowledge', evidence: { enabled: knowledgeRequired, chunks: facts.knowledgeChunks } });
        const ragValid = Number(config.rag?.chunkSize) > 0
            && Number(config.rag?.topK) > 0
            && Number(config.rag?.similarityThreshold) >= 0
            && Number(config.rag?.similarityThreshold) <= 1;
        add({ code: 'rag_configuration', dimension: 'knowledge_grounding', status: knowledgeRequired ? status(ragValid) : 'not_applicable', critical: knowledgeRequired, weight: 3, href: `/admin/agent/${agent.id}`, evidence: { enabled: knowledgeRequired, valid: ragValid } });
        add({ code: 'tool_faqs', dimension: 'knowledge_grounding', status: this.optionalToolStatus(tools.faqs, facts.faqs > 0), critical: tools.faqs?.enabled === true, weight: 3, href: '/admin/knowledge/faqs', evidence: { enabled: tools.faqs?.enabled === true, published: facts.faqs } });
        add({ code: 'tool_policies', dimension: 'knowledge_grounding', status: this.optionalToolStatus(tools.policies, facts.policies > 0), critical: tools.policies?.enabled === true, weight: 3, href: '/admin/settings/policies', evidence: { enabled: tools.policies?.enabled === true, active: facts.policies } });

        add({ code: 'channel_assignment', dimension: 'actions_outcomes', status: status(assignedCount > 0), critical: true, weight: 5, href: `/admin/agent/${agent.id}`, evidence: { assigned: assignedCount } });
        add({ code: 'operational_channel_scope', dimension: 'actions_outcomes', status: unsupportedCount > 0 ? 'fail' : 'pass', critical: true, weight: 3, href: `/admin/agent/${agent.id}`, evidence: { unsupportedAssignments: unsupportedCount } });
        add({ code: 'channel_connection', dimension: 'actions_outcomes', status: assignedCount > 0 ? status(connectedAssignments === assignedCount) : 'fail', critical: true, weight: 5, href: '/admin/channels', evidence: { assigned: assignedCount, connected: connectedAssignments } });
        add({ code: 'tool_appointments', dimension: 'actions_outcomes', status: this.optionalToolStatus(tools.appointments, facts.services > 0 && facts.availabilitySlots > 0), critical: tools.appointments?.enabled === true, weight: 5, href: '/admin/appointments', evidence: { enabled: tools.appointments?.enabled === true, services: facts.services, availabilitySlots: facts.availabilitySlots } });
        add({ code: 'tool_catalog', dimension: 'actions_outcomes', status: this.optionalToolStatus(tools.catalog, facts.products > 0), critical: tools.catalog?.enabled === true, weight: 4, href: '/admin/inventory', evidence: { enabled: tools.catalog?.enabled === true, products: facts.products } });
        add({ code: 'tool_ecommerce', dimension: 'actions_outcomes', status: this.optionalToolStatus(tools.ecommerce, facts.products > 0), critical: tools.ecommerce?.enabled === true, weight: 4, href: '/admin/inventory', evidence: { enabled: tools.ecommerce?.enabled === true, products: facts.products } });
        add({ code: 'tool_orders', dimension: 'actions_outcomes', status: tools.orders?.enabled === true ? 'pass' : 'not_applicable', critical: false, weight: 2, href: '/admin/orders', evidence: { enabled: tools.orders?.enabled === true, existingOrders: facts.orders } });
        add({ code: 'tool_offers', dimension: 'actions_outcomes', status: this.optionalToolStatus(tools.offers, facts.offers > 0), critical: false, weight: 2, href: '/admin/catalog/offers', evidence: { enabled: tools.offers?.enabled === true, activeOffers: facts.offers } });
        add({ code: 'tool_crm', dimension: 'actions_outcomes', status: tools.crm?.enabled === true ? 'pass' : 'not_applicable', critical: false, weight: 2, href: '/admin/contacts', evidence: { enabled: tools.crm?.enabled === true } });

        const verticalRoutes: Record<string, string> = {
            properties: '/admin/properties', tours: '/admin/tours', treatments: '/admin/treatment-plans', realEstate: '/admin/listings',
            pets: '/admin/pets', restaurants: '/admin/menu', gyms: '/admin/memberships', education: '/admin/courses',
            insurance: '/admin/insurance', homeServices: '/admin/service-requests', petServices: '/admin/appointments',
            photography: '/admin/appointments', professionalServices: '/admin/appointments',
        };
        const verticalFactKeys: Record<string, string> = {
            realEstate: 'real_estate', homeServices: 'home_services', petServices: 'pet_services', professionalServices: 'professional_services',
        };
        for (const tool of Object.keys(verticalRoutes)) {
            const factKey = verticalFactKeys[tool] || tool;
            add({
                code: `tool_${this.snake(tool)}`,
                dimension: 'actions_outcomes',
                status: this.optionalToolStatus(tools[tool], (facts.verticalCatalogs[factKey] || 0) > 0),
                critical: tools[tool]?.enabled === true,
                weight: 4,
                href: verticalRoutes[tool],
                evidence: { enabled: tools[tool]?.enabled === true, records: facts.verticalCatalogs[factKey] || 0 },
            });
        }

        add({ code: 'forbidden_topics', dimension: 'safety_handoff', status: promptMode ? 'not_applicable' : status(list(behavior.forbiddenTopics), 'warning'), critical: false, weight: 4, href: `/admin/agent/${agent.id}`, evidence: { count: Array.isArray(behavior.forbiddenTopics) ? behavior.forbiddenTopics.length : 0 } });
        add({ code: 'handoff_triggers', dimension: 'safety_handoff', status: status(list(behavior.handoffTriggers)), critical: true, weight: 5, href: `/admin/agent/${agent.id}`, evidence: { count: Array.isArray(behavior.handoffTriggers) ? behavior.handoffTriggers.length : 0 } });
        add({ code: 'human_handoff_route', dimension: 'safety_handoff', status: list(behavior.handoffTriggers) ? status(tenant.activeHumanCount > 0) : 'unknown', critical: true, weight: 5, href: '/admin/users', evidence: { activeHumans: tenant.activeHumanCount } });

        const hasHours = hours.is247 === true || (hours.schedule && Object.keys(hours.schedule).length > 0)
            || (config.hours?.schedule && Object.keys(config.hours.schedule).length > 0);
        add({ code: 'business_hours', dimension: 'robustness_operations', status: status(!!hasHours, 'warning'), critical: false, weight: 4, href: '/admin/settings/business-hours', evidence: { configured: !!hasHours } });
        const is247 = hours.is247 === true;
        const hasAfterHoursBehavior = is247 || hours.aiOutsideHours === true || config.hours?.aiOutsideHours === true
            || text(hours.afterHoursMessage) || text(config.hours?.afterHoursMessage);
        add({ code: 'after_hours_behavior', dimension: 'robustness_operations', status: hasHours && !is247 ? status(hasAfterHoursBehavior, 'warning') : 'not_applicable', critical: false, weight: 2, href: '/admin/settings/business-hours', evidence: { required: !!hasHours && !is247, configured: hasAfterHoursBehavior } });
        add({ code: 'llm_limits', dimension: 'robustness_operations', status: status(Number(config.llm?.maxTokens) > 0 && Number(config.llm?.temperature) >= 0, 'warning'), critical: false, weight: 2, href: `/admin/agent/${agent.id}`, evidence: { maxTokens: Number(config.llm?.maxTokens) || 0 } });

        const dimensions = AGENT_QUALITY_DIMENSIONS.map((dimension) => this.scoreDimension(dimension, checks));
        const applicableChecks = checks.filter((check) => check.status !== 'not_applicable');
        const criticalBlockers = applicableChecks.filter((check) => check.critical && (check.status === 'fail' || check.status === 'unknown')).map((check) => check.code);
        const score = this.weightedDimensionScore(dimensions);
        const hasFailure = applicableChecks.some((check) => check.status === 'fail' || check.status === 'unknown');
        const hasWarning = applicableChecks.some((check) => check.status === 'warning');
        return {
            status: criticalBlockers.length ? 'blocked' : hasFailure || hasWarning ? 'needs_attention' : 'ready',
            score,
            passed: applicableChecks.filter((check) => check.status === 'pass').length,
            applicable: applicableChecks.length,
            criticalBlockers,
            dimensions,
        };
    }

    private buildTestedPillar(agent: AgentRow, rows: TestRows, sourceUpdatedAt: Date | null): AgentQualityTestedPillar {
        const evalRow = rows.latestEval;
        const simRow = rows.latestSimulation;
        const staleReasons: string[] = [];
        const evalDate = evalRow?.created_at ? new Date(evalRow.created_at) : null;
        const simDate = simRow?.completed_at ? new Date(simRow.completed_at) : simRow?.created_at ? new Date(simRow.created_at) : null;
        const agentUpdated = new Date(agent.updated_at);
        // eval_runs currently has no config version/hash, so eval freshness is
        // necessarily date-based. Simulations additionally carry persona_version.
        if (evalDate && evalDate < agentUpdated) staleReasons.push('agent_configuration_changed_after_eval');
        if (evalDate && sourceUpdatedAt && evalDate < sourceUpdatedAt) staleReasons.push('business_or_knowledge_changed_after_eval');
        if (simDate && simDate < agentUpdated) staleReasons.push('agent_configuration_changed_after_simulation');
        if (simRow?.persona_version != null && Number(simRow.persona_version) !== (Number(agent.version) || 1)) {
            staleReasons.push('simulation_persona_version_mismatch');
        }
        if (simDate && sourceUpdatedAt && simDate < sourceUpdatedAt) staleReasons.push('business_or_knowledge_changed_after_simulation');
        const stale = staleReasons.length > 0;
        const evalScore = evalRow?.avg_score == null ? null : Number(evalRow.avg_score);
        const simScore = simRow?.avg_score == null ? null : Number(simRow.avg_score);
        const score = evalScore != null ? this.round(evalScore * 10, 2) : simScore != null ? this.round(simScore * 10, 2) : null;
        let status: AgentQualityPillarStatus;
        if (!evalRow) status = 'unknown';
        else if (stale) status = 'stale';
        else if (evalRow.passed !== true || evalRow.eval_activable !== true) status = 'blocked';
        else status = 'evidenced';
        return {
            status,
            score,
            stale,
            staleReasons: Array.from(new Set(staleReasons)),
            latestEval: evalRow ? {
                runId: String(evalRow.id),
                createdAt: this.iso(evalRow.created_at),
                trigger: evalRow.trigger || null,
                passed: evalRow.passed === true,
                score: Number(evalRow.avg_score) || 0,
                threshold: Number(evalRow.threshold) || 0,
                trials: Number(evalRow.k) || 1,
                activable: evalRow.eval_activable === true,
            } : null,
            latestSimulation: simRow ? {
                runId: String(simRow.id),
                createdAt: this.iso(simRow.created_at),
                completedAt: simRow.completed_at ? this.iso(simRow.completed_at) : null,
                scenarioCount: Number(simRow.scenario_count) || 0,
                averageScore: Number(simRow.avg_score) || 0,
                resolvedRate: Number(simRow.resolved_rate) || 0,
                source: simRow.scenario_source || 'synthetic',
            } : null,
        };
    }

    private buildProductionPillar(facts: ProductionFacts): AgentQualityProductionPillar {
        const issues = this.aggregateFlags(facts.flagRows);
        if (facts.toolFailures > 0) {
            issues.push({ code: 'tool_failures', label: 'tool_failures', count: facts.toolFailures, conversationIds: facts.toolFailureConversationIds.slice(0, 10) });
        }
        const enoughEvidence = facts.available && facts.sampleSize >= MINIMUM_PRODUCTION_SAMPLE;
        const verifiedRate = this.percent(facts.verifiedResolutionSuccess, facts.verifiedResolutionTotal);
        const verifiedResolutionWeak = facts.verifiedResolutionTotal >= MINIMUM_PRODUCTION_SAMPLE
            && verifiedRate != null
            && verifiedRate < HEALTHY_VERIFIED_RESOLUTION_RATE;
        const recurringQualityIssue = issues.some((issue) => issue.code !== 'tool_failures'
            && issue.count >= RECURRING_ISSUE_COUNT);
        const recurringKnowledgeGap = facts.knowledgeGaps >= RECURRING_ISSUE_COUNT;
        const needsAttention = (facts.avgOverall ?? 0) < 6
            || this.hasMaterialToolFailure(facts)
            || verifiedResolutionWeak
            || recurringQualityIssue
            || recurringKnowledgeGap;
        return {
            status: !facts.available || facts.sampleSize < MINIMUM_PRODUCTION_SAMPLE ? 'insufficient_evidence'
                : needsAttention ? 'needs_attention' : 'evidenced',
            observedScore: enoughEvidence && facts.avgOverall != null ? this.round(facts.avgOverall * 10, 2) : null,
            sampleSize: facts.sampleSize,
            minimumSample: MINIMUM_PRODUCTION_SAMPLE,
            periodDays: PRODUCTION_DAYS,
            attributedSince: facts.attributedSince ? this.iso(facts.attributedSince) : null,
            metrics: [
                { code: 'quality_overall', value: facts.avgOverall, numerator: facts.sampleSize, denominator: facts.sampleSize, unit: 'score_10' },
                { code: 'verified_resolution_rate', value: verifiedRate, numerator: facts.verifiedResolutionSuccess, denominator: facts.verifiedResolutionTotal, unit: 'percent' },
                { code: 'handoff_rate', value: this.percent(facts.handoffCount, facts.conversationCount), numerator: facts.handoffCount, denominator: facts.conversationCount, unit: 'percent' },
                { code: 'tool_failure_rate', value: this.percent(facts.toolFailures, facts.toolTotal), numerator: facts.toolFailures, denominator: facts.toolTotal, unit: 'percent' },
                { code: 'open_knowledge_gaps', value: facts.knowledgeGaps, numerator: facts.knowledgeGaps, unit: 'count' },
            ],
            topIssues: issues.sort((a, b) => b.count - a.count).slice(0, 10),
        };
    }

    private buildRecommendations(
        preparation: AgentQualityPreparationPillar,
        tested: AgentQualityTestedPillar,
        production: AgentQualityProductionPillar,
        productionFacts: ProductionFacts,
    ): AgentQualityRecommendation[] {
        const recommendations: AgentQualityRecommendation[] = [];
        for (const dimension of preparation.dimensions) {
            for (const check of dimension.checks) {
                if (check.status !== 'fail' && check.status !== 'warning' && check.status !== 'unknown') continue;
                recommendations.push({
                    code: `fix_${check.code}`,
                    pillar: 'preparation',
                    dimension: check.dimension,
                    severity: check.critical ? 'critical' : check.status === 'fail' || check.status === 'unknown' ? 'high' : 'medium',
                    href: check.href || '/admin/agent',
                    params: check.evidence,
                });
            }
        }

        if (!tested.latestEval) {
            recommendations.push({ code: 'run_eval', pillar: 'tested', dimension: 'robustness_operations', severity: 'high', href: '/admin/agent/simulation' });
        } else if (tested.stale) {
            recommendations.push({ code: 'refresh_eval', pillar: 'tested', dimension: 'robustness_operations', severity: 'high', href: '/admin/agent/simulation', params: { staleReasons: tested.staleReasons.join(',') } });
        } else if (!tested.latestEval.passed || !tested.latestEval.activable) {
            recommendations.push({ code: 'fix_failed_eval', pillar: 'tested', dimension: 'robustness_operations', severity: 'high', href: '/admin/agent/simulation', params: { score: tested.latestEval.score, threshold: tested.latestEval.threshold } });
        }
        if (!tested.latestSimulation || tested.stale) {
            recommendations.push({ code: 'run_simulation', pillar: 'tested', dimension: 'robustness_operations', severity: 'medium', href: '/admin/agent/simulation' });
        }

        if (production.status === 'insufficient_evidence') {
            recommendations.push({
                code: 'collect_production_evidence', pillar: 'production', dimension: 'robustness_operations', severity: 'medium', href: '/admin/inbox',
                evidenceCount: production.sampleSize, params: { minimumSample: production.minimumSample, missing: Math.max(0, production.minimumSample - production.sampleSize) },
            });
        }
        const verifiedRate = this.percent(productionFacts.verifiedResolutionSuccess, productionFacts.verifiedResolutionTotal);
        if (productionFacts.verifiedResolutionTotal >= MINIMUM_PRODUCTION_SAMPLE
            && verifiedRate != null
            && verifiedRate < HEALTHY_VERIFIED_RESOLUTION_RATE) {
            recommendations.push({
                code: 'improve_verified_resolution', pillar: 'production', dimension: 'actions_outcomes',
                severity: verifiedRate < CRITICAL_VERIFIED_RESOLUTION_RATE ? 'critical' : 'high', href: '/admin/inbox',
                evidenceCount: Math.max(0, productionFacts.verifiedResolutionTotal - productionFacts.verifiedResolutionSuccess),
                conversationIds: productionFacts.unverifiedConversationIds,
                params: { rate: verifiedRate, total: productionFacts.verifiedResolutionTotal },
            });
        }
        if (productionFacts.sampleSize >= MINIMUM_PRODUCTION_SAMPLE
            && productionFacts.avgOverall != null
            && productionFacts.avgOverall < 6) {
            recommendations.push({
                code: 'review_low_quality_conversations', pillar: 'production', dimension: 'conversation_brand',
                severity: productionFacts.avgOverall < 4 ? 'critical' : 'high', href: '/admin/inbox',
                evidenceCount: productionFacts.lowQualityConversationIds.length,
                conversationIds: productionFacts.lowQualityConversationIds,
                params: { score: productionFacts.avgOverall },
            });
        }
        for (const issue of production.topIssues.filter((item) => item.code !== 'tool_failures').slice(0, 5)) {
            recommendations.push({
                code: `investigate_${issue.code}`,
                pillar: 'production',
                dimension: 'conversation_brand',
                severity: issue.count >= 5 ? 'high' : 'medium',
                href: '/admin/inbox',
                evidenceCount: issue.count,
                conversationIds: issue.conversationIds,
                params: { label: issue.label },
            });
        }
        if (productionFacts.toolFailures > 0) {
            const material = this.hasMaterialToolFailure(productionFacts);
            recommendations.push({
                code: 'review_tool_failures', pillar: 'production', dimension: 'actions_outcomes',
                severity: productionFacts.toolReconciliations > 0 ? 'critical' : material ? 'high' : 'medium', href: '/admin/inbox',
                evidenceCount: productionFacts.toolFailures, conversationIds: productionFacts.toolFailureConversationIds,
                params: { totalExecutions: productionFacts.toolTotal, reconciliations: productionFacts.toolReconciliations },
            });
        }
        if (productionFacts.knowledgeGaps > 0) {
            recommendations.push({
                code: 'resolve_knowledge_gaps', pillar: 'production', dimension: 'knowledge_grounding', severity: 'high', href: '/admin/knowledge',
                evidenceCount: productionFacts.knowledgeGaps,
                conversationIds: productionFacts.knowledgeGapConversationIds,
            });
        }
        return recommendations.sort((a, b) => this.severityRank(a.severity) - this.severityRank(b.severity)).slice(0, 20);
    }

    private resolveStatus(
        preparation: AgentQualityPreparationPillar,
        tested: AgentQualityTestedPillar,
        production: AgentQualityProductionPillar,
        productionFacts: ProductionFacts,
    ): AgentQualityOverview['status'] {
        if (preparation.criticalBlockers.length > 0) return 'configuration_incomplete';
        if (tested.status === 'blocked' || this.hasCriticalProductionRisk(productionFacts)) return 'at_risk';
        if (tested.status === 'stale' || production.status === 'needs_attention') return 'review_required';
        if (preparation.status !== 'ready') return 'configuration_incomplete';
        if (tested.status === 'unknown') return 'not_evaluated';
        if (production.status === 'evidenced') return 'operating_with_evidence';
        return 'ready_for_pilot';
    }

    private scoreDimension(dimension: AgentQualityDimension, checks: AgentQualityCheck[]): AgentQualityDimensionResult {
        const dimensionChecks = checks.filter((check) => check.dimension === dimension);
        const applicable = dimensionChecks.filter((check) => check.status !== 'not_applicable');
        const score = this.weightedScore(applicable);
        const blocked = applicable.some((check) => check.critical && (check.status === 'fail' || check.status === 'unknown'));
        const attention = applicable.some((check) => check.status === 'fail' || check.status === 'warning' || check.status === 'unknown');
        return {
            dimension,
            score,
            status: applicable.length === 0 ? 'unknown' : blocked ? 'blocked' : attention ? 'needs_attention' : 'ready',
            passed: applicable.filter((check) => check.status === 'pass').length,
            applicable: applicable.length,
            checks: dimensionChecks,
        };
    }

    private weightedScore(checks: AgentQualityCheck[]): number | null {
        if (!checks.length) return null;
        const total = checks.reduce((sum, check) => sum + check.weight, 0);
        if (!total) return null;
        const earned = checks.reduce((sum, check) => sum + check.weight * (check.status === 'pass' ? 1 : check.status === 'warning' ? 0.5 : 0), 0);
        return this.round((earned / total) * 100, 2);
    }

    private weightedDimensionScore(dimensions: AgentQualityDimensionResult[]): number | null {
        const scored = dimensions.filter((dimension) => dimension.score != null);
        const totalWeight = scored.reduce((sum, dimension) => sum + DIMENSION_WEIGHTS[dimension.dimension], 0);
        if (!totalWeight) return null;
        const earned = scored.reduce((sum, dimension) =>
            sum + (dimension.score as number) * DIMENSION_WEIGHTS[dimension.dimension], 0);
        return this.round(earned / totalWeight, 2);
    }

    private optionalToolStatus(tool: any, ready: boolean): AgentQualityCheck['status'] {
        if (tool?.enabled !== true) return 'not_applicable';
        return ready ? 'pass' : 'fail';
    }

    private aggregateFlags(rows: ProductionFacts['flagRows']): AgentQualityProductionIssue[] {
        const groups = new Map<string, { label: string; count: number; conversationIds: Set<string> }>();
        for (const row of rows) {
            const flags = Array.isArray(row.flags) ? row.flags : [];
            const rowCodes = new Set<string>();
            for (const raw of flags) {
                const label = String(raw || '').trim().slice(0, 240);
                if (!label) continue;
                const code = this.classifyQualityFlag(label);
                if (rowCodes.has(code)) continue;
                rowCodes.add(code);
                // Never expose the judge's free-text flag: it may repeat customer data.
                const current = groups.get(code) || { label: code, count: 0, conversationIds: new Set<string>() };
                current.count += 1;
                if (row.conversation_id) current.conversationIds.add(String(row.conversation_id));
                groups.set(code, current);
            }
        }
        return Array.from(groups.entries()).map(([code, value]) => ({
            code,
            label: value.label,
            count: value.count,
            conversationIds: Array.from(value.conversationIds).slice(0, 10),
        }));
    }

    private latestDate(values: Array<Date | string | null | undefined>): Date | null {
        const dates = values.filter(Boolean).map((value) => new Date(value as Date | string)).filter((value) => !Number.isNaN(value.getTime()));
        return dates.length ? new Date(Math.max(...dates.map((value) => value.getTime()))) : null;
    }

    private percent(numerator: number, denominator: number): number | null {
        return denominator > 0 ? this.round((numerator / denominator) * 100, 2) : null;
    }

    private hasMaterialToolFailure(facts: Pick<ProductionFacts, 'toolFailures' | 'toolTotal' | 'toolReconciliations'>): boolean {
        if (facts.toolReconciliations > 0) return true;
        if (facts.toolTotal <= 0) return false;
        return facts.toolFailures >= 3 || facts.toolFailures / facts.toolTotal >= 0.1;
    }

    private hasCriticalProductionRisk(facts: ProductionFacts): boolean {
        // Reconciliation-required is a deterministic integrity failure, not a
        // statistical trend. It is critical even before enough QA samples have
        // accumulated for production scoring.
        if (facts.toolReconciliations > 0) return true;
        if (facts.sampleSize < MINIMUM_PRODUCTION_SAMPLE) return false;
        if (facts.avgOverall != null && facts.avgOverall < 4) return true;
        const verifiedRate = this.percent(facts.verifiedResolutionSuccess, facts.verifiedResolutionTotal);
        return facts.verifiedResolutionTotal >= MINIMUM_PRODUCTION_SAMPLE
            && verifiedRate != null
            && verifiedRate < CRITICAL_VERIFIED_RESOLUTION_RATE;
    }

    private round(value: number, digits: number): number {
        const factor = 10 ** digits;
        return Math.round(value * factor) / factor;
    }

    private iso(value: Date | string): string {
        return new Date(value).toISOString();
    }

    private snake(value: string): string {
        return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    }

    private slug(value: string): string {
        return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'issue';
    }

    private classifyQualityFlag(label: string): string {
        const value = this.slug(label);
        if (/(invent|alucin|incorrect|imprecis|contradic|no_verific|fuente|conocimiento|precio_err|dato_err)/.test(value)) return 'qa_knowledge_accuracy';
        if (/(no_resol|sin_resol|necesidad|pendiente|aband|incomplet|no_cerro|no_solucion)/.test(value)) return 'qa_unresolved_need';
        if (/(no_escal|sin_escal|humano|handoff|transfer|deriv)/.test(value)) return 'qa_missing_handoff';
        if (/(tono|cortante|empatia|empatic|groser|frio|calidez|profesional)/.test(value)) return 'qa_tone_empathy';
        if (/(ignor|no_respond|sin_responder|pregunta)/.test(value)) return 'qa_ignored_question';
        if (/(repet|confus|claridad|ambigu|demasiado|verbos|redundan)/.test(value)) return 'qa_repetition_clarity';
        return 'qa_other';
    }

    private severityRank(value: AgentQualitySeverity): number {
        return { critical: 0, high: 1, medium: 2, low: 3 }[value];
    }
}
