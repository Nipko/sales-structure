import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    MessageBody,
    ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Server, Socket } from 'socket.io';
import { WidgetService } from './widget.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';

@WebSocketGateway({
    namespace: '/widget',
    cors: { origin: '*', credentials: false },
})
export class WidgetGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() server: Server;
    private readonly logger = new Logger(WidgetGateway.name);

    constructor(
        private readonly widgetService: WidgetService,
        private readonly prisma: PrismaService,
        private readonly conversations: ConversationsService,
    ) {}

    async handleConnection(client: Socket) {
        const token = client.handshake.auth?.token || client.handshake.query?.token as string;
        if (!token) {
            client.disconnect();
            return;
        }

        const session = await this.widgetService.getSessionByToken(token);
        if (!session) {
            client.emit('widget:error', { message: 'Invalid session' });
            client.disconnect();
            return;
        }

        (client as any).widgetSession = session;
        client.join(`session:${session.id}`);

        if (session.conversation_id) {
            const schemaName = await this.prisma.getTenantSchemaName(session.tenant_id);
            const history = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id, direction, content_text, created_at FROM messages
                 WHERE conversation_id = $1::uuid ORDER BY created_at DESC LIMIT 30`,
                [session.conversation_id],
            );
            client.emit('widget:history', { messages: (history || []).reverse() });

            // If the newest message is inbound, the previous turn never produced a
            // reply - the API was restarted or crashed mid-stream. The widget is
            // the one channel with no queue behind it, so nothing would ever retry
            // and the visitor would sit in front of an unanswered question.
            const newest = (history || [])[0];
            if (newest && newest.direction === 'inbound' && newest.content_text) {
                this.logger.warn(
                    `[Widget] Conversation ${session.conversation_id} reconnected with an unanswered message - regenerating`,
                );
                this.regenerateReply(client, session, newest.content_text).catch((err) =>
                    this.logger.error(`[Widget] Regeneration failed: ${err?.message}`),
                );
            }
        }

        client.emit('widget:connected', { sessionId: session.id });
    }

    /**
     * Re-run the AI turn for a message left unanswered by a restart. Streams
     * through the same path as a live message so the visitor sees a normal reply.
     */
    private async regenerateReply(client: Socket, session: any, text: string): Promise<void> {
        const schemaName = await this.prisma.getTenantSchemaName(session.tenant_id);
        await this.streamAssistantReply(
            client, session.tenant_id, schemaName, session.conversation_id, session.contact_id, text,
        );
    }

    handleDisconnect(client: Socket) {
        // Cleanup handled by socket.io room removal
    }

    @SubscribeMessage('widget:message')
    async handleMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { content: string; type?: string },
    ) {
        const session = (client as any).widgetSession;
        if (!session || !data.content?.trim()) return;

        const tenantId = session.tenant_id;
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);

        let conversationId = session.conversation_id;
        let contactId = session.contact_id;

        if (!conversationId) {
            const contactRows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `INSERT INTO contacts (name, phone, email, channel_type, external_id, created_at, updated_at)
                 VALUES ($1, $2, $3, 'web_widget', $4, NOW(), NOW())
                 RETURNING id`,
                [
                    session.visitor_name || 'Visitante web',
                    session.visitor_phone || `widget_${session.visitor_id}`,
                    session.visitor_email || null,
                    `widget_${session.visitor_id}`,
                ],
            );
            contactId = contactRows[0].id;

            const convRows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `INSERT INTO conversations (contact_id, channel_type, channel_account_id, status, metadata, created_at, updated_at)
                 VALUES ($1::uuid, 'web_widget', 'widget', 'active', $2::jsonb, NOW(), NOW())
                 RETURNING id`,
                [contactId, JSON.stringify({ widgetSessionId: session.id, page: session.page_url })],
            );
            conversationId = convRows[0].id;

            await this.widgetService.updateSessionConversation(session.id, conversationId, contactId);
            session.conversation_id = conversationId;
            session.contact_id = contactId;
        }

        const inboundRows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `INSERT INTO messages (conversation_id, direction, content_text, metadata, created_at)
             VALUES ($1::uuid, 'inbound', $2, '{"channel":"web_widget"}'::jsonb, NOW())
             RETURNING id`,
            [conversationId, data.content],
        );

        // Delivery ack. Without it the widget rendered every message as sent even
        // when socket.io had silently dropped it (its send buffer is discarded
        // once the reconnection attempts run out), so a visitor could be talking
        // to nobody and never know.
        client.emit('widget:message-received', {
            id: inboundRows?.[0]?.id,
            content: data.content,
            timestamp: new Date().toISOString(),
        });

        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE conversations SET updated_at = NOW() WHERE id = $1::uuid`,
            [conversationId],
        );

        await this.streamAssistantReply(client, tenantId, schemaName, conversationId, contactId, data.content);
    }

    /**
     * Stream the AI reply for an already-persisted visitor message.
     *
     * Split out of handleMessage so a reconnect can regenerate an unanswered
     * turn WITHOUT re-inserting the visitor's message (which would duplicate it
     * in the history the visitor is looking at).
     */
    private async streamAssistantReply(
        client: Socket,
        tenantId: string,
        schemaName: string,
        conversationId: string,
        contactId: string,
        text: string,
    ): Promise<void> {
        client.emit('widget:typing', { isTyping: true });
        const messageId = randomUUID();
        let full = '';
        let started = false; // only emit stream_start once the first chunk actually arrives

        try {
            for await (const chunk of this.conversations.streamWidgetMessage(
                tenantId, schemaName, conversationId, contactId, text,
            )) {
                if (!chunk) continue;
                if (!started) {
                    started = true;
                    client.emit('widget:stream_start', { messageId, role: 'assistant', timestamp: new Date().toISOString() });
                }
                full += chunk;
                client.emit('widget:stream_chunk', { messageId, delta: chunk });
            }

            // Nothing streamed (no persona, conversation handled by a human, or empty
            // reply) → stay silent: no bubble, no sound, no persisted message.
            if (started && full.trim()) {
                await this.prisma.executeInTenantSchema(schemaName,
                    `INSERT INTO messages (conversation_id, direction, content_text, metadata, created_at)
                     VALUES ($1::uuid, 'outbound', $2, '{"channel":"web_widget","ai":true}'::jsonb, NOW())`,
                    [conversationId, full],
                );
                client.emit('widget:stream_end', { messageId, content: full, timestamp: new Date().toISOString() });
                // Back-compat: cached loaders that only listen for widget:message still render.
                client.emit('widget:message', { content: full, role: 'assistant', timestamp: new Date().toISOString() });
            }
        } catch (err: any) {
            this.logger.warn(`Widget AI stream failed: ${err.message}`);
            // Only surface an error if a stream had actually started (otherwise the loader
            // has no bubble to fail). Persist the partial so history stays coherent.
            if (started && full.trim()) {
                await this.prisma.executeInTenantSchema(schemaName,
                    `INSERT INTO messages (conversation_id, direction, content_text, metadata, created_at)
                     VALUES ($1::uuid, 'outbound', $2, '{"channel":"web_widget","ai":true,"partial":true}'::jsonb, NOW())`,
                    [conversationId, full],
                ).catch(() => {});
                client.emit('widget:stream_error', { messageId, message: 'Failed to process message', partial: full });
            }
        } finally {
            client.emit('widget:typing', { isTyping: false });
        }
    }

    @SubscribeMessage('widget:typing')
    async handleTyping(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { isTyping: boolean },
    ) {
        // Could relay to agent console in the future
    }

    emitToSession(sessionId: string, event: string, data: any) {
        this.server?.to(`session:${sessionId}`).emit(event, data);
    }
}
