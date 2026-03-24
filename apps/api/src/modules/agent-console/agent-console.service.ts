import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ChannelGatewayService } from '../channels/channel-gateway.service';
import { WhatsappConnectionService } from '../whatsapp/services/whatsapp-connection.service';
import { LLMRouterService } from '../ai/router/llm-router.service';

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
        private channelGateway: ChannelGatewayService,
        private whatsappConnection: WhatsappConnectionService,
        private llmRouter: LLMRouterService,
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
                statusFilter = `AND c.assigned_to = '${agentId}'`;
                break;
            case 'unassigned':
                statusFilter = `AND c.assigned_to IS NULL AND c.status = 'waiting_human'`;
                break;
            case 'handoff':
                statusFilter = `AND c.status = 'waiting_human'`;
                break;
        }

        const conversations = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT
        c.id, c.status, c.channel_type as channel, c.created_at as started_at, c.metadata,
        ct.name as contact_name, ct.phone as contact_phone, ct.email as contact_email,
        ct.tags as contact_tags,
        m.content_text as last_message, m.created_at as last_message_at, m.direction as last_sender,
        c.assigned_to as assigned_agent_id
      FROM conversations c
      LEFT JOIN contacts ct ON c.contact_id = ct.id
      LEFT JOIN LATERAL (
        SELECT content_text, created_at, direction FROM messages
        WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
      ) m ON true
      WHERE c.status != 'resolved' AND c.status != 'archived'
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
              ct.tags, ct.metadata as custom_fields, ct.first_contact_at as last_interaction, ct.id as contact_id
       FROM conversations c
       LEFT JOIN contacts ct ON c.contact_id = ct.id
       WHERE c.id = $1`,
            [conversationId],
        );

        if (!convRows || convRows.length === 0) return null;
        const conv = convRows[0];

        const messages = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, content_text as content, content_type as type, direction as sender, created_at, metadata
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
            `INSERT INTO messages (conversation_id, content_text, content_type, direction, status, created_at)
       VALUES ($1, $2, $3, 'outbound', 'delivered', NOW())
       RETURNING id, content_text, content_type, direction, created_at`,
            [conversationId, content, type],
        );

        const msg = result[0];

        // Obtener token real y enviar via el canal (WhatsApp, etc.)
        try {
            const schemaName = await this.getTenantSchema(tenantId);
            if (schemaName) {
                // Buscar el canal activo de la conversación para saber a qué número enviar
                const convRows = await this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `SELECT c.channel_type, ct.phone, c.channel_account_id
                     FROM conversations c
                     LEFT JOIN contacts ct ON c.contact_id = ct.id
                     WHERE c.id = $1 LIMIT 1`,
                    [conversationId],
                );
                if (convRows?.[0]) {
                    const conv = convRows[0];
                    const creds = await this.whatsappConnection.getValidAccessToken(schemaName);
                    await this.channelGateway.sendMessage(
                        {
                            tenantId,
                            channelType: conv.channel_type || 'whatsapp',
                            channelAccountId: conv.channel_account_id || creds.phoneNumberId,
                            to: conv.phone,
                            content: { type: 'text', text: content },
                        },
                        creds.accessToken,
                    );
                }
            }
        } catch (e: any) {
            this.logger.warn(`Could not send agent message via channel: ${e.message}`);
        }

        return {
            id: msg.id,
            content: msg.content_text,
            type: msg.content_type,
            sender: 'agent',
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
            `UPDATE conversations SET assigned_to = $2, status = 'with_human' WHERE id = $1`,
            [conversationId, agentId],
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
            `UPDATE conversations SET status = 'active', assigned_to = NULL WHERE id = $1`,
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

        // Usar LLM Router para generar sugerencia real
        try {
            const response = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: messages.map((m: any) => ({
                    role: (m.direction === 'inbound' ? 'user' : 'assistant') as any,
                    content: m.content_text || '',
                })) as any,
                systemPrompt: `Eres un asistente que ayuda a agentes humanos de atención al cliente.
Basándote en el historial de conversación, sugiere UNA respuesta corta y profesional que el agente debería enviar.
Responde SOLO con el texto de la sugerencia, sin explicaciones adicionales.`,
                temperature: 0.5,
            });
            return response.content || 'No se pudo generar una sugerencia.';
        } catch (e: any) {
            this.logger.warn(`LLM suggestion failed: ${e.message}`);
            return `El cliente preguntó: "${messages[messages.length - 1]?.content_text}". Puedes ayudarle con información relevante.`;
        }
    }

    /**
     * Get agent performance metrics
     */
    async getAgentStats(tenantId: string, agentId: string) {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) return { resolved: 0, active: 0, avg_first_response_secs: 0, avg_resolution_secs: 0 };

        try {
            const stats = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT
                   SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
                   SUM(CASE WHEN status = 'with_human' AND assigned_to = $1 THEN 1 ELSE 0 END) as active
                 FROM conversations
                 WHERE assigned_to = $1`,
                [agentId],
            );
            return {
                resolved: parseInt(stats?.[0]?.resolved || '0'),
                active: parseInt(stats?.[0]?.active || '0'),
                avg_first_response_secs: 0,
                avg_resolution_secs: 0,
            };
        } catch (e) {
            return { resolved: 0, active: 0, avg_first_response_secs: 0, avg_resolution_secs: 0 };
        }
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
