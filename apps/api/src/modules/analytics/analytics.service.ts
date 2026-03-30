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
       VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb, $5)`,
            [eventType, conversationId || null, contactId || null, JSON.stringify(data || {}), timestamp]
        );
    }

    /**
     * Get dashboard metrics for a tenant (fast path via Redis)
     */
    async getDashboardMetrics(tenantId: string): Promise<DashboardMetrics> {
        const today = new Date().toISOString().split('T')[0];

        // 1. Today's counters
        const [conversations, messages, handoffs, costStr] = await Promise.all([
            this.redis.get(`analytics:${tenantId}:${today}:conversation_started`) || '0',
            this.redis.get(`analytics:${tenantId}:${today}:total`) || '0',
            this.redis.get(`analytics:${tenantId}:${today}:handoff_triggered`) || '0',
            this.redis.get(`analytics:${tenantId}:${today}:cost`) || '0',
        ]);

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
                conversations: parseInt(conversations as string),
                messages: parseInt(messages as string),
                handoffs: parseInt(handoffs as string),
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
     * Commercial overview — combines Redis real-time counters + DB lead counts.
     * Called by the dashboard's main stat cards to replace mock data.
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
        const [conversations, messages, handoffs, costStr] = await Promise.all([
            this.redis.get(`analytics:${tenantId}:${today}:conversation_started`),
            this.redis.get(`analytics:${tenantId}:${today}:total`),
            this.redis.get(`analytics:${tenantId}:${today}:handoff_triggered`),
            this.redis.get(`analytics:${tenantId}:${today}:cost`),
        ]);

        // DB lead counts from commercial domain
        let leadsToday = 0;
        let leadsHot = 0;
        let leadsReadyToClose = 0;

        try {
            // Leads created today
            const todayRows = await this.prisma.executeInTenantSchema<Array<{ cnt: string }>>(
                schemaName,
                `SELECT COUNT(*) as cnt FROM leads WHERE DATE(created_at) = CURRENT_DATE`
            );
            leadsToday = parseInt(todayRows[0]?.cnt ?? '0');

            // Hot leads (score >= 7) and ready-to-close (score >= 9)
            const stageRows = await this.prisma.executeInTenantSchema<Array<{ stage: string; cnt: string }>>(
                schemaName,
                `SELECT stage, COUNT(*) AS cnt FROM leads WHERE stage IN ('caliente', 'listo_cierre') AND opted_out = false GROUP BY stage`
            );
            for (const row of stageRows) {
                const count = parseInt(row.cnt);
                if (row.stage === 'caliente') leadsHot = count;
                if (row.stage === 'listo_cierre') leadsReadyToClose = count;
            }
        } catch {
            // Graceful fallback — leads table may not exist in older tenant schemas
            this.logger.warn(`[Analytics] Could not query leads for tenant ${tenantId} — schema may be outdated.`);
        }

        return {
            leadsToday,
            leadsHot,
            leadsReadyToClose,
            conversations: parseInt((conversations as string) ?? '0'),
            handoffs: parseInt((handoffs as string) ?? '0'),
            llmCostToday: parseFloat((costStr as string) ?? '0'),
            messagesProcessed: parseInt((messages as string) ?? '0'),
        };
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
