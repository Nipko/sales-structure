import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ChannelGatewayService } from '../channels/channel-gateway.service';
import { WhatsappConnectionService } from '../whatsapp/services/whatsapp-connection.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { AiResolutionService } from '../analytics/ai-resolution.service';

export interface InboxConversation {
    id: string;
    contactName: string;
    contactPhone: string;
    contactEmail?: string;
    contactAvatar?: string;
    lastMessage: string;
    lastMessageAt: string;
    status: 'open' | 'pending' | 'assigned' | 'resolved' | 'handoff';
    assignedAgentId?: string;
    assignedAgentName?: string;
    channel: string;
    channelAccountName?: string;
    channelAccountPicture?: string;
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
    hasMore?: boolean;
    notes: InternalNote[];
    assignedAgent?: { id: string; name: string };
    status: string;
    channel: string;
    channelAccountName?: string;
    channelAccountPicture?: string;
    startedAt: string;
    aiSummary?: string;
    handoffReason?: string | null;
    handoffSummary?: string | null;
    handoffTriggeredAt?: string | null;
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
        private eventEmitter: EventEmitter2,
        private aiResolutionService: AiResolutionService,
    ) { }

    /**
     * Get inbox conversations for an agent
     */
    async getInbox(
        tenantId: string,
        agentId: string,
        filter: 'all' | 'mine' | 'unassigned' | 'handoff' | 'resolved' = 'all',
        limit = 50,
        offset = 0,
    ): Promise<InboxConversation[]> {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) return [];

        let statusFilter = '';
        // Default: hide resolved + archived (the active inbox view).
        // 'resolved' filter inverts this so the user can browse historical
        // conversations for support/audit purposes — they are read-only in
        // practice (no new messages would land there because the channel
        // would create a fresh conversation on the next inbound message).
        let baseStatusFilter = `c.status NOT IN ('resolved', 'archived')`;
        const params: any[] = [];

        // tenantId is always param $1 for the channel_accounts join
        params.push(tenantId);
        const tenantIdParam = `$${params.length}::uuid`;

        switch (filter) {
            case 'mine':
                params.push(agentId);
                statusFilter = `AND c.assigned_to = $${params.length}::uuid`;
                break;
            case 'unassigned':
                statusFilter = `AND c.assigned_to IS NULL AND c.status = 'waiting_human'`;
                break;
            case 'handoff':
                statusFilter = `AND c.status = 'waiting_human'`;
                break;
            case 'resolved':
                baseStatusFilter = `c.status = 'resolved'`;
                break;
        }

        const conversations = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT
        c.id, c.status, c.channel_type as channel, c.created_at as started_at,
        c.resolved_at, c.metadata,
        c.channel_account_id,
        ct.name as contact_name, ct.phone as contact_phone, ct.email as contact_email,
        ct.avatar_url as contact_avatar, ct.tags as contact_tags,
        m.content_text as last_message, m.created_at as last_message_at, m.direction as last_sender,
        c.assigned_to as assigned_agent_id,
        ca.display_name as channel_account_name, ca.metadata as channel_account_metadata
      FROM conversations c
      LEFT JOIN contacts ct ON c.contact_id = ct.id
      LEFT JOIN public.channel_accounts ca ON ca.account_id = c.channel_account_id AND ca.tenant_id = ${tenantIdParam}
      LEFT JOIN LATERAL (
        SELECT content_text, created_at, direction FROM messages
        WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
      ) m ON true
      WHERE ${baseStatusFilter}
      ${statusFilter}
      ORDER BY ${filter === 'resolved' ? 'c.resolved_at DESC NULLS LAST' : 'm.created_at DESC NULLS LAST'}
      LIMIT ${limit + 1} OFFSET ${offset}`,
            params,
        );

        const hasMore = (conversations || []).length > limit;
        const page = (conversations || []).slice(0, limit);
        const items = page.map((c: any) => ({
            id: c.id,
            contactName: c.contact_name || 'Unknown',
            contactPhone: c.contact_phone || '',
            contactEmail: c.contact_email || '',
            contactAvatar: c.contact_avatar || '',
            lastMessage: c.last_message || '',
            lastMessageAt: c.last_message_at || c.started_at,
            status: c.status,
            assignedAgentId: c.assigned_agent_id,
            channel: c.channel || 'whatsapp',
            channelAccountName: c.channel_account_name || '',
            channelAccountPicture: c.channel_account_metadata?.picture || c.channel_account_metadata?.profilePicture || '',
            unreadCount: 0,
            priority: this.calculatePriority(c),
            tags: c.contact_tags || [],
            isAiHandled: c.status !== 'handoff' && !c.assigned_agent_id,
            handoffReason: c.metadata?.handoff?.reason || null,
            handoffSummary: c.metadata?.handoff?.summary || null,
            handoffTriggeredAt: c.metadata?.handoff?.startedAt || null,
        }));
        // Attach hasMore as a non-enumerable property so existing array consumers
        // still see a plain array, but the controller can forward it.
        (items as any).__hasMore = hasMore;
        return items as InboxConversation[];
    }

    /**
     * Get full conversation detail with messages.
     * Supports cursor-based pagination: `limit` (default 50, max 200) and `before`
     * (ISO timestamp of the oldest message already loaded → loads the page *before* it).
     * Returns `hasMore: true` when there are older messages not included in this page.
     */
    async getConversation(
        tenantId: string,
        conversationId: string,
        limit = 50,
        before?: string,
    ): Promise<ConversationDetail | null> {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) return null;

        const convRows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT c.*, ct.name as contact_name, ct.phone as contact_phone, ct.email as contact_email,
              ct.tags, ct.metadata as custom_fields, ct.first_contact_at as last_interaction, ct.id as contact_id,
              ca.display_name as channel_account_name, ca.metadata as channel_account_metadata
       FROM conversations c
       LEFT JOIN contacts ct ON c.contact_id = ct.id
       LEFT JOIN public.channel_accounts ca ON ca.account_id = c.channel_account_id AND ca.tenant_id = $2::uuid
       WHERE c.id = $1::uuid`,
            [conversationId, tenantId],
        );

        if (!convRows || convRows.length === 0) return null;
        const conv = convRows[0];

        // Cursor-based pagination: load `limit` messages, optionally only those
        // created before `before` (the oldest timestamp the client already has).
        // Fetch limit+1 to detect whether there are more pages.
        const msgParams: any[] = [conversationId];
        let beforeClause = '';
        if (before) {
            msgParams.push(before);
            beforeClause = `AND created_at < $${msgParams.length}::timestamptz`;
        }
        msgParams.push(limit + 1);
        const messages = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, content_text as content, content_type as type, direction as sender, created_at, metadata
       FROM messages
       WHERE conversation_id = $1::uuid ${beforeClause}
       ORDER BY created_at DESC
       LIMIT $${msgParams.length}`,
            msgParams,
        );
        const hasMore = (messages || []).length > limit;
        const page = (messages || []).slice(0, limit).reverse(); // back to chronological ASC

        const notes = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT n.id, n.content, n.created_at, TRIM(u.first_name || ' ' || u.last_name) as agent_name
       FROM internal_notes n
       LEFT JOIN public.users u ON n.agent_id = u.id
       WHERE n.conversation_id = $1::uuid ORDER BY n.created_at ASC`,
            [conversationId],
        );

        // Count total conversations for this contact
        const countRows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT COUNT(*) as total FROM conversations WHERE contact_id = $1::uuid`,
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
                lifetimeValue: Number(conv.lifetime_value) || 0,
                lastInteraction: conv.last_interaction,
                conversationCount: Number(countRows?.[0]?.total) || 0,
            },
            hasMore,
            messages: page.map((m: any) => ({
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
            channel: conv.channel_type || conv.channel || 'whatsapp',
            channelAccountName: conv.channel_account_name || '',
            channelAccountPicture: conv.channel_account_metadata?.picture || conv.channel_account_metadata?.profilePicture || '',
            startedAt: conv.started_at,
            handoffReason: conv.metadata?.handoff?.reason || null,
            handoffSummary: conv.metadata?.handoff?.summary || null,
            handoffTriggeredAt: conv.metadata?.handoff?.startedAt || null,
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
        mediaUrl?: string,
        caption?: string,
        filename?: string,
    ): Promise<ConversationMessage> {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) throw new Error('Tenant not found');

        // Media messages (image/document/audio) carry their URL in metadata so the
        // timeline can render it; content_text holds the optional caption.
        const isMedia = !!mediaUrl;
        const contentType = isMedia ? (type && type !== 'text' ? type : 'image') : (type || 'text');
        const contentText = isMedia ? (caption || content || '') : content;
        const metadataJson = isMedia ? JSON.stringify({ mediaUrl, ...(caption || content ? { caption: caption || content } : {}), ...(filename ? { filename } : {}) }) : null;

        const result = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO messages (conversation_id, content_text, content_type, direction, status, metadata, created_at)
       VALUES ($1::uuid, $2, $3, 'outbound', 'delivered', $4::jsonb, NOW())
       RETURNING id, content_text, content_type, direction, created_at, metadata`,
            [conversationId, contentText, contentType, metadataJson],
        );

        const msg = result[0];

        // Track first response time in conversation_assignments (only if not yet set)
        try {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE conversation_assignments
                 SET first_response_at = NOW()
                 WHERE conversation_id = $1::uuid AND agent_id = $2::uuid
                   AND first_response_at IS NULL AND resolved_at IS NULL`,
                [conversationId, agentId],
            );
        } catch (e: any) {
            this.logger.warn(`Could not update first_response_at: ${e.message}`);
        }

        // Obtener token real y enviar via el canal (WhatsApp, etc.)
        try {
            // Buscar el canal activo de la conversación para saber a qué número enviar
            const convRows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT c.channel_type, COALESCE(ct.phone, ct.external_id) as phone, c.channel_account_id
                 FROM conversations c
                 LEFT JOIN contacts ct ON c.contact_id = ct.id
                 WHERE c.id = $1::uuid LIMIT 1`,
                [conversationId],
            );
            if (convRows?.[0]) {
                const conv = convRows[0];
                const creds = await this.whatsappConnection.getValidAccessToken(schemaName);
                const outContent: any = isMedia
                    ? { type: contentType, mediaUrl, caption: caption || content || undefined, ...(filename ? { filename } : {}) }
                    : { type: 'text', text: content };
                await this.channelGateway.sendMessage(
                    {
                        tenantId,
                        channelType: conv.channel_type || 'whatsapp',
                        channelAccountId: conv.channel_account_id || creds.phoneNumberId,
                        to: conv.phone,
                        content: outContent,
                    },
                    creds.accessToken,
                );
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
            `UPDATE conversations SET assigned_to = $2::uuid, status = 'with_human' WHERE id = $1::uuid`,
            [conversationId, agentId],
        );

        // Close any existing active assignment from a different agent before creating the new one
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE conversation_assignments SET resolved_at = NOW()
             WHERE conversation_id = $1::uuid AND resolved_at IS NULL`,
            [conversationId],
        );

        // Track assignment in conversation_assignments table
        await this.prisma.executeInTenantSchema(
            schemaName,
            `INSERT INTO conversation_assignments (conversation_id, agent_id, assigned_at)
             VALUES ($1::uuid, $2::uuid, NOW())`,
            [conversationId, agentId],
        );

        this.logger.log(`Conversation ${conversationId} assigned to agent ${agentId}`);
    }

    /**
     * Resolve a conversation (return to AI)
     */
    /**
     * Return a conversation to the AI: unassign + set status 'active' so the bot
     * handles the next inbound message again. Closes the active human assignment.
     */
    async returnToAI(tenantId: string, conversationId: string): Promise<void> {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) return;

        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE conversations SET status = 'active', assigned_to = NULL WHERE id = $1::uuid`,
            [conversationId],
        );
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE conversation_assignments SET resolved_at = NOW()
             WHERE conversation_id = $1::uuid AND resolved_at IS NULL`,
            [conversationId],
        ).catch(() => {});
    }

    async resolveConversation(tenantId: string, conversationId: string, agentId: string): Promise<void> {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) return;

        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE conversations
             SET status = 'active',
                 assigned_to = NULL,
                 metadata = jsonb_set(
                     COALESCE(metadata, '{}'::jsonb),
                     '{failedAttempts}',
                     '0'::jsonb
                 ) - 'bookingState' - 'bookingStateUpdatedAt' - 'toolContext' - 'toolContextUpdatedAt'
             WHERE id = $1::uuid`,
            [conversationId],
        );

        // Clear Redis booking state
        await this.redis.del(`booking:${conversationId}`).catch(() => {});

        // Mark the active assignment as resolved
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE conversation_assignments
             SET resolved_at = NOW()
             WHERE conversation_id = $1::uuid AND agent_id = $2::uuid AND resolved_at IS NULL`,
            [conversationId, agentId],
        );

        // Set resolution_type based on whether AI was handed off to a human
        try {
            await this.aiResolutionService.ensureResolutionColumns(schemaName);
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE conversations
                 SET resolution_type = CASE WHEN was_handed_off = true THEN 'agent_resolved' ELSE 'ai_resolved' END,
                     resolved_at = NOW()
                 WHERE id = $1::uuid`,
                [conversationId],
            );
        } catch (e: any) {
            this.logger.warn(`Failed to set resolution_type: ${e.message}`);
        }

        // QA scoring + resolution verification (async via BullMQ — T1.6/T1.8)
        this.eventEmitter.emit('conversation.resolved', { tenantId, conversationId });

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
       Values ($1::uuid, $2::uuid, $3, NOW())
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
            `SELECT content_text, direction FROM messages
       WHERE conversation_id = $1::uuid ORDER BY created_at ASC LIMIT 5`,
            [conversationId],
        );

        if (!messages || messages.length === 0) return 'No hay suficiente contexto para sugerir.';

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
                tenantId,
            });
            return response.content || 'No se pudo generar una sugerencia.';
        } catch (e: any) {
            this.logger.warn(`LLM suggestion failed: ${e.message}`);
            return `El cliente preguntó: "${messages[messages.length - 1]?.content_text}". Puedes ayudarle con información relevante.`;
        }
    }

    /** Translate text to targetLanguage using the LLM router. */
    async translateText(tenantId: string, text: string, targetLanguage = 'es'): Promise<string> {
        if (!text?.trim()) return text;
        const LANG: Record<string, string> = {
            es: 'Spanish', en: 'English', pt: 'Portuguese', fr: 'French',
            de: 'German', it: 'Italian', zh: 'Chinese', ja: 'Japanese', ar: 'Arabic',
        };
        const lang = LANG[targetLanguage] || targetLanguage;
        try {
            const res = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: text }],
                systemPrompt: `You are a professional translator. Translate the following text to ${lang}.
Rules: return ONLY the translated text, no explanations, no quotes, preserve formatting.`,
                temperature: 0.2,
                maxTokens: 600,
                tenantId,
            });
            return (res.content || text).trim();
        } catch (e: any) {
            this.logger.warn(`translateText failed: ${e.message}`);
            return text;
        }
    }

    /** Extract contact information from a base64-encoded business card image. */
    async scanBusinessCard(
        tenantId: string,
        imageBase64: string,
        mimeType = 'image/jpeg',
    ): Promise<{ name?: string; phone?: string; email?: string; company?: string; title?: string; website?: string; address?: string }> {
        try {
            // Resolve provider (reuse the same logic as ImageVisionService — call LLM directly
            // with the image data URL, which works with OpenAI and xAI vision models).
            const dataUrl = `data:${mimeType};base64,${imageBase64}`;
            const res = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: 'Extract all contact information from this business card.' },
                            { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
                        ] as any,
                    },
                ],
                systemPrompt: `You are a business card OCR system. Extract contact information from the image.
Return a JSON object (no markdown, no code fences) with these fields (omit fields not found):
{ "name": "", "title": "", "company": "", "phone": "", "email": "", "website": "", "address": "" }
Rules: only include fields that are clearly visible. Return valid JSON only.`,
                temperature: 0,
                maxTokens: 300,
                tenantId,
            });
            const raw = (res.content || '').trim().replace(/```json|```/g, '');
            return JSON.parse(raw);
        } catch (e: any) {
            this.logger.warn(`scanBusinessCard failed: ${e.message}`);
            return {};
        }
    }

    /**
     * Get agent performance metrics
     */
    async getAgentStats(tenantId: string, agentId: string) {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) return { resolved: 0, active: 0, avg_first_response_secs: 0, avg_resolution_secs: 0 };

        try {
            // Resolved count from conversation_assignments (assignments that have been closed)
            const resolvedRows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT COUNT(*) as resolved
                 FROM conversation_assignments
                 WHERE agent_id = $1::uuid AND resolved_at IS NOT NULL`,
                [agentId],
            );

            // Active count from conversations (currently assigned to this agent)
            const activeRows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT COUNT(*) as active
                 FROM conversations
                 WHERE assigned_to = $1::uuid AND status IN ('with_human', 'waiting_human')`,
                [agentId],
            );

            // Timing stats from conversation_assignments
            const timingStats = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT
                   COALESCE(AVG(EXTRACT(EPOCH FROM (ca.first_response_at - ca.assigned_at)))
                     FILTER (WHERE ca.first_response_at IS NOT NULL), 0) as avg_first_response_secs,
                   COALESCE(AVG(EXTRACT(EPOCH FROM (ca.resolved_at - ca.assigned_at)))
                     FILTER (WHERE ca.resolved_at IS NOT NULL), 0) as avg_resolution_secs
                 FROM conversation_assignments ca
                 WHERE ca.agent_id = $1::uuid`,
                [agentId],
            );

            return {
                resolved: Number(resolvedRows?.[0]?.resolved || 0),
                active: Number(activeRows?.[0]?.active || 0),
                avg_first_response_secs: Number(timingStats?.[0]?.avg_first_response_secs || 0),
                avg_resolution_secs: Number(timingStats?.[0]?.avg_resolution_secs || 0),
            };
        } catch (e) {
            return { resolved: 0, active: 0, avg_first_response_secs: 0, avg_resolution_secs: 0 };
        }
    }

    /**
     * Check if an agent can act on a conversation (assigned to them, or conversation is unassigned).
     * Returns true if the agent is assigned or the conversation has no assignee.
     */
    async canActOnConversation(tenantId: string, conversationId: string, agentId: string): Promise<boolean> {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) return false;

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT assigned_to FROM conversations WHERE id = $1::uuid LIMIT 1`,
            [conversationId],
        );

        if (!rows || rows.length === 0) return false;

        const assignedTo = rows[0].assigned_to;
        // Allow if unassigned or assigned to this agent
        return assignedTo === null || assignedTo === agentId;
    }

    /**
     * Get an agent's role from the public users table.
     */
    async getAgentRole(agentId: string): Promise<string | null> {
        try {
            const rows = await this.prisma.$queryRaw<any[]>`
                SELECT role FROM public.users WHERE id = ${agentId}::uuid LIMIT 1
            `;
            return rows?.[0]?.role || null;
        } catch {
            return null;
        }
    }

    private calculatePriority(conv: any): 'low' | 'normal' | 'high' | 'urgent' {
        if (conv.status === 'handoff') return 'urgent';
        const lastMsgAge = Date.now() - new Date(conv.last_message_at || conv.started_at).getTime();
        if (lastMsgAge > 30 * 60 * 1000) return 'high'; // > 30 min
        if (lastMsgAge > 10 * 60 * 1000) return 'normal'; // > 10 min
        return 'low';
    }

    /**
     * Archive a conversation
     */
    async archiveConversation(tenantId: string, conversationId: string, agentId: string): Promise<void> {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) throw new Error('Tenant not found');

        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE conversations SET status = 'archived', updated_at = NOW() WHERE id = $1::uuid`,
            [conversationId],
        );

        this.logger.log(`Conversation ${conversationId} archived by agent ${agentId}`);
        this.eventEmitter.emit('conversation.archived', { tenantId, conversationId });
    }

    /**
     * Delete a conversation and all its messages/notes
     */
    async deleteConversation(tenantId: string, conversationId: string): Promise<void> {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) throw new Error('Tenant not found');

        await this.prisma.executeInTenantSchema(
            schemaName,
            `DELETE FROM messages WHERE conversation_id = $1::uuid`,
            [conversationId],
        );

        await this.prisma.executeInTenantSchema(
            schemaName,
            `DELETE FROM internal_notes WHERE conversation_id = $1::uuid`,
            [conversationId],
        );

        await this.prisma.executeInTenantSchema(
            schemaName,
            `DELETE FROM conversations WHERE id = $1::uuid`,
            [conversationId],
        );

        this.logger.log(`Conversation ${conversationId} permanently deleted`);
        this.eventEmitter.emit('conversation.deleted', { tenantId, conversationId });
    }

    /**
     * Delete a single message
     */
    async deleteMessage(tenantId: string, messageId: string): Promise<void> {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) throw new Error('Tenant not found');

        await this.prisma.executeInTenantSchema(
            schemaName,
            `DELETE FROM messages WHERE id = $1::uuid`,
            [messageId],
        );

        this.logger.log(`Message ${messageId} deleted`);
    }

    /**
     * Bulk archive conversations
     */
    async bulkArchive(tenantId: string, conversationIds: string[]): Promise<void> {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) throw new Error('Tenant not found');

        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE conversations SET status = 'archived', updated_at = NOW() WHERE id = ANY($1::uuid[])`,
            [conversationIds],
        );

        this.logger.log(`Bulk archived ${conversationIds.length} conversations`);
    }

    /**
     * Bulk delete conversations
     */
    async bulkDelete(tenantId: string, conversationIds: string[]): Promise<void> {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) throw new Error('Tenant not found');

        await this.prisma.executeInTenantSchema(
            schemaName,
            `DELETE FROM messages WHERE conversation_id = ANY($1::uuid[])`,
            [conversationIds],
        );

        await this.prisma.executeInTenantSchema(
            schemaName,
            `DELETE FROM internal_notes WHERE conversation_id = ANY($1::uuid[])`,
            [conversationIds],
        );

        await this.prisma.executeInTenantSchema(
            schemaName,
            `DELETE FROM conversations WHERE id = ANY($1::uuid[])`,
            [conversationIds],
        );

        this.logger.log(`Bulk deleted ${conversationIds.length} conversations`);
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

    /**
     * Reopen a previously resolved/archived conversation. Used when a user
     * wants to bring an auto-resolved thread back into the active inbox
     * (e.g. the customer replied via email or the team needs to follow up
     * on something that was prematurely resolved by the 72h cron).
     */
    async reopenConversation(tenantId: string, conversationId: string): Promise<void> {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) return;
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE conversations
             SET status = 'active', resolved_at = NULL, updated_at = NOW()
             WHERE id = $1::uuid`,
            [conversationId],
        );
    }
}
