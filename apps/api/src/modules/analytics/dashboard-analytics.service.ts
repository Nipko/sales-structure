import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

interface DateRange {
    start: string; // YYYY-MM-DD
    end: string;   // YYYY-MM-DD
}

export interface KPI {
    key: string;
    value: number;
    previousValue: number;
    changePercent: number;
}

@Injectable()
export class DashboardAnalyticsService {
    private readonly logger = new Logger(DashboardAnalyticsService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) { }

    // ── Helpers ───────────────────────────────────────────────────

    private computePreviousPeriod(start: string, end: string): DateRange {
        const s = new Date(start);
        const e = new Date(end);
        const days = Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        const prevEnd = new Date(s);
        prevEnd.setDate(prevEnd.getDate() - 1);
        const prevStart = new Date(prevEnd);
        prevStart.setDate(prevStart.getDate() - days + 1);
        return {
            start: prevStart.toISOString().split('T')[0],
            end: prevEnd.toISOString().split('T')[0],
        };
    }

    private changePercent(current: number, previous: number): number {
        if (previous === 0) return current > 0 ? 100 : 0;
        return Math.round(((current - previous) / previous) * 100 * 10) / 10;
    }

    private async getSchemaName(tenantId: string): Promise<string> {
        const cached = await this.redis.get(`tenant:${tenantId}:schema`);
        if (cached) return cached;

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { schemaName: true },
        });
        if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

        await this.redis.set(`tenant:${tenantId}:schema`, tenant.schemaName, 3600);
        return tenant.schemaName;
    }

    // ── 1. Overview KPIs ──────────────────────────────────────────

    async getOverviewKPIs(tenantId: string, start: string, end: string): Promise<{ kpis: KPI[] }> {
        const schema = await this.getSchemaName(tenantId);
        const prev = this.computePreviousPeriod(start, end);

        const [current, previous] = await Promise.all([
            this.fetchPeriodKPIs(schema, start, end),
            this.fetchPeriodKPIs(schema, prev.start, prev.end),
        ]);

        const kpis: KPI[] = [
            {
                key: 'conversations',
                value: current.conversations,
                previousValue: previous.conversations,
                changePercent: this.changePercent(current.conversations, previous.conversations),
            },
            {
                key: 'messages',
                value: current.messages,
                previousValue: previous.messages,
                changePercent: this.changePercent(current.messages, previous.messages),
            },
            {
                key: 'aiResolutionRate',
                value: current.aiResolutionRate,
                previousValue: previous.aiResolutionRate,
                changePercent: this.changePercent(current.aiResolutionRate, previous.aiResolutionRate),
            },
            {
                key: 'avgResponseTime',
                value: current.avgResponseTime,
                previousValue: previous.avgResponseTime,
                changePercent: this.changePercent(current.avgResponseTime, previous.avgResponseTime),
            },
            {
                key: 'csatAvg',
                value: current.csatAvg,
                previousValue: previous.csatAvg,
                changePercent: this.changePercent(current.csatAvg, previous.csatAvg),
            },
            {
                key: 'llmCost',
                value: current.llmCost,
                previousValue: previous.llmCost,
                changePercent: this.changePercent(current.llmCost, previous.llmCost),
            },
        ];

        return { kpis };
    }

    private async fetchPeriodKPIs(schema: string, start: string, end: string) {
        const [convRow, msgRow, resolutionRow, responseRow, csatRow, costRow] = await Promise.all([
            // Conversations count
            this.prisma.$queryRawUnsafe<any[]>(
                `SELECT COUNT(*)::int as count FROM "${schema}".conversations
                 WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')`,
                start, end,
            ),
            // Messages count
            this.prisma.$queryRawUnsafe<any[]>(
                `SELECT COUNT(*)::int as count FROM "${schema}".messages
                 WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')`,
                start, end,
            ),
            // AI resolution rate: resolved conversations without handoff
            this.prisma.$queryRawUnsafe<any[]>(
                `SELECT
                    COUNT(*) FILTER (WHERE status = 'resolved')::int as resolved,
                    COUNT(*) FILTER (WHERE status = 'resolved' AND id NOT IN (
                        SELECT DISTINCT conversation_id FROM "${schema}".conversation_assignments
                    ))::int as ai_resolved,
                    COUNT(*)::int as total
                 FROM "${schema}".conversations
                 WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')`,
                start, end,
            ),
            // Avg first response time (seconds)
            this.prisma.$queryRawUnsafe<any[]>(
                `SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (first_response_at - assigned_at))), 0)::numeric as avg_secs
                 FROM "${schema}".conversation_assignments
                 WHERE assigned_at >= $1::date AND assigned_at < ($2::date + interval '1 day')
                   AND first_response_at IS NOT NULL`,
                start, end,
            ),
            // CSAT average
            this.prisma.$queryRawUnsafe<any[]>(
                `SELECT COALESCE(AVG(rating), 0)::numeric as avg_rating
                 FROM "${schema}".csat_surveys
                 WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')`,
                start, end,
            ),
            // LLM cost
            this.prisma.$queryRawUnsafe<any[]>(
                `SELECT COALESCE(SUM(llm_cost), 0)::numeric as total_cost
                 FROM "${schema}".messages
                 WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')
                   AND llm_cost > 0`,
                start, end,
            ),
        ]);

        const total = Number(resolutionRow[0]?.total || 0);
        const aiResolved = Number(resolutionRow[0]?.ai_resolved || 0);

        return {
            conversations: Number(convRow[0]?.count || 0),
            messages: Number(msgRow[0]?.count || 0),
            aiResolutionRate: total > 0 ? Math.round((aiResolved / total) * 1000) / 10 : 0,
            avgResponseTime: Math.round(Number(responseRow[0]?.avg_secs || 0)),
            csatAvg: Math.round(Number(csatRow[0]?.avg_rating || 0) * 10) / 10,
            llmCost: Math.round(Number(costRow[0]?.total_cost || 0) * 100) / 100,
        };
    }

    // ── 2. Conversations Volume (stacked by channel) ──────────────

    async getConversationsVolume(
        tenantId: string, start: string, end: string,
    ): Promise<{ series: any[] }> {
        const schema = await this.getSchemaName(tenantId);

        const rows = await this.prisma.$queryRawUnsafe<any[]>(
            `SELECT DATE(created_at)::text as date,
                    COALESCE(channel_type, 'whatsapp') as channel,
                    COUNT(*)::int as count
             FROM "${schema}".conversations
             WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')
             GROUP BY DATE(created_at), channel_type
             ORDER BY date`,
            start, end,
        );

        // Pivot: { date, whatsapp, instagram, messenger, telegram }
        const byDate: Record<string, any> = {};
        for (const row of rows) {
            if (!byDate[row.date]) {
                byDate[row.date] = { date: row.date, whatsapp: 0, instagram: 0, messenger: 0, telegram: 0 };
            }
            const ch = row.channel || 'whatsapp';
            if (ch in byDate[row.date]) {
                byDate[row.date][ch] = row.count;
            }
        }

        return { series: Object.values(byDate) };
    }

    // ── 3. Response Times (median + P90) ──────────────────────────

    async getResponseTimes(
        tenantId: string, start: string, end: string,
    ): Promise<{ series: any[] }> {
        const schema = await this.getSchemaName(tenantId);

        const rows = await this.prisma.$queryRawUnsafe<any[]>(
            `SELECT DATE(assigned_at)::text as date,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_response_at - assigned_at)))::numeric as median_response,
                    PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_response_at - assigned_at)))::numeric as p90_response,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (resolved_at - assigned_at)))::numeric as median_resolution,
                    PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (resolved_at - assigned_at)))::numeric as p90_resolution
             FROM "${schema}".conversation_assignments
             WHERE assigned_at >= $1::date AND assigned_at < ($2::date + interval '1 day')
               AND first_response_at IS NOT NULL
             GROUP BY DATE(assigned_at)
             ORDER BY date`,
            start, end,
        );

        return {
            series: rows.map(r => ({
                date: r.date,
                medianResponse: Math.round(Number(r.median_response || 0)),
                p90Response: Math.round(Number(r.p90_response || 0)),
                medianResolution: Math.round(Number(r.median_resolution || 0)),
                p90Resolution: Math.round(Number(r.p90_resolution || 0)),
            })),
        };
    }

    // ── 4. AI Metrics ─────────────────────────────────────────────

    async getAIMetrics(
        tenantId: string, start: string, end: string,
    ): Promise<{
        resolutionRate: number;
        containmentRate: number;
        totalConversations: number;
        aiResolved: number;
        handoffs: number;
        avgCostPerConversation: number;
        totalCost: number;
        modelUsage: any[];
        handoffReasons: any[];
    }> {
        const schema = await this.getSchemaName(tenantId);

        const [statsRow, costRow, modelRows, handoffRows] = await Promise.all([
            // AI resolution + containment
            this.prisma.$queryRawUnsafe<any[]>(
                `SELECT
                    COUNT(*)::int as total,
                    COUNT(*) FILTER (WHERE status = 'resolved')::int as resolved,
                    COUNT(*) FILTER (WHERE status = 'resolved' AND id NOT IN (
                        SELECT DISTINCT conversation_id FROM "${schema}".conversation_assignments
                    ))::int as ai_resolved,
                    COUNT(*) FILTER (WHERE id IN (
                        SELECT DISTINCT conversation_id FROM "${schema}".conversation_assignments
                    ))::int as handoffs
                 FROM "${schema}".conversations
                 WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')`,
                start, end,
            ),
            // Cost breakdown
            this.prisma.$queryRawUnsafe<any[]>(
                `SELECT COALESCE(SUM(llm_cost), 0)::numeric as total_cost,
                        COUNT(DISTINCT conversation_id)::int as conv_count
                 FROM "${schema}".messages
                 WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')
                   AND llm_cost > 0`,
                start, end,
            ),
            // Model usage
            this.prisma.$queryRawUnsafe<any[]>(
                `SELECT COALESCE(llm_model_used, 'unknown') as model,
                        COUNT(*)::int as requests,
                        COALESCE(SUM(llm_cost), 0)::numeric as cost
                 FROM "${schema}".messages
                 WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')
                   AND llm_model_used IS NOT NULL
                 GROUP BY llm_model_used
                 ORDER BY requests DESC`,
                start, end,
            ),
            // Handoff reasons
            this.prisma.$queryRawUnsafe<any[]>(
                `SELECT COALESCE(data->>'reason', 'unknown') as reason, COUNT(*)::int as count
                 FROM "${schema}".analytics_events
                 WHERE event_type = 'handoff_triggered'
                   AND created_at >= $1::date AND created_at < ($2::date + interval '1 day')
                 GROUP BY data->>'reason'
                 ORDER BY count DESC`,
                start, end,
            ),
        ]);

        const total = Number(statsRow[0]?.total || 0);
        const aiResolved = Number(statsRow[0]?.ai_resolved || 0);
        const handoffs = Number(statsRow[0]?.handoffs || 0);
        const totalCost = Number(costRow[0]?.total_cost || 0);
        const convWithCost = Number(costRow[0]?.conv_count || 0);

        return {
            resolutionRate: total > 0 ? Math.round((aiResolved / total) * 1000) / 10 : 0,
            containmentRate: total > 0 ? Math.round(((total - handoffs) / total) * 1000) / 10 : 0,
            totalConversations: total,
            aiResolved,
            handoffs,
            avgCostPerConversation: convWithCost > 0 ? Math.round((totalCost / convWithCost) * 10000) / 10000 : 0,
            totalCost: Math.round(totalCost * 100) / 100,
            modelUsage: modelRows.map(r => ({
                model: r.model,
                requests: r.requests,
                cost: Math.round(Number(r.cost) * 100) / 100,
            })),
            handoffReasons: handoffRows.map(r => ({
                reason: r.reason,
                count: r.count,
            })),
        };
    }

    // ── 5. Heatmap (day x hour) ───────────────────────────────────

    async getHeatmap(
        tenantId: string, start: string, end: string,
    ): Promise<{ data: Array<{ day: number; hour: number; count: number }> }> {
        const schema = await this.getSchemaName(tenantId);

        const rows = await this.prisma.$queryRawUnsafe<any[]>(
            `SELECT EXTRACT(DOW FROM created_at)::int as day,
                    EXTRACT(HOUR FROM created_at)::int as hour,
                    COUNT(*)::int as count
             FROM "${schema}".messages
             WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')
             GROUP BY day, hour
             ORDER BY day, hour`,
            start, end,
        );

        return {
            data: rows.map(r => ({
                day: Number(r.day),
                hour: Number(r.hour),
                count: Number(r.count),
            })),
        };
    }

    // ── 6. Export CSV ─────────────────────────────────────────────

    async exportCSV(tenantId: string, start: string, end: string): Promise<string> {
        const [kpis, volume, responseTimes, ai] = await Promise.all([
            this.getOverviewKPIs(tenantId, start, end),
            this.getConversationsVolume(tenantId, start, end),
            this.getResponseTimes(tenantId, start, end),
            this.getAIMetrics(tenantId, start, end),
        ]);

        const lines: string[] = [];

        // KPIs section
        lines.push('=== KPI Overview ===');
        lines.push('Metric,Value,Previous,Change %');
        for (const k of kpis.kpis) {
            lines.push(`${k.key},${k.value},${k.previousValue},${k.changePercent}%`);
        }

        lines.push('');
        lines.push('=== Conversations by Channel ===');
        lines.push('Date,WhatsApp,Instagram,Messenger,Telegram');
        for (const row of volume.series) {
            lines.push(`${row.date},${row.whatsapp},${row.instagram},${row.messenger},${row.telegram}`);
        }

        lines.push('');
        lines.push('=== Response Times (seconds) ===');
        lines.push('Date,Median Response,P90 Response,Median Resolution,P90 Resolution');
        for (const row of responseTimes.series) {
            lines.push(`${row.date},${row.medianResponse},${row.p90Response},${row.medianResolution},${row.p90Resolution}`);
        }

        lines.push('');
        lines.push('=== AI Metrics ===');
        lines.push(`Resolution Rate,${ai.resolutionRate}%`);
        lines.push(`Containment Rate,${ai.containmentRate}%`);
        lines.push(`Total Conversations,${ai.totalConversations}`);
        lines.push(`AI Resolved,${ai.aiResolved}`);
        lines.push(`Handoffs,${ai.handoffs}`);
        lines.push(`Avg Cost/Conversation,$${ai.avgCostPerConversation}`);
        lines.push(`Total LLM Cost,$${ai.totalCost}`);

        lines.push('');
        lines.push('=== Model Usage ===');
        lines.push('Model,Requests,Cost');
        for (const m of ai.modelUsage) {
            lines.push(`${m.model},${m.requests},$${m.cost}`);
        }

        return lines.join('\n');
    }
}
