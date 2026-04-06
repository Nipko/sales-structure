import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

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

/** Default pipeline stages seeded per tenant */
export const DEFAULT_PIPELINE_STAGES = [
    { slug: 'nuevo', name: 'Nuevo', color: '#95a5a6', position: 0, sla_hours: 1, is_terminal: false, default_probability: 10 },
    { slug: 'contactado', name: 'Contactado', color: '#3498db', position: 1, sla_hours: 4, is_terminal: false, default_probability: 20 },
    { slug: 'respondio', name: 'Respondió', color: '#9b59b6', position: 2, sla_hours: 24, is_terminal: false, default_probability: 30 },
    { slug: 'calificado', name: 'Calificado', color: '#e67e22', position: 3, sla_hours: 48, is_terminal: false, default_probability: 50 },
    { slug: 'tibio', name: 'Tibio', color: '#f39c12', position: 4, sla_hours: 72, is_terminal: false, default_probability: 60 },
    { slug: 'caliente', name: 'Caliente', color: '#e74c3c', position: 5, sla_hours: 48, is_terminal: false, default_probability: 80 },
    { slug: 'listo_para_cierre', name: 'Listo para cierre', color: '#27ae60', position: 6, sla_hours: 24, is_terminal: false, default_probability: 95 },
    { slug: 'ganado', name: 'Ganado', color: '#2ecc71', position: 7, sla_hours: null, is_terminal: true, default_probability: 100 },
    { slug: 'perdido', name: 'Perdido', color: '#7f8c8d', position: 8, sla_hours: null, is_terminal: true, default_probability: 0 },
    { slug: 'no_interesado', name: 'No interesado', color: '#bdc3c7', position: 9, sla_hours: null, is_terminal: true, default_probability: 0 },
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
    ) {}

    // ============================================
    // Stages
    // ============================================

    /** Get all pipeline stages with order, SLA config, deal counts */
    async getStages(tenantId: string): Promise<PipelineStage[]> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return [];

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT ps.*,
                    COUNT(d.id) as deal_count,
                    COALESCE(SUM(d.value), 0) as total_value
             FROM pipeline_stages ps
             LEFT JOIN deals d ON d.stage_id = ps.id AND d.status = 'open'
             GROUP BY ps.id
             ORDER BY ps.position ASC`,
        );

        return (rows || []).map((r: any) => ({
            id: r.id,
            name: r.name,
            slug: r.slug || r.name,
            color: r.color,
            position: r.position,
            slaHours: r.sla_hours != null ? parseInt(r.sla_hours) : null,
            isTerminal: r.is_terminal || false,
            defaultProbability: parseInt(r.default_probability) || 0,
            dealCount: parseInt(r.deal_count) || 0,
            totalValue: parseFloat(r.total_value) || 0,
        }));
    }

    /** Create a new pipeline stage */
    async createStage(tenantId: string, data: {
        name: string; color: string; defaultProbability?: number;
        slug?: string; slaHours?: number; isTerminal?: boolean;
    }): Promise<void> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return;

        const maxPos = await this.prisma.executeInTenantSchema<any[]>(
            schema, `SELECT COALESCE(MAX(position), 0) + 1 as next_pos FROM pipeline_stages`,
        );

        await this.prisma.executeInTenantSchema(
            schema,
            `INSERT INTO pipeline_stages (tenant_id, name, slug, color, position, default_probability, sla_hours, is_terminal)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                tenantId,
                data.name,
                data.slug || data.name.toLowerCase().replace(/\s+/g, '_'),
                data.color,
                maxPos?.[0]?.next_pos || 0,
                data.defaultProbability || 0,
                data.slaHours ?? null,
                data.isTerminal ?? false,
            ],
        );
    }

    // ============================================
    // Deals
    // ============================================

    /** Get full Kanban board data */
    async getKanban(tenantId: string): Promise<PipelineKanban> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return { stages: [], forecast: { total: 0, weighted: 0, dealCount: 0, avgDealValue: 0 } };

        const stages = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT id, name, slug, color, position, sla_hours, is_terminal, default_probability
             FROM pipeline_stages ORDER BY position ASC`,
        );

        const deals = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT d.*, ct.name as contact_name, ct.phone as contact_phone,
                    ps.name as stage_name, ps.sla_hours
             FROM deals d
             LEFT JOIN contacts ct ON d.contact_id = ct.id
             LEFT JOIN pipeline_stages ps ON d.stage_id = ps.id
             WHERE d.status = 'open'
             ORDER BY d.updated_at DESC`,
        );

        const kanbanStages = (stages || []).map((s: any) => {
            const stageDeals = (deals || []).filter((d: any) => d.stage_id === s.id);
            const totalValue = stageDeals.reduce((sum: number, d: any) => sum + parseFloat(d.value || 0), 0);
            return {
                id: s.id,
                name: s.name,
                slug: s.slug || s.name,
                color: s.color,
                position: s.position,
                slaHours: s.sla_hours != null ? parseInt(s.sla_hours) : null,
                isTerminal: s.is_terminal || false,
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
        slaStatus?: 'on_track' | 'at_risk' | 'breached';
    }): Promise<Deal[]> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return [];

        let query = `SELECT d.*, ct.name as contact_name, ct.phone as contact_phone,
                            ps.name as stage_name, ps.sla_hours
                     FROM deals d
                     LEFT JOIN contacts ct ON d.contact_id = ct.id
                     LEFT JOIN pipeline_stages ps ON d.stage_id = ps.id
                     WHERE 1=1`;
        const params: any[] = [];
        let paramIdx = 1;

        if (filters?.stageId) {
            query += ` AND d.stage_id = $${paramIdx++}`;
            params.push(filters.stageId);
        }
        if (filters?.status) {
            query += ` AND d.status = $${paramIdx++}`;
            params.push(filters.status);
        } else {
            query += ` AND d.status = 'open'`;
        }
        if (filters?.assignedAgentId) {
            query += ` AND d.assigned_agent_id = $${paramIdx++}`;
            params.push(filters.assignedAgentId);
        }

        query += ` ORDER BY d.updated_at DESC`;

        const rows = await this.prisma.executeInTenantSchema<any[]>(schema, query, params);
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
        probability?: number; expectedCloseDate?: string; assignedAgentId?: string; notes?: string;
    }): Promise<Deal> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        // Get stage info for SLA deadline
        const stageRows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT sla_hours, default_probability, name FROM pipeline_stages WHERE id = $1::uuid`,
            [data.stageId],
        );
        const stage = stageRows?.[0];
        const probability = data.probability ?? (stage?.default_probability || 0);
        const slaDeadline = stage?.sla_hours
            ? `NOW() + INTERVAL '${parseInt(stage.sla_hours)} hours'`
            : 'NULL';

        const result = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `INSERT INTO deals (contact_id, title, value, stage_id, probability, expected_close_date,
                                assigned_agent_id, notes, status, sla_deadline,
                                created_at, updated_at, stage_entered_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', ${slaDeadline}, NOW(), NOW(), NOW())
             RETURNING *`,
            [data.contactId, data.title, data.value, data.stageId,
                probability, data.expectedCloseDate || null,
                data.assignedAgentId || null, data.notes || ''],
        );

        // Record initial stage transition
        await this.recordStageTransition(schema, result[0].id, null, data.stageId, 'system', 'Deal created');

        return this.mapDeal(result[0]);
    }

    /** Move a deal to a new stage with validation, audit, and SLA */
    async moveToStage(tenantId: string, dealId: string, newStageId: string, agentId?: string, reason?: string): Promise<void> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return;

        // Get current deal state
        const dealRows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT d.stage_id, ps.is_terminal as current_is_terminal, ps.slug as current_slug
             FROM deals d
             LEFT JOIN pipeline_stages ps ON d.stage_id = ps.id
             WHERE d.id = $1::uuid`,
            [dealId],
        );
        if (!dealRows || dealRows.length === 0) {
            throw new Error('Deal not found');
        }

        const currentDeal = dealRows[0];
        if (currentDeal.current_is_terminal) {
            throw new Error(`Cannot move deal from terminal stage '${currentDeal.current_slug}'`);
        }

        // Get new stage info
        const newStageRows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT id, sla_hours, default_probability, is_terminal, slug FROM pipeline_stages WHERE id = $1::uuid`,
            [newStageId],
        );
        if (!newStageRows || newStageRows.length === 0) {
            throw new Error('Target stage not found');
        }
        const newStage = newStageRows[0];
        const probability = newStage.default_probability || 0;

        // Calculate SLA deadline for new stage
        const slaDeadline = newStage.sla_hours
            ? `NOW() + INTERVAL '${parseInt(newStage.sla_hours)} hours'`
            : 'NULL';

        // Determine deal status based on terminal stages
        let statusUpdate = '';
        if (newStage.is_terminal) {
            if (newStage.slug === 'ganado') {
                statusUpdate = `, status = 'won'`;
            } else {
                statusUpdate = `, status = 'lost'`;
            }
        }

        // Update deal
        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE deals
             SET stage_id = $1, probability = $2, stage_entered_at = NOW(),
                 updated_at = NOW(), sla_deadline = ${slaDeadline}, sla_status = 'on_track'${statusUpdate}
             WHERE id = $3::uuid`,
            [newStageId, probability, dealId],
        );

        // Record audit trail
        await this.recordStageTransition(
            schema, dealId, currentDeal.stage_id, newStageId,
            agentId || 'system', reason || null,
        );

        // Emit event for automation
        this.eventEmitter.emit('pipeline.stage_changed', {
            tenantId,
            dealId,
            fromStageId: currentDeal.stage_id,
            toStageId: newStageId,
            toStageSlug: newStage.slug,
            changedBy: agentId || 'system',
            reason,
        });

        this.logger.log(`Deal ${dealId} moved to stage ${newStage.slug} (${newStageId})`);
    }

    /** Backward-compatible alias for moveDeal */
    async moveDeal(tenantId: string, dealId: string, newStageId: string): Promise<void> {
        return this.moveToStage(tenantId, dealId, newStageId);
    }

    /** Update a deal */
    async updateDeal(tenantId: string, dealId: string, data: Partial<{
        title: string; value: number; probability: number; expectedCloseDate: string;
        assignedAgentId: string; notes: string; status: string;
    }>): Promise<void> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return;

        const sets: string[] = ['updated_at = NOW()'];
        const params: any[] = [dealId];
        let i = 2;

        if (data.title) { sets.push(`title = $${i++}`); params.push(data.title); }
        if (data.value !== undefined) { sets.push(`value = $${i++}`); params.push(data.value); }
        if (data.probability !== undefined) { sets.push(`probability = $${i++}`); params.push(data.probability); }
        if (data.expectedCloseDate) { sets.push(`expected_close_date = $${i++}`); params.push(data.expectedCloseDate); }
        if (data.assignedAgentId) { sets.push(`assigned_agent_id = $${i++}`); params.push(data.assignedAgentId); }
        if (data.notes !== undefined) { sets.push(`notes = $${i++}`); params.push(data.notes); }
        if (data.status) { sets.push(`status = $${i++}`); params.push(data.status); }

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
    @Cron('*/5 * * * *')
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
                 SELECT o.lead_id,
                        $2,
                        'system',
                        NOW()
                 FROM opportunities o WHERE o.deal_id = $1 LIMIT 1`,
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
        const currentSlug = opp.opp_stage || 'nuevo';

        // Determine target stage based on signals
        let targetSlug: string | null = null;
        let reason: string | null = null;

        // Priority order: strongest signal first
        const purchaseKeywords = ['comprar', 'quiero inscribirme', 'inscribo', 'matricula', 'reservar', 'pagar', 'tómelo', 'lo quiero', 'confirmo', 'confirmar'];
        const intentKeywords = ['precio', 'costo', 'cuánto', 'cuanto', 'valor', 'tarifa', 'disponibilidad', 'disponible', 'cupos', 'horario', 'fecha', 'cuando'];
        const positiveKeywords = ['interesante', 'me interesa', 'suena bien', 'genial', 'perfecto', 'excelente', 'dale', 'claro', 'sí', 'bueno'];

        if (this.hasAnyKeyword(messageText, purchaseKeywords)) {
            targetSlug = 'listo_para_cierre';
            reason = 'Explicit purchase language detected';
        } else if ((signals.sentiment && signals.sentiment < 20) && this.hasAnyKeyword(messageText, intentKeywords)) {
            // Strong positive sentiment + pricing inquiry
            targetSlug = 'caliente';
            reason = 'Strong purchase intent detected (positive sentiment + pricing inquiry)';
        } else if (this.hasAnyKeyword(messageText, intentKeywords)) {
            targetSlug = 'calificado';
            reason = 'Customer asked about pricing/availability';
        } else if (signals.isCustomerReply && this.hasAnyKeyword(messageText, positiveKeywords)) {
            targetSlug = 'respondio';
            reason = 'Customer replied positively';
        } else if (signals.isFirstAiResponse) {
            targetSlug = 'contactado';
            reason = 'First AI response sent';
        }

        if (!targetSlug) return;

        // Only progress forward (never backward)
        const stageOrder = DEFAULT_PIPELINE_STAGES.map(s => s.slug);
        const currentIdx = stageOrder.indexOf(currentSlug);
        const targetIdx = stageOrder.indexOf(targetSlug);

        if (targetIdx <= currentIdx) return; // Already at or past this stage

        // Update the opportunity stage
        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE opportunities SET stage = $1, updated_at = NOW() WHERE id = $2::uuid`,
            [targetSlug, opp.opp_id],
        );

        // Update the lead stage too
        if (opp.lead_id) {
            await this.prisma.executeInTenantSchema(
                schema,
                `UPDATE leads SET stage = $1, updated_at = NOW() WHERE id = $2::uuid`,
                [targetSlug, opp.lead_id],
            );
        }

        this.logger.log(`Auto-progressed conversation ${conversationId} to stage "${targetSlug}": ${reason}`);
    }

    // ============================================
    // Private helpers
    // ============================================

    private hasAnyKeyword(text: string, keywords: string[]): boolean {
        return keywords.some(kw => text.includes(kw));
    }

    private async recordStageTransition(
        schema: string, dealId: string, fromStageId: string | null,
        toStageId: string, changedBy: string, reason: string | null,
    ): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schema,
            `INSERT INTO stage_transitions (deal_id, from_stage, to_stage, changed_by, reason, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
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
