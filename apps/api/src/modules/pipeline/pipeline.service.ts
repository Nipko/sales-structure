import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { CronLockService } from '../redis/cron-lock.service';
import { resolveTerminalOutcome } from './pipeline-outcome.util';
import { ensurePrimaryPipeline } from '../../common/utils/primary-pipeline.util';

// ============================================
// Types
// ============================================

export interface PipelineStage {
    id: string;
    name: string;
    slug: string;
    color: string;
    position: number;
    slaHours: number | null;
    isTerminal: boolean;
    terminalOutcome: 'won' | 'lost' | null;
    defaultProbability: number;
    dealCount: number;
    totalValue: number;
}

export interface Deal {
    id: string;
    contactId: string;
    contactName: string;
    contactPhone: string;
    title: string;
    value: number;
    currency: string;
    stageId: string;
    stageName?: string;
    probability: number;
    expectedCloseDate: string | null;
    assignedAgentId: string | null;
    assignedAgentName?: string;
    notes: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
    lastActivity: string;
    daysInStage: number;
    slaStatus: 'on_track' | 'at_risk' | 'breached' | 'no_sla';
    slaDeadline: string | null;
}

export type TenantStageMapping = {
    id?: string;
    pipeline_id?: string | null;
    name?: string;
    slug: string;
    position: number;
    is_terminal: boolean;
    terminal_outcome: 'won' | 'lost' | null;
    prob: number;
    sla_hours?: number | null;
    transition_rules?: any[];
};

export type UnknownStagePolicy = 'error' | 'first_non_terminal';
type TenantTxQuery = <R = any[]>(sql: string, params?: any[]) => Promise<R>;

type TransitionRuleContext = {
    email: string;
    phone: string;
    name: string;
    score: number;
    assignedAgentId: string | null;
    contactId: string;
    leadId: string | null;
    opportunityId?: string | null;
    opportunityCreatedAt?: Date | string | null;
};

export interface OpportunityStagePatch {
    estimated_value?: number;
    currency?: string;
    assigned_to?: string | null;
    metadata?: Record<string, unknown>;
    loss_reason?: string | null;
}

const STAGE_SEMANTIC_ALIASES: Record<string, string> = {
    nuevo: 'nuevo',
    new: 'nuevo',
    novo: 'nuevo',
    nouveau: 'nuevo',
    nouvelle: 'nuevo',
    contactado: 'contactado',
    contacted: 'contactado',
    contatado: 'contactado',
    contacte: 'contactado',
    respondio: 'respondio',
    replied: 'respondio',
    respondeu: 'respondio',
    repondu: 'respondio',
    calificado: 'calificado',
    qualified: 'calificado',
    qualificado: 'calificado',
    qualifie: 'calificado',
    tibio: 'tibio',
    warm: 'tibio',
    morno: 'tibio',
    tiede: 'tibio',
    caliente: 'caliente',
    hot: 'caliente',
    quente: 'caliente',
    chaud: 'caliente',
    listo_cierre: 'listo_para_cierre',
    listo_para_cierre: 'listo_para_cierre',
    ready_to_close: 'listo_para_cierre',
    pronto_para_fechar: 'listo_para_cierre',
    pret_a_conclure: 'listo_para_cierre',
    ganado: 'ganado',
    won: 'ganado',
    closed_won: 'ganado',
    gagne: 'ganado',
    perdido: 'perdido',
    lost: 'perdido',
    closed_lost: 'perdido',
    perdu: 'perdido',
    cancelado: 'perdido',
    canceled: 'perdido',
    cancelled: 'perdido',
    no_interesado: 'no_interesado',
    no_interes: 'no_interesado',
    not_interested: 'no_interesado',
    uninterested: 'no_interesado',
    sem_interesse: 'no_interesado',
    pas_interesse: 'no_interesado',
};

/**
 * Normalizes a user/CSV/automation stage label without assuming a language.
 * It is intentionally shared by exact slug/name matching and semantic aliases.
 */
export function normalizeStageIdentifier(value: string): string {
    return String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

/**
 * Resolve any accepted stage input into a stage that actually belongs to the tenant.
 *
 * Resolution order is deterministic:
 *  1. exact tenant slug or localized stage name;
 *  2. semantic alias mapped by probability for non-terminal stages;
 *  3. explicit terminal_outcome for won/lost aliases (probability never decides it);
 *  4. missing input uses the tenant's first non-terminal stage.
 *
 * Unknown non-empty inputs fail closed by default. Callers may explicitly opt into the
 * first-stage fallback only for repair/migration flows where dropping the write is worse.
 */
export function resolveTenantNativeStage(
    tenantStages: TenantStageMapping[],
    requestedStage?: string | null,
    unknownPolicy: UnknownStagePolicy = 'error',
): TenantStageMapping {
    const stages = [...(tenantStages || [])].sort((a, b) => Number(a.position) - Number(b.position));
    if (!stages.length) {
        throw new BadRequestException('No active pipeline stage is configured');
    }

    const normalized = normalizeStageIdentifier(requestedStage || '');
    const firstNonTerminal = stages.find((stage) => !stage.is_terminal);
    if (!normalized) {
        if (!firstNonTerminal) throw new BadRequestException('No non-terminal pipeline stage is configured');
        return firstNonTerminal;
    }

    const exact = stages.find((stage) =>
        normalizeStageIdentifier(stage.slug) === normalized
        || normalizeStageIdentifier(stage.name || '') === normalized,
    );
    if (exact) return exact;

    const genericSlug = STAGE_SEMANTIC_ALIASES[normalized];
    const generic = genericSlug
        ? DEFAULT_PIPELINE_STAGES.find((stage) => stage.slug === genericSlug)
        : undefined;

    if (!generic) {
        if (unknownPolicy === 'first_non_terminal') {
            if (!firstNonTerminal) throw new BadRequestException('No non-terminal pipeline stage is configured');
            return firstNonTerminal;
        }
        throw new BadRequestException(`Unknown pipeline stage: ${requestedStage}`);
    }

    let pool: TenantStageMapping[];
    if (generic.is_terminal) {
        pool = stages.filter((stage) =>
            stage.is_terminal && stage.terminal_outcome === generic.terminal_outcome,
        );
        if (!pool.length) {
            throw new BadRequestException(
                `Pipeline has no terminal stage for outcome: ${generic.terminal_outcome}`,
            );
        }
    } else {
        pool = stages.filter((stage) => !stage.is_terminal);
        if (!pool.length) throw new BadRequestException('No non-terminal pipeline stage is configured');
    }

    const targetProbability = Number(generic.default_probability || 0);
    return pool.reduce((best, stage) => {
        const bestDistance = Math.abs(Number(best.prob || 0) - targetProbability);
        const distance = Math.abs(Number(stage.prob || 0) - targetProbability);
        return distance < bestDistance ? stage : best;
    }, pool[0]);
}

export interface StageTransition {
    id: string;
    dealId: string;
    fromStage: string | null;
    toStage: string;
    changedBy: string;
    reason: string | null;
    createdAt: string;
}

export interface PipelineKanban {
    stages: Array<PipelineStage & { deals: Deal[] }>;
    forecast: {
        total: number;
        weighted: number;
        dealCount: number;
        avgDealValue: number;
    };
}

export interface StageAnalytics {
    stage: string;
    stageName: string;
    count: number;
    avgTimeHours: number;
    conversionRate: number;
    slaBreachRate: number;
}

/**
 * Auto-advance keyword sets per language. Keeps non-Spanish leads (pt/en/fr — Brazil
 * is a major WhatsApp market) from being frozen at 'contactado' because the classifier
 * only matched Spanish substrings. Accent/word-boundary/negation handling lives in
 * hasAnyKeyword; these are the lexicons it matches against.
 */
export const AUTO_PROGRESS_KEYWORDS: Record<string, { purchase: string[]; intent: string[]; positive: string[] }> = {
    es: {
        purchase: ['comprar', 'quiero inscribirme', 'inscribo', 'matricula', 'reservar', 'pagar', 'lo quiero', 'confirmo', 'confirmar'],
        intent: ['precio', 'costo', 'cuanto', 'valor', 'tarifa', 'disponibilidad', 'disponible', 'cupos', 'horario', 'fecha', 'cuando'],
        positive: ['interesante', 'me interesa', 'suena bien', 'genial', 'perfecto', 'excelente', 'dale', 'claro', 'bueno', 'listo'],
    },
    en: {
        purchase: ['buy', 'purchase', 'sign me up', 'enroll', 'book it', 'pay', 'i want it', 'i take it', 'confirm', 'checkout'],
        intent: ['price', 'cost', 'how much', 'pricing', 'rate', 'fee', 'availability', 'available', 'schedule', 'date', 'when', 'slots'],
        positive: ['interested', 'sounds good', 'great', 'perfect', 'excellent', 'awesome', 'sure', 'nice', 'lets do it'],
    },
    pt: {
        purchase: ['comprar', 'quero me inscrever', 'inscrever', 'matricula', 'reservar', 'pagar', 'quero', 'confirmo', 'confirmar'],
        intent: ['preco', 'preço', 'custo', 'quanto', 'valor', 'tarifa', 'disponibilidade', 'disponivel', 'horario', 'data', 'quando', 'vagas'],
        positive: ['interessante', 'tenho interesse', 'me interessa', 'parece bom', 'otimo', 'ótimo', 'perfeito', 'excelente', 'legal', 'claro'],
    },
    fr: {
        purchase: ["acheter", "je veux m'inscrire", "inscrire", "reserver", "réserver", "payer", "je le veux", "je prends", "confirmer"],
        intent: ["prix", "cout", "coût", "combien", "tarif", "disponibilite", "disponibilité", "disponible", "horaire", "date", "quand", "creneaux"],
        positive: ["interessant", "intéressant", "ca m'interesse", "parfait", "excellent", "super", "d'accord", "genial", "génial"],
    },
};

/** Default pipeline stages seeded per tenant */
export const DEFAULT_PIPELINE_STAGES = [
    { slug: 'nuevo', name: 'Nuevo', color: '#95a5a6', position: 0, sla_hours: 1, is_terminal: false, terminal_outcome: null, default_probability: 10 },
    { slug: 'contactado', name: 'Contactado', color: '#3498db', position: 1, sla_hours: 4, is_terminal: false, terminal_outcome: null, default_probability: 20 },
    { slug: 'respondio', name: 'Respondió', color: '#9b59b6', position: 2, sla_hours: 24, is_terminal: false, terminal_outcome: null, default_probability: 30 },
    { slug: 'calificado', name: 'Calificado', color: '#e67e22', position: 3, sla_hours: 48, is_terminal: false, terminal_outcome: null, default_probability: 50 },
    { slug: 'tibio', name: 'Tibio', color: '#f39c12', position: 4, sla_hours: 72, is_terminal: false, terminal_outcome: null, default_probability: 60 },
    { slug: 'caliente', name: 'Caliente', color: '#e74c3c', position: 5, sla_hours: 48, is_terminal: false, terminal_outcome: null, default_probability: 80 },
    { slug: 'listo_para_cierre', name: 'Listo para cierre', color: '#27ae60', position: 6, sla_hours: 24, is_terminal: false, terminal_outcome: null, default_probability: 95 },
    { slug: 'ganado', name: 'Ganado', color: '#2ecc71', position: 7, sla_hours: null, is_terminal: true, terminal_outcome: 'won', default_probability: 100 },
    { slug: 'perdido', name: 'Perdido', color: '#7f8c8d', position: 8, sla_hours: null, is_terminal: true, terminal_outcome: 'lost', default_probability: 0 },
    { slug: 'no_interesado', name: 'No interesado', color: '#bdc3c7', position: 9, sla_hours: null, is_terminal: true, terminal_outcome: 'lost', default_probability: 0 },
];

// ============================================
// Service
// ============================================

@Injectable()
export class PipelineService {
    private readonly logger = new Logger(PipelineService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private eventEmitter: EventEmitter2,
        private throttle: TenantThrottleService,
        private readonly cronLock: CronLockService,
    ) {}

    /** Load the canonical stage catalog used by every stage writer. */
    async getTenantStageCatalog(
        tenantId: string,
        schemaName?: string,
        pipelineId?: string,
    ): Promise<TenantStageMapping[]> {
        const schema = schemaName || await this.getTenantSchema(tenantId);
        if (!schema) throw new BadRequestException('Tenant not found');
        const pipelineFilter = pipelineId ? ' AND pipeline_id = $2::uuid' : '';
        const params: any[] = pipelineId ? [tenantId, pipelineId] : [tenantId];

        const stages = await this.prisma.executeInTenantSchema<TenantStageMapping[]>(
            schema,
            `SELECT id, pipeline_id, name, slug, position, is_terminal, terminal_outcome, sla_hours,
                    transition_rules,
                    COALESCE(default_probability, 0) AS prob
             FROM pipeline_stages
             WHERE tenant_id = $1::uuid${pipelineFilter}
             ORDER BY pipeline_id NULLS FIRST, position ASC`,
            params,
        );
        if (pipelineId) return stages;

        // Opportunity/lead rows predate multi-pipeline and carry no pipeline_id. Prefer
        // the legacy/default catalog so position 0 from a secondary pipeline can never
        // become the canonical initial stage by accident.
        const unscoped = stages.filter((stage) => stage.pipeline_id == null);
        if (unscoped.length) return unscoped;
        const defaults = await this.prisma.executeInTenantSchema<Array<{ id: string }>>(
            schema,
            `SELECT id FROM pipelines
              WHERE tenant_id = $1::uuid AND is_default = true AND is_active = true
              ORDER BY created_at ASC LIMIT 1`,
            [tenantId],
        ).catch(() => [] as Array<{ id: string }>);
        const defaultPipelineId = defaults?.[0]?.id;
        return defaultPipelineId
            ? stages.filter((stage) => stage.pipeline_id === defaultPipelineId)
            : stages;
    }

    /** Resolve a slug/name/semantic alias without ever returning a foreign slug. */
    async resolveTenantStage(
        tenantId: string,
        requestedStage?: string | null,
        options?: { schemaName?: string; pipelineId?: string; unknownPolicy?: UnknownStagePolicy },
    ): Promise<TenantStageMapping> {
        const stages = await this.getTenantStageCatalog(tenantId, options?.schemaName, options?.pipelineId);
        return resolveTenantNativeStage(stages, requestedStage, options?.unknownPolicy);
    }

    /**
     * Canonical write boundary for services that move every active opportunity of a lead.
     * It keeps lead, opportunity timestamps and mirrored deal status aligned.
     */
    async writeLeadStage(
        tenantId: string,
        leadId: string,
        requestedStage?: string | null,
        options?: {
            schemaName?: string;
            opportunityId?: string;
            onlyActiveOpportunities?: boolean;
            unknownPolicy?: UnknownStagePolicy;
            triggeredBy?: string;
            opportunityPatch?: OpportunityStagePatch;
            enforceTransitionRules?: boolean;
        },
    ): Promise<{ stage: TenantStageMapping; updatedOpportunities: number }> {
        const schema = options?.schemaName || await this.getTenantSchema(tenantId);
        if (!schema) throw new BadRequestException('Tenant not found');
        await this.ensurePipelinesTables(schema);
        await this.migrateToMultiPipeline(schema, tenantId);
        const stageCatalog = await this.getTenantStageCatalog(tenantId, schema);
        const stage = await this.resolveTenantStage(tenantId, requestedStage, {
            schemaName: schema,
            unknownPolicy: options?.unknownPolicy,
        });
        const terminalOutcome = resolveTerminalOutcome(stage);

        return this.prisma.transactionInTenantSchema(schema, async (query) => {
            const scopeParams: any[] = [leadId];
            let scope = 'lead_id = $1::uuid';
            if (options?.opportunityId) {
                scopeParams.push(options.opportunityId);
                scope += ' AND id = $2::uuid';
            }
            const scoped = await query<Array<{
                id: string;
                stage: string;
                won_at: Date | null;
                lost_at: Date | null;
            }>>(
                `SELECT id, stage, won_at, lost_at
                   FROM opportunities
                  WHERE ${scope}
                  ORDER BY updated_at DESC
                  FOR UPDATE`,
                scopeParams,
            );

            if (options?.opportunityId && !scoped.length) {
                throw new BadRequestException(`Opportunity not found: ${options.opportunityId}`);
            }

            const activeScoped = scoped.filter(
                (opportunity) => !opportunity.won_at && !opportunity.lost_at,
            );
            const candidates = options?.onlyActiveOpportunities === false
                ? scoped
                : activeScoped;
            const ruleOpportunityId = options?.opportunityId
                ? scoped[0].id
                : activeScoped.length === 1
                    ? activeScoped[0].id
                    : null;

            if (options?.enforceTransitionRules && (stage.transition_rules?.length || 0) > 0) {
                await this.evaluateRulesForLeadTx(
                    query,
                    tenantId,
                    leadId,
                    stage.transition_rules || [],
                    ruleOpportunityId,
                );
            }

            for (const opportunity of candidates) {
                const current = resolveTenantNativeStage(stageCatalog, opportunity.stage);
                if (current.is_terminal) resolveTerminalOutcome(current);
                if (current.is_terminal && current.slug !== stage.slug) {
                    throw new BadRequestException(`Cannot move lead from terminal stage: ${current.slug}`);
                }
            }

            let updatedOpportunities = 0;
            for (const opportunity of candidates) {
                const current = resolveTenantNativeStage(stageCatalog, opportunity.stage);
                const outcomeFields = terminalOutcome === 'won'
                    ? ', won_at = COALESCE(won_at, NOW()), lost_at = NULL'
                    : terminalOutcome === 'lost'
                        ? ', lost_at = COALESCE(lost_at, NOW()), won_at = NULL'
                        : ', won_at = NULL, lost_at = NULL';
                await query(
                    `UPDATE opportunities
                        SET stage = $1, updated_at = NOW()${outcomeFields}
                      WHERE id = $2::uuid`,
                    [stage.slug, opportunity.id],
                );
                await this.syncExactOpportunityDealTx(query, tenantId, leadId, opportunity.id, stage);
                if (current.slug !== stage.slug) {
                    await query(
                        `INSERT INTO stage_history
                            (lead_id, opportunity_id, from_stage, to_stage, triggered_by)
                         VALUES ($1::uuid, $2::uuid, $3, $4, $5)`,
                        [leadId, opportunity.id, current.slug, stage.slug, options?.triggeredBy || 'system'],
                    );
                }
                updatedOpportunities++;
            }

            if (options?.opportunityPatch) {
                if (!options.opportunityId) {
                    throw new BadRequestException('opportunityPatch requires an exact opportunityId');
                }
                const patch = options.opportunityPatch;
                const sets: string[] = [];
                const values: any[] = [options.opportunityId];
                const add = (sql: string, value: any) => {
                    values.push(value);
                    sets.push(sql.replace('?', `$${values.length}`));
                };
                if (patch.estimated_value !== undefined) add('estimated_value = ?', patch.estimated_value);
                if (patch.currency !== undefined) add('currency = ?', patch.currency);
                if (patch.assigned_to !== undefined) add('assigned_to = ?::uuid', patch.assigned_to);
                if (patch.loss_reason !== undefined) add('loss_reason = ?', patch.loss_reason);
                if (patch.metadata !== undefined) {
                    add(`metadata = COALESCE(metadata, '{}'::jsonb) || ?::jsonb`, JSON.stringify(patch.metadata));
                }
                if (sets.length > 0) {
                    await query(
                        `UPDATE opportunities SET ${sets.join(', ')}, updated_at = NOW()
                          WHERE id = $1::uuid`,
                        values,
                    );
                }
            }

            // Idempotent terminal retry: no candidate is active, but its exact linked
            // deal still gets verified without reopening or selecting another contact deal.
            if (!candidates.length && scoped.length) {
                for (const opportunity of scoped) {
                    const current = resolveTenantNativeStage(stageCatalog, opportunity.stage);
                    if (current.slug === stage.slug) {
                        // The stored slug may be a generic/vertical alias that
                        // resolves to `current`; pass it so the locked re-read
                        // recognises it instead of rejecting the mirror.
                        await this.syncExactOpportunityDealTx(
                            query, tenantId, leadId, opportunity.id, current, opportunity.stage,
                        );
                    }
                }
            }
            await query(
                `UPDATE leads SET stage = $1, updated_at = NOW() WHERE id = $2::uuid`,
                [stage.slug, leadId],
            );
            return { stage, updatedOpportunities };
        });
    }

    // ============================================
    // Multi-Pipeline Support
    // ============================================

    private async ensurePipelinesTables(schemaName: string): Promise<void> {
        const cacheKey = `pipeline_tables:${schemaName}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return;

        await this.prisma.executeInTenantSchema(schemaName,
            `CREATE TABLE IF NOT EXISTS pipelines (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                tenant_id UUID NOT NULL,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                is_default BOOLEAN DEFAULT false,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )`);

        await this.prisma.executeInTenantSchema(schemaName,
            `CREATE INDEX IF NOT EXISTS idx_pipelines_tenant ON pipelines(tenant_id, is_active)`);
        await this.prisma.executeInTenantSchema(schemaName,
            `CREATE UNIQUE INDEX IF NOT EXISTS uidx_pipelines_default_per_tenant
                ON pipelines(tenant_id) WHERE is_default = true`);

        await this.prisma.executeInTenantSchema(schemaName,
            `ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS pipeline_id UUID`);
        await this.prisma.executeInTenantSchema(schemaName,
            `ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS terminal_outcome VARCHAR(10)`);
        await this.prisma.executeInTenantSchema(schemaName,
            `ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS transition_rules JSONB DEFAULT '[]'::jsonb`);

        await this.prisma.executeInTenantSchema(schemaName,
            `ALTER TABLE deals ADD COLUMN IF NOT EXISTS pipeline_id UUID`);

        await this.prisma.executeInTenantSchema(schemaName,
            `ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE SET NULL`);

        await this.prisma.executeInTenantSchema(schemaName,
            `CREATE INDEX IF NOT EXISTS idx_opportunities_deal_id ON opportunities(deal_id)`);

        const duplicateDealLinks = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT deal_id, COUNT(*)::int AS opportunity_count
               FROM opportunities
              WHERE deal_id IS NOT NULL
              GROUP BY deal_id
             HAVING COUNT(*) > 1
              LIMIT 1`);
        if (duplicateDealLinks?.length) {
            throw new ConflictException({
                error: 'duplicate_opportunity_deal_link_requires_repair',
                dealId: duplicateDealLinks[0].deal_id,
                opportunityCount: Number(duplicateDealLinks[0].opportunity_count),
            });
        }
        await this.prisma.executeInTenantSchema(schemaName,
            `CREATE UNIQUE INDEX IF NOT EXISTS uidx_opportunities_deal_id
                ON opportunities(deal_id) WHERE deal_id IS NOT NULL`);

        await this.redis.set(cacheKey, '1', 86400);
    }

    private async migrateToMultiPipeline(schemaName: string, tenantId: string): Promise<string> {
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const { pipelineId, repairedDuplicateStages } = await ensurePrimaryPipeline(query, tenantId);
            if (repairedDuplicateStages > 0) {
                this.logger.warn(
                    `Repaired ${repairedDuplicateStages} duplicate legacy stage(s) while opening pipeline ${pipelineId}`,
                );
            }
            await query(
                `CREATE UNIQUE INDEX IF NOT EXISTS uidx_pipeline_stages_pipeline_slug
                 ON pipeline_stages (pipeline_id, slug) NULLS NOT DISTINCT`,
            );
            return pipelineId;
        });
    }

    private async ensureMultiPipeline(tenantId: string): Promise<{ schema: string; defaultPipelineId: string }> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');
        await this.ensurePipelinesTables(schema);
        const defaultPipelineId = await this.migrateToMultiPipeline(schema, tenantId);
        return { schema, defaultPipelineId };
    }

    /**
     * Resolve an explicit pipeline only when it belongs to this tenant; legacy
     * callers that omit pipelineId are scoped to the canonical primary
     * pipeline.  No stage/deal writer is allowed to fall back to NULL.
     */
    private async resolvePipelineScope(
        tenantId: string,
        requestedPipelineId?: string,
    ): Promise<{ schema: string; pipelineId: string }> {
        const { schema, defaultPipelineId } = await this.ensureMultiPipeline(tenantId);
        if (!requestedPipelineId) return { schema, pipelineId: defaultPipelineId };
        if (!PipelineService.UUID_RE.test(requestedPipelineId)) {
            throw new BadRequestException('Invalid pipeline ID');
        }
        const rows = await this.prisma.executeInTenantSchema<Array<{ id: string }>>(
            schema,
            `SELECT id FROM pipelines
              WHERE id = $1::uuid AND tenant_id = $2::uuid AND is_active = true
              LIMIT 1`,
            [requestedPipelineId, tenantId],
        );
        if (!rows?.[0]) throw new BadRequestException('Pipeline not found');
        return { schema, pipelineId: rows[0].id };
    }

    async listPipelines(tenantId: string) {
        const { schema } = await this.ensureMultiPipeline(tenantId);
        return this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT * FROM pipelines WHERE tenant_id = $1::uuid AND is_active = true ORDER BY is_default DESC, created_at ASC`,
            [tenantId]);
    }

    async createPipeline(tenantId: string, data: { name: string; description?: string }) {
        const { schema } = await this.ensureMultiPipeline(tenantId);
        return this.prisma.transactionInTenantSchema(schema, async (query) => {
            // The plan limit and the insert are one serialized decision. Two
            // simultaneous requests can no longer both observe the same count
            // and exceed maxPipelines.
            await query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS lock_acquired`, [
                `pipeline-create:${tenantId}`,
            ]);
            const countRows = await query<Array<{ c: number }>>(
                `SELECT COUNT(*)::int AS c
                   FROM pipelines
                  WHERE tenant_id = $1::uuid AND is_active = true`,
                [tenantId],
            );
            const count = Number(countRows?.[0]?.c || 0);
            await this.throttle.enforcePlanLimit(tenantId, 'maxPipelines', count, 'Pipelines');

            const rows = await query<any[]>(
                `INSERT INTO pipelines (tenant_id, name, description, is_default, is_active)
                 VALUES ($1::uuid, $2, $3, false, true)
                 RETURNING *`,
                [tenantId, data.name, data.description || null],
            );
            return rows?.[0];
        });
    }

    async updatePipeline(tenantId: string, pipelineId: string, data: { name?: string; description?: string }) {
        const { schema } = await this.ensureMultiPipeline(tenantId);

        const sets: string[] = ['updated_at = NOW()'];
        const params: any[] = [pipelineId, tenantId];
        let idx = 3;

        if (data.name !== undefined) { sets.push(`name = $${idx}`); params.push(data.name); idx++; }
        if (data.description !== undefined) { sets.push(`description = $${idx}`); params.push(data.description); idx++; }

        await this.prisma.executeInTenantSchema(schema,
            `UPDATE pipelines SET ${sets.join(', ')} WHERE id = $1::uuid AND tenant_id = $2::uuid`,
            params);

        return { success: true };
    }

    async deletePipeline(tenantId: string, pipelineId: string) {
        const { schema, defaultPipelineId } = await this.ensureMultiPipeline(tenantId);
        if (!PipelineService.UUID_RE.test(pipelineId)) {
            throw new BadRequestException('Invalid pipeline ID');
        }

        return this.prisma.transactionInTenantSchema(schema, async (query) => {
            await query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS lock_acquired`, [
                `pipeline-delete:${tenantId}`,
            ]);
            const rows = await query<Array<{ id: string; is_default: boolean }>>(
                `SELECT id, is_default
                   FROM pipelines
                  WHERE id = $1::uuid AND tenant_id = $2::uuid AND is_active = true
                  FOR UPDATE`,
                [pipelineId, tenantId],
            );
            const pipeline = rows?.[0];
            if (!pipeline) throw new BadRequestException('Pipeline not found');
            if (pipeline.is_default || pipelineId === defaultPipelineId) {
                throw new ForbiddenException({
                    error: 'cannot_delete_default',
                    message: 'No se puede eliminar el pipeline principal.',
                });
            }

            const [usage] = await query<Array<{ stages: number; deals: number }>>(
                `SELECT
                    (SELECT COUNT(*)::int FROM pipeline_stages WHERE pipeline_id = $1::uuid) AS stages,
                    (SELECT COUNT(*)::int FROM deals WHERE pipeline_id = $1::uuid) AS deals`,
                [pipelineId],
            );
            const stages = Number(usage?.stages || 0);
            const deals = Number(usage?.deals || 0);
            if (stages > 0 || deals > 0) {
                // Reassigning blindly can collide on stage slugs and can leave
                // a partially-moved funnel. The caller must first move or
                // explicitly remove its contents.
                throw new ConflictException({
                    error: 'pipeline_not_empty',
                    message: 'El pipeline contiene etapas o negocios y no puede eliminarse automáticamente.',
                    stages,
                    deals,
                });
            }

            await query(
                `UPDATE pipelines
                    SET is_active = false, updated_at = NOW()
                  WHERE id = $1::uuid AND tenant_id = $2::uuid`,
                [pipelineId, tenantId],
            );
            return { success: true };
        });
    }

    // ============================================
    // Stages
    // ============================================

    /** Get all pipeline stages with order, SLA config, deal counts */
    async getStages(tenantId: string, pipelineId?: string): Promise<PipelineStage[]> {
        const scope = await this.resolvePipelineScope(tenantId, pipelineId);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            scope.schema,
            `SELECT ps.*,
                    COUNT(d.id) as deal_count,
                    COALESCE(SUM(d.value), 0) as total_value
             FROM pipeline_stages ps
             LEFT JOIN deals d ON d.stage_id = ps.id AND d.status = 'open'
             WHERE ps.pipeline_id = $1::uuid
             GROUP BY ps.id
             ORDER BY ps.position ASC`,
            [scope.pipelineId],
        );

        return (rows || []).map((r: any) => ({
            id: r.id,
            name: r.name,
            slug: r.slug || r.name,
            color: r.color,
            position: r.position,
            slaHours: r.sla_hours != null ? parseInt(r.sla_hours) : null,
            isTerminal: r.is_terminal || false,
            terminalOutcome: resolveTerminalOutcome(r),
            defaultProbability: parseInt(r.default_probability) || 0,
            dealCount: parseInt(r.deal_count) || 0,
            totalValue: parseFloat(r.total_value) || 0,
        }));
    }

    /** Create a new pipeline stage */
    async createStage(tenantId: string, data: {
        name: string; color: string; defaultProbability?: number;
        slug?: string; slaHours?: number; isTerminal?: boolean;
        terminalOutcome?: 'won' | 'lost'; pipelineId?: string;
    }): Promise<void> {
        const scope = await this.resolvePipelineScope(tenantId, data.pipelineId);

        try {
            const isTerminal = data.isTerminal ?? false;
            if (isTerminal && data.terminalOutcome !== 'won' && data.terminalOutcome !== 'lost') {
                throw new BadRequestException('A terminal stage requires terminalOutcome: won or lost');
            }
            if (!isTerminal && data.terminalOutcome != null) {
                throw new BadRequestException('A non-terminal stage cannot define terminalOutcome');
            }
            const terminalOutcome = isTerminal ? data.terminalOutcome! : null;
            await this.prisma.transactionInTenantSchema(scope.schema, async (query) => {
                await query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS lock_acquired`, [tenantId]);
                const stageCount = await query<Array<{ c: number }>>(
                    `SELECT COUNT(*)::int AS c FROM pipeline_stages WHERE pipeline_id = $1::uuid`,
                    [scope.pipelineId],
                );
                await this.throttle.enforcePlanLimit(
                    tenantId,
                    'pipelineStages',
                    Number(stageCount?.[0]?.c || 0),
                    'etapas de pipeline',
                );
                const maxPos = await query<Array<{ next_pos: number }>>(
                    `SELECT COALESCE(MAX(position), 0) + 1 AS next_pos
                       FROM pipeline_stages WHERE pipeline_id = $1::uuid`,
                    [scope.pipelineId],
                );
                await query(
                    `INSERT INTO pipeline_stages
                        (tenant_id, name, slug, color, position, default_probability,
                         sla_hours, is_terminal, terminal_outcome, pipeline_id)
                     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid)`,
                    [
                        tenantId,
                        data.name,
                        data.slug || data.name.toLowerCase().replace(/\s+/g, '_'),
                        data.color,
                        maxPos?.[0]?.next_pos || 0,
                        data.defaultProbability || 0,
                        data.slaHours ?? null,
                        isTerminal,
                        terminalOutcome,
                        scope.pipelineId,
                    ],
                );
            });
        } catch (e: any) {
            // uidx_pipeline_stages_pipeline_slug: el slug se deriva del nombre, así que
            // dos etapas con el mismo nombre en el mismo embudo chocan. Sin este catch
            // el usuario recibía un 500 con el texto crudo de Postgres.
            if (this.isDuplicateStageError(e)) {
                throw new ConflictException(`Ya existe una etapa con el nombre "${data.name}" en este embudo`);
            }
            throw e;
        }
    }

    /** 23505 sobre el índice único de (pipeline_id, slug). */
    private isDuplicateStageError(e: any): boolean {
        const msg = `${e?.code || ''} ${e?.message || ''}`;
        return msg.includes('23505') || msg.includes('uidx_pipeline_stages_pipeline_slug');
    }

    // ============================================
    // Deals
    // ============================================

    /** Get full Kanban board data */
    async getKanban(tenantId: string, pipelineId?: string): Promise<PipelineKanban> {
        const scope = await this.resolvePipelineScope(tenantId, pipelineId);

        const stages = await this.prisma.executeInTenantSchema<any[]>(
            scope.schema,
            `SELECT id, name, slug, color, position, sla_hours, is_terminal, terminal_outcome, default_probability
             FROM pipeline_stages WHERE pipeline_id = $1::uuid ORDER BY position ASC`,
            [scope.pipelineId],
        );

        const deals = await this.prisma.executeInTenantSchema<any[]>(
            scope.schema,
            `SELECT d.*, ct.name as contact_name, ct.phone as contact_phone,
                    ps.name as stage_name, ps.sla_hours
             FROM deals d
             LEFT JOIN contacts ct ON d.contact_id = ct.id
             LEFT JOIN pipeline_stages ps ON d.stage_id = ps.id
             WHERE d.status = 'open' AND d.pipeline_id = $1::uuid
             ORDER BY d.updated_at DESC`,
            [scope.pipelineId],
        );

        const kanbanStages = (stages || []).map((s: any, idx: number) => {
            const stageDeals = (deals || []).filter((d: any) => {
                if (idx === 0) {
                    const validStageIds = (stages || []).map((st: any) => st.id);
                    return d.stage_id === s.id || !d.stage_id || !validStageIds.includes(d.stage_id);
                }
                return d.stage_id === s.id;
            });
            const totalValue = stageDeals.reduce((sum: number, d: any) => sum + parseFloat(d.value || 0), 0);
            return {
                id: s.id,
                name: s.name,
                slug: s.slug || s.name,
                color: s.color,
                position: s.position,
                slaHours: s.sla_hours != null ? parseInt(s.sla_hours) : null,
                isTerminal: s.is_terminal || false,
                terminalOutcome: resolveTerminalOutcome(s),
                defaultProbability: parseInt(s.default_probability) || 0,
                dealCount: stageDeals.length,
                totalValue,
                deals: stageDeals.map((d: any) => this.mapDeal(d)),
            };
        });

        const allDeals = (deals || []).map((d: any) => this.mapDeal(d));
        const totalValue = allDeals.reduce((sum, d) => sum + d.value, 0);
        const weightedValue = allDeals.reduce((sum, d) => sum + d.value * (d.probability / 100), 0);

        return {
            stages: kanbanStages,
            forecast: {
                total: totalValue,
                weighted: weightedValue,
                dealCount: allDeals.length,
                avgDealValue: allDeals.length > 0 ? totalValue / allDeals.length : 0,
            },
        };
    }

    /** List deals with filters, including SLA status */
    async getDeals(tenantId: string, filters?: {
        stageId?: string; status?: string; assignedAgentId?: string;
        slaStatus?: 'on_track' | 'at_risk' | 'breached'; pipelineId?: string;
    }): Promise<Deal[]> {
        const scope = await this.resolvePipelineScope(tenantId, filters?.pipelineId);

        let query = `SELECT d.*, ct.name as contact_name, ct.phone as contact_phone,
                            ps.name as stage_name, ps.sla_hours
                     FROM deals d
                     LEFT JOIN contacts ct ON d.contact_id = ct.id
                     LEFT JOIN pipeline_stages ps ON d.stage_id = ps.id
                     WHERE 1=1`;
        const params: any[] = [];
        let paramIdx = 1;

        if (filters?.stageId) {
            query += ` AND d.stage_id = $${paramIdx++}::uuid`;
            params.push(filters.stageId);
        }
        if (filters?.status) {
            query += ` AND d.status = $${paramIdx++}`;
            params.push(filters.status);
        } else {
            query += ` AND d.status = 'open'`;
        }
        if (filters?.assignedAgentId) {
            query += ` AND d.assigned_agent_id = $${paramIdx++}::uuid`;
            params.push(filters.assignedAgentId);
        }
        query += ` AND d.pipeline_id = $${paramIdx++}::uuid`;
        params.push(scope.pipelineId);

        query += ` ORDER BY d.updated_at DESC`;

        const rows = await this.prisma.executeInTenantSchema<any[]>(scope.schema, query, params);
        let deals = (rows || []).map((d: any) => this.mapDeal(d));

        // Post-filter by SLA status if requested
        if (filters?.slaStatus) {
            deals = deals.filter(d => d.slaStatus === filters.slaStatus);
        }

        return deals;
    }

    /** Full deal detail with stage history, associated lead, conversation, opportunity */
    async getDealDetail(tenantId: string, dealId: string): Promise<{
        deal: Deal;
        stageHistory: StageTransition[];
        lead: any;
        conversation: any;
        opportunity: any;
    } | null> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return null;

        const [dealRows, historyRows, oppRows] = await Promise.all([
            this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT d.*, ct.name as contact_name, ct.phone as contact_phone,
                        ps.name as stage_name, ps.sla_hours
                 FROM deals d
                 LEFT JOIN contacts ct ON d.contact_id = ct.id
                 LEFT JOIN pipeline_stages ps ON d.stage_id = ps.id
                 WHERE d.id = $1::uuid`,
                [dealId],
            ),
            this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT * FROM stage_transitions WHERE deal_id = $1::uuid ORDER BY created_at DESC`,
                [dealId],
            ),
            this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT o.*, l.first_name, l.last_name, l.phone, l.email, l.score as lead_score,
                        c.id as conversation_id, c.status as conversation_status, c.stage as conversation_stage
                 FROM opportunities o
                 LEFT JOIN leads l ON l.id = o.lead_id
                 LEFT JOIN conversations c ON c.id = o.conversation_id
                 WHERE o.deal_id = $1::uuid
                 ORDER BY o.updated_at DESC
                 LIMIT 1`,
                [dealId],
            ),
        ]);

        if (!dealRows || dealRows.length === 0) return null;

        const deal = this.mapDeal(dealRows[0]);
        const stageHistory = (historyRows || []).map((h: any) => ({
            id: h.id,
            dealId: h.deal_id,
            fromStage: h.from_stage,
            toStage: h.to_stage,
            changedBy: h.changed_by,
            reason: h.reason,
            createdAt: h.created_at,
        }));

        const opp = oppRows?.[0] || null;

        return {
            deal,
            stageHistory,
            lead: opp ? {
                firstName: opp.first_name,
                lastName: opp.last_name,
                phone: opp.phone,
                email: opp.email,
                score: opp.lead_score,
            } : null,
            conversation: opp?.conversation_id ? {
                id: opp.conversation_id,
                status: opp.conversation_status,
                stage: opp.conversation_stage,
            } : null,
            opportunity: opp ? {
                id: opp.id,
                stage: opp.stage,
                estimatedValue: opp.estimated_value,
            } : null,
        };
    }

    /** Create a new deal */
    async createDeal(tenantId: string, data: {
        contactId: string; title: string; value: number; stageId: string;
        probability?: number; expectedCloseDate?: string; assignedAgentId?: string; notes?: string; pipelineId?: string;
    }): Promise<Deal> {
        const scope = await this.resolvePipelineScope(tenantId, data.pipelineId);

        // Accept either a stage UUID or a stage slug (e.g. vertical stages like 'interesado')
        const stageId = await this.resolveStageId(scope.schema, tenantId, data.stageId, scope.pipelineId);
        if (!stageId) {
            throw new BadRequestException(`Pipeline stage not found: ${data.stageId}`);
        }
        data = { ...data, stageId, pipelineId: scope.pipelineId };

        // Get stage info for SLA deadline
        const stageRows = await this.prisma.executeInTenantSchema<any[]>(
            scope.schema,
            `SELECT sla_hours, default_probability, name, is_terminal, terminal_outcome
             FROM pipeline_stages WHERE id = $1::uuid AND pipeline_id = $2::uuid`,
            [data.stageId, scope.pipelineId],
        );
        const stage = stageRows?.[0];
        const probability = data.probability ?? (stage?.default_probability || 0);
        const initialStatus = resolveTerminalOutcome(stage || {}) || 'open';
        const created = await this.prisma.transactionInTenantSchema(scope.schema, async (query) => {
            const result = await query<any[]>(
                `INSERT INTO deals (contact_id, title, value, stage_id, probability, expected_close_date,
                                    assigned_agent_id, notes, status, sla_deadline,
                                    pipeline_id,
                                    created_at, updated_at, stage_entered_at)
                 VALUES ($1::uuid, $2, $3, $4::uuid, $5, $6, $7::uuid, $8, $9,
                         CASE WHEN $10::int IS NULL THEN NULL ELSE NOW() + ($10::int * INTERVAL '1 hour') END,
                         $11::uuid, NOW(), NOW(), NOW())
                 RETURNING *`,
                [
                    data.contactId,
                    data.title,
                    data.value,
                    data.stageId,
                    probability,
                    data.expectedCloseDate || null,
                    data.assignedAgentId || null,
                    data.notes || '',
                    initialStatus,
                    stage?.sla_hours ?? null,
                    scope.pipelineId,
                ],
            );
            if (!result?.[0]) throw new Error('Deal creation failed');
            await query(
                `INSERT INTO stage_transitions
                    (deal_id, from_stage, to_stage, changed_by, reason, created_at)
                 VALUES ($1::uuid, NULL, $2, 'system', 'Deal created', NOW())`,
                [result[0].id, data.stageId],
            );
            return result[0];
        });

        return this.mapDeal(created);
    }

    /**
     * Transactional mirror for one exact Opportunity. It never searches a Deal by
     * contact: an existing mirror must be referenced by opportunities.deal_id.
     */
    async syncExactOpportunityDealTx(
        query: TenantTxQuery,
        tenantId: string,
        leadId: string,
        opportunityId: string,
        stage: TenantStageMapping,
        /**
         * The stage slug the caller actually observed before resolving it. A
         * vertical tenant stores its own or a generic slug (`listo_para_cierre`)
         * which resolves to a native stage (`confirmado`), so comparing the raw
         * column against the RESOLVED slug rejected every legitimate sync and
         * no vertical tenant could ever mirror a deal.
         */
        observedStage?: string | null,
    ): Promise<void> {
        if (!stage.id) throw new Error(`Canonical stage ${stage.slug} has no id`);
        const outcome = resolveTerminalOutcome(stage);
        const status = outcome || 'open';
        const opportunities = await query<any[]>(
            `SELECT o.id, o.stage, o.lead_id, o.deal_id,
                    l.contact_id, l.first_name, l.last_name, l.phone
               FROM opportunities o
               JOIN leads l ON l.id = o.lead_id
              WHERE o.id = $1::uuid AND o.lead_id = $2::uuid
              FOR UPDATE OF o`,
            [opportunityId, leadId],
        );
        const opportunity = opportunities?.[0];
        if (!opportunity) throw new BadRequestException(`Opportunity not found: ${opportunityId}`);
        // The guard exists to catch a CONCURRENT move between the caller's read
        // and this locked re-read — not to demand that the stored slug already
        // be canonical. Accept the canonical slug or the exact value the caller
        // resolved from; anything else really is someone else moving the card.
        const observed = normalizeStageIdentifier(opportunity.stage || '');
        const canonical = normalizeStageIdentifier(stage.slug);
        const expected = normalizeStageIdentifier(observedStage || '');
        if (observed !== canonical && !(expected && observed === expected)) {
            throw new ConflictException(
                `Opportunity ${opportunityId} is at ${opportunity.stage}, not canonical stage ${stage.slug}`,
            );
        }
        if (!opportunity.contact_id) return;

        let pipelineId = stage.pipeline_id || null;
        if (!pipelineId) {
            const pipelines = await query<any[]>(
                `SELECT id FROM pipelines
                  WHERE tenant_id = $1::uuid AND is_default = true AND is_active = true
                  ORDER BY created_at ASC LIMIT 1`,
                [tenantId],
            );
            pipelineId = pipelines?.[0]?.id || null;
        }
        if (!pipelineId) throw new Error('No active default pipeline is configured');

        const title = `${opportunity.first_name || ''} ${opportunity.last_name || ''}`.trim()
            || opportunity.phone
            || 'Interés Automatizado';
        let deal: any;
        if (opportunity.deal_id) {
            const deals = await query<any[]>(
                `SELECT id, stage_id, contact_id, status
                   FROM deals
                  WHERE id = $1::uuid AND contact_id = $2::uuid
                  FOR UPDATE`,
                [opportunity.deal_id, opportunity.contact_id],
            );
            deal = deals?.[0];
            if (!deal) {
                throw new ConflictException(
                    `Opportunity ${opportunityId} references a missing or foreign deal`,
                );
            }
        } else {
            const created = await query<any[]>(
                `INSERT INTO deals
                    (contact_id, title, value, stage_id, probability, status,
                     sla_deadline, sla_status, stage_entered_at, pipeline_id,
                     notes, created_at, updated_at)
                 VALUES
                    ($1::uuid, $2, 0, $3::uuid, $4, $5,
                     CASE WHEN $6::int IS NULL THEN NULL ELSE NOW() + ($6::int * INTERVAL '1 hour') END,
                     'on_track', NOW(), $7::uuid,
                     'Creado por la IA mediante chat interactivo', NOW(), NOW())
                 RETURNING id, stage_id, contact_id`,
                [
                    opportunity.contact_id,
                    title,
                    stage.id,
                    Number(stage.prob || 0),
                    status,
                    stage.sla_hours ?? null,
                    pipelineId,
                ],
            );
            deal = created?.[0];
            if (!deal) throw new Error(`Failed to create Deal mirror for Opportunity ${opportunityId}`);
            await query(
                `UPDATE opportunities
                    SET deal_id = $1::uuid
                  WHERE id = $2::uuid AND deal_id IS NULL`,
                [deal.id, opportunityId],
            );
            await query(
                `INSERT INTO stage_transitions
                    (deal_id, from_stage, to_stage, changed_by, reason, created_at)
                 VALUES ($1::uuid, NULL, $2, 'system', 'Created from exact Opportunity link', NOW())`,
                [deal.id, stage.id],
            );
            return;
        }

        const stageChanged = deal.stage_id !== stage.id;
        if (stageChanged) {
            await query(
                `UPDATE deals
                    SET stage_id = $1::uuid,
                        probability = $2,
                        status = $3,
                        stage_entered_at = NOW(),
                        updated_at = NOW(),
                        sla_deadline = CASE
                            WHEN $4::int IS NULL THEN NULL
                            ELSE NOW() + ($4::int * INTERVAL '1 hour')
                        END,
                        sla_status = 'on_track',
                        pipeline_id = $5::uuid
                  WHERE id = $6::uuid`,
                [stage.id, Number(stage.prob || 0), status, stage.sla_hours ?? null, pipelineId, deal.id],
            );
            await query(
                `INSERT INTO stage_transitions
                    (deal_id, from_stage, to_stage, changed_by, reason, created_at)
                 VALUES ($1::uuid, $2, $3, 'system', 'Synchronized from exact Opportunity link', NOW())`,
                [deal.id, deal.stage_id, stage.id],
            );
        } else if (deal.status !== status) {
            // Idempotent retries may repair status from explicit stage metadata, but
            // must not reset stage_entered_at or extend the SLA clock.
            await query(
                `UPDATE deals SET status = $1, updated_at = NOW() WHERE id = $2::uuid`,
                [status, deal.id],
            );
        }
    }

    /** Synchronize one explicitly identified Opportunity to its exact Deal mirror. */
    async syncOpportunityToDeal(
        tenantId: string,
        leadId: string,
        opportunityStage: string,
        opportunityId: string,
    ): Promise<void> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return;
        await this.ensurePipelinesTables(schema);
        await this.migrateToMultiPipeline(schema, tenantId);
        const canonicalStage = await this.resolveTenantStage(tenantId, opportunityStage, { schemaName: schema });
        await this.prisma.transactionInTenantSchema(schema, (query) =>
            this.syncExactOpportunityDealTx(
                query, tenantId, leadId, opportunityId, canonicalStage, opportunityStage,
            ),
        );
    }

    /** Evaluate all transition rules for a stage before allowing a move (deal path) */
    async evaluateTransitionRules(
        schema: string,
        dealId: string,
        rules: any[],
        txQuery?: TenantTxQuery,
    ): Promise<void> {
        if (!rules || rules.length === 0) return;
        const execute = <R = any[]>(sql: string, params: any[] = []): Promise<R> => txQuery
            ? txQuery<R>(sql, params)
            : this.prisma.executeInTenantSchema<R>(schema, sql, params);

        // Lead + contact + assigned agent for this deal
        const dealData = await execute<any[]>(
            `SELECT d.contact_id, l.id as lead_id, l.email as lead_email, l.phone as lead_phone,
                    l.first_name, l.last_name, l.score, d.assigned_agent_id,
                    ct.email as contact_email, ct.phone as contact_phone,
                    o.id AS opportunity_id, o.created_at AS opportunity_created_at
             FROM deals d
             LEFT JOIN contacts ct ON ct.id = d.contact_id
             LEFT JOIN opportunities o ON o.deal_id = d.id
             LEFT JOIN leads l ON l.id = o.lead_id
             WHERE d.id = $1::uuid
             ORDER BY o.updated_at DESC NULLS LAST
             LIMIT 1`,
            [dealId],
        ).then(res => res[0]);

        if (!dealData) return;

        await this.runRuleChecks(schema, rules, {
            email: (dealData.lead_email || dealData.contact_email || '').trim(),
            phone: (dealData.lead_phone || dealData.contact_phone || '').trim(),
            name: `${dealData.first_name || ''} ${dealData.last_name || ''}`.trim(),
            score: dealData.score || 0,
            assignedAgentId: dealData.assigned_agent_id || null,
            contactId: dealData.contact_id,
            leadId: dealData.lead_id || null,
            opportunityId: dealData.opportunity_id || null,
            opportunityCreatedAt: dealData.opportunity_created_at || null,
        }, txQuery);
    }

    /**
     * Evaluate a target stage's transition rules against an OPPORTUNITY's lead. Used by
     * the CRM board move and the AI auto-advance (both lead-centric, not deal-centric).
     * Throws BadRequestException('TRANSITION_RULE_FAILED:<type>') when a prerequisite is
     * unmet — same contract as the deal path, so the dashboard's per-rule i18n toasts fire.
     */
    async evaluateRulesForLead(
        schema: string,
        tenantId: string,
        leadId: string,
        targetSlug: string,
        pipelineId?: string | null,
        opportunityId?: string | null,
    ): Promise<void> {
        if (!leadId) return;
        const stage = await this.resolveTenantStage(tenantId, targetSlug, {
            schemaName: schema,
            pipelineId: pipelineId || undefined,
        });
        const rules = stage.transition_rules || [];
        if (!rules.length) return;

        const d = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT l.id as lead_id, l.contact_id, l.email as lead_email, l.phone as lead_phone,
                    l.first_name, l.last_name, l.score, l.assigned_to,
                    ct.email as contact_email, ct.phone as contact_phone,
                    o.id AS opportunity_id, o.created_at AS opportunity_created_at
             FROM leads l
             LEFT JOIN contacts ct ON ct.id = l.contact_id
             LEFT JOIN opportunities o
                    ON o.id = $2::uuid
                   AND o.lead_id = l.id
             WHERE l.id = $1::uuid
             LIMIT 1`,
            [leadId, opportunityId || '00000000-0000-0000-0000-000000000000'],
        ).then(res => res[0]);
        if (!d) return;

        await this.runRuleChecks(schema, rules, {
            email: (d.lead_email || d.contact_email || '').trim(),
            phone: (d.lead_phone || d.contact_phone || '').trim(),
            name: `${d.first_name || ''} ${d.last_name || ''}`.trim(),
            score: d.score || 0,
            assignedAgentId: d.assigned_to || null,
            contactId: d.contact_id,
            leadId: d.lead_id || null,
            opportunityId: d.opportunity_id || null,
            opportunityCreatedAt: d.opportunity_created_at || null,
        });
    }

    /** Same rule contract, evaluated on the transaction's locked lead snapshot. */
    private async evaluateRulesForLeadTx(
        query: TenantTxQuery,
        tenantId: string,
        leadId: string,
        rules: any[],
        opportunityId?: string | null,
    ): Promise<void> {
        if (!rules.length) return;
        const rows = await query<any[]>(
            `SELECT l.id AS lead_id, l.contact_id, l.email AS lead_email, l.phone AS lead_phone,
                    l.first_name, l.last_name, l.score, l.assigned_to,
                    ct.email AS contact_email, ct.phone AS contact_phone,
                    o.id AS opportunity_id, o.created_at AS opportunity_created_at
               FROM leads l
               LEFT JOIN contacts ct ON ct.id = l.contact_id
               LEFT JOIN opportunities o
                      ON o.id = $2::uuid
                     AND o.lead_id = l.id
              WHERE l.id = $1::uuid
              FOR UPDATE OF l`,
            [leadId, opportunityId || '00000000-0000-0000-0000-000000000000'],
        );
        const d = rows?.[0];
        if (!d) throw new BadRequestException('Lead not found during transition');
        await this.runRuleChecks('', rules, {
            email: (d.lead_email || d.contact_email || '').trim(),
            phone: (d.lead_phone || d.contact_phone || '').trim(),
            name: `${d.first_name || ''} ${d.last_name || ''}`.trim(),
            score: d.score || 0,
            assignedAgentId: d.assigned_to || null,
            contactId: d.contact_id,
            leadId: d.lead_id || null,
            opportunityId: d.opportunity_id || null,
            opportunityCreatedAt: d.opportunity_created_at || null,
        }, query);
    }

    /**
     * Guard a manual opportunity stage move (the CRM board / kanban path). Enforces the
     * target stage's transition rules — the same governance the deal board's moveToStage
     * applies — so a rule configured in Settings → Pipeline is honored no matter which
     * board the move comes from. Throws BadRequestException('TRANSITION_RULE_FAILED:...').
     */
    async assertOpportunityMoveAllowed(tenantId: string, opportunityId: string, targetSlug: string): Promise<void> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return;
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT lead_id FROM opportunities WHERE id = $1::uuid LIMIT 1`,
            [opportunityId],
        );
        const leadId = rows?.[0]?.lead_id;
        if (leadId) {
            const canonical = await this.resolveTenantStage(tenantId, targetSlug, { schemaName: schema });
            await this.evaluateRulesForLead(
                schema,
                tenantId,
                leadId,
                canonical.slug,
                canonical.pipeline_id,
                opportunityId,
            );
        }
    }

    /** Shared rule evaluation for both the deal and lead/opportunity paths. */
    private async runRuleChecks(
        schema: string,
        rules: any[],
        ctx: TransitionRuleContext,
        txQuery?: TenantTxQuery,
    ): Promise<void> {
        const execute = <R = any[]>(sql: string, params: any[] = []): Promise<R> => txQuery
            ? txQuery<R>(sql, params)
            : this.prisma.executeInTenantSchema<R>(schema, sql, params);
        // Custom-attribute values are only needed when a custom_attribute rule is present.
        // The table stores TYPED values (value_text/number/boolean/date/json) and the
        // definition key column is `attribute_key` — the old `def.key, val.value` SELECT
        // referenced non-existent columns and threw 42703 for EVERY rule-bearing stage.
        // Guarded so an infra error can never masquerade as a rule failure (a query error
        // skips only the attribute-dependent rules instead of blocking the move / 500ing).
        let attrMap: Map<string, string> | null = null;
        const needsAttrs = rules.some((r) => r.type === 'custom_attribute_required' || r.type === 'custom_attribute_equals');
        if (needsAttrs) {
            try {
                const customAttributes = await execute<any[]>(
                    `SELECT def.attribute_key AS key,
                            COALESCE(val.value_text, val.value_number::text, val.value_boolean::text,
                                     to_char(val.value_date, 'YYYY-MM-DD'), val.value_json::text) AS value
                     FROM custom_attribute_values val
                     JOIN custom_attribute_definitions def ON val.definition_id = def.id
                     WHERE val.entity_id = $1::uuid OR val.entity_id = $2::uuid`,
                    [ctx.contactId, ctx.leadId || '00000000-0000-0000-0000-000000000000'],
                );
                attrMap = new Map(customAttributes.map((a) => [a.key, a.value]));
            } catch (e: any) {
                this.logger.error(`Custom-attribute prefetch failed during rule check: ${e.message}`);
                attrMap = null; // skip attribute rules rather than block/500
            }
        }

        // Native operational rows are contact-linked in legacy schemas. Infer
        // ownership only when the exact current opportunity was the contact's
        // sole active opportunity both now and at the instant the evidence was
        // created. The predicates live in the SAME SQL snapshot as the evidence
        // lookup, so a separate COUNT cannot race a close/reopen operation.
        const nativeOpportunityScope = `
            AND EXISTS (
                SELECT 1
                  FROM opportunities current_o
                  JOIN leads current_l ON current_l.id = current_o.lead_id
                 WHERE current_o.id = $3::uuid
                   AND (
                        current_l.contact_id = $1::uuid
                        OR EXISTS (
                            SELECT 1
                              FROM contact_identities requested_identity
                              JOIN contact_identities current_lead_identity
                                ON current_lead_identity.customer_profile_id = requested_identity.customer_profile_id
                             WHERE requested_identity.contact_id = $1::uuid
                               AND current_lead_identity.contact_id = current_l.contact_id
                        )
                   )
                   AND current_o.created_at <= e.created_at
                   AND current_o.won_at IS NULL
                   AND current_o.lost_at IS NULL
            )
            AND NOT EXISTS (
                SELECT 1
                  FROM opportunities other_now
                  JOIN leads other_now_l ON other_now_l.id = other_now.lead_id
                 WHERE (
                        other_now_l.contact_id = $1::uuid
                        OR EXISTS (
                            SELECT 1
                              FROM contact_identities requested_identity
                              JOIN contact_identities other_now_identity
                                ON other_now_identity.customer_profile_id = requested_identity.customer_profile_id
                             WHERE requested_identity.contact_id = $1::uuid
                               AND other_now_identity.contact_id = other_now_l.contact_id
                        )
                   )
                   AND other_now.id <> $3::uuid
                   AND other_now.won_at IS NULL
                   AND other_now.lost_at IS NULL
            )
            AND NOT EXISTS (
                SELECT 1
                  FROM opportunities other_at_evidence
                  JOIN leads other_at_l ON other_at_l.id = other_at_evidence.lead_id
                 WHERE (
                        other_at_l.contact_id = $1::uuid
                        OR EXISTS (
                            SELECT 1
                              FROM contact_identities requested_identity
                              JOIN contact_identities other_at_identity
                                ON other_at_identity.customer_profile_id = requested_identity.customer_profile_id
                             WHERE requested_identity.contact_id = $1::uuid
                               AND other_at_identity.contact_id = other_at_l.contact_id
                        )
                   )
                   AND other_at_evidence.id <> $3::uuid
                   AND other_at_evidence.created_at <= e.created_at
                   AND (other_at_evidence.won_at IS NULL OR other_at_evidence.won_at >= e.created_at)
                   AND (other_at_evidence.lost_at IS NULL OR other_at_evidence.lost_at >= e.created_at)
            )`;
        const nativeOpportunityScopeToken = '/* native-opportunity-scope */';
        const equivalentEvidenceContactScope = `
            AND (
                e.contact_id = $1::uuid
                OR EXISTS (
                    SELECT 1
                      FROM contact_identities requested_identity
                      JOIN contact_identities evidence_identity
                        ON evidence_identity.customer_profile_id = requested_identity.customer_profile_id
                     WHERE requested_identity.contact_id = $1::uuid
                       AND evidence_identity.contact_id = e.contact_id
                )
            )`;
        const legacyOpportunityScope = `
            ${equivalentEvidenceContactScope}
            ${nativeOpportunityScope}`;
        const exactOrLegacyOpportunityScope = `
            AND (
                e.opportunity_id = $3::uuid
                OR (
                    e.opportunity_id IS NULL
                    ${legacyOpportunityScope}
                )
            )`;
        const queryOptionalVerticalTable = async (sql: string): Promise<any[]> => {
            if (
                !ctx.contactId
                || !ctx.opportunityId
                || !ctx.opportunityCreatedAt
            ) {
                return [];
            }
            const modernSql = sql.replace(nativeOpportunityScopeToken, exactOrLegacyOpportunityScope);
            const legacySql = sql.replace(nativeOpportunityScopeToken, legacyOpportunityScope);
            try {
                return await execute<any[]>(modernSql, [
                    ctx.contactId,
                    ctx.opportunityCreatedAt,
                    ctx.opportunityId,
                ]);
            } catch (error: any) {
                const pgCode = error?.meta?.code || error?.code;
                const message = String(error?.meta?.message || error?.message || '');
                // Older tenant schemas may genuinely predate one specialized
                // table. Only that PostgreSQL condition is optional; syntax,
                // column and connection errors must remain visible.
                if (pgCode === '42P01') return [];
                // Rolling-deploy compatibility is deliberately narrow: only a
                // missing opportunity_id column may use the legacy temporal
                // ownership proof. Every other schema/query error stays loud.
                if (pgCode === '42703' && message.includes('opportunity_id')) {
                    try {
                        return await execute<any[]>(legacySql, [
                            ctx.contactId,
                            ctx.opportunityCreatedAt,
                            ctx.opportunityId,
                        ]);
                    } catch (legacyError: any) {
                        const legacyCode = legacyError?.meta?.code || legacyError?.code;
                        if (legacyCode === '42P01') return [];
                        throw legacyError;
                    }
                }
                throw error;
            }
        };

        for (const rule of rules) {
            switch (rule.type) {
                case 'email_required':
                    if (!ctx.email) throw new BadRequestException('TRANSITION_RULE_FAILED:email_required');
                    break;
                case 'phone_required':
                    if (!ctx.phone) throw new BadRequestException('TRANSITION_RULE_FAILED:phone_required');
                    break;
                case 'name_required':
                    if (!ctx.name) throw new BadRequestException('TRANSITION_RULE_FAILED:name_required');
                    break;
                case 'min_score': {
                    const minScore = Number(rule.value) || 0;
                    if (ctx.score < minScore) throw new BadRequestException(`TRANSITION_RULE_FAILED:min_score:${minScore}`);
                    break;
                }
                case 'agent_assigned':
                    if (!ctx.assignedAgentId) throw new BadRequestException('TRANSITION_RULE_FAILED:agent_assigned');
                    break;
                case 'tour_booking_required': {
                    const bookings = await queryOptionalVerticalTable(
                        `SELECT 1 FROM tour_bookings e
                          WHERE e.status <> 'cancelled'
                            AND e.created_at >= $2::timestamp
                            ${nativeOpportunityScopeToken}
                          LIMIT 1`,
                    );
                    if (!bookings.length) {
                        throw new BadRequestException('TRANSITION_RULE_FAILED:tour_booking_required');
                    }
                    break;
                }
                case 'property_booking_required': {
                    const bookings = await queryOptionalVerticalTable(
                        `SELECT 1 FROM property_bookings e
                          WHERE e.status <> 'cancelled'
                            AND e.created_at >= $2::timestamp
                            ${nativeOpportunityScopeToken}
                          LIMIT 1`,
                    );
                    if (!bookings.length) {
                        throw new BadRequestException('TRANSITION_RULE_FAILED:property_booking_required');
                    }
                    break;
                }
                case 'service_request_scheduled_required': {
                    const requests = await queryOptionalVerticalTable(
                        `SELECT 1 FROM service_requests e
                          WHERE e.scheduled_at IS NOT NULL
                            AND e.status IN ('scheduled','dispatched','in_progress','completed')
                            AND e.created_at >= $2::timestamp
                            ${nativeOpportunityScopeToken}
                          LIMIT 1`,
                    );
                    if (!requests.length) {
                        throw new BadRequestException('TRANSITION_RULE_FAILED:service_request_scheduled_required');
                    }
                    break;
                }
                case 'food_order_required': {
                    const orders = await queryOptionalVerticalTable(
                        `SELECT 1 FROM food_orders e
                          WHERE e.status <> 'cancelled'
                            AND e.created_at >= $2::timestamp
                            ${nativeOpportunityScopeToken}
                          LIMIT 1`,
                    );
                    if (!orders.length) {
                        throw new BadRequestException('TRANSITION_RULE_FAILED:food_order_required');
                    }
                    break;
                }
                case 'photo_session_scheduled_required': {
                    const sessions = await queryOptionalVerticalTable(
                        `SELECT 1 FROM photo_sessions e
                          WHERE e.scheduled_at IS NOT NULL
                            AND e.status IN ('scheduled','in_progress','delivered')
                            AND e.created_at >= $2::timestamp
                            ${nativeOpportunityScopeToken}
                          LIMIT 1`,
                    );
                    if (!sessions.length) {
                        throw new BadRequestException('TRANSITION_RULE_FAILED:photo_session_scheduled_required');
                    }
                    break;
                }
                case 'pet_boarding_required': {
                    const rentals = await queryOptionalVerticalTable(
                        `SELECT 1 FROM resource_rentals e
                          WHERE e.rental_type = 'pet_boarding'
                            AND e.status <> 'cancelled'
                            AND e.created_at >= $2::timestamp
                            ${nativeOpportunityScopeToken}
                          LIMIT 1`,
                    );
                    if (!rentals.length) {
                        throw new BadRequestException('TRANSITION_RULE_FAILED:pet_boarding_required');
                    }
                    break;
                }
                case 'vehicle_rental_required': {
                    const rentals = await queryOptionalVerticalTable(
                        `SELECT 1 FROM resource_rentals e
                          WHERE e.rental_type = 'vehicle_rental'
                            AND e.status <> 'cancelled'
                            AND e.created_at >= $2::timestamp
                            ${nativeOpportunityScopeToken}
                          LIMIT 1`,
                    );
                    if (!rentals.length) {
                        throw new BadRequestException('TRANSITION_RULE_FAILED:vehicle_rental_required');
                    }
                    break;
                }
                case 'appointment_required': {
                    // This rule is deliberately narrow. Specialized engines use
                    // their own rule so evidence from an unrelated historical
                    // table can never unlock a generic appointment stage.
                    const appointments = await queryOptionalVerticalTable(
                        `SELECT 1 FROM appointments e
                          WHERE e.status NOT IN ('cancelled','no_show')
                            AND e.created_at >= $2::timestamp
                            ${nativeOpportunityScopeToken}
                          LIMIT 1`,
                    );
                    if (!appointments.length) {
                        throw new BadRequestException('TRANSITION_RULE_FAILED:appointment_required');
                    }
                    break;
                }
                case 'order_required': {
                    // Generic commerce orders are deliberately isolated from
                    // restaurant food orders. Each vertical must prove its own
                    // native operation for the same contact.
                    const orders = await queryOptionalVerticalTable(
                        `SELECT 1 FROM orders e
                          WHERE e.status <> 'cancelled'
                            AND e.created_at >= $2::timestamp
                            ${nativeOpportunityScopeToken}
                          LIMIT 1`,
                    );
                    if (!orders.length) {
                        throw new BadRequestException('TRANSITION_RULE_FAILED:order_required');
                    }
                    break;
                }
                case 'offer_required': {
                    // An offer is "available" when the lead's course has an active commercial
                    // offer (commercial_offers links to course_id + active, not lead_id/status).
                    const offers = ctx.leadId
                        ? await execute<any[]>(
                            `SELECT 1 FROM commercial_offers co
                             JOIN leads l ON l.course_id = co.course_id
                             WHERE l.id = $1::uuid AND co.active = true
                             LIMIT 1`,
                            [ctx.leadId],
                        )
                        : [];
                    if (!offers || offers.length === 0) throw new BadRequestException('TRANSITION_RULE_FAILED:offer_required');
                    break;
                }
                case 'custom_attribute_required': {
                    if (attrMap === null) break; // couldn't read attributes → don't hard-block
                    const v = attrMap.get(rule.field);
                    if (!v || !String(v).trim()) throw new BadRequestException(`TRANSITION_RULE_FAILED:custom_attribute_required:${rule.field}`);
                    break;
                }
                case 'custom_attribute_equals': {
                    if (attrMap === null) break;
                    const curVal = attrMap.get(rule.field);
                    if (String(curVal) !== String(rule.value)) throw new BadRequestException(`TRANSITION_RULE_FAILED:custom_attribute_equals:${rule.field}:${rule.value}`);
                    break;
                }
            }
        }
    }

    /** Move a deal to a new stage with validation, audit, and SLA */
    async moveToStage(tenantId: string, dealId: string, newStageId: string, agentId?: string, reason?: string): Promise<void> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return;
        await this.ensurePipelinesTables(schema);
        await this.migrateToMultiPipeline(schema, tenantId);

        const requestedStage = newStageId;
        const changedBy = agentId || 'system';
        const txResult = await this.prisma.transactionInTenantSchema(schema, async (query) => {
            const dealRows = await query<any[]>(
                `SELECT d.stage_id, d.pipeline_id AS deal_pipeline_id,
                        ps.pipeline_id AS stage_pipeline_id,
                        ps.is_terminal AS current_is_terminal,
                        ps.terminal_outcome AS current_terminal_outcome,
                        ps.default_probability AS current_default_probability,
                        ps.slug AS current_slug
                   FROM deals d
                   LEFT JOIN pipeline_stages ps ON d.stage_id = ps.id
                  WHERE d.id = $1::uuid
                  FOR UPDATE OF d`,
                [dealId],
            );
            if (!dealRows?.length) throw new BadRequestException('Deal not found');
            const currentDeal = dealRows[0];

            if (
                currentDeal.deal_pipeline_id
                && currentDeal.stage_pipeline_id
                && currentDeal.deal_pipeline_id !== currentDeal.stage_pipeline_id
            ) {
                throw new ConflictException(`Deal ${dealId} references a stage from another pipeline`);
            }
            let pipelineId = currentDeal.deal_pipeline_id || currentDeal.stage_pipeline_id || null;
            if (!pipelineId) {
                pipelineId = (await ensurePrimaryPipeline(query, tenantId)).pipelineId;
            }

            const stageCatalog = await query<TenantStageMapping[]>(
                `SELECT id, pipeline_id, name, slug, position, is_terminal,
                        terminal_outcome, sla_hours, transition_rules,
                        COALESCE(default_probability, 0) AS prob
                   FROM pipeline_stages
                  WHERE tenant_id = $1::uuid AND pipeline_id = $2::uuid
                  ORDER BY position ASC`,
                [tenantId, pipelineId],
            );
            let newStage: TenantStageMapping | undefined;
            if (PipelineService.UUID_RE.test(requestedStage)) {
                newStage = stageCatalog.find((stage) => stage.id === requestedStage);
            } else {
                try {
                    newStage = resolveTenantNativeStage(stageCatalog, requestedStage);
                } catch {
                    newStage = undefined;
                }
            }
            if (!newStage) {
                throw new BadRequestException(`Target stage not found in deal pipeline: ${requestedStage}`);
            }

            const transitionRules = newStage.transition_rules || [];
            const probability = Number(newStage.prob || 0);
            const terminalOutcome = resolveTerminalOutcome(newStage);
            await this.evaluateTransitionRules(schema, dealId, transitionRules, query);
            if (currentDeal.current_is_terminal) {
                resolveTerminalOutcome({
                    is_terminal: true,
                    terminal_outcome: currentDeal.current_terminal_outcome,
                    default_probability: currentDeal.current_default_probability,
                });
                throw new BadRequestException(`Cannot move deal from terminal stage '${currentDeal.current_slug}'`);
            }

            await query(
                `UPDATE deals
                    SET stage_id = $1::uuid,
                        probability = $2,
                        status = $3,
                        stage_entered_at = CASE WHEN stage_id IS DISTINCT FROM $1::uuid THEN NOW() ELSE stage_entered_at END,
                        updated_at = NOW(),
                        sla_deadline = CASE
                            WHEN $4::int IS NULL THEN NULL
                            ELSE NOW() + ($4::int * INTERVAL '1 hour')
                        END,
                        sla_status = 'on_track',
                        pipeline_id = $5::uuid
                  WHERE id = $6::uuid`,
                [newStage.id, probability, terminalOutcome || 'open', newStage.sla_hours ?? null, pipelineId, dealId],
            );

            const oppRows = await query<Array<{ id: string; lead_id: string | null; stage: string }>>(
                `SELECT id, lead_id, stage
                   FROM opportunities
                  WHERE deal_id = $1::uuid
                  ORDER BY updated_at DESC
                  FOR UPDATE`,
                [dealId],
            );
            if (oppRows.length > 1) {
                throw new ConflictException(`Deal ${dealId} is linked to multiple opportunities`);
            }
            const opportunity = oppRows[0];
            if (opportunity) {
                const outcomeTimestamps = terminalOutcome === 'won'
                    ? ', won_at = COALESCE(won_at, NOW()), lost_at = NULL'
                    : terminalOutcome === 'lost'
                        ? ', lost_at = COALESCE(lost_at, NOW()), won_at = NULL'
                        : ', won_at = NULL, lost_at = NULL';
                await query(
                    `UPDATE opportunities
                        SET stage = $1, updated_at = NOW()${outcomeTimestamps}
                      WHERE id = $2::uuid`,
                    [newStage.slug, opportunity.id],
                );
                if (opportunity.lead_id) {
                    await query(
                        `UPDATE leads SET stage = $1, updated_at = NOW() WHERE id = $2::uuid`,
                        [newStage.slug, opportunity.lead_id],
                    );
                    if (opportunity.stage !== newStage.slug) {
                        await query(
                            `INSERT INTO stage_history
                                (lead_id, opportunity_id, from_stage, to_stage, reason, triggered_by, agent_id)
                             VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid)`,
                            [
                                opportunity.lead_id,
                                opportunity.id,
                                opportunity.stage,
                                newStage.slug,
                                reason || null,
                                agentId ? 'agent' : 'system',
                                agentId || null,
                            ],
                        );
                    }
                }
            }

            const stageChanged = currentDeal.stage_id !== newStage.id;
            if (stageChanged) {
                await query(
                    `INSERT INTO stage_transitions
                        (deal_id, from_stage, to_stage, changed_by, reason, created_at)
                     VALUES ($1::uuid, $2, $3, $4, $5, NOW())`,
                    [dealId, currentDeal.stage_id, newStage.id, changedBy, reason || null],
                );
            }
            return {
                fromStageId: currentDeal.stage_id,
                stageChanged,
                newStage,
                terminalOutcome,
            };
        });

        // Emit event for automation
        if (txResult.stageChanged) {
            this.eventEmitter.emit('pipeline.stage_changed', {
                tenantId,
                dealId,
                fromStageId: txResult.fromStageId,
                toStageId: txResult.newStage.id,
                toStageSlug: txResult.newStage.slug,
                terminalOutcome: txResult.terminalOutcome,
                changedBy,
                reason,
            });
        }

        this.logger.log(
            `Deal ${dealId} moved to stage ${txResult.newStage.slug} (${txResult.newStage.id})`,
        );
    }

    /** Backward-compatible alias for moveDeal */
    async moveDeal(tenantId: string, dealId: string, newStageId: string): Promise<void> {
        return this.moveToStage(tenantId, dealId, newStageId);
    }

    /** Update a deal */
    async updateDeal(tenantId: string, dealId: string, data: Partial<{
        title: string; value: number; probability: number; expectedCloseDate: string | null;
        assignedAgentId: string | null; notes: string;
    }>): Promise<void> {
        if ((data as any).status !== undefined || (data as any).stageId !== undefined || (data as any).stage_id !== undefined) {
            throw new BadRequestException('Deal stage/status is managed only by moveToStage');
        }
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return;

        const sets: string[] = ['updated_at = NOW()'];
        const params: any[] = [dealId];
        let i = 2;

        if (data.title) { sets.push(`title = $${i++}`); params.push(data.title); }
        if (data.value !== undefined) { sets.push(`value = $${i++}`); params.push(data.value); }
        if (data.probability !== undefined) { sets.push(`probability = $${i++}`); params.push(data.probability); }
        if (data.expectedCloseDate !== undefined) { sets.push(`expected_close_date = $${i++}`); params.push(data.expectedCloseDate); }
        if (data.assignedAgentId !== undefined) { sets.push(`assigned_agent_id = $${i++}::uuid`); params.push(data.assignedAgentId); }
        if (data.notes !== undefined) { sets.push(`notes = $${i++}`); params.push(data.notes); }

        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE deals SET ${sets.join(', ')} WHERE id = $1::uuid`,
            params,
        );
    }

    // ============================================
    // SLA Checking (Cron)
    // ============================================

    /** Check SLA violations every 5 minutes across all tenants */
    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('*/5 * * * *')
    async checkAllTenantSLAsCron() {
        await this.cronLock.runExclusive('pipeline.checkAllTenantSLAs', 120, () => this.checkAllTenantSLAs());
    }

    async checkAllTenantSLAs(): Promise<void> {
        try {
            const tenants = await this.prisma.$queryRaw<any[]>`
                SELECT id, schema_name FROM tenants WHERE is_active = true
            `;
            if (!tenants || tenants.length === 0) return;

            for (const tenant of tenants) {
                try {
                    await this.checkSLAViolations(tenant.id);
                } catch (e: any) {
                    this.logger.error(`SLA check failed for tenant ${tenant.id}: ${e.message}`);
                }
            }
        } catch (e: any) {
            this.logger.error(`SLA cron failed: ${e.message}`);
        }
    }

    /** Check SLA violations for a single tenant */
    async checkSLAViolations(tenantId: string): Promise<void> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return;

        // Find deals that have breached their SLA deadline
        const breachedDeals = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT d.id, d.title, d.sla_deadline, d.sla_status, d.stage_id,
                    ps.name as stage_name, ps.slug as stage_slug, ps.sla_hours,
                    d.stage_entered_at,
                    EXTRACT(EPOCH FROM (NOW() - d.sla_deadline)) / 3600 as hours_overdue
             FROM deals d
             JOIN pipeline_stages ps ON d.stage_id = ps.id
             WHERE d.status = 'open'
               AND d.sla_deadline IS NOT NULL
               AND d.sla_deadline < NOW()
               AND d.sla_status != 'breached'`,
        );

        for (const deal of (breachedDeals || [])) {
            // Mark as breached
            await this.prisma.executeInTenantSchema(
                schema,
                `UPDATE deals SET sla_status = 'breached', updated_at = NOW() WHERE id = $1::uuid`,
                [deal.id],
            );

            // Create internal note
            await this.prisma.executeInTenantSchema(
                schema,
                `INSERT INTO notes (lead_id, content, created_by, created_at)
                 SELECT l.id,
                        $2,
                        'system',
                        NOW()
                 FROM leads l
                 JOIN opportunities o ON o.lead_id = l.id
                 WHERE o.deal_id = $1::uuid
                 LIMIT 1`,
                [
                    deal.id,
                    `[SLA BREACHED] Deal "${deal.title}" exceeded SLA in stage "${deal.stage_name}". ` +
                    `SLA limit: ${deal.sla_hours}h. Overdue by ${Math.round(parseFloat(deal.hours_overdue) * 10) / 10}h.`,
                ],
            );

            // Emit event for automation
            this.eventEmitter.emit('pipeline.sla_violated', {
                tenantId,
                dealId: deal.id,
                dealTitle: deal.title,
                stageSlug: deal.stage_slug,
                stageName: deal.stage_name,
                slaHours: deal.sla_hours,
                hoursOverdue: parseFloat(deal.hours_overdue),
            });

            this.logger.warn(`SLA BREACHED: Deal ${deal.id} ("${deal.title}") in stage "${deal.stage_name}" — overdue by ${Math.round(parseFloat(deal.hours_overdue) * 10) / 10}h`);
        }

        // Also mark deals nearing SLA as "at_risk" (within 25% of remaining time)
        const atRiskDeals = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT d.id
             FROM deals d
             JOIN pipeline_stages ps ON d.stage_id = ps.id
             WHERE d.status = 'open'
               AND d.sla_deadline IS NOT NULL
               AND d.sla_status = 'on_track'
               AND ps.sla_hours IS NOT NULL
               AND d.sla_deadline > NOW()
               AND d.sla_deadline < NOW() + (ps.sla_hours * INTERVAL '1 hour' * 0.25)`,
        );

        if (atRiskDeals && atRiskDeals.length > 0) {
            const ids = atRiskDeals.map((d: any) => `'${d.id}'`).join(',');
            await this.prisma.executeInTenantSchema(
                schema,
                `UPDATE deals SET sla_status = 'at_risk', updated_at = NOW()
                 WHERE id IN (${ids}) AND sla_status = 'on_track'`,
            );
        }
    }

    // ============================================
    // Analytics
    // ============================================

    /** Per-stage analytics: count, avg time, conversion rate, SLA breach rate */
    async getStageAnalytics(tenantId: string): Promise<StageAnalytics[]> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return [];

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `WITH stage_stats AS (
                SELECT
                    ps.slug as stage_slug,
                    ps.name as stage_name,
                    ps.position,
                    COUNT(d.id) FILTER (WHERE d.status = 'open') as open_count,
                    AVG(EXTRACT(EPOCH FROM (
                        COALESCE(
                            (SELECT MIN(st2.created_at) FROM stage_transitions st2
                             WHERE st2.deal_id = d.id AND st2.from_stage = ps.id::text
                             AND st2.created_at > d.stage_entered_at),
                            CASE WHEN d.stage_id = ps.id THEN NOW() ELSE d.updated_at END
                        ) - d.stage_entered_at
                    )) / 3600) as avg_time_hours,
                    COUNT(d.id) FILTER (WHERE d.sla_status = 'breached') as breach_count,
                    COUNT(d.id) as total_count
                FROM pipeline_stages ps
                LEFT JOIN deals d ON d.stage_id = ps.id
                GROUP BY ps.slug, ps.name, ps.position
                ORDER BY ps.position ASC
            ),
            transitions AS (
                SELECT
                    st.from_stage,
                    COUNT(*) as exit_count
                FROM stage_transitions st
                GROUP BY st.from_stage
            )
            SELECT
                ss.stage_slug,
                ss.stage_name,
                ss.open_count,
                COALESCE(ss.avg_time_hours, 0) as avg_time_hours,
                ss.total_count,
                ss.breach_count,
                COALESCE(t.exit_count, 0) as exit_count
            FROM stage_stats ss
            LEFT JOIN transitions t ON t.from_stage = ss.stage_slug
            ORDER BY ss.position ASC`,
        );

        return (rows || []).map((r: any) => {
            const totalCount = parseInt(r.total_count) || 0;
            const breachCount = parseInt(r.breach_count) || 0;
            const exitCount = parseInt(r.exit_count) || 0;
            return {
                stage: r.stage_slug,
                stageName: r.stage_name,
                count: parseInt(r.open_count) || 0,
                avgTimeHours: Math.round((parseFloat(r.avg_time_hours) || 0) * 10) / 10,
                conversionRate: totalCount > 0 ? Math.round((exitCount / totalCount) * 100) : 0,
                slaBreachRate: totalCount > 0 ? Math.round((breachCount / totalCount) * 100) : 0,
            };
        });
    }

    // ============================================
    // Auto-progress from conversation signals
    // ============================================

    /**
     * Called by ConversationsService after AI response.
     * Based on signals (complexity, sentiment, keywords), auto-progress the deal stage.
     */
    async autoProgressFromConversation(
        tenantId: string,
        conversationId: string,
        signals: {
            complexity?: number;
            sentiment?: number;
            messageText?: string;
            isFirstAiResponse?: boolean;
            isCustomerReply?: boolean;
            lang?: string;
        },
    ): Promise<void> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return;

        // Find the opportunity linked to this conversation
        const oppRows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT o.id as opp_id, o.stage as opp_stage, o.lead_id
             FROM opportunities o
             WHERE o.conversation_id = $1::uuid
             LIMIT 1`,
            [conversationId],
        );

        if (!oppRows || oppRows.length === 0) return;

        const opp = oppRows[0];
        const messageText = (signals.messageText || '').toLowerCase();
        const tenantStages = await this.getTenantStageCatalog(tenantId, schema);

        // Canonicalization is independent from advancement. Even a turn with no signal,
        // a disabled auto-progress toggle, or a backward target repairs a known legacy
        // generic slug before returning.
        let currentStage: TenantStageMapping;
        try {
            currentStage = resolveTenantNativeStage(tenantStages, opp.opp_stage || undefined);
        } catch (error: any) {
            this.logger.warn(
                `Cannot canonicalize opportunity ${opp.opp_id} stage "${opp.opp_stage || ''}": ${error.message}`,
            );
            return;
        }
        const currentSlug = currentStage.slug;
        if (opp.opp_stage !== currentStage.slug) {
            if (!opp.lead_id) {
                this.logger.warn(`Cannot canonicalize opportunity ${opp.opp_id}: it has no lead_id`);
                return;
            }
            await this.writeLeadStage(tenantId, opp.lead_id, currentStage.slug, {
                schemaName: schema,
                opportunityId: opp.opp_id,
                onlyActiveOpportunities: false,
                triggeredBy: 'canonical_repair',
            });
            this.logger.log(
                `Canonicalized opportunity ${opp.opp_id} stage "${opp.opp_stage || ''}" → "${currentStage.slug}"`,
            );
        }

        if (!(await this.isAutoProgressEnabled(tenantId))) return; // toggle disables advancement, not repair

        // Determine target stage based on signals
        let targetSlug: string | null = null;
        let reason: string | null = null;

        // Priority order: strongest signal first. Keyword sets are per-language so
        // pt/en/fr leads aren't frozen at 'contactado'. (analyzeSentiment is Spanish-only,
        // so the sentiment sub-gate below effectively only sharpens the es path; other
        // languages still advance via the keyword branches.)
        const lang = (signals.lang || 'es').slice(0, 2).toLowerCase();
        const kw = AUTO_PROGRESS_KEYWORDS[lang] || AUTO_PROGRESS_KEYWORDS.es;

        if (this.hasAnyKeyword(messageText, kw.purchase)) {
            targetSlug = 'listo_para_cierre';
            reason = 'Explicit purchase language detected';
        } else if (typeof signals.sentiment === 'number' && signals.sentiment < 20 && this.hasAnyKeyword(messageText, kw.intent)) {
            // Strong positive sentiment (low = positive on the inverted scale) + pricing inquiry
            targetSlug = 'caliente';
            reason = 'Strong purchase intent detected (positive sentiment + pricing inquiry)';
        } else if (this.hasAnyKeyword(messageText, kw.intent)) {
            targetSlug = 'calificado';
            reason = 'Customer asked about pricing/availability';
        } else if (signals.isCustomerReply && this.hasAnyKeyword(messageText, kw.positive)) {
            targetSlug = 'respondio';
            reason = 'Customer replied positively';
        } else if (signals.isFirstAiResponse) {
            targetSlug = 'contactado';
            reason = 'First AI response sent';
        }

        if (!targetSlug) return;

        if (currentStage.is_terminal) return;
        let targetStage: TenantStageMapping;
        try {
            targetStage = resolveTenantNativeStage(tenantStages, targetSlug);
        } catch (error: any) {
            this.logger.warn(`Cannot resolve auto-progress target "${targetSlug}": ${error.message}`);
            return;
        }
        const writeSlug = targetStage.slug;
        const currentIdx = currentStage.position;
        const targetIdx = targetStage.position;

        if (targetIdx <= currentIdx) return; // Already at or past this stage (never move backward)

        // Governance: never auto-advance a card PAST a stage whose prerequisites are unmet
        // (appointment/offer/email/score/...). Soft-hold — leave it where it is rather than
        // parking it in a gated stage a human drag would be refused from. Manual moves
        // enforce the same rules hard.
        if (opp.lead_id) {
            try {
                await this.evaluateRulesForLead(
                    schema,
                    tenantId,
                    opp.lead_id,
                    writeSlug,
                    targetStage.pipeline_id,
                    opp.opp_id,
                );
            } catch (ruleErr: any) {
                const msg = String(ruleErr?.message || '');
                if (msg.includes('TRANSITION_RULE_FAILED')) {
                    this.logger.log(`Auto-progress held conv ${conversationId} at "${currentSlug}": "${writeSlug}" prerequisites unmet (${msg})`);
                } else {
                    this.logger.warn(`Auto-progress rule check errored (holding): ${msg}`);
                }
                return; // hold — do not advance
            }
        }

        if (opp.lead_id) {
            try {
                await this.writeLeadStage(tenantId, opp.lead_id, writeSlug, {
                    schemaName: schema,
                    opportunityId: opp.opp_id,
                    triggeredBy: 'auto_progress',
                    enforceTransitionRules: true,
                });
            } catch (ruleErr: any) {
                if (String(ruleErr?.message || '').includes('TRANSITION_RULE_FAILED')) {
                    this.logger.log(`Auto-progress transaction held conv ${conversationId} at "${currentSlug}"`);
                    return;
                }
                throw ruleErr;
            }
        }

        this.logger.log(`Auto-progressed conversation ${conversationId} to stage "${writeSlug}": ${reason}`);
    }

    /** Per-tenant auto-progression toggle (default ON). Cached in Redis. */
    async isAutoProgressEnabled(tenantId: string): Promise<boolean> {
        const cacheKey = `pipeline:autoprogress:${tenantId}`;
        try {
            const cached = await this.redis.get(cacheKey);
            if (cached === '1') return true;
            if (cached === '0') return false;
        } catch { /* ignore */ }
        let enabled = true; // default ON
        try {
            const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
            if ((t?.settings as any)?.pipeline?.autoProgress === false) enabled = false;
        } catch { /* default ON */ }
        try { await this.redis.set(cacheKey, enabled ? '1' : '0', 300); } catch { /* ignore */ }
        return enabled;
    }

    async setAutoProgressEnabled(tenantId: string, enabled: boolean): Promise<{ enabled: boolean }> {
        const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        const settings: any = { ...((t?.settings as any) || {}) };
        settings.pipeline = { ...(settings.pipeline || {}), autoProgress: enabled };
        await this.prisma.tenant.update({ where: { id: tenantId }, data: { settings } });
        try { await this.redis.set(`pipeline:autoprogress:${tenantId}`, enabled ? '1' : '0', 300); } catch { /* ignore */ }
        return { enabled };
    }

    /**
     * Re-align every opportunity's Kanban deal to its current stage (using the new
     * probability mapping). Fixes deals stuck in the first stage from before the
     * mapping fix — without waiting for each conversation to get a new signal.
     */
    async resyncDeals(tenantId: string): Promise<{ synced: number }> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return { synced: 0 };

        const tenantStages = await this.getTenantStageCatalog(tenantId, schema)
            .catch(() => [] as TenantStageMapping[]);

        let opps: Array<{ id: string; lead_id: string; stage: string }> = [];
        try {
            opps = await this.prisma.executeInTenantSchema<Array<{ id: string; lead_id: string; stage: string }>>(
                schema,
                `SELECT id, lead_id, stage FROM opportunities
                 WHERE lead_id IS NOT NULL
                 ORDER BY updated_at DESC LIMIT 1000`,
                [],
            );
        } catch {
            return { synced: 0 };
        }
        let synced = 0;
        for (const o of opps) {
            try {
                const mapped = resolveTenantNativeStage(tenantStages, o.stage || undefined);
                await this.writeLeadStage(tenantId, o.lead_id, mapped.slug, {
                    schemaName: schema,
                    opportunityId: o.id,
                    onlyActiveOpportunities: false,
                    triggeredBy: 'resync',
                });
                synced++;
            } catch { /* skip individual failures */ }
        }
        return { synced };
    }

    // ============================================
    // Private helpers
    // ============================================

    /** Strip accents + apostrophes + lowercase for accent/quote-insensitive matching. */
    private normalizeForMatch(s: string): string {
        const lowered = (s || '').toLowerCase().normalize('NFD');
        let out = '';
        for (const ch of lowered) {
            const code = ch.codePointAt(0) ?? 0;
            if (code >= 0x300 && code <= 0x36f) continue; // combining diacritical marks
            if (code === 0x27 || code === 0x2019) continue; // straight + curly apostrophes (can't→cant, d'accord→daccord)
            out += ch;
        }
        return out;
    }

    /**
     * Keyword match that is accent/quote-insensitive, respects word boundaries (so 'claro'
     * no longer matches inside 'declaro' and 'bien' inside 'tambien'), and is negation-aware
     * (a negator within the 3 preceding tokens suppresses the match, so 'no me interesa' /
     * "i can't pay" / 'pero,no lo quiero comprar' don't advance the deal).
     */
    private hasAnyKeyword(text: string, keywords: string[]): boolean {
        const hay = this.normalizeForMatch(text);
        if (!hay) return false;
        // Apostrophes are already stripped, so English contractions arrive as cant/wont/etc.
        // 'sin' is deliberately NOT a negator ('sin duda quiero comprar' = affirmative).
        const NEGATORS = new Set([
            'no', 'nunca', 'tampoco', 'ni', 'jamas',           // es
            'nao', 'jamais', 'pas',                            // pt / fr
            'not', 'dont', 'doesnt', 'didnt', 'cant', 'cannot', 'wont', 'wouldnt', 'couldnt', // en
        ]);
        for (const kw of keywords) {
            const needle = this.normalizeForMatch(kw);
            if (!needle) continue;
            const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'g');
            let m: RegExpExecArray | null;
            while ((m = re.exec(hay)) !== null) {
                // Tokenize the preamble on any non-alphanumeric run so a punctuation-glued
                // negator ('pero,no') is still detected.
                const before = hay.slice(0, m.index).split(/[^a-z0-9]+/).filter(Boolean).slice(-3);
                if (!before.some((w) => NEGATORS.has(w))) return true; // matched without negation
                if (re.lastIndex === m.index) re.lastIndex++; // avoid zero-width loop
            }
        }
        return false;
    }

    private static readonly UUID_RE =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    /**
     * Resolve a stage reference (UUID or slug) to a stage UUID.
     * Callers (dashboard, AI tools, automation) sometimes pass a slug like
     * 'interesado' instead of the stage's UUID — casting that to ::uuid fails (22P02).
     * Returns null if no matching stage exists.
     */
    private async resolveStageId(
        schema: string, tenantId: string, stageRef: string, pipelineId?: string,
    ): Promise<string | null> {
        if (!stageRef) return null;
        if (PipelineService.UUID_RE.test(stageRef)) {
            const params: any[] = [stageRef, tenantId];
            let pipelineFilter = '';
            if (pipelineId && PipelineService.UUID_RE.test(pipelineId)) {
                pipelineFilter = ' AND pipeline_id = $3::uuid';
                params.push(pipelineId);
            }
            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT id FROM pipeline_stages
                  WHERE id = $1::uuid AND tenant_id = $2::uuid${pipelineFilter}
                  LIMIT 1`,
                params,
            );
            return rows?.[0]?.id || null;
        }
        try {
            const stage = await this.resolveTenantStage(tenantId, stageRef, {
                schemaName: schema,
                pipelineId: pipelineId && PipelineService.UUID_RE.test(pipelineId) ? pipelineId : undefined,
            });
            return stage.id || null;
        } catch {
            return null;
        }
    }

    /** Move one exact Opportunity through the atomic lead/opportunity/deal/history boundary. */
    async moveOpportunityStage(
        tenantId: string,
        opportunityId: string,
        requestedStage: string,
        triggeredBy = 'agent',
        opportunityPatch?: OpportunityStagePatch,
    ): Promise<TenantStageMapping> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new BadRequestException('Tenant not found');
        const rows = await this.prisma.executeInTenantSchema<Array<{ lead_id: string }>>(
            schema,
            `SELECT lead_id FROM opportunities WHERE id = $1::uuid LIMIT 1`,
            [opportunityId],
        );
        const leadId = rows?.[0]?.lead_id;
        if (!leadId) throw new BadRequestException('Opportunity not found');
        const target = await this.resolveTenantStage(tenantId, requestedStage, { schemaName: schema });
        const result = await this.writeLeadStage(tenantId, leadId, target.slug, {
            schemaName: schema,
            opportunityId,
            onlyActiveOpportunities: true,
            triggeredBy,
            opportunityPatch,
            enforceTransitionRules: true,
        });
        return result.stage;
    }

    private async recordStageTransition(
        schema: string, dealId: string, fromStageId: string | null,
        toStageId: string, changedBy: string, reason: string | null,
    ): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schema,
            `INSERT INTO stage_transitions (deal_id, from_stage, to_stage, changed_by, reason, created_at)
             VALUES ($1::uuid, $2, $3, $4, $5, NOW())`,
            [dealId, fromStageId, toStageId, changedBy, reason],
        );
    }

    private mapDeal(d: any): Deal {
        const stageEnteredAt = d.stage_entered_at ? new Date(d.stage_entered_at) : new Date();
        const daysInStage = Math.floor((Date.now() - stageEnteredAt.getTime()) / (1000 * 60 * 60 * 24));

        // Compute SLA status
        let slaStatus: Deal['slaStatus'] = 'no_sla';
        if (d.sla_status) {
            slaStatus = d.sla_status;
        } else if (d.sla_deadline) {
            const deadline = new Date(d.sla_deadline);
            if (deadline < new Date()) {
                slaStatus = 'breached';
            } else {
                // Check if within 25% of SLA time
                const slaHours = d.sla_hours ? parseInt(d.sla_hours) : null;
                if (slaHours) {
                    const remainingMs = deadline.getTime() - Date.now();
                    const totalMs = slaHours * 60 * 60 * 1000;
                    slaStatus = remainingMs < totalMs * 0.25 ? 'at_risk' : 'on_track';
                } else {
                    slaStatus = 'on_track';
                }
            }
        }

        return {
            id: d.id,
            contactId: d.contact_id,
            contactName: d.contact_name || 'Unknown',
            contactPhone: d.contact_phone || '',
            title: d.title,
            value: parseFloat(d.value) || 0,
            currency: d.currency || 'COP',
            stageId: d.stage_id,
            stageName: d.stage_name,
            probability: parseInt(d.probability) || 0,
            expectedCloseDate: d.expected_close_date,
            assignedAgentId: d.assigned_agent_id,
            assignedAgentName: d.assigned_agent_name,
            notes: d.notes || '',
            tags: d.tags || [],
            createdAt: d.created_at,
            updatedAt: d.updated_at,
            lastActivity: d.updated_at,
            daysInStage,
            slaStatus,
            slaDeadline: d.sla_deadline || null,
        };
    }

    private async getTenantSchema(tenantId: string): Promise<string | null> {
        const cached = await this.redis.get(`tenant:${tenantId}:schema`);
        if (cached) return cached;
        const tenant = await this.prisma.$queryRaw<any[]>`
            SELECT schema_name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1
        `;
        if (tenant?.[0]) {
            await this.redis.set(`tenant:${tenantId}:schema`, tenant[0].schema_name, 3600);
            return tenant[0].schema_name;
        }
        return null;
    }
}
