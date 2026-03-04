import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export interface InboxConversation {
    id: string;
    contactName: string;
    contactPhone: string;
    contactAvatar?: string;
    lastMessage: string;
    lastMessageAt: string;
    status: 'open' | 'pending' | 'assigned' | 'resolved' | 'handoff';
    assignedAgentId?: string;
    assignedAgentName?: string;
    channel: string;
    unreadCount: number;
    priority: 'low' | 'normal' | 'high' | 'urgent';
    tags: string[];
    isAiHandled: boolean;
    tenantName?: string;
}

export interface ConversationDetail {
    id: string;
    contact: {
        id: string;
        name: string;
        phone: string;
        email?: string;
        tags: string[];
        segment: string;
        customFields: Record<string, any>;
        lifetimeValue: number;
        lastInteraction: string;
        conversationCount: number;
    };
    messages: ConversationMessage[];
    notes: InternalNote[];
    assignedAgent?: { id: string; name: string };
    status: string;
    channel: string;
    startedAt: string;
    aiSummary?: string;
}

export interface ConversationMessage {
    id: string;
    content: string;
    type: 'text' | 'image' | 'document' | 'audio' | 'note';
    sender: 'customer' | 'agent' | 'ai' | 'system';
    senderName?: string;
    timestamp: string;
    metadata?: Record<string, any>;
}

export interface InternalNote {
    id: string;
    content: string;
    agentName: string;
    createdAt: string;
}

@Injectable()
export class AgentConsoleService {
    private readonly logger = new Logger(AgentConsoleService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) { }

    /**
     * Get inbox conversations for an agent
     */
    async getInbox(
        tenantId: string,
        agentId: string,
        filter: 'all' | 'mine' | 'unassigned' | 'handoff' = 'all',
    ): Promise<InboxConversation[]> {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) return [];

        let statusFilter = '';
        switch (filter) {
            case 'mine':
                statusFilter = `AND ca.agent_id = '${agentId}'`;
                break;
            case 'unassigned':
                statusFilter = `AND ca.agent_id IS NULL AND c.status != 'resolved'`;
                break;
            case 'handoff':
                statusFilter = `AND c.status = 'handoff'`;
                break;
        }

        const conversations = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT
        c.id, c.status, c.channel, c.started_at, c.metadata,
        ct.name as contact_name, ct.phone as contact_phone, ct.email as contact_email,
        ct.tags as contact_tags,
        m.content as last_message, m.created_at as last_message_at, m.sender as last_sender,
        ca.agent_id as assigned_agent_id
      FROM conversations c
      LEFT JOIN contacts ct ON c.contact_id = ct.id
      LEFT JOIN LATERAL (
        SELECT content, created_at, sender FROM messages
        WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
      ) m ON true
      LEFT JOIN conversation_assignments ca ON ca.conversation_id = c.id AND ca.resolved_at IS NULL
      WHERE c.status != 'resolved'
      ${statusFilter}
      ORDER BY m.created_at DESC NULLS LAST
      LIMIT 100`,
        );

        return (conversations || []).map((c: any) => ({
            id: c.id,
            contactName: c.contact_name || 'Unknown',
            contactPhone: c.contact_phone || '',
            lastMessage: c.last_message || '',
            lastMessageAt: c.last_message_at || c.started_at,
            status: c.status,
            assignedAgentId: c.assigned_agent_id,
            channel: c.channel || 'whatsapp',
            unreadCount: 0,
            priority: this.calculatePriority(c),
            tags: c.contact_tags || [],
            isAiHandled: c.status !== 'handoff' && !c.assigned_agent_id,
        }));
    }

    /**
     * Get full conversation detail with messages
     */
    async getConversation(tenantId: string, conversationId: string): Promise<ConversationDetail | null> {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) return null;

        const convRows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT c.*, ct.name as contact_name, ct.phone as contact_phone, ct.email as contact_email,
              ct.tags, ct.segment, ct.custom_fields, ct.lifetime_value, ct.last_interaction, ct.id as contact_id
       FROM conversations c
       LEFT JOIN contacts ct ON c.contact_id = ct.id
       WHERE c.id = $1`,
            [conversationId],
        );

        if (!convRows || convRows.length === 0) return null;
        const conv = convRows[0];

        const messages = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, content, type, sender, sender_name, created_at, metadata
       FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
            [conversationId],
        );

        const notes = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT n.id, n.content, n.created_at, u.name as agent_name
       FROM internal_notes n
       LEFT JOIN public.users u ON n.agent_id = u.id
       WHERE n.conversation_id = $1 ORDER BY n.created_at ASC`,
            [conversationId],
        );

        // Count total conversations for this contact
        const countRows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT COUNT(*) as total FROM conversations WHERE contact_id = $1`,
            [conv.contact_id],
        );

        return {
            id: conv.id,
            contact: {
                id: conv.contact_id,
                name: conv.contact_name || 'Unknown',
                phone: conv.contact_phone || '',
                email: conv.contact_email,
                tags: conv.tags || [],
                segment: conv.segment || 'new',
                customFields: conv.custom_fields || {},
                lifetimeValue: parseFloat(conv.lifetime_value) || 0,
                lastInteraction: conv.last_interaction,
                conversationCount: parseInt(countRows?.[0]?.total) || 0,
            },
            messages: (messages || []).map((m: any) => ({
                id: m.id,
                content: m.content,
                type: m.type || 'text',
                sender: m.sender,
                senderName: m.sender_name,
                timestamp: m.created_at,
                metadata: m.metadata,
            })),
            notes: (notes || []).map((n: any) => ({
                id: n.id,
                content: n.content,
                agentName: n.agent_name || 'Agent',
                createdAt: n.created_at,
            })),
            status: conv.status,
            channel: conv.channel || 'whatsapp',
            startedAt: conv.started_at,
        };
    }

    /**
     * Send a message from an agent
     */
    async sendAgentMessage(
        tenantId: string,
        conversationId: string,
        agentId: string,
        content: string,
        type: string = 'text',
    ): Promise<ConversationMessage> {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) throw new Error('Tenant not found');

        const result = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO messages (conversation_id, content, type, sender, sender_name, direction, created_at)
       VALUES ($1, $2, $3, 'agent', (SELECT name FROM public.users WHERE id = $4), 'outbound', NOW())
       RETURNING id, content, type, sender, sender_name, created_at`,
            [conversationId, content, type, agentId],
        );

        const msg = result[0];

        // TODO: Send via channel gateway (WhatsApp, etc.)
        // await this.channelGateway.sendMessage(tenantId, conversationId, content, type);

        return {
            id: msg.id,
            content: msg.content,
            type: msg.type,
            sender: 'agent',
            senderName: msg.sender_name,
            timestamp: msg.created_at,
        };
    }

    /**
     * Assign a conversation to an agent
     */
    async assignConversation(tenantId: string, conversationId: string, agentId: string): Promise<void> {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) return;

        await this.prisma.executeInTenantSchema(
            schemaName,
            `INSERT INTO conversation_assignments (conversation_id, agent_id, assigned_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (conversation_id) WHERE resolved_at IS NULL
       DO UPDATE SET agent_id = $2, assigned_at = NOW()`,
            [conversationId, agentId],
        );

        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE conversations SET status = 'assigned' WHERE id = $1`,
            [conversationId],
        );

        this.logger.log(`Conversation ${conversationId} assigned to agent ${agentId}`);
    }

    /**
     * Resolve a conversation (return to AI)
     */
    async resolveConversation(tenantId: string, conversationId: string, agentId: string): Promise<void> {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) return;

        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE conversation_assignments SET resolved_at = NOW()
       WHERE conversation_id = $1 AND agent_id = $2 AND resolved_at IS NULL`,
            [conversationId, agentId],
        );

        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE conversations SET status = 'active' WHERE id = $1`,
            [conversationId],
        );

        this.logger.log(`Conversation ${conversationId} resolved by agent ${agentId}, returned to AI`);
    }

    /**
     * Add an internal note to a conversation
     */
    async addNote(tenantId: string, conversationId: string, agentId: string, content: string): Promise<InternalNote> {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) throw new Error('Tenant not found');

        const result = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO internal_notes (conversation_id, agent_id, content, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, content, created_at`,
            [conversationId, agentId, content],
        );

        return {
            id: result[0].id,
            content: result[0].content,
            agentName: 'Agent',
            createdAt: result[0].created_at,
        };
    }

    /**
     * Get AI suggestion for an agent response
     */
    async getAISuggestion(tenantId: string, conversationId: string): Promise<string> {
        // Get last few messages for context
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) return '';

        const messages = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT content, sender FROM messages
       WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 5`,
            [conversationId],
        );

        if (!messages || messages.length === 0) return 'No hay suficiente contexto para sugerir.';

        const context = messages
            .reverse()
            .map((m: any) => `${m.sender}: ${m.content}`)
            .join('\n');

        // TODO: Use LLM Router for actual suggestion
        return `Basado en la conversación, el cliente preguntó: "${messages[0]?.content}". Sugiero responder con información relevante.`;
    }

    /**
     * Get agent performance metrics
     */
    async getAgentStats(tenantId: string, agentId: string) {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) return null;

        const stats = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT
        COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) as resolved,
        COUNT(*) FILTER (WHERE resolved_at IS NULL) as active,
        AVG(EXTRACT(EPOCH FROM (COALESCE(first_response_at, NOW()) - assigned_at))) as avg_first_response_secs,
        AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, NOW()) - assigned_at))) as avg_resolution_secs
       FROM conversation_assignments WHERE agent_id = $1`,
            [agentId],
        );

        return stats?.[0] || null;
    }

    private calculatePriority(conv: any): 'low' | 'normal' | 'high' | 'urgent' {
        if (conv.status === 'handoff') return 'urgent';
        const lastMsgAge = Date.now() - new Date(conv.last_message_at || conv.started_at).getTime();
        if (lastMsgAge > 30 * 60 * 1000) return 'high'; // > 30 min
        if (lastMsgAge > 10 * 60 * 1000) return 'normal'; // > 10 min
        return 'low';
    }

    private async getTenantSchema(tenantId: string): Promise<string | null> {
        const cached = await this.redis.get(`tenant:${tenantId}:schema`);
        if (cached) return cached;

        const tenant = await this.prisma.$queryRaw<any[]>`
      SELECT schema_name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1
    `;

        if (tenant && tenant.length > 0) {
            const schema = tenant[0].schema_name;
            await this.redis.set(`tenant:${tenantId}:schema`, schema, 3600);
            return schema;
        }
        return null;
    }
}
