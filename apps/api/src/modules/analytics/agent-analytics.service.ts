import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// ============================================
// Types
// ============================================

export interface AgentMetrics {
    agentId: string;
    agentName: string;
    totalConversations: number;
    resolvedConversations: number;
    activeConversations: number;
    avgFirstResponseSecs: number;
    avgResolutionSecs: number;
    csatAvg: number;
    csatCount: number;
    messagesHandled: number;
}

export interface OverviewStats {
    totalConversations: number;
    resolvedToday: number;
    avgResponseTime: string;
    avgResolutionTime: string;
    csatAvg: number;
    csatTrend: number;
    activeAgents: number;
    handoffRate: number;
    recentActivity: Array<{ event_type: string; description: string; tenant_name: string; created_at: string; type: string }>;
    modelUsage: Array<{ model: string; count: number }>;
}

export interface CSATEntry {
    id: string;
    conversationId: string;
    contactName: string;
    agentName: string;
    rating: number;
    feedback: string | null;
    createdAt: string;
}

// ============================================
// Service
// ============================================

@Injectable()
export class AgentAnalyticsService {
    private readonly logger = new Logger(AgentAnalyticsService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) { }

    /** Get overview dashboard stats */
    async getOverviewStats(tenantId: string): Promise<OverviewStats> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return this.emptyOverview();

        const stats = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT
        (SELECT COUNT(*) FROM conversations) as total_conversations,
        (SELECT COUNT(*) FROM conversations WHERE status = 'resolved' AND updated_at >= CURRENT_DATE) as resolved_today,
        (SELECT AVG(EXTRACT(EPOCH FROM (COALESCE(ca.first_response_at, NOW()) - ca.assigned_at)))
         FROM conversation_assignments ca WHERE ca.first_response_at IS NOT NULL) as avg_first_response,
        (SELECT AVG(EXTRACT(EPOCH FROM (ca.resolved_at - ca.assigned_at)))
         FROM conversation_assignments ca WHERE ca.resolved_at IS NOT NULL) as avg_resolution,
        (SELECT AVG(cs.rating) FROM csat_surveys cs) as csat_avg,
        (SELECT AVG(cs.rating) FROM csat_surveys cs WHERE cs.created_at >= CURRENT_DATE - INTERVAL '7 days') as csat_week,
        (SELECT AVG(cs.rating) FROM csat_surveys cs WHERE cs.created_at >= CURRENT_DATE - INTERVAL '14 days'
         AND cs.created_at < CURRENT_DATE - INTERVAL '7 days') as csat_prev_week,
        (SELECT COUNT(DISTINCT agent_id) FROM conversation_assignments WHERE resolved_at IS NULL) as active_agents,
        (SELECT COUNT(*) FROM conversations WHERE status = 'handoff')::float /
         NULLIF((SELECT COUNT(*) FROM conversations)::float, 0) as handoff_rate
      `,
        );

        const s = stats?.[0] || {};
        const csatWeek = parseFloat(s.csat_week) || 0;
        const csatPrev = parseFloat(s.csat_prev_week) || 0;

        // Fetch recent activity from analytics_events or conversations
        let recentActivity: OverviewStats['recentActivity'] = [];
        try {
            const activityRows = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `(SELECT 'conversation' as type, 'Nueva conversación' as description,
                         '' as tenant_name, created_at
                  FROM conversations
                  ORDER BY created_at DESC LIMIT 5)
                 UNION ALL
                 (SELECT 'handoff' as type, 'Handoff activado' as description,
                         '' as tenant_name, updated_at as created_at
                  FROM conversations
                  WHERE status IN ('waiting_human', 'with_human')
                  ORDER BY updated_at DESC LIMIT 5)
                 ORDER BY created_at DESC LIMIT 10`,
            );
            recentActivity = (activityRows || []).map((r: any) => ({
                event_type: r.type,
                description: r.description,
                tenant_name: '',
                created_at: r.created_at,
                type: r.type,
            }));
        } catch {
            // Table may not exist
        }

        // Fetch model usage from Redis
        const today = new Date().toISOString().split('T')[0];
        const modelNames = ['gpt-4o', 'gpt-4o-mini', 'gemini-flash', 'gemini-pro', 'deepseek', 'grok', 'claude-sonnet'];
        const modelUsage: OverviewStats['modelUsage'] = [];
        for (const model of modelNames) {
            const countStr = await this.redis.get(`analytics:${tenantId}:${today}:model:${model}`);
            const count = parseInt(countStr as string || '0');
            if (count > 0) {
                modelUsage.push({ model, count });
            }
        }

        return {
            totalConversations: parseInt(s.total_conversations) || 0,
            resolvedToday: parseInt(s.resolved_today) || 0,
            avgResponseTime: this.formatDuration(parseFloat(s.avg_first_response) || 0),
            avgResolutionTime: this.formatDuration(parseFloat(s.avg_resolution) || 0),
            csatAvg: parseFloat(s.csat_avg) || 0,
            csatTrend: csatPrev > 0 ? ((csatWeek - csatPrev) / csatPrev) * 100 : 0,
            activeAgents: parseInt(s.active_agents) || 0,
            handoffRate: parseFloat(s.handoff_rate) || 0,
            recentActivity,
            modelUsage,
        };
    }

    /** Agent leaderboard */
    async getAgentLeaderboard(tenantId: string): Promise<AgentMetrics[]> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return [];

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT
        ca.agent_id,
        u.name as agent_name,
        COUNT(*) as total_conversations,
        COUNT(*) FILTER (WHERE ca.resolved_at IS NOT NULL) as resolved,
        COUNT(*) FILTER (WHERE ca.resolved_at IS NULL) as active,
        AVG(EXTRACT(EPOCH FROM (COALESCE(ca.first_response_at, NOW()) - ca.assigned_at)))
          FILTER (WHERE ca.first_response_at IS NOT NULL) as avg_first_response,
        AVG(EXTRACT(EPOCH FROM (ca.resolved_at - ca.assigned_at)))
          FILTER (WHERE ca.resolved_at IS NOT NULL) as avg_resolution,
        (SELECT AVG(cs.rating) FROM csat_surveys cs WHERE cs.agent_id = ca.agent_id) as csat_avg,
        (SELECT COUNT(*) FROM csat_surveys cs WHERE cs.agent_id = ca.agent_id) as csat_count,
        (SELECT COUNT(*) FROM messages m
         JOIN conversations c ON m.conversation_id = c.id
         JOIN conversation_assignments ca2 ON ca2.conversation_id = c.id AND ca2.agent_id = ca.agent_id
         WHERE m.sender = 'agent') as messages_handled
       FROM conversation_assignments ca
       LEFT JOIN public.users u ON ca.agent_id = u.id
       GROUP BY ca.agent_id, u.name
       ORDER BY resolved DESC`,
        );

        return (rows || []).map((r: any) => ({
            agentId: r.agent_id,
            agentName: r.agent_name || 'Agent',
            totalConversations: parseInt(r.total_conversations) || 0,
            resolvedConversations: parseInt(r.resolved) || 0,
            activeConversations: parseInt(r.active) || 0,
            avgFirstResponseSecs: parseFloat(r.avg_first_response) || 0,
            avgResolutionSecs: parseFloat(r.avg_resolution) || 0,
            csatAvg: parseFloat(r.csat_avg) || 0,
            csatCount: parseInt(r.csat_count) || 0,
            messagesHandled: parseInt(r.messages_handled) || 0,
        }));
    }

    /** Get CSAT survey responses */
    async getCSATResponses(tenantId: string, limit = 50): Promise<CSATEntry[]> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return [];

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT cs.*, ct.name as contact_name, u.name as agent_name
       FROM csat_surveys cs
       LEFT JOIN contacts ct ON cs.contact_id = ct.id
       LEFT JOIN public.users u ON cs.agent_id = u.id
       ORDER BY cs.created_at DESC LIMIT $1`,
            [limit],
        );

        return (rows || []).map((r: any) => ({
            id: r.id,
            conversationId: r.conversation_id,
            contactName: r.contact_name || 'Unknown',
            agentName: r.agent_name || 'Agent',
            rating: parseInt(r.rating) || 0,
            feedback: r.feedback,
            createdAt: r.created_at,
        }));
    }

    /** Submit a CSAT rating */
    async submitCSAT(tenantId: string, data: {
        conversationId: string; contactId: string; agentId: string;
        rating: number; feedback?: string;
    }): Promise<void> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return;

        await this.prisma.executeInTenantSchema(
            schema,
            `INSERT INTO csat_surveys (conversation_id, contact_id, agent_id, rating, feedback, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (conversation_id) DO UPDATE SET rating = $4, feedback = $5`,
            [data.conversationId, data.contactId, data.agentId, data.rating, data.feedback || null],
        );
    }

    /** Get CSAT distribution (1-5 stars) */
    async getCSATDistribution(tenantId: string): Promise<Record<number, number>> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT rating, COUNT(*) as count FROM csat_surveys GROUP BY rating ORDER BY rating`,
        );

        const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        (rows || []).forEach((r: any) => { dist[parseInt(r.rating)] = parseInt(r.count); });
        return dist;
    }

    private formatDuration(seconds: number): string {
        if (seconds < 60) return `${Math.round(seconds)}s`;
        if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
        return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
    }

    private emptyOverview(): OverviewStats {
        return { totalConversations: 0, resolvedToday: 0, avgResponseTime: '0s', avgResolutionTime: '0s', csatAvg: 0, csatTrend: 0, activeAgents: 0, handoffRate: 0, recentActivity: [], modelUsage: [] };
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
