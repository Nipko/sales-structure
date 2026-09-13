import { randomUUID } from 'crypto';
import { WidgetMessageStore } from '../widget/widget-message-store.service';
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    Optional,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ChannelGatewayService } from '../channels/channel-gateway.service';
import { ProactiveDispatchService, effectIsDurable } from '../channels/proactive-dispatch.service';
import type { DispatchItem } from '../channels/agent-dispatch-outbox';
import type { ChannelType } from '@parallext/shared';
import { WhatsappConnectionService } from '../whatsapp/services/whatsapp-connection.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { AiResolutionService } from '../analytics/ai-resolution.service';
import { absoluteMediaUrl } from '../../common/utils/media-url.util';
import { ConversationAssignedEvent, StructuredHandoffSummary } from '@parallext/shared';
import {
    createFreshLineage,
    evaluateAiDecisionReadiness,
    type OutcomeEvaluationCertification,
} from '../../common/policies/ai-decision-readiness.policy';

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
    handoffReason?: string | null;
    handoffSummary?: string | null;
    handoffStructuredSummary?: StructuredHandoffSummary | null;
    handoffTriggeredAt?: string | null;
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
    /**
     * Id of the agent currently holding the conversation, or null when the AI has it.
     *
     * Replaces a declared-but-never-populated `assignedAgent?: {id, name}`. Nothing ever
     * set it and nothing ever read it, while the client was asking for the flat
     * `assignedAgentId` the inbox list already returns — so the field it depended on
     * simply never arrived. Kept flat and named exactly like the list contract.
     */
    assignedAgentId?: string | null;
    status: string;
    channel: string;
    channelAccountName?: string;
    channelAccountPicture?: string;
    startedAt: string;
    aiSummary?: string;
    handoffReason?: string | null;
    handoffSummary?: string | null;
    handoffStructuredSummary?: StructuredHandoffSummary | null;
    handoffTriggeredAt?: string | null;
}

export interface ConversationMessage {
    id: string;
    /**
     * What became of an outbound message, when this is one that was just sent.
     *
     * `pending` until a provider accepted it. The row used to be written as
     * `delivered` before anything was sent, so the console had nothing to
     * distinguish a reply that left from one whose send threw into a warn.
     */
    status?: 'pending' | 'sent' | 'failed';
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
        @Optional() private widgetMessages?: WidgetMessageStore,
        /**
         * The durable lane, for the one send in this file that reaches a
         * customer's channel.
         *
         * Declared after the optional store because a required parameter cannot
         * follow an optional one, and moving `widgetMessages` would change the
         * position of every existing construction site. It is provided by the
         * module; when it is absent a reply is refused before persistence.
         */
        @Optional() private dispatch?: ProactiveDispatchService,
    ) { }

    /**
     * Get inbox conversations for an agent
     */
    async getInbox(
        tenantId: string,
        agentId: string,
        filter: 'all' | 'mine' | 'unassigned' | 'handoff' | 'resolved' | 'ai' = 'all',
        limit = 50,
        offset = 0,
        actorRole = 'tenant_agent',
    ): Promise<InboxConversation[]> {
        if (!this.isTenantInboxRole(actorRole)) return [];
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
                // `conversations.assigned_to` is VARCHAR(255), not UUID. Casting the
                // parameter to ::uuid asks Postgres for a `varchar = uuid` operator,
                // which does not exist → 42883 and a 500 on the whole inbox. The rest
                // of the codebase compares this column as text (see
                // agent-availability.service `active.assigned_to = u.id::text`).
                statusFilter = `AND c.assigned_to = $${params.length}`;
                break;
            case 'unassigned':
                statusFilter = `AND c.assigned_to IS NULL AND c.status = 'waiting_human'`;
                break;
            case 'handoff':
                statusFilter = `AND c.status = 'waiting_human'`;
                break;
            case 'ai':
                // Automated Inbox: conversations the AI is handling (active, unassigned,
                // not escalated to a human) — the transparency counterpart to 'handoff'.
                statusFilter = `AND c.assigned_to IS NULL AND c.status NOT IN ('waiting_human', 'with_human')`;
                break;
            case 'resolved':
                baseStatusFilter = `c.status = 'resolved'`;
                break;
        }

        let visibilityFilter = '';
        if (!this.isElevatedTenantInboxRole(actorRole)) {
            params.push(agentId);
            visibilityFilter = `AND (c.assigned_to IS NULL OR c.assigned_to = $${params.length})`;
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
      ${visibilityFilter}
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
            handoffStructuredSummary: c.metadata?.handoff?.structuredSummary || null,
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
            // `status` travels with the message: an outbound row the provider
            // refused is written `failed`, and without this column the console
            // could only warn at the moment of sending — one reload and the
            // reply that never left looked ordinary again.
            // ── AND THE ATTACHMENT, WHICHEVER PLACE IT WAS RECORDED IN ──────
            //
            // The console renders an attachment from `metadata.mediaUrl`, which
            // is where THIS service writes it. The durable lane writes the
            // canonical `media_url` column instead — so every picture the agent
            // or the AI sent through the outbox arrived in the timeline as an
            // empty bubble. Filled in from the column only when the metadata
            // does not already say: a producer that recorded it stays the
            // authority on its own presentation.
            `SELECT id, content_text as content, content_type as type, direction as sender, status, created_at,
              CASE WHEN media_url IS NOT NULL AND media_url <> ''
                        AND NOT (COALESCE(metadata, '{}'::jsonb) ? 'mediaUrl')
                   THEN COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('mediaUrl', media_url)
                   ELSE metadata END AS metadata
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
            // Who currently holds the conversation. The client decides "am I the one
            // handling this?" with `assignedAgentId === user.id`; without this field it
            // was always undefined, so the takeover banner could never reach the "you"
            // state and kept reading "waiting for a human" even right after the agent
            // took control — the exact ambiguity the banner exists to remove. The inbox
            // list already exposed it (`c.assigned_to as assigned_agent_id`); only the
            // detail endpoint dropped it.
            assignedAgentId: conv.assigned_to || null,
            channel: conv.channel_type || conv.channel || 'whatsapp',
            channelAccountName: conv.channel_account_name || '',
            channelAccountPicture: conv.channel_account_metadata?.picture || conv.channel_account_metadata?.profilePicture || '',
            startedAt: conv.started_at,
            handoffReason: conv.metadata?.handoff?.reason || null,
            handoffSummary: conv.metadata?.handoff?.summary || null,
            handoffStructuredSummary: conv.metadata?.handoff?.structuredSummary || null,
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
        /**
         * What makes this press of Send *this* press.
         *
         * Supplied by every console client that exists, and still optional
         * so one that does not send it keeps working:
         *
         *   · HTTP — `agent-console.controller.ts` takes `body.idempotencyKey`
         *     or the `Idempotency-Key` header, through `pressKey`;
         *   · socket — `agent-console.gateway.ts` takes the same field off
         *     the `conversation:send` payload, where a reconnecting client
         *     re-emitting one press is the duplicate this exists to stop;
         *   · the dashboard mints one per press in `admin/inbox/page.tsx`
         *     and REUSES it when the agent retries the same words after a
         *     failure, through `api.sendMessage`'s fourth argument.
         *
         * This docblock used to say "nothing upstream supplies one". It was
         * true when written and was made false by the batch that wired the
         * three callers above — which is worse than never having said it,
         * because the next reader plans around a fallback that is not the
         * normal path any more.
         *
         * With a key, `replyThroughOutbox` builds the effect id from it and the
         * outbox collides a retry of the same press onto the row that already
         * exists. Without one the reply gets a fresh identity per invocation,
         * which is the honest default for a console — two presses are two
         * messages, and deriving the key from the words would silently swallow
         * an agent's second "ok" — but it does mean a retry from a client that
         * sends no key is a second message on the customer's phone. That is why
         * it is the fallback and not the design.
         */
        idempotencyKey?: string,
    ): Promise<ConversationMessage> {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) throw new Error('Tenant not found');

        // Media messages (image/document/audio) carry their URL in metadata so the
        // timeline can render it; content_text holds the optional caption.
        const isMedia = !!mediaUrl;
        const contentType = isMedia ? (type && type !== 'text' ? type : 'image') : (type || 'text');
        const contentText = isMedia ? (caption || content || '') : content;
        const metadataJson = isMedia ? JSON.stringify({ mediaUrl, ...(caption || content ? { caption: caption || content } : {}), ...(filename ? { filename } : {}) }) : null;

        const deliveryBinding = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            'SELECT channel_type FROM conversations WHERE id=$1::uuid', [conversationId]);
        if (deliveryBinding[0]?.channel_type === 'web_widget') {
            if (!this.widgetMessages) throw new Error('widget_delivery_unavailable');
            await this.aiResolutionService.ensureResolutionColumns(schemaName);
            const msg = await this.widgetMessages.persist(tenantId, { conversationId, source:'agent', agentId,
                dedupeId: 'agent:' + randomUUID(),
                content: isMedia ? {type:contentType as any,mediaUrl:this.absoluteMediaUrl(mediaUrl),caption:contentText,filename}
                    : {type:'text',text:contentText} });
            return {id:msg.id,content:msg.content_text||'',type:msg.content_type as any,sender:'agent',timestamp:msg.created_at,
                metadata:{...msg.metadata,deliveryState:'stored'}};
        }

        // Any human-authored reply makes the transcript mixed. Mark it before
        // persisting the message so quality/outcome scores do not credit a
        // conversation that a person helped complete. The handoff itself stays
        // attributable as an operational rate for the AI configuration.
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE conversations
                SET was_handed_off = true,
                    handoff_at = COALESCE(handoff_at, NOW()),
                    updated_at = NOW()
              WHERE id = $1::uuid`,
            [conversationId],
        );

        // ── THE DURABLE LANE, WHEN THE CHANNEL CAN ACTUALLY CARRY IT ────────
        //
        // Everything below this block is the inline path: the row is written
        // here, the POST happens on this stack, and a restart between the two
        // loses the reply or repeats it. That path stays only for a channel
        // with no strict transport — one the lane could commit a row for and
        // then never deliver, which would be worse than sending it inline.
        //
        // Asked BEFORE the history row is written, because on the durable path
        // the row is written by `prepare`, inside the same transaction as the
        // outbox row. Two independent writes is precisely the pair that could
        // half-happen.
        const durable = await this.replyThroughOutbox({
            tenantId, schemaName, conversationId, agentId, idempotencyKey,
            item: isMedia
                ? { kind: 'media', payload: {
                    mediaType: ['image', 'document', 'audio', 'video'].includes(contentType)
                        ? contentType : 'image',
                    mediaUrl: this.absoluteMediaUrl(mediaUrl),
                    ...(contentText ? { caption: contentText } : {}),
                    ...(filename ? { filename } : {}),
                } }
                : { kind: 'text', payload: { text: contentText } },
            // Kept so the console timeline, which renders an attachment from
            // `metadata.mediaUrl`, sees what it expects on a row the outbox
            // wrote with only the `media_url` column.
            presentation: isMedia ? JSON.parse(metadataJson!) : null,
        });
        if (durable) return durable;
        // A console reply is a conversational effect. Every supported
        // conversational channel has a strict durable transport; Email is an
        // inbound-only adapter and SMS is a one-way notification product. If
        // the lane cannot bind this conversation, sending inline would either
        // create an unsupported product surface or lose the recovery record.
        // Refuse before writing history or contacting a provider.
        throw new BadRequestException(
            'La respuesta no puede enviarse sin un transporte durable para este canal.');
    }

    /**
     * A person's reply, committed before anything leaves the building.
     *
     * `null` means "not this one, keep the inline path": no lane wired in, a
     * channel whose adapter cannot carry a durable item, or a conversation row
     * that does not name the four things a binding is made of. Every one of
     * those is a case where committing a row would produce an effect nothing
     * could ever deliver, which is worse than the inline POST it replaces.
     *
     * The press owns its durable identity, independently from the customer
     * message it answers. That lets a person send two distinct sentences, or
     * answer after the AI, without adopting somebody else's batch. When a real
     * inbound exists, `disposition: reactive` names it as the economic cause;
     * an old thread with no inbound stays proactive rather than fabricating one.
     */
    private async replyThroughOutbox(input: {
        tenantId: string; schemaName: string; conversationId: string; agentId: string;
        item: DispatchItem; presentation: Record<string, any> | null;
        idempotencyKey?: string;
    }): Promise<ConversationMessage | null> {
        if (!this.dispatch) return null;
        const [conv] = await this.prisma.executeInTenantSchema<any[]>(input.schemaName,
            `SELECT c.channel_type, c.channel_account_id, c.contact_id,
                    COALESCE(ct.phone, ct.external_id) AS recipient,
                    (SELECT m.id
                       FROM messages m
                      WHERE m.conversation_id = c.id AND m.direction = 'inbound'
                      ORDER BY m.created_at DESC, m.id DESC
                      LIMIT 1) AS reply_to_message_id
               FROM conversations c
               LEFT JOIN contacts ct ON ct.id = c.contact_id
              WHERE c.id = $1::uuid LIMIT 1`, [input.conversationId]);
        const channelType = String(conv?.channel_type ?? '');
        const channelAccountId = String(conv?.channel_account_id ?? '').trim();
        const contactId = String(conv?.contact_id ?? '').trim();
        const recipient = String(conv?.recipient ?? '').trim();
        const replyToMessageId = String(conv?.reply_to_message_id ?? '').trim();
        if (!channelType || !channelAccountId || !contactId || !recipient) return null;
        // The adapter has to be able to send exactly one effect and say what
        // happened. Without that there is nothing to hand a committed row to.
        if (!this.channelGateway.getStrictTransport?.(channelType as ChannelType)) return null;

        const operationalScope = await this.dispatch.operatorAuthority(input.schemaName, {
            tenantId: input.tenantId, userId: input.agentId, surface: 'agent_console',
            channelType, channelAccountId,
        });
        if (!operationalScope) {
            // Deactivated, demoted, moved or gone. There is nobody to attribute
            // the message to, and the agent has to be told rather than watch it
            // vanish. Refused here, before a row exists.
            throw new ForbiddenException('Esta cuenta ya no puede enviar desde esta conexión.');
        }

        const result = await this.dispatch.send(input.tenantId, {
            originKey: input.idempotencyKey
                ? `agent_console:${input.conversationId}:${input.idempotencyKey}`
                : `agent_console:${input.conversationId}:${randomUUID()}`,
            conversationId: input.conversationId,
            contactId, channelType, channelAccountId, recipient,
            items: [input.item],
            operationalScope,
            // This press remains its own effect even when it answers the same
            // customer message as an earlier AI or human reply.
            originKind: 'proactive',
            disposition: isUUID(replyToMessageId) ? 'reactive' : 'proactive',
            ...(isUUID(replyToMessageId) ? { replyToMessageId } : {}),
        });
        if (!effectIsDurable(result)) {
            // Nothing was committed. Saying so is the whole point: a reply that
            // silently did not leave is worse than one that visibly did not,
            // because the agent goes on believing the customer was answered.
            this.logger.error(`[Console] reply for ${input.conversationId} was ${result.kind}: `
                + `${(result as any).reason}`);
            throw new BadRequestException(
                `La respuesta no se registró (${result.kind}): ${(result as any).reason}`);
        }

        // The history row `prepare` wrote, read back through the outbox row
        // rather than by reconstructing its external id: the id belongs to the
        // outbox and a copy of its format here is a second place to get wrong.
        const [written] = await this.prisma.executeInTenantSchema<any[]>(input.schemaName,
            `SELECT m.id, m.content_text, m.content_type, m.status, m.created_at, m.metadata
               FROM agent_dispatch_outbox o
               JOIN messages m ON m.id = o.message_id
              WHERE o.inbound_message_id = $1::uuid AND o.item_index = 0`,
            [(result as any).originId]);
        if (!written) {
            // The effect exists and will be delivered; only the row this method
            // wanted to hand back could not be read. Never a second send.
            throw new BadRequestException(
                'La respuesta quedó registrada pero no se pudo leer; recargá la conversación.');
        }
        if (input.presentation) {
            // The console timeline renders an attachment from `metadata.mediaUrl`
            // and the outbox records the canonical `media_url` column. Merged
            // after the commit, so a failure here costs the thumbnail and never
            // the message.
            await this.prisma.executeInTenantSchema(input.schemaName,
                `UPDATE messages SET metadata = COALESCE(metadata,'{}'::jsonb) || $2::jsonb
                  WHERE id = $1::uuid AND status <> 'redacted'`,
                [written.id, JSON.stringify(input.presentation)],
            ).catch((error: any) => this.logger.warn(
                `[Console] media presentation not recorded for ${written.id}: ${error?.message}`));
        }

        // Parity with the inline path: the agent just replied, so a pending AI
        // draft for this conversation is resolved, and their first response is
        // timed from here.
        this.prisma.executeInTenantSchema(input.schemaName,
            `UPDATE conversations SET metadata = metadata - 'pendingDraft'
              WHERE id = $1::uuid AND metadata ? 'pendingDraft'`,
            [input.conversationId],
        ).catch(() => { /* non-blocking */ });
        await this.prisma.executeInTenantSchema(input.schemaName,
            `UPDATE conversation_assignments SET first_response_at = NOW()
              WHERE conversation_id = $1::uuid AND agent_id = $2::uuid
                AND first_response_at IS NULL AND resolved_at IS NULL`,
            [input.conversationId, input.agentId],
        ).catch((error: any) => this.logger.warn(
            `Could not update first_response_at: ${error?.message}`));

        return {
            id: written.id,
            // `pending` until a provider accepts the effect this row describes.
            // The console shows it as not-yet-delivered, which is true, instead
            // of the `sent` the inline path could only claim after the fact.
            status: written.status,
            content: written.content_text || '',
            type: written.content_type as any,
            sender: 'agent',
            timestamp: written.created_at,
            metadata: { ...(written.metadata || {}), ...(input.presentation || {}) },
        } as ConversationMessage;
    }

    /** Suggest the single next best SALES action for a conversation (AI coach). */
    async nextBestAction(
        tenantId: string,
        conversationId: string,
        evaluation?: OutcomeEvaluationCertification,
    ): Promise<string> {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) return '';
        const messages = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, content_text, direction, created_at FROM messages
             WHERE conversation_id = $1::uuid ORDER BY created_at DESC LIMIT 12`,
            [conversationId],
        );
        if (!messages || messages.length === 0) return '';
        const readAt = new Date();
        const readiness = evaluateAiDecisionReadiness({
            outcome: 'conversation_next_best_action',
            evaluation,
            now: readAt,
            lineage: messages.map((message: any) => createFreshLineage(
                'tenant.messages', String(message.id || ''), readAt, message.created_at,
            )),
        });
        if (!readiness.allowed) {
            this.logger.warn(`nextBestAction blocked by readiness gate: ${readiness.reasons.join(',')}`);
            return '';
        }
        const ordered = [...messages].reverse();
        try {
            const res = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                messages: ordered.map((m: any) => ({
                    role: (m.direction === 'inbound' ? 'user' : 'assistant') as any,
                    content: m.content_text || '',
                })) as any,
                systemPrompt: `Eres un coach de ventas para un agente humano. Analiza la conversación y sugiere LA ÚNICA próxima mejor acción concreta para avanzar la venta (ej: enviar cotización, agendar una demo, preguntar el presupuesto, hacer seguimiento, cerrar la venta). Responde en el MISMO idioma del cliente, en 1-2 frases accionables, sin preámbulo ni explicaciones.`,
                temperature: 0.4,
                maxTokens: 150,
                tenantId,
            });
            return (res.content || '').trim();
        } catch (e: any) {
            this.logger.warn(`nextBestAction failed: ${e.message}`);
            return '';
        }
    }

    /**
     * Media URLs are stored relative (/api/v1/media/file/...) so the timeline can
     * render them, but Meta/WhatsApp requires an ABSOLUTE https URL for image/audio/
     * document links. Prepend the public API origin for the outbound send.
     */
    private absoluteMediaUrl(url?: string): string | undefined {
        return absoluteMediaUrl(url);
    }

    /**
     * Assign or reassign a conversation to an agent. Authorization for choosing
     * the target agent belongs to the controller/gateway boundary.
     */
    async assignConversation(tenantId: string, conversationId: string, agentId: string): Promise<void> {
        await this.persistConversationAssignment(tenantId, conversationId, agentId, false);
    }

    /**
     * Atomically claim an unassigned conversation for the authenticated agent.
     * The conditional UPDATE closes the check/use race: two agents cannot both
     * observe an empty assignee and then overwrite one another.
     */
    async claimConversation(tenantId: string, conversationId: string, agentId: string): Promise<void> {
        await this.persistConversationAssignment(tenantId, conversationId, agentId, true);
    }

    private async persistConversationAssignment(
        tenantId: string,
        conversationId: string,
        agentId: string,
        onlyIfUnassigned: boolean,
    ): Promise<void> {
        await this.assertAssignmentTarget(tenantId, agentId);
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) return;

        const assignedAt = new Date().toISOString();
        const assignment = await this.prisma.transactionInTenantSchema(
            schemaName,
            async (query) => {
                const conversations = await query<Array<{ contact_id: string | null }>>(
                    // assigned_to es VARCHAR: el ::uuid aqui funcionaba sólo porque
                    // Postgres aplica un cast de ASIGNACION hacia tipos texto. Se quita
                    // para que la columna se lea como lo que es y nadie replique el
                    // patron en un WHERE, donde no hay operador y revienta con 42883.
                    `UPDATE conversations
                        SET assigned_to = $2,
                            status = 'with_human',
                            was_handed_off = true,
                            handoff_at = COALESCE(handoff_at, NOW()),
                            updated_at = NOW()
                      WHERE id = $1::uuid
                        ${onlyIfUnassigned ? 'AND assigned_to IS NULL' : ''}
                      RETURNING contact_id`,
                    [conversationId, agentId],
                );
                if (!conversations[0]) {
                    if (onlyIfUnassigned) {
                        throw new ConflictException('Conversation is already assigned or does not exist');
                    }
                    throw new Error(`Conversation ${conversationId} not found`);
                }

                await query(
                    `UPDATE conversation_assignments SET resolved_at = NOW()
                      WHERE conversation_id = $1::uuid AND resolved_at IS NULL`,
                    [conversationId],
                );
                await query(
                    `INSERT INTO conversation_assignments (conversation_id, agent_id, assigned_at)
                     VALUES ($1::uuid, $2::uuid, $3::timestamptz)`,
                    [conversationId, agentId, assignedAt],
                );

                const contactId = conversations[0].contact_id || undefined;
                const contacts = contactId
                    ? await query<Array<{ phone: string | null }>>(
                        `SELECT phone FROM contacts WHERE id = $1::uuid LIMIT 1`,
                        [contactId],
                    )
                    : [];
                return { contactId, phone: contacts[0]?.phone || undefined };
            },
        );

        const event: ConversationAssignedEvent = {
            tenantId,
            schemaName,
            conversationId,
            agentId,
            ...(assignment.contactId ? { contactId: assignment.contactId } : {}),
            ...(assignment.phone ? { phone: assignment.phone } : {}),
            assignmentSource: 'manual',
            assignedAt,
        };
        try {
            this.eventEmitter.emit('conversation.assigned', event);
        } catch (error: any) {
            // The DB transaction already committed; do not make the caller retry
            // and create a duplicate assignment because a listener failed.
            this.logger.error(`conversation.assigned listener failed: ${error.message}`);
        }

        this.logger.log(
            `Conversation ${conversationId} ${onlyIfUnassigned ? 'claimed' : 'assigned'} by agent ${agentId}`,
        );
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
                // assigned_to is VARCHAR here — comparing it against ::uuid raises
                // 42883 (no `varchar = uuid` operator). Same defect as the inbox filter.
                `SELECT COUNT(*) as active
                 FROM conversations
                 WHERE assigned_to = $1 AND status IN ('with_human', 'waiting_human')`,
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

    async conversationExists(tenantId: string, conversationId: string): Promise<boolean> {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) return false;

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT 1 FROM conversations WHERE id = $1::uuid LIMIT 1`,
            [conversationId],
        );

        return Boolean(rows?.length);
    }

    /**
     * Tenant admins/supervisors may manage any tenant-visible conversation.
     * Agents must explicitly claim a free conversation first and may then act
     * only while it remains assigned to their authenticated user id.
     */
    async canActOnConversation(
        tenantId: string,
        conversationId: string,
        actorId: string,
        actorRole: string = 'tenant_agent',
    ): Promise<boolean> {
        if (!this.isTenantInboxRole(actorRole)) return false;
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) return false;

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT assigned_to FROM conversations WHERE id = $1::uuid LIMIT 1`,
            [conversationId],
        );

        if (!rows || rows.length === 0) return false;
        if (this.isElevatedTenantInboxRole(actorRole)) return true;
        return rows[0].assigned_to === actorId;
    }

    /**
     * Read access is intentionally broader than mutation access: agents may
     * inspect their own conversations and the unassigned queue so they can
     * decide whether to claim an item, but never a conversation held by a peer.
     */
    async canViewConversation(
        tenantId: string,
        conversationId: string,
        actorId: string,
        actorRole: string = 'tenant_agent',
    ): Promise<boolean> {
        if (!this.isTenantInboxRole(actorRole)) return false;
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) return false;

        const rows = await this.prisma.executeInTenantSchema<Array<{ assigned_to: string | null }>>(
            schemaName,
            `SELECT assigned_to FROM conversations WHERE id = $1::uuid LIMIT 1`,
            [conversationId],
        );
        if (!rows?.length) return false;
        if (this.isElevatedTenantInboxRole(actorRole)) return true;
        return rows[0].assigned_to === null || rows[0].assigned_to === actorId;
    }

    async assertCanViewConversation(
        tenantId: string,
        conversationId: string,
        actorId: string,
        actorRole: string,
    ): Promise<void> {
        if (!this.isTenantInboxRole(actorRole)) {
            throw new ForbiddenException('Role cannot read Inbox conversations');
        }
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) throw new NotFoundException('Tenant not found');
        const rows = await this.prisma.executeInTenantSchema<Array<{ assigned_to: string | null }>>(
            schemaName,
            `SELECT assigned_to FROM conversations WHERE id = $1::uuid LIMIT 1`,
            [conversationId],
        );
        if (!rows?.length) throw new NotFoundException('Conversation not found');
        if (
            !this.isElevatedTenantInboxRole(actorRole)
            && rows[0].assigned_to !== null
            && rows[0].assigned_to !== actorId
        ) {
            throw new ForbiddenException('Conversation is assigned to another agent');
        }
    }

    async assertCanActOnConversation(
        tenantId: string,
        conversationId: string,
        actorId: string,
        actorRole: string,
    ): Promise<void> {
        if (!this.isTenantInboxRole(actorRole)) {
            throw new ForbiddenException('Role cannot mutate Inbox conversations');
        }

        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) throw new NotFoundException('Tenant not found');
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT assigned_to FROM conversations WHERE id = $1::uuid LIMIT 1`,
            [conversationId],
        );
        if (!rows?.length) throw new NotFoundException('Conversation not found');
        if (!this.isElevatedTenantInboxRole(actorRole) && rows[0].assigned_to !== actorId) {
            throw new ForbiddenException('Conversation is not assigned to the authenticated agent');
        }
    }

    async assertCanActOnConversations(
        tenantId: string,
        conversationIds: string[],
        actorId: string,
        actorRole: string,
    ): Promise<void> {
        if (!this.isTenantInboxRole(actorRole)) {
            throw new ForbiddenException('Role cannot mutate Inbox conversations');
        }
        const ids = [...new Set(conversationIds || [])];
        if (ids.length === 0) throw new BadRequestException('At least one conversation is required');

        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) throw new NotFoundException('Tenant not found');
        const rows = await this.prisma.executeInTenantSchema<Array<{ id: string; assigned_to: string | null }>>(
            schemaName,
            `SELECT id, assigned_to FROM conversations WHERE id = ANY($1::uuid[])`,
            [ids],
        );
        if ((rows || []).length !== ids.length) throw new NotFoundException('One or more conversations were not found');
        if (!this.isElevatedTenantInboxRole(actorRole) && rows.some((row) => row.assigned_to !== actorId)) {
            throw new ForbiddenException('One or more conversations are not assigned to the authenticated agent');
        }
    }

    private async assertAssignmentTarget(tenantId: string, agentId: string): Promise<void> {
        if (!isUUID(agentId)) {
            throw new BadRequestException('Assignment target is not an active member of this tenant');
        }
        const target = await this.prisma.user.findFirst({
            where: {
                id: agentId,
                tenantId,
                isActive: true,
                role: { in: ['tenant_admin', 'tenant_supervisor', 'tenant_agent'] },
            },
            select: { id: true },
        });
        if (!target) {
            throw new BadRequestException('Assignment target is not an active member of this tenant');
        }
    }

    private isTenantInboxRole(role: string): boolean {
        return ['tenant_admin', 'tenant_supervisor', 'tenant_agent'].includes(role);
    }

    private isElevatedTenantInboxRole(role: string): boolean {
        return role === 'tenant_admin' || role === 'tenant_supervisor';
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
     * Borra una conversación y el estado vivo que la acompaña.
     *
     * Borraba las filas y dejaba TODO lo demás en pie, así que la conversación
     * desaparecía de la bandeja y el sistema seguía comportándose como si
     * existiera: el motor de reservas retomaba un flujo a medias, una
     * confirmación pendiente vieja se ejecutaba con el primer "sí", y la memoria
     * del agente seguía hablando de un chat que el dueño ya había borrado.
     *
     * LO QUE NO SE BORRA, y es deliberado: las reservas, citas, pedidos y
     * oportunidades sobreviven. Borrar una conversación no puede borrar la venta
     * — su `conversation_id` queda en NULL (ON DELETE SET NULL) y el negocio
     * sigue en pie.
     *
     * La plata la protege la base sola: `payment_operation_ledger` referencia al
     * ledger de ejecución con ON DELETE RESTRICT, así que una operación de cobro
     * no se puede borrar por accidente. Acá se hace explícito en vez de chocar
     * contra el error: se borran las confirmaciones SIN cobro asociado.
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

        // Memoria del agente sobre ESTE chat. Sin esto, el próximo mensaje del
        // mismo contacto arrastra lo que el dueño acaba de borrar.
        await this.prisma.executeInTenantSchema(
            schemaName,
            `DELETE FROM conversation_memory WHERE conversation_id = $1::uuid`,
            [conversationId],
        ).catch((e: any) => this.logger.warn(`[Borrado] memoria: ${e.message}`));

        // Confirmaciones pendientes, salvo las que tienen un cobro detrás.
        await this.prisma.executeInTenantSchema(
            schemaName,
            `DELETE FROM tool_execution_ledger
              WHERE conversation_id = $1::uuid
                AND id NOT IN (SELECT execution_ledger_id FROM payment_operation_ledger)`,
            [conversationId],
        ).catch((e: any) => this.logger.warn(`[Borrado] confirmaciones: ${e.message}`));

        await this.prisma.executeInTenantSchema(
            schemaName,
            `DELETE FROM conversations WHERE id = $1::uuid`,
            [conversationId],
        );

        // Estado vivo en Redis. Es lo que hacía que un chat borrado siguiera
        // teniendo un flujo a medias esperando el próximo mensaje.
        await this.clearConversationRuntimeState(tenantId, conversationId);

        this.logger.log(`Conversation ${conversationId} permanently deleted`);
        this.eventEmitter.emit('conversation.deleted', { tenantId, conversationId });
    }

    /**
     * El estado que vive fuera de PostgreSQL.
     *
     * Las mismas claves que borra `infra/scripts/reset-chat.sh`, que existe justo
     * porque esto no se limpiaba desde el producto. Cada fallo se traga: el
     * borrado ya ocurrió en la base y abortar acá dejaría algo peor —una
     * conversación a medio borrar— que un residuo en Redis.
     */
    private async clearConversationRuntimeState(tenantId: string, conversationId: string): Promise<void> {
        const keys = [
            `booking:${conversationId}`,          // flujo de reserva a medias
            `procedure:${conversationId}`,        // procedimiento a medias
            `lock:conv:${conversationId}`,        // mutex del turno
            `handoff:${tenantId}:${conversationId}`,
            `llm:affinity:${conversationId}`,
            `llm:affinity:${conversationId}:conversation`,
            `llm:affinity:${conversationId}:tool_calling`,
        ];
        for (const key of keys) {
            try {
                await this.redis.del(key);
            } catch (e: any) {
                this.logger.warn(`[Borrado] no se pudo limpiar ${key}: ${e.message}`);
            }
        }
    }

    /**
     * Delete a single message
     */
    async deleteMessage(tenantId: string, conversationId: string, messageId: string): Promise<void> {
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) throw new Error('Tenant not found');

        await this.prisma.executeInTenantSchema(
            schemaName,
            `DELETE FROM messages WHERE id = $1::uuid AND conversation_id = $2::uuid`,
            [messageId, conversationId],
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
