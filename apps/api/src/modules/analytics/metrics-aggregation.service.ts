import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MetricsAggregationService {
    private readonly logger = new Logger(MetricsAggregationService.name);

    constructor(private prisma: PrismaService) { }

    /**
     * Nightly cron: aggregate yesterday's metrics into daily_metrics table.
     * Runs at 2:00 AM daily.
     */
    @Cron('0 2 * * *')
    async aggregateYesterday(): Promise<void> {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const dateStr = yesterday.toISOString().split('T')[0];

        this.logger.log(`Starting daily metrics aggregation for ${dateStr}`);

        const tenants = await this.prisma.tenant.findMany({
            where: { isActive: true },
            select: { id: true, schemaName: true },
        });

        for (const tenant of tenants) {
            try {
                await this.aggregateDate(tenant.id, tenant.schemaName, dateStr);
            } catch (error) {
                this.logger.error(`Failed to aggregate metrics for tenant ${tenant.id}: ${error}`);
            }
        }

        this.logger.log(`Completed daily metrics aggregation for ${dateStr} (${tenants.length} tenants)`);
    }

    /**
     * Aggregate metrics for a specific tenant and date.
     * Can also be called manually for backfilling.
     */
    async aggregateDate(tenantId: string, schemaName: string, date: string): Promise<void> {
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);
        const nextDateStr = nextDate.toISOString().split('T')[0];

        // ── Global dimension ──
        const [globalStats]: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT
                (SELECT COUNT(*)::int FROM "${schemaName}".conversations WHERE created_at >= $1::date AND created_at < $2::date) as conversations,
                (SELECT COUNT(*)::int FROM "${schemaName}".messages WHERE created_at >= $1::date AND created_at < $2::date) as messages,
                (SELECT COUNT(*)::int FROM "${schemaName}".conversation_assignments WHERE assigned_at >= $1::date AND assigned_at < $2::date) as handoffs,
                (SELECT COUNT(*)::int FROM "${schemaName}".conversations WHERE status = 'resolved' AND created_at >= $1::date AND created_at < $2::date) as resolved,
                (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (first_response_at - assigned_at))), 0)::numeric
                 FROM "${schemaName}".conversation_assignments
                 WHERE assigned_at >= $1::date AND assigned_at < $2::date AND first_response_at IS NOT NULL) as avg_response_secs,
                (SELECT COALESCE(SUM(llm_cost), 0)::numeric FROM "${schemaName}".messages WHERE created_at >= $1::date AND created_at < $2::date AND llm_cost > 0) as llm_cost,
                (SELECT COALESCE(AVG(rating), 0)::numeric FROM "${schemaName}".csat_surveys WHERE created_at >= $1::date AND created_at < $2::date) as csat_avg`,
            date, nextDateStr,
        );

        await this.upsertMetric(schemaName, tenantId, date, 'global', 'all', {
            conversations: Number(globalStats.conversations),
            messages: Number(globalStats.messages),
            handoffs: Number(globalStats.handoffs),
            resolved: Number(globalStats.resolved),
            avgResponseSecs: Math.round(Number(globalStats.avg_response_secs)),
            llmCost: Math.round(Number(globalStats.llm_cost) * 100) / 100,
            csatAvg: Math.round(Number(globalStats.csat_avg) * 10) / 10,
        });

        // ── Channel dimension ──
        const channelRows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT COALESCE(channel_type, 'whatsapp') as channel, COUNT(*)::int as count
             FROM "${schemaName}".conversations
             WHERE created_at >= $1::date AND created_at < $2::date
             GROUP BY channel_type`,
            date, nextDateStr,
        );

        for (const row of channelRows) {
            await this.upsertMetric(schemaName, tenantId, date, 'channel', row.channel, {
                conversations: row.count,
            });
        }

        // ── Hourly dimension ──
        const hourlyRows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT EXTRACT(HOUR FROM created_at)::int as hour, COUNT(*)::int as count
             FROM "${schemaName}".messages
             WHERE created_at >= $1::date AND created_at < $2::date
             GROUP BY hour ORDER BY hour`,
            date, nextDateStr,
        );

        for (const row of hourlyRows) {
            await this.upsertMetric(schemaName, tenantId, date, 'hourly', String(row.hour), {
                messages: row.count,
            });
        }
    }

    private async upsertMetric(
        schema: string, tenantId: string, date: string,
        dimensionType: string, dimensionId: string,
        metrics: Record<string, any>,
    ): Promise<void> {
        // Check if exists
        const existing: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT id FROM "${schema}".daily_metrics
             WHERE tenant_id = $1 AND metric_date = $2::date
               AND dimension_type = $3 AND COALESCE(dimension_id, '') = $4`,
            tenantId, date, dimensionType, dimensionId || '',
        );

        if (existing.length > 0) {
            await this.prisma.$queryRawUnsafe(
                `UPDATE "${schema}".daily_metrics
                 SET metrics_json = $1::jsonb
                 WHERE id = $2::uuid`,
                JSON.stringify(metrics), existing[0].id,
            );
        } else {
            await this.prisma.$queryRawUnsafe(
                `INSERT INTO "${schema}".daily_metrics (tenant_id, metric_date, dimension_type, dimension_id, metrics_json)
                 VALUES ($1, $2::date, $3, $4, $5::jsonb)`,
                tenantId, date, dimensionType, dimensionId, JSON.stringify(metrics),
            );
        }
    }
}
