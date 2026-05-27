import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class AiResolutionService {
    private readonly logger = new Logger(AiResolutionService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) {}

    async ensureResolutionColumns(schemaName: string): Promise<void> {
        const cacheKey = `ai_res_cols:${schemaName}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return;

        const existing = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT column_name FROM information_schema.columns
             WHERE table_schema = $1 AND table_name = 'conversations'
               AND column_name = 'was_handed_off'`,
            [schemaName],
        );

        if (!existing?.length) {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS was_handed_off BOOLEAN DEFAULT false`,
                [],
            );
            await this.prisma.executeInTenantSchema(
                schemaName,
                `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS handoff_at TIMESTAMPTZ`,
                [],
            );
            await this.prisma.executeInTenantSchema(
                schemaName,
                `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_message_count INTEGER DEFAULT 0`,
                [],
            );
            await this.prisma.executeInTenantSchema(
                schemaName,
                `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS resolution_type VARCHAR(50)`,
                [],
            );
            this.logger.log(`Added AI resolution columns to ${schemaName}.conversations`);
        }

        await this.redis.set(cacheKey, '1', 86400);
    }

    async getResolutionStats(tenantId: string, startDate: string, endDate: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureResolutionColumns(schemaName);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE resolution_type = 'ai_resolved')::int AS ai_resolved,
                COUNT(*) FILTER (WHERE resolution_type = 'agent_resolved')::int AS agent_resolved,
                COUNT(*) FILTER (WHERE resolution_type = 'auto_resolved')::int AS auto_resolved,
                COUNT(*) FILTER (WHERE resolution_type = 'unresolved' OR resolution_type IS NULL)::int AS unresolved,
                COALESCE(AVG(ai_message_count) FILTER (WHERE resolution_type IS NOT NULL), 0) AS avg_messages_to_resolution,
                COALESCE(AVG(ai_message_count) FILTER (WHERE was_handed_off = true), 0) AS avg_ai_messages_before_handoff
             FROM conversations
             WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz`,
            [startDate, endDate],
        );

        const r = rows?.[0] || {};
        const total = Number(r.total) || 0;
        const aiResolved = Number(r.ai_resolved) || 0;

        return {
            total,
            aiResolved,
            agentResolved: Number(r.agent_resolved) || 0,
            autoResolved: Number(r.auto_resolved) || 0,
            unresolved: Number(r.unresolved) || 0,
            aiResolutionRate: total > 0 ? Math.round((aiResolved / total) * 10000) / 100 : 0,
            avgMessagesToResolution: Math.round(Number(r.avg_messages_to_resolution) * 100) / 100,
            avgAiMessagesBeforeHandoff: Math.round(Number(r.avg_ai_messages_before_handoff) * 100) / 100,
        };
    }

    async getResolutionTrend(
        tenantId: string,
        startDate: string,
        endDate: string,
        granularity: 'day' | 'week' | 'month' = 'day',
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureResolutionColumns(schemaName);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT
                date_trunc($3, created_at)::text AS period,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE resolution_type = 'ai_resolved')::int AS ai_resolved,
                COUNT(*) FILTER (WHERE resolution_type = 'agent_resolved')::int AS agent_resolved
             FROM conversations
             WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
             GROUP BY date_trunc($3, created_at)
             ORDER BY period ASC`,
            [startDate, endDate, granularity],
        );

        return (rows || []).map((r: any) => {
            const total = Number(r.total) || 0;
            const aiResolved = Number(r.ai_resolved) || 0;
            return {
                period: r.period,
                aiResolved,
                agentResolved: Number(r.agent_resolved) || 0,
                total,
                rate: total > 0 ? Math.round((aiResolved / total) * 10000) / 100 : 0,
            };
        });
    }

    async getResolutionByChannel(tenantId: string, startDate: string, endDate: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureResolutionColumns(schemaName);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT
                channel_type AS channel,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE resolution_type = 'ai_resolved')::int AS ai_resolved
             FROM conversations
             WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz
             GROUP BY channel_type
             ORDER BY total DESC`,
            [startDate, endDate],
        );

        return (rows || []).map((r: any) => {
            const total = Number(r.total) || 0;
            const aiResolved = Number(r.ai_resolved) || 0;
            return {
                channel: r.channel || 'unknown',
                total,
                aiResolved,
                rate: total > 0 ? Math.round((aiResolved / total) * 10000) / 100 : 0,
            };
        });
    }
}
