import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const OPEN = `o.stage NOT IN ('ganado', 'perdido', 'no_interesado')`;
const COMMITTED_THRESHOLD = 80; // stage probability ≥ this counts as "committed"

/**
 * Pipeline forecasting (T3.21): weighted pipeline value (Σ value × stage
 * probability), committed / best-case, per-stage breakdown, and a basic
 * velocity-based projection. Works on `opportunities` joined to
 * `pipeline_stages` (by slug) — consistent with CRM analytics.
 */
@Injectable()
export class ForecastingService {
    private readonly logger = new Logger(ForecastingService.name);

    constructor(private readonly prisma: PrismaService) {}

    private async schema(tenantId: string): Promise<string> {
        const s = await this.prisma.getTenantSchemaName(tenantId);
        if (!s) throw new NotFoundException('Tenant not found');
        return s;
    }

    async getForecast(tenantId: string): Promise<any> {
        const schemaName = await this.schema(tenantId);

        const totals = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT
                COUNT(*)::int AS open_count,
                COALESCE(SUM(o.estimated_value), 0) AS total_value,
                COALESCE(SUM(o.estimated_value * COALESCE(ps.default_probability, 0) / 100.0), 0) AS weighted_value,
                COALESCE(SUM(CASE WHEN COALESCE(ps.default_probability, 0) >= ${COMMITTED_THRESHOLD} THEN o.estimated_value ELSE 0 END), 0) AS committed_value
             FROM opportunities o
             LEFT JOIN pipeline_stages ps ON ps.slug = o.stage
             WHERE ${OPEN}`,
            [],
        );

        const byStage = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT o.stage,
                    COALESCE(ps.name, o.stage) AS stage_name,
                    COALESCE(ps.default_probability, 0) AS probability,
                    COALESCE(ps.position, 99) AS position,
                    COUNT(*)::int AS count,
                    COALESCE(SUM(o.estimated_value), 0) AS value,
                    COALESCE(SUM(o.estimated_value * COALESCE(ps.default_probability, 0) / 100.0), 0) AS weighted
             FROM opportunities o
             LEFT JOIN pipeline_stages ps ON ps.slug = o.stage
             WHERE ${OPEN}
             GROUP BY o.stage, ps.name, ps.default_probability, ps.position
             ORDER BY position ASC`,
            [],
        );

        // Velocity: average days from creation to win over the last 90 days.
        const velocity = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT AVG(EXTRACT(EPOCH FROM (won_at - created_at)) / 86400) AS avg_days_to_win,
                    COUNT(*)::int AS won_last_90d
             FROM opportunities
             WHERE stage = 'ganado' AND won_at IS NOT NULL AND won_at >= NOW() - INTERVAL '90 days'`,
            [],
        );

        const t = totals?.[0] || {};
        const v = velocity?.[0] || {};
        const round = (n: any) => Math.round((Number(n) || 0) * 100) / 100;
        const avgDaysToWin = v.avg_days_to_win != null ? Math.round(Number(v.avg_days_to_win)) : null;
        const wonLast90 = Number(v.won_last_90d) || 0;

        return {
            openCount: Number(t.open_count) || 0,
            totalPipeline: round(t.total_value),
            weightedPipeline: round(t.weighted_value),
            committedValue: round(t.committed_value),
            bestCase: round(t.total_value),
            velocity: {
                avgDaysToWin,
                wonLast90Days: wonLast90,
                monthlyWinRate: Math.round((wonLast90 / 3) * 10) / 10, // wins per month
            },
            byStage: (byStage || []).map((s) => ({
                stage: s.stage,
                stageName: s.stage_name,
                probability: Number(s.probability) || 0,
                count: Number(s.count) || 0,
                value: round(s.value),
                weighted: round(s.weighted),
            })),
        };
    }

    /** Open opportunities with no movement for ≥ rottingDays (live query). */
    async getRotting(tenantId: string, rottingDays: number): Promise<any[]> {
        const schemaName = await this.schema(tenantId);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT o.id, o.stage, o.estimated_value, o.currency, o.updated_at,
                    FLOOR(EXTRACT(EPOCH FROM (NOW() - o.updated_at)) / 86400)::int AS days_stale,
                    l.id AS lead_id, l.first_name, l.last_name, l.assigned_to,
                    co.name AS company_name
             FROM opportunities o
             JOIN leads l ON l.id = o.lead_id
             LEFT JOIN companies co ON co.id = l.company_id
             WHERE o.${OPEN}
               AND o.updated_at < NOW() - ($1 || ' days')::interval
             ORDER BY o.updated_at ASC
             LIMIT 100`,
            [String(rottingDays)],
        );
        return (rows || []).map((r) => ({
            id: r.id,
            leadId: r.lead_id,
            name: `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.company_name || '—',
            companyName: r.company_name,
            stage: r.stage,
            value: Number(r.estimated_value) || 0,
            currency: r.currency,
            daysStale: Number(r.days_stale) || 0,
            assignedTo: r.assigned_to,
            updatedAt: r.updated_at,
        }));
    }
}
