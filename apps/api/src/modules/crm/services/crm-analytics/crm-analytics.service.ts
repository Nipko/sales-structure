import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';

@Injectable()
export class CrmAnalyticsService {
    private readonly logger = new Logger(CrmAnalyticsService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) {}

    private async getSchema(tenantId: string): Promise<string> {
        const cached = await this.redis.get(`tenant:${tenantId}:schema`);
        if (cached) return cached;
        const tenant = await this.prisma.$queryRaw<any[]>`SELECT schema_name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1`;
        if (!tenant?.[0]?.schema_name) throw new Error('Tenant not found');
        const schema = tenant[0].schema_name;
        await this.redis.set(`tenant:${tenantId}:schema`, schema, 3600);
        return schema;
    }

    /**
     * Conversion funnel: count leads at each stage with drop-off %
     */
    async getConversionFunnel(tenantId: string, dateFrom?: string, dateTo?: string) {
        const schema = await this.getSchema(tenantId);
        let dateFilter = '';
        const params: any[] = [];
        if (dateFrom) { params.push(dateFrom); dateFilter += ` AND l.created_at >= $${params.length}`; }
        if (dateTo) { params.push(dateTo); dateFilter += ` AND l.created_at <= $${params.length}`; }

        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT l.stage, COUNT(*) as count
             FROM leads l
             WHERE l.archived_at IS NULL ${dateFilter}
             GROUP BY l.stage
             ORDER BY CASE l.stage
                WHEN 'nuevo' THEN 1 WHEN 'contactado' THEN 2 WHEN 'respondio' THEN 3
                WHEN 'calificado' THEN 4 WHEN 'tibio' THEN 5 WHEN 'caliente' THEN 6
                WHEN 'listo_cierre' THEN 7 WHEN 'ganado' THEN 8 WHEN 'perdido' THEN 9
                WHEN 'no_interesado' THEN 10 ELSE 99 END`,
            params,
        );

        const total = rows.reduce((s: number, r: any) => s + Number(r.count), 0);
        return (rows || []).map((r: any) => ({
            stage: r.stage,
            count: Number(r.count),
            percentage: total > 0 ? Math.round((Number(r.count) / total) * 100) : 0,
        }));
    }

    /**
     * Pipeline velocity: average days in each stage
     */
    async getPipelineVelocity(tenantId: string, dateFrom?: string, dateTo?: string) {
        const schema = await this.getSchema(tenantId);
        let dateFilter = '';
        const params: any[] = [];
        if (dateFrom) { params.push(dateFrom); dateFilter += ` AND sh.created_at >= $${params.length}`; }
        if (dateTo) { params.push(dateTo); dateFilter += ` AND sh.created_at <= $${params.length}`; }

        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT sh.from_stage as stage,
                    AVG(EXTRACT(EPOCH FROM (next_sh.created_at - sh.created_at)) / 86400) as avg_days,
                    COUNT(*) as transitions
             FROM stage_history sh
             LEFT JOIN LATERAL (
                SELECT created_at FROM stage_history sh2
                WHERE sh2.lead_id = sh.lead_id AND sh2.created_at > sh.created_at
                ORDER BY sh2.created_at ASC LIMIT 1
             ) next_sh ON true
             WHERE next_sh.created_at IS NOT NULL ${dateFilter}
             GROUP BY sh.from_stage
             ORDER BY CASE sh.from_stage
                WHEN 'nuevo' THEN 1 WHEN 'contactado' THEN 2 WHEN 'respondio' THEN 3
                WHEN 'calificado' THEN 4 WHEN 'tibio' THEN 5 WHEN 'caliente' THEN 6
                WHEN 'listo_cierre' THEN 7 ELSE 99 END`,
            params,
        );

        return (rows || []).map((r: any) => ({
            stage: r.stage,
            avgDays: Math.round(Number(r.avg_days) * 10) / 10,
            transitions: Number(r.transitions),
        }));
    }

    /**
     * Win/loss rate with loss reasons
     */
    async getWinLossRate(tenantId: string, dateFrom?: string, dateTo?: string) {
        const schema = await this.getSchema(tenantId);
        let dateFilter = '';
        const params: any[] = [];
        if (dateFrom) { params.push(dateFrom); dateFilter += ` AND o.updated_at >= $${params.length}`; }
        if (dateTo) { params.push(dateTo); dateFilter += ` AND o.updated_at <= $${params.length}`; }

        const won = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT COUNT(*) as count, COALESCE(SUM(estimated_value), 0) as total_value
             FROM opportunities WHERE stage = 'ganado' ${dateFilter}`, params);
        const lost = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT COUNT(*) as count FROM opportunities WHERE stage IN ('perdido', 'no_interesado') ${dateFilter}`, params);
        const lossReasons = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT COALESCE(loss_reason, 'Sin razón') as reason, COUNT(*) as count
             FROM opportunities WHERE stage IN ('perdido', 'no_interesado') ${dateFilter}
             GROUP BY loss_reason ORDER BY count DESC LIMIT 10`, params);

        const wonCount = Number(won?.[0]?.count || 0);
        const lostCount = Number(lost?.[0]?.count || 0);
        const totalClosed = wonCount + lostCount;

        return {
            won: wonCount,
            lost: lostCount,
            winRate: totalClosed > 0 ? Math.round((wonCount / totalClosed) * 100) : 0,
            totalValue: Number(won?.[0]?.total_value || 0),
            lossReasons: (lossReasons || []).map((r: any) => ({ reason: r.reason, count: Number(r.count) })),
        };
    }

    /**
     * Agent leaderboard: deals closed, avg value per agent
     */
    async getAgentLeaderboard(tenantId: string, dateFrom?: string, dateTo?: string) {
        const schema = await this.getSchema(tenantId);
        let dateFilter = '';
        const params: any[] = [];
        if (dateFrom) { params.push(dateFrom); dateFilter += ` AND o.won_at >= $${params.length}`; }
        if (dateTo) { params.push(dateTo); dateFilter += ` AND o.won_at <= $${params.length}`; }

        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT o.assigned_to as agent_id,
                    TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) as agent_name,
                    COUNT(*) as deals_closed,
                    COALESCE(SUM(o.estimated_value), 0) as total_value,
                    COALESCE(AVG(o.estimated_value), 0) as avg_value
             FROM opportunities o
             LEFT JOIN public.users u ON u.id::text = o.assigned_to
             WHERE o.stage = 'ganado' AND o.assigned_to IS NOT NULL ${dateFilter}
             GROUP BY o.assigned_to, u.first_name, u.last_name
             ORDER BY total_value DESC
             LIMIT 20`,
            params,
        );

        return (rows || []).map((r: any) => ({
            agentId: r.agent_id,
            agentName: r.agent_name?.trim() || r.agent_id || 'Unknown',
            dealsClosed: Number(r.deals_closed),
            totalValue: Number(r.total_value),
            avgValue: Math.round(Number(r.avg_value)),
        }));
    }

    /**
     * Lead source breakdown: by utm_source and campaign
     */
    async getSourceBreakdown(tenantId: string, dateFrom?: string, dateTo?: string) {
        const schema = await this.getSchema(tenantId);
        let dateFilter = '';
        const params: any[] = [];
        if (dateFrom) { params.push(dateFrom); dateFilter += ` AND l.created_at >= $${params.length}`; }
        if (dateTo) { params.push(dateTo); dateFilter += ` AND l.created_at <= $${params.length}`; }

        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT COALESCE(l.utm_source, 'Directo') as source, COUNT(*) as count
             FROM leads l
             WHERE l.archived_at IS NULL ${dateFilter}
             GROUP BY l.utm_source
             ORDER BY count DESC
             LIMIT 15`,
            params,
        );

        return (rows || []).map((r: any) => ({
            source: r.source,
            count: Number(r.count),
        }));
    }

    /**
     * Overview KPIs
     */
    async getOverviewKpis(tenantId: string) {
        const schema = await this.getSchema(tenantId);

        const totalLeads = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT COUNT(*) as count FROM leads WHERE archived_at IS NULL`, []);
        const activeOpps = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT COUNT(*) as count, COALESCE(SUM(estimated_value), 0) as total_value
             FROM opportunities WHERE stage NOT IN ('ganado', 'perdido', 'no_interesado')`, []);
        const avgScore = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT ROUND(AVG(score)::numeric, 1) as avg FROM leads WHERE archived_at IS NULL AND score > 0`, []);
        const convRate = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT
                COUNT(*) FILTER (WHERE stage = 'ganado') as won,
                COUNT(*) FILTER (WHERE stage IN ('ganado', 'perdido', 'no_interesado')) as closed
             FROM leads WHERE archived_at IS NULL`, []);

        const wonCount = Number(convRate?.[0]?.won || 0);
        const closedCount = Number(convRate?.[0]?.closed || 0);

        return {
            totalLeads: Number(totalLeads?.[0]?.count || 0),
            activeOpportunities: Number(activeOpps?.[0]?.count || 0),
            pipelineValue: Number(activeOpps?.[0]?.total_value || 0),
            avgScore: Number(avgScore?.[0]?.avg || 0),
            conversionRate: closedCount > 0 ? Math.round((wonCount / closedCount) * 100) : 0,
        };
    }
}
