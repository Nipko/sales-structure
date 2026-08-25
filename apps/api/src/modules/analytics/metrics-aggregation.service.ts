import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../redis/cron-lock.service';

@Injectable()
export class MetricsAggregationService {
    private readonly logger = new Logger(MetricsAggregationService.name);

    constructor(
        private prisma: PrismaService,
        private readonly cronLock: CronLockService,
    ) { }

    /**
     * Nightly cron: aggregate yesterday's metrics into daily_metrics table.
     * Runs at 2:00 AM daily.
     */
    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('0 2 * * *')
    async aggregateYesterdayCron() {
        await this.cronLock.runExclusive('metrics-aggregation.aggregateYesterday', 3600, () => this.aggregateYesterday());
    }

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

        // ── Operational channel-account dimension ──
        const channelAccountRows: any[] = await this.prisma.$queryRawUnsafe(
            `WITH accounts AS (
                SELECT DISTINCT c.channel_type, c.channel_account_id
                FROM "${schemaName}".conversations c
                WHERE c.created_at >= $1::date AND c.created_at < $2::date
                UNION
                SELECT DISTINCT c.channel_type, c.channel_account_id
                FROM "${schemaName}".messages m
                JOIN "${schemaName}".conversations c ON c.id = m.conversation_id
                WHERE m.created_at >= $1::date AND m.created_at < $2::date
             )
             SELECT a.channel_type, a.channel_account_id,
                    (SELECT COUNT(*)::int FROM "${schemaName}".conversations c
                     WHERE c.channel_type = a.channel_type AND c.channel_account_id IS NOT DISTINCT FROM a.channel_account_id
                       AND c.created_at >= $1::date AND c.created_at < $2::date) AS conversations,
                    (SELECT COUNT(*)::int FROM "${schemaName}".messages m
                     JOIN "${schemaName}".conversations c ON c.id = m.conversation_id
                     WHERE c.channel_type = a.channel_type AND c.channel_account_id IS NOT DISTINCT FROM a.channel_account_id
                       AND m.created_at >= $1::date AND m.created_at < $2::date) AS messages,
                    (SELECT COUNT(*)::int FROM "${schemaName}".conversation_assignments ca
                     JOIN "${schemaName}".conversations c ON c.id = ca.conversation_id
                     WHERE c.channel_type = a.channel_type AND c.channel_account_id IS NOT DISTINCT FROM a.channel_account_id
                       AND ca.assigned_at >= $1::date AND ca.assigned_at < $2::date) AS handoffs,
                    (SELECT COALESCE(SUM(m.llm_cost), 0)::numeric FROM "${schemaName}".messages m
                     JOIN "${schemaName}".conversations c ON c.id = m.conversation_id
                     WHERE c.channel_type = a.channel_type AND c.channel_account_id IS NOT DISTINCT FROM a.channel_account_id
                       AND m.created_at >= $1::date AND m.created_at < $2::date) AS llm_cost
             FROM accounts a`,
            date, nextDateStr,
        );

        for (const row of channelAccountRows) {
            await this.upsertMetric(
                schemaName,
                tenantId,
                date,
                'channel_account',
                `${row.channel_type}:${row.channel_account_id || 'unknown'}`,
                {
                    channelType: row.channel_type,
                    channelAccountId: row.channel_account_id,
                    conversations: Number(row.conversations),
                    messages: Number(row.messages),
                    handoffs: Number(row.handoffs),
                    llmCost: Math.round(Number(row.llm_cost) * 10000) / 10000,
                },
            );
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
