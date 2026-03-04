import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// ============================================
// Types
// ============================================

export interface PipelineStage {
    id: string;
    name: string;
    color: string;
    position: number;
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

// ============================================
// Service
// ============================================

@Injectable()
export class PipelineService {
    private readonly logger = new Logger(PipelineService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) { }

    /** Get full Kanban board data */
    async getKanban(tenantId: string): Promise<PipelineKanban> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return { stages: [], forecast: { total: 0, weighted: 0, dealCount: 0, avgDealValue: 0 } };

        const stages = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT id, name, color, position FROM pipeline_stages ORDER BY position ASC`,
        );

        const deals = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT d.*, ct.name as contact_name, ct.phone as contact_phone,
              ps.name as stage_name
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
                color: s.color,
                position: s.position,
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

    /** Create a new deal */
    async createDeal(tenantId: string, data: {
        contactId: string; title: string; value: number; stageId: string;
        probability?: number; expectedCloseDate?: string; assignedAgentId?: string; notes?: string;
    }): Promise<Deal> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        const result = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `INSERT INTO deals (contact_id, title, value, stage_id, probability, expected_close_date,
                          assigned_agent_id, notes, status, created_at, updated_at, stage_entered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', NOW(), NOW(), NOW())
       RETURNING *`,
            [data.contactId, data.title, data.value, data.stageId,
            data.probability || 0, data.expectedCloseDate || null,
            data.assignedAgentId || null, data.notes || ''],
        );

        return this.mapDeal(result[0]);
    }

    /** Move deal to a different stage */
    async moveDeal(tenantId: string, dealId: string, newStageId: string): Promise<void> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return;

        // Get stage probability
        const stageRows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT default_probability FROM pipeline_stages WHERE id = $1`,
            [newStageId],
        );
        const probability = stageRows?.[0]?.default_probability || 0;

        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE deals SET stage_id = $1, probability = $2, stage_entered_at = NOW(), updated_at = NOW()
       WHERE id = $3`,
            [newStageId, probability, dealId],
        );

        this.logger.log(`Deal ${dealId} moved to stage ${newStageId}`);
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
            `UPDATE deals SET ${sets.join(', ')} WHERE id = $1`,
            params,
        );
    }

    /** CRUD for pipeline stages */
    async getStages(tenantId: string): Promise<PipelineStage[]> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return [];

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT ps.*, COUNT(d.id) as deal_count, COALESCE(SUM(d.value), 0) as total_value
       FROM pipeline_stages ps
       LEFT JOIN deals d ON d.stage_id = ps.id AND d.status = 'open'
       GROUP BY ps.id ORDER BY ps.position ASC`,
        );

        return (rows || []).map((r: any) => ({
            id: r.id,
            name: r.name,
            color: r.color,
            position: r.position,
            dealCount: parseInt(r.deal_count) || 0,
            totalValue: parseFloat(r.total_value) || 0,
        }));
    }

    async createStage(tenantId: string, data: { name: string; color: string; defaultProbability?: number }): Promise<void> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return;

        const maxPos = await this.prisma.executeInTenantSchema<any[]>(
            schema, `SELECT COALESCE(MAX(position), 0) + 1 as next_pos FROM pipeline_stages`,
        );

        await this.prisma.executeInTenantSchema(
            schema,
            `INSERT INTO pipeline_stages (tenant_id, name, color, position, default_probability)
       VALUES ($1, $2, $3, $4, $5)`,
            [tenantId, data.name, data.color, maxPos?.[0]?.next_pos || 0, data.defaultProbability || 0],
        );
    }

    private mapDeal(d: any): Deal {
        const stageEnteredAt = d.stage_entered_at ? new Date(d.stage_entered_at) : new Date();
        const daysInStage = Math.floor((Date.now() - stageEnteredAt.getTime()) / (1000 * 60 * 60 * 24));
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
