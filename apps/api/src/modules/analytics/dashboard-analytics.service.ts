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
        const [convRow, msgRow, resolutionRow, responseRow, csatRow, costRow]: any = await Promise.all([
            // Conversations count
            this.prisma.$queryRawUnsafe(
                `SELECT COUNT(*)::int as count FROM "${schema}".conversations
                 WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')`,
                start, end,
            ),
            // Messages count
            this.prisma.$queryRawUnsafe(
                `SELECT COUNT(*)::int as count FROM "${schema}".messages
                 WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')`,
                start, end,
            ),
            // AI resolution rate: resolved conversations without handoff
            this.prisma.$queryRawUnsafe(
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
            this.prisma.$queryRawUnsafe(
                `SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (first_response_at - assigned_at))), 0)::numeric as avg_secs
                 FROM "${schema}".conversation_assignments
                 WHERE assigned_at >= $1::date AND assigned_at < ($2::date + interval '1 day')
                   AND first_response_at IS NOT NULL`,
                start, end,
            ),
            // CSAT average
            this.prisma.$queryRawUnsafe(
                `SELECT COALESCE(AVG(rating), 0)::numeric as avg_rating
                 FROM "${schema}".csat_surveys
                 WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')`,
                start, end,
            ),
            // LLM cost
            this.prisma.$queryRawUnsafe(
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

        const rows: any[] = await this.prisma.$queryRawUnsafe(
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

        const rows: any[] = await this.prisma.$queryRawUnsafe(
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

        const [statsRow, costRow, modelRows, handoffRows]: any = await Promise.all([
            // AI resolution + containment
            this.prisma.$queryRawUnsafe(
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
            this.prisma.$queryRawUnsafe(
                `SELECT COALESCE(SUM(llm_cost), 0)::numeric as total_cost,
                        COUNT(DISTINCT conversation_id)::int as conv_count
                 FROM "${schema}".messages
                 WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')
                   AND llm_cost > 0`,
                start, end,
            ),
            // Model usage
            this.prisma.$queryRawUnsafe(
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
            this.prisma.$queryRawUnsafe(
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
            modelUsage: modelRows.map((r: any) => ({
                model: r.model,
                requests: r.requests,
                cost: Math.round(Number(r.cost) * 100) / 100,
            })),
            handoffReasons: handoffRows.map((r: any) => ({
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

        const rows: any[] = await this.prisma.$queryRawUnsafe(
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

    // ── 7. Real-time Panel ────────────────────────────────────────

    async getRealtime(tenantId: string): Promise<{
        activeConversations: number;
        agentsOnline: number;
        agentsBusy: number;
        agentsOffline: number;
        queueDepth: number;
        messagesToday: number;
    }> {
        const schema = await this.getSchemaName(tenantId);
        const today = new Date().toISOString().split('T')[0];

        const [activeRow, queueRow, agentRows] = await Promise.all([
            this.prisma.$queryRawUnsafe(
                `SELECT COUNT(*)::int as count FROM "${schema}".conversations
                 WHERE status IN ('active', 'waiting_human', 'with_human')`,
            ),
            this.prisma.$queryRawUnsafe(
                `SELECT COUNT(*)::int as count FROM "${schema}".conversations
                 WHERE status = 'waiting_human'`,
            ),
            this.prisma.user.groupBy({
                by: ['availabilityStatus'],
                where: { tenantId, isActive: true },
                _count: true,
            }),
        ]) as any;

        // Messages today from Redis
        const msgKey = `analytics:${tenantId}:${today}:total`;
        const messagesToday = Number(await this.redis.get(msgKey) || 0);

        const agentMap: Record<string, number> = {};
        for (const row of agentRows) {
            agentMap[row.availabilityStatus] = row._count;
        }

        return {
            activeConversations: Number(activeRow[0]?.count || 0),
            agentsOnline: agentMap['online'] || 0,
            agentsBusy: agentMap['busy'] || 0,
            agentsOffline: agentMap['offline'] || 0,
            queueDepth: Number(queueRow[0]?.count || 0),
            messagesToday,
        };
    }

    // ── 8. Automation Metrics ─────────────────────────────────────

    async getAutomationMetrics(tenantId: string, start: string, end: string): Promise<{
        totalRules: number;
        activeRules: number;
        totalExecutions: number;
        successCount: number;
        failedCount: number;
        successRate: number;
        rulePerformance: any[];
        executionsByDay: any[];
    }> {
        const schema = await this.getSchemaName(tenantId);

        const [rulesRow, execRows, rulePerf, dailyExec]: any = await Promise.all([
            // Total / active rules
            this.prisma.$queryRawUnsafe(
                `SELECT COUNT(*)::int as total,
                        COUNT(*) FILTER (WHERE active = true)::int as active
                 FROM "${schema}".automation_rules`,
            ),
            // Execution stats
            this.prisma.$queryRawUnsafe(
                `SELECT COUNT(*)::int as total,
                        COUNT(*) FILTER (WHERE status = 'success')::int as success,
                        COUNT(*) FILTER (WHERE status = 'failed')::int as failed
                 FROM "${schema}".automation_executions
                 WHERE started_at >= $1::date AND started_at < ($2::date + interval '1 day')`,
                start, end,
            ),
            // Per-rule performance
            this.prisma.$queryRawUnsafe(
                `SELECT r.name, r.trigger_type, r.active,
                        COUNT(e.id)::int as executions,
                        COUNT(e.id) FILTER (WHERE e.status = 'success')::int as success,
                        COUNT(e.id) FILTER (WHERE e.status = 'failed')::int as failed
                 FROM "${schema}".automation_rules r
                 LEFT JOIN "${schema}".automation_executions e ON e.rule_id = r.id
                   AND e.started_at >= $1::date AND e.started_at < ($2::date + interval '1 day')
                 GROUP BY r.id, r.name, r.trigger_type, r.active
                 ORDER BY executions DESC`,
                start, end,
            ),
            // Daily execution volume
            this.prisma.$queryRawUnsafe(
                `SELECT DATE(started_at)::text as date,
                        COUNT(*)::int as total,
                        COUNT(*) FILTER (WHERE status = 'success')::int as success,
                        COUNT(*) FILTER (WHERE status = 'failed')::int as failed
                 FROM "${schema}".automation_executions
                 WHERE started_at >= $1::date AND started_at < ($2::date + interval '1 day')
                 GROUP BY DATE(started_at)
                 ORDER BY date`,
                start, end,
            ),
        ]);

        const totalExec = Number(execRows[0]?.total || 0);
        const successCount = Number(execRows[0]?.success || 0);
        const failedCount = Number(execRows[0]?.failed || 0);

        return {
            totalRules: Number(rulesRow[0]?.total || 0),
            activeRules: Number(rulesRow[0]?.active || 0),
            totalExecutions: totalExec,
            successCount,
            failedCount,
            successRate: totalExec > 0 ? Math.round((successCount / totalExec) * 1000) / 10 : 0,
            rulePerformance: rulePerf.map((r: any) => ({
                name: r.name,
                triggerType: r.trigger_type,
                active: r.active,
                executions: r.executions,
                success: r.success,
                failed: r.failed,
            })),
            executionsByDay: dailyExec.map((r: any) => ({
                date: r.date,
                total: r.total,
                success: r.success,
                failed: r.failed,
            })),
        };
    }

    // ── 9. Broadcast Funnel ───────────────────────────────────────

    async getBroadcastFunnel(tenantId: string, start: string, end: string): Promise<{
        campaigns: any[];
        totals: { sent: number; delivered: number; read: number; failed: number; total: number };
    }> {
        const schema = await this.getSchemaName(tenantId);

        // Check if tables exist
        const tableCheck: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = $1 AND table_name = 'campaigns'
            ) as exists`,
            schema,
        );

        if (!tableCheck[0]?.exists) {
            return { campaigns: [], totals: { sent: 0, delivered: 0, read: 0, failed: 0, total: 0 } };
        }

        const campaigns: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT c.id, c.name, c.status, c.channel, c.starts_at, c.ends_at,
                    COUNT(cr.id)::int as total,
                    COUNT(cr.id) FILTER (WHERE cr.status IN ('sent','delivered','read'))::int as sent,
                    COUNT(cr.id) FILTER (WHERE cr.status IN ('delivered','read'))::int as delivered,
                    COUNT(cr.id) FILTER (WHERE cr.status = 'read')::int as read,
                    COUNT(cr.id) FILTER (WHERE cr.status = 'failed')::int as failed
             FROM "${schema}".campaigns c
             LEFT JOIN "${schema}".campaign_recipients cr ON cr.campaign_id = c.id
             WHERE c.created_at >= $1::date AND c.created_at < ($2::date + interval '1 day')
             GROUP BY c.id, c.name, c.status, c.channel, c.starts_at, c.ends_at
             ORDER BY c.created_at DESC`,
            start, end,
        );

        const totals = { sent: 0, delivered: 0, read: 0, failed: 0, total: 0 };
        for (const c of campaigns) {
            totals.total += c.total;
            totals.sent += c.sent;
            totals.delivered += c.delivered;
            totals.read += c.read;
            totals.failed += c.failed;
        }

        return {
            campaigns: campaigns.map((c: any) => ({
                id: c.id,
                name: c.name,
                status: c.status,
                channel: c.channel,
                startsAt: c.starts_at,
                total: c.total,
                sent: c.sent,
                delivered: c.delivered,
                read: c.read,
                failed: c.failed,
                deliveryRate: c.sent > 0 ? Math.round((c.delivered / c.sent) * 1000) / 10 : 0,
                readRate: c.delivered > 0 ? Math.round((c.read / c.delivered) * 1000) / 10 : 0,
            })),
            totals,
        };
    }

    // ── 10. Anomaly Detection ─────────────────────────────────────

    async getAnomalies(tenantId: string): Promise<{
        anomalies: Array<{ metric: string; date: string; value: number; avg: number; stdDev: number; zScore: number }>;
    }> {
        const schema = await this.getSchemaName(tenantId);
        const today = new Date().toISOString().split('T')[0];
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const startDate = thirtyDaysAgo.toISOString().split('T')[0];

        // Get daily conversation counts for last 30 days
        const dailyRows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT DATE(created_at)::text as date, COUNT(*)::int as conversations,
                    (SELECT COUNT(*)::int FROM "${schema}".messages WHERE DATE(created_at) = DATE(c.created_at)) as messages,
                    (SELECT COUNT(*)::int FROM "${schema}".conversation_assignments WHERE DATE(assigned_at) = DATE(c.created_at)) as handoffs
             FROM "${schema}".conversations c
             WHERE created_at >= $1::date AND created_at < ($2::date + interval '1 day')
             GROUP BY DATE(created_at)
             ORDER BY date`,
            startDate, today,
        );

        if (dailyRows.length < 7) return { anomalies: [] }; // Need at least 7 days

        const anomalies: Array<{ metric: string; date: string; value: number; avg: number; stdDev: number; zScore: number }> = [];

        // Check each metric for anomalies (z-score > 2)
        for (const metric of ['conversations', 'messages', 'handoffs'] as const) {
            const values = dailyRows.map((r: any) => Number(r[metric] || 0));
            const avg = values.reduce((a, b) => a + b, 0) / values.length;
            const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
            const stdDev = Math.sqrt(variance);

            if (stdDev === 0) continue;

            // Check last 3 days for anomalies
            const recentDays = dailyRows.slice(-3);
            for (const day of recentDays) {
                const value = Number(day[metric] || 0);
                const zScore = Math.abs((value - avg) / stdDev);
                if (zScore > 2) {
                    anomalies.push({
                        metric,
                        date: day.date,
                        value,
                        avg: Math.round(avg * 10) / 10,
                        stdDev: Math.round(stdDev * 10) / 10,
                        zScore: Math.round(zScore * 100) / 100,
                    });
                }
            }
        }

        return { anomalies: anomalies.sort((a, b) => b.zScore - a.zScore) };
    }

    // ── 11. Cohort Analysis ───────────────────────────────────────

    async getCohortAnalysis(tenantId: string, months: number = 6): Promise<{
        cohorts: Array<{
            month: string;
            size: number;
            retention: number[]; // % returned in month 0, 1, 2, ...
        }>;
    }> {
        const schema = await this.getSchemaName(tenantId);
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - months);
        const start = startDate.toISOString().split('T')[0];

        // Get first contact month for each contact
        const cohortRows: any[] = await this.prisma.$queryRawUnsafe(
            `WITH contact_cohorts AS (
                SELECT id, TO_CHAR(first_contact_at, 'YYYY-MM') as cohort_month
                FROM "${schema}".contacts
                WHERE first_contact_at >= $1::date
            ),
            contact_activity AS (
                SELECT DISTINCT c.contact_id, TO_CHAR(c.created_at, 'YYYY-MM') as activity_month
                FROM "${schema}".conversations c
                WHERE c.created_at >= $1::date
            )
            SELECT cc.cohort_month,
                   COUNT(DISTINCT cc.id)::int as cohort_size,
                   ca.activity_month,
                   COUNT(DISTINCT cc.id) FILTER (WHERE ca.activity_month IS NOT NULL)::int as active_count
            FROM contact_cohorts cc
            LEFT JOIN contact_activity ca ON ca.contact_id = cc.id
            GROUP BY cc.cohort_month, ca.activity_month
            ORDER BY cc.cohort_month, ca.activity_month`,
            start,
        );

        // Build cohort matrix
        const cohortMap: Record<string, { size: number; monthlyActive: Record<string, number> }> = {};

        for (const row of cohortRows) {
            const cm = row.cohort_month;
            if (!cohortMap[cm]) cohortMap[cm] = { size: row.cohort_size, monthlyActive: {} };
            if (row.activity_month) {
                cohortMap[cm].monthlyActive[row.activity_month] = row.active_count;
            }
        }

        // Convert to retention percentages
        const sortedMonths = Object.keys(cohortMap).sort();
        const cohorts = sortedMonths.map(cohortMonth => {
            const cohort = cohortMap[cohortMonth];
            const retention: number[] = [];
            const cohortDate = new Date(cohortMonth + '-01');

            for (let i = 0; i < months; i++) {
                const checkDate = new Date(cohortDate);
                checkDate.setMonth(checkDate.getMonth() + i);
                const checkMonth = checkDate.toISOString().slice(0, 7);

                if (checkMonth > new Date().toISOString().slice(0, 7)) break;

                const active = cohort.monthlyActive[checkMonth] || 0;
                retention.push(cohort.size > 0 ? Math.round((active / cohort.size) * 1000) / 10 : 0);
            }

            return { month: cohortMonth, size: cohort.size, retention };
        });

        return { cohorts };
    }

    // ── 12. BI API Data Export ─────────────────────────────────────

    async getBIData(tenantId: string, start: string, end: string): Promise<{
        kpis: any;
        timeSeries: any[];
        channelBreakdown: any[];
        aiMetrics: any;
    }> {
        const [kpiData, volume, ai] = await Promise.all([
            this.getOverviewKPIs(tenantId, start, end),
            this.getConversationsVolume(tenantId, start, end),
            this.getAIMetrics(tenantId, start, end),
        ]);

        // Flatten KPIs for BI consumption
        const kpis: Record<string, any> = {};
        for (const k of kpiData.kpis) {
            kpis[k.key] = { value: k.value, previousValue: k.previousValue, changePercent: k.changePercent };
        }

        // Channel aggregation
        const channels: Record<string, number> = { whatsapp: 0, instagram: 0, messenger: 0, telegram: 0 };
        for (const row of volume.series) {
            channels.whatsapp += row.whatsapp || 0;
            channels.instagram += row.instagram || 0;
            channels.messenger += row.messenger || 0;
            channels.telegram += row.telegram || 0;
        }

        return {
            kpis,
            timeSeries: volume.series,
            channelBreakdown: Object.entries(channels).map(([channel, count]) => ({ channel, count })),
            aiMetrics: {
                resolutionRate: ai.resolutionRate,
                containmentRate: ai.containmentRate,
                handoffs: ai.handoffs,
                totalCost: ai.totalCost,
                avgCostPerConversation: ai.avgCostPerConversation,
                modelUsage: ai.modelUsage,
            },
        };
    }
}
