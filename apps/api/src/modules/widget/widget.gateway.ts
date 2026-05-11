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
        }

        client.emit('widget:connected', { sessionId: session.id });
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
                `INSERT INTO conversations (contact_id, channel_type, status, metadata, created_at, updated_at)
                 VALUES ($1::uuid, 'web_widget', 'active', $2::jsonb, NOW(), NOW())
                 RETURNING id`,
                [contactId, JSON.stringify({ widgetSessionId: session.id, page: session.page_url })],
            );
            conversationId = convRows[0].id;

            await this.widgetService.updateSessionConversation(session.id, conversationId, contactId);
            session.conversation_id = conversationId;
            session.contact_id = contactId;
        }

        await this.prisma.executeInTenantSchema(schemaName,
            `INSERT INTO messages (conversation_id, direction, content_text, metadata, created_at)
             VALUES ($1::uuid, 'inbound', $2, '{"channel":"web_widget"}'::jsonb, NOW())`,
            [conversationId, data.content],
        );

        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE conversations SET updated_at = NOW() WHERE id = $1::uuid`,
            [conversationId],
        );

        client.emit('widget:typing', { isTyping: true });

        try {
            const aiResponse = await this.conversations.processWidgetMessage(
                tenantId, schemaName, conversationId, contactId, data.content,
            );

            if (aiResponse) {
                await this.prisma.executeInTenantSchema(schemaName,
                    `INSERT INTO messages (conversation_id, direction, content_text, metadata, created_at)
                     VALUES ($1::uuid, 'outbound', $2, '{"channel":"web_widget","ai":true}'::jsonb, NOW())`,
                    [conversationId, aiResponse],
                );

                client.emit('widget:message', {
                    content: aiResponse,
                    role: 'assistant',
                    timestamp: new Date().toISOString(),
                });
            }
        } catch (err: any) {
            this.logger.warn(`Widget AI response failed: ${err.message}`);
            client.emit('widget:error', { message: 'Failed to process message' });
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
