import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AnalyticsEventType } from '@parallext/shared';

export interface TrackEventParams {
    tenantId: string;
    eventType: AnalyticsEventType;
    conversationId?: string;
    contactId?: string;
    data?: Record<string, unknown>;
}

export interface DashboardMetrics {
    today: {
        conversations: number;
        messages: number;
        handoffs: number;
        llmCost: number;
    };
    models: Array<{ model: string; requests: number; cost: number }>;
    hourlyVolume: Array<{ hour: number; count: number }>;
}

@Injectable()
export class AnalyticsService {
    private readonly logger = new Logger(AnalyticsService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) { }

    /**
     * Track an analytics event (fire-and-forget pattern with Redis buffer)
     */
    async trackEvent(params: TrackEventParams): Promise<void> {
        const { tenantId, eventType, conversationId, contactId, data } = params;
        const timestamp = new Date().toISOString();

        // 1. Push to Redis for real-time counters (fast path)
        const today = timestamp.split('T')[0]; // YYYY-MM-DD
        const hour = new Date().getHours();
        const pipeline = [
            // Daily counter by event type
            `analytics:${tenantId}:${today}:${eventType}`,
            // Hourly volume
            `analytics:${tenantId}:${today}:hourly:${hour}`,
            // Global daily counter
            `analytics:${tenantId}:${today}:total`,
        ];

        for (const key of pipeline) {
            await this.redis.incr(key);
            await this.redis.expire(key, 7 * 86400); // 7 days TTL
        }

        // 2. Track model usage if applicable
        if (eventType === 'model_used' && data?.model) {
            const modelKey = `analytics:${tenantId}:${today}:model:${data.model}`;
            await this.redis.incr(modelKey);
            await this.redis.expire(modelKey, 7 * 86400);

            // Track cost
            if (data.cost) {
                const costKey = `analytics:${tenantId}:${today}:cost`;
                await this.redis.incrByFloat(costKey, data.cost as number);
                await this.redis.expire(costKey, 7 * 86400);
            }
        }

        // 3. Persist to database (async, non-blocking)
        this.persistEvent(tenantId, eventType, conversationId, contactId, data, timestamp)
            .catch(err => this.logger.error(`Failed to persist event: ${err}`));
    }

    /**
     * Persist event to tenant's analytics_events table
     */
    private async persistEvent(
        tenantId: string,
        eventType: string,
        conversationId?: string,
        contactId?: string,
        data?: Record<string, unknown>,
        timestamp?: string,
    ): Promise<void> {
        const schemaName = await this.getSchemaName(tenantId);
        if (!schemaName) return;

        await this.prisma.executeInTenantSchema(schemaName,
            `INSERT INTO analytics_events (id, event_type, conversation_id, contact_id, data, created_at)
       VALUES (gen_random_uuid(), $1, $2::uuid, $3::uuid, $4::jsonb, $5::timestamp)`,
            [eventType, conversationId || null, contactId || null, JSON.stringify(data || {}), timestamp]
        );
    }

    /**
     * Get dashboard metrics for a tenant (Redis fast path + DB fallback)
     */
    async getDashboardMetrics(tenantId: string): Promise<DashboardMetrics> {
        const today = new Date().toISOString().split('T')[0];

        // 1. Today's counters from Redis
        const [redisConvos, redisMessages, redisHandoffs, costStr] = await Promise.all([
            this.redis.get(`analytics:${tenantId}:${today}:conversation_started`) || '0',
            this.redis.get(`analytics:${tenantId}:${today}:total`) || '0',
            this.redis.get(`analytics:${tenantId}:${today}:handoff_triggered`) || '0',
            this.redis.get(`analytics:${tenantId}:${today}:cost`) || '0',
        ]);

        let conversations = parseInt(redisConvos as string);
        let messages = parseInt(redisMessages as string);
        let handoffs = parseInt(redisHandoffs as string);

        // DB fallback if Redis counters are zero
        if (conversations === 0 || messages === 0) {
            const schemaName = await this.getSchemaName(tenantId);
            if (schemaName) {
                try {
                    const [convoRows, msgRows, handoffRows] = await Promise.all([
                        this.prisma.executeInTenantSchema<Array<{ cnt: string }>>(
                            schemaName,
                            `SELECT COUNT(*) as cnt FROM conversations WHERE created_at >= CURRENT_DATE`
                        ),
                        this.prisma.executeInTenantSchema<Array<{ cnt: string }>>(
                            schemaName,
                            `SELECT COUNT(*) as cnt FROM messages WHERE created_at >= CURRENT_DATE`
                        ),
                        this.prisma.executeInTenantSchema<Array<{ cnt: string }>>(
                            schemaName,
                            `SELECT COUNT(*) as cnt FROM conversations WHERE status IN ('waiting_human', 'with_human') AND updated_at >= CURRENT_DATE`
                        ),
                    ]);
                    conversations = Math.max(conversations, parseInt(convoRows[0]?.cnt ?? '0'));
                    messages = Math.max(messages, parseInt(msgRows[0]?.cnt ?? '0'));
                    handoffs = Math.max(handoffs, parseInt(handoffRows[0]?.cnt ?? '0'));
                } catch {
                    // Schema may be outdated
                }
            }
        }

        // 2. Model usage distribution
        const modelNames = ['gpt-4o', 'gpt-4o-mini', 'gemini-flash', 'gemini-pro', 'deepseek', 'grok', 'claude-sonnet'];
        const models = await Promise.all(
            modelNames.map(async (model) => {
                const requests = parseInt(
                    await this.redis.get(`analytics:${tenantId}:${today}:model:${model}`) || '0'
                );
                return { model, requests, cost: 0 }; // cost computed by router
            })
        );

        // 3. Hourly volume (last 24 hours)
        const hourlyVolume = await Promise.all(
            Array.from({ length: 24 }, async (_, h) => {
                const count = parseInt(
                    await this.redis.get(`analytics:${tenantId}:${today}:hourly:${h}`) || '0'
                );
                return { hour: h, count };
            })
        );

        return {
            today: {
                conversations,
                messages,
                handoffs,
                llmCost: parseFloat(costStr as string),
            },
            models: models.filter(m => m.requests > 0),
            hourlyVolume,
        };
    }

    /**
     * Get metrics for a date range (from database)
     */
    async getMetricsRange(tenantId: string, startDate: string, endDate: string) {
        const schemaName = await this.getSchemaName(tenantId);
        if (!schemaName) return [];

        const events = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT event_type, COUNT(*) as count, DATE(created_at) as date
       FROM analytics_events
       WHERE created_at >= $1 AND created_at <= $2
       GROUP BY event_type, DATE(created_at)
       ORDER BY date DESC`,
            [startDate, endDate]
        );

        return events;
    }

    /**
     * Commercial overview — combines Redis real-time counters + DB queries.
     * Falls back to direct DB counts when Redis counters are zero (e.g. events not tracked yet).
     */
    async getCommercialOverview(tenantId: string): Promise<{
        leadsToday: number;
        leadsHot: number;
        leadsReadyToClose: number;
        conversations: number;
        handoffs: number;
        llmCostToday: number;
        messagesProcessed: number;
    }> {
        const today = new Date().toISOString().split('T')[0];
        const schemaName = await this.getSchemaName(tenantId);
        if (!schemaName) {
            return {
                leadsToday: 0,
                leadsHot: 0,
                leadsReadyToClose: 0,
                conversations: 0,
                handoffs: 0,
                llmCostToday: 0,
                messagesProcessed: 0,
            };
        }

        // Redis counters (real-time, fast path)
        const [redisConvos, redisMessages, redisHandoffs, costStr] = await Promise.all([
            this.redis.get(`analytics:${tenantId}:${today}:conversation_started`),
            this.redis.get(`analytics:${tenantId}:${today}:total`),
            this.redis.get(`analytics:${tenantId}:${today}:handoff_triggered`),
            this.redis.get(`analytics:${tenantId}:${today}:cost`),
        ]);

        // DB lead counts + fallback counts for conversations/handoffs/messages
        let leadsToday = 0;
        let leadsHot = 0;
        let leadsReadyToClose = 0;
        let dbConversations = 0;
        let dbHandoffs = 0;
        let dbMessages = 0;

        try {
            const [todayRows, scoreRows, convoRows, handoffRows, msgRows] = await Promise.all([
                // Leads created today
                this.prisma.executeInTenantSchema<Array<{ cnt: string }>>(
                    schemaName,
                    `SELECT COUNT(*) as cnt FROM leads WHERE created_at >= CURRENT_DATE`
                ),
                // Hot leads (score >= 7) and ready-to-close (score >= 9)
                this.prisma.executeInTenantSchema<Array<{ bucket: string; cnt: string }>>(
                    schemaName,
                    `SELECT
                        CASE WHEN score >= 9 THEN 'ready' WHEN score >= 7 THEN 'hot' END as bucket,
                        COUNT(*) as cnt
                     FROM leads
                     WHERE score >= 7 AND opted_out = false
                     GROUP BY bucket`
                ),
                // Conversations today (DB fallback)
                this.prisma.executeInTenantSchema<Array<{ cnt: string }>>(
                    schemaName,
                    `SELECT COUNT(*) as cnt FROM conversations WHERE created_at >= CURRENT_DATE`
                ),
                // Handoffs today (DB fallback)
                this.prisma.executeInTenantSchema<Array<{ cnt: string }>>(
                    schemaName,
                    `SELECT COUNT(*) as cnt FROM conversations WHERE status IN ('waiting_human', 'with_human') AND updated_at >= CURRENT_DATE`
                ),
                // Messages today (DB fallback)
                this.prisma.executeInTenantSchema<Array<{ cnt: string }>>(
                    schemaName,
                    `SELECT COUNT(*) as cnt FROM messages WHERE created_at >= CURRENT_DATE`
                ),
            ]);

            leadsToday = parseInt(todayRows[0]?.cnt ?? '0');

            for (const row of scoreRows) {
                const count = parseInt(row.cnt);
                if (row.bucket === 'hot') leadsHot = count;
                if (row.bucket === 'ready') leadsReadyToClose = count;
            }
            // "ready" leads are also "hot", so add them
            leadsHot += leadsReadyToClose;

            dbConversations = parseInt(convoRows[0]?.cnt ?? '0');
            dbHandoffs = parseInt(handoffRows[0]?.cnt ?? '0');
            dbMessages = parseInt(msgRows[0]?.cnt ?? '0');
        } catch {
            this.logger.warn(`[Analytics] Could not query leads/conversations for tenant ${tenantId} — schema may be outdated.`);
        }

        // Use Redis counters when available, fall back to DB counts
        const redisConvoCount = parseInt((redisConvos as string) ?? '0');
        const redisMessageCount = parseInt((redisMessages as string) ?? '0');
        const redisHandoffCount = parseInt((redisHandoffs as string) ?? '0');

        return {
            leadsToday,
            leadsHot,
            leadsReadyToClose,
            conversations: Math.max(redisConvoCount, dbConversations),
            handoffs: Math.max(redisHandoffCount, dbHandoffs),
            llmCostToday: parseFloat((costStr as string) ?? '0'),
            messagesProcessed: Math.max(redisMessageCount, dbMessages),
        };
    }

    /**
     * Pipeline funnel — real opportunity stage counts with average lead scores.
     */
    async getPipelineFunnel(tenantId: string): Promise<Array<{
        stage: string;
        count: number;
        avgScore: number;
        totalValue: number;
    }>> {
        const schemaName = await this.getSchemaName(tenantId);
        if (!schemaName) return [];

        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT
                    o.stage,
                    COUNT(*) as count,
                    COALESCE(AVG(l.score), 0) as avg_score,
                    COALESCE(SUM(o.estimated_value), 0) as total_value
                 FROM opportunities o
                 LEFT JOIN leads l ON o.lead_id = l.id
                 WHERE o.stage NOT IN ('ganado', 'perdido', 'no_interesado')
                 GROUP BY o.stage
                 ORDER BY count DESC`, []
            );

            return (rows || []).map(r => ({
                stage: r.stage,
                count: parseInt(r.count) || 0,
                avgScore: parseFloat(parseFloat(r.avg_score).toFixed(1)) || 0,
                totalValue: parseFloat(r.total_value) || 0,
            }));
        } catch {
            this.logger.warn(`[Analytics] Could not query pipeline for tenant ${tenantId}`);
            return [];
        }
    }

    /**
     * Conversation metrics — daily counts, resolution rate, avg response time over N days.
     */
    async getConversationMetrics(tenantId: string, days = 30): Promise<{
        daily: Array<{ date: string; total: number; resolved: number; handoffs: number }>;
        resolutionRate: number;
        avgResponseTimeSecs: number;
        totalConversations: number;
    }> {
        const schemaName = await this.getSchemaName(tenantId);
        if (!schemaName) {
            return { daily: [], resolutionRate: 0, avgResponseTimeSecs: 0, totalConversations: 0 };
        }

        try {
            const [dailyRows, aggregateRows] = await Promise.all([
                this.prisma.executeInTenantSchema<any[]>(schemaName,
                    `SELECT
                        DATE(created_at) as date,
                        COUNT(*) as total,
                        COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
                        COUNT(*) FILTER (WHERE status IN ('waiting_human', 'with_human')) as handoffs
                     FROM conversations
                     WHERE created_at >= CURRENT_DATE - make_interval(days => $1::int)
                     GROUP BY DATE(created_at)
                     ORDER BY date ASC`,
                    [days]
                ),
                this.prisma.executeInTenantSchema<any[]>(schemaName,
                    `SELECT
                        COUNT(*) as total,
                        COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
                        AVG(EXTRACT(EPOCH FROM (
                            COALESCE(ca.first_response_at, NOW()) - ca.assigned_at
                        ))) FILTER (WHERE ca.first_response_at IS NOT NULL) as avg_response_time
                     FROM conversations c
                     LEFT JOIN conversation_assignments ca ON ca.conversation_id = c.id
                     WHERE c.created_at >= CURRENT_DATE - make_interval(days => $1::int)`,
                    [days]
                ),
            ]);

            const agg = aggregateRows[0] || {};
            const total = parseInt(agg.total || '0');
            const resolved = parseInt(agg.resolved || '0');

            return {
                daily: (dailyRows || []).map(r => ({
                    date: r.date,
                    total: parseInt(r.total) || 0,
                    resolved: parseInt(r.resolved) || 0,
                    handoffs: parseInt(r.handoffs) || 0,
                })),
                resolutionRate: total > 0 ? Math.round((resolved / total) * 100) : 0,
                avgResponseTimeSecs: parseFloat(agg.avg_response_time) || 0,
                totalConversations: total,
            };
        } catch (err) {
            this.logger.warn(`[Analytics] Could not query conversation metrics for tenant ${tenantId}: ${err}`);
            return { daily: [], resolutionRate: 0, avgResponseTimeSecs: 0, totalConversations: 0 };
        }
    }

    /**
     * CRM Dashboard: stage funnel, task overdue count, aging, leads by campaign
     */
    async getCrmStats(tenantId: string) {
        const schemaName = await this.getSchemaName(tenantId);
        if (!schemaName) return null;

        const [stageFunnel, openTasks, overdueTasksResult, leadsByCampaign, opportunityStats] = await Promise.all([
            this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT stage, COUNT(*) as count, AVG(score) as avg_score
                 FROM leads WHERE opted_out = false
                 GROUP BY stage ORDER BY COUNT(*) DESC`, []
            ),
            this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT status, COUNT(*) as count FROM tasks GROUP BY status`, []
            ),
            this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT COUNT(*) as count FROM tasks WHERE status != 'done' AND due_at < NOW()`, []
            ),
            this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT c.name as campaign_name, COUNT(l.id) as lead_count, AVG(l.score) as avg_score
                 FROM leads l
                 JOIN campaigns c ON c.id = l.campaign_id
                 WHERE l.opted_out = false AND l.campaign_id IS NOT NULL
                 GROUP BY c.name ORDER BY lead_count DESC LIMIT 10`, []
            ).catch(() => []),
            this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT 
                    COUNT(*) as total_opps,
                    SUM(estimated_value) as total_value,
                    COUNT(*) FILTER (WHERE stage = 'ganado') as won,
                    COUNT(*) FILTER (WHERE stage IN ('perdido','no_interesado')) as lost
                 FROM opportunities`, []
            ).catch(() => [{ total_opps: 0, total_value: 0, won: 0, lost: 0 }]),
        ]);

        const oppStats = opportunityStats[0] || {};

        return {
            stageFunnel,
            tasksByStatus: openTasks,
            overdueTasks: parseInt(overdueTasksResult[0]?.count || '0'),
            leadsByCampaign,
            opportunities: {
                total: parseInt(oppStats.total_opps || '0'),
                totalValue: parseFloat(oppStats.total_value || '0'),
                won: parseInt(oppStats.won || '0'),
                lost: parseInt(oppStats.lost || '0'),
                winRate: parseInt(oppStats.total_opps || '0') > 0
                    ? Math.round((parseInt(oppStats.won || '0') / parseInt(oppStats.total_opps || '0')) * 100)
                    : 0,
            },
        };
    }

    /**
     * WhatsApp Health Dashboard: message volume, delivery rates
     */
    async getWhatsappStats(tenantId: string) {
        const schemaName = await this.getSchemaName(tenantId);
        if (!schemaName) return null;

        const [msgStats, templateErrors] = await Promise.all([
            this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT direction, COUNT(*) as count
                 FROM messages WHERE created_at > NOW() - INTERVAL '7 days'
                 GROUP BY direction`, []
            ),
            this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT COUNT(*) as total FROM messages
                 WHERE metadata->>'wa_status' = 'failed' AND created_at > NOW() - INTERVAL '7 days'`, []
            ),
        ]);

        return {
            messageLast7d: msgStats,
            failedMessages: parseInt(templateErrors[0]?.total || '0'),
        };
    }

    /**
     * AI Dashboard: handoff rates, avg score, handoffs by date
     */
    async getAiStats(tenantId: string) {
        const schemaName = await this.getSchemaName(tenantId);
        if (!schemaName) return null;

        const today = new Date().toISOString().split('T')[0];
        const [convStats, avgScore] = await Promise.all([
            this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE status = 'waiting_human') as handoffs,
                    COUNT(*) FILTER (WHERE status = 'resolved') as resolved
                 FROM conversations WHERE created_at > NOW() - INTERVAL '30 days'`, []
            ),
            this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT AVG(score) as avg_score FROM leads WHERE score IS NOT NULL`, []
            ),
        ]);

        const stats = convStats[0] || {};
        const total = parseInt(stats.total || '0');
        return {
            totalConversations: total,
            handoffs: parseInt(stats.handoffs || '0'),
            resolved: parseInt(stats.resolved || '0'),
            handoffRate: total > 0 ? Math.round((parseInt(stats.handoffs || '0') / total) * 100) : 0,
            avgLeadScore: parseFloat(avgScore[0]?.avg_score || '0').toFixed(1),
            llmCostToday: parseFloat(await this.redis.get(`analytics:${tenantId}:${today}:cost`) as string || '0'),
        };
    }

    /**
     * V4 Campaign Analytics: leads, response rate, conversion per campaign
     */
    async getCampaignAnalytics(tenantId: string) {
        const schemaName = await this.getSchemaName(tenantId);
        if (!schemaName) return [];

        return this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT 
                c.id, c.name, c.status, c.channel,
                COUNT(l.id) as total_leads,
                COUNT(l.id) FILTER (WHERE l.score >= 5) as qualified_leads,
                COUNT(l.id) FILTER (WHERE l.score >= 8) as hot_leads,
                COUNT(l.id) FILTER (WHERE l.stage = 'ganado') as converted,
                ROUND(AVG(l.score)::numeric, 1) as avg_score,
                ROUND(
                    CASE WHEN COUNT(l.id) > 0 
                    THEN (COUNT(l.id) FILTER (WHERE l.stage = 'ganado')::numeric / COUNT(l.id) * 100)
                    ELSE 0 END, 1
                ) as conversion_rate
             FROM campaigns c
             LEFT JOIN leads l ON l.campaign_id = c.id AND l.opted_out = false
             GROUP BY c.id, c.name, c.status, c.channel
             ORDER BY total_leads DESC`, []
        ).catch(() => []);
    }

    /**
     * V4 Conversion Funnel: full pipeline from capture to close
     */
    async getConversionFunnel(tenantId: string) {
        const schemaName = await this.getSchemaName(tenantId);
        if (!schemaName) return null;

        const stages = ['nuevo', 'contactado', 'calificado', 'caliente', 'listo_cierre', 'ganado', 'perdido'];
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT stage, COUNT(*) as count FROM leads WHERE opted_out = false GROUP BY stage`, []
        ).catch(() => []);

        const stageMap: Record<string, number> = {};
        for (const r of rows) stageMap[r.stage] = parseInt(r.count);

        return stages.map(s => ({ stage: s, count: stageMap[s] || 0 }));
    }

    private async getSchemaName(tenantId: string): Promise<string | null> {
        const cached = await this.redis.get(`tenant:${tenantId}:schema`);
        if (cached) return cached;

        try {
            const schemaName = await this.prisma.getTenantSchemaName(tenantId);
            await this.redis.set(`tenant:${tenantId}:schema`, schemaName, 3600);
            return schemaName;
        } catch {
            return null;
        }
    }
}
