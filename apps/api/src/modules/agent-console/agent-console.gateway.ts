import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    ConnectedSocket,
    MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AgentConsoleService } from './agent-console.service';
import { HandoffEscalatedEvent } from '../handoff/handoff.service';

@WebSocketGateway({
    cors: { origin: '*' },
    namespace: '/agent',
})
export class AgentConsoleGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: any;

    private readonly logger = new Logger(AgentConsoleGateway.name);
    private connectedAgents = new Map<string, string>(); // agentId -> socketId
    private socketMeta = new Map<string, { agentId: string; tenantId: string }>();

    constructor(private agentConsoleService: AgentConsoleService) { }

    async handleConnection(client: any) {
        this.logger.log(`Agent connected: ${client.id}`);
    }

    async handleDisconnect(client: any) {
        const meta = this.socketMeta.get(client.id);
        if (meta) {
            this.connectedAgents.delete(meta.agentId);
            this.socketMeta.delete(client.id);
            this.logger.log(`Agent disconnected: ${meta.agentId}`);
        }
    }

    @SubscribeMessage('agent:join')
    async handleAgentJoin(
        @ConnectedSocket() client: any,
        @MessageBody() data: { agentId: string; tenantId: string },
    ) {
        this.socketMeta.set(client.id, { agentId: data.agentId, tenantId: data.tenantId });
        this.connectedAgents.set(data.agentId, client.id);

        // Join tenant room for broadcasts
        client.join(`tenant:${data.tenantId}`);
        client.join(`agent:${data.agentId}`);

        // Send initial inbox
        const inbox = await this.agentConsoleService.getInbox(data.tenantId, data.agentId);
        client.emit('inbox:update', inbox);

        this.logger.log(`Agent ${data.agentId} joined tenant ${data.tenantId}`);
    }

    @SubscribeMessage('conversation:open')
    async handleOpenConversation(
        @ConnectedSocket() client: any,
        @MessageBody() data: { conversationId: string },
    ) {
        const meta = this.socketMeta.get(client.id);
        if (!meta) return;

        const conversation = await this.agentConsoleService.getConversation(
            meta.tenantId,
            data.conversationId,
        );

        client.join(`conversation:${data.conversationId}`);
        client.emit('conversation:detail', conversation);
    }

    @SubscribeMessage('conversation:send')
    async handleSendMessage(
        @ConnectedSocket() client: any,
        @MessageBody() data: { conversationId: string; content: string; type?: string },
    ) {
        const meta = this.socketMeta.get(client.id);
        if (!meta) return;

        const message = await this.agentConsoleService.sendAgentMessage(
            meta.tenantId,
            data.conversationId,
            meta.agentId,
            data.content,
            data.type || 'text',
        );

        // Broadcast to all agents watching this conversation
        this.server
            .to(`conversation:${data.conversationId}`)
            .emit('conversation:message', message);
    }

    @SubscribeMessage('conversation:assign')
    async handleAssign(
        @ConnectedSocket() client: any,
        @MessageBody() data: { conversationId: string; agentId: string },
    ) {
        const meta = this.socketMeta.get(client.id);
        if (!meta) return;

        await this.agentConsoleService.assignConversation(
            meta.tenantId,
            data.conversationId,
            data.agentId,
        );

        // Notify assigned agent
        this.server.to(`agent:${data.agentId}`).emit('inbox:assigned', {
            conversationId: data.conversationId,
        });

        // Notify tenant room
        this.server.to(`tenant:${meta.tenantId}`).emit('inbox:refresh');
    }

    @SubscribeMessage('conversation:resolve')
    async handleResolve(
        @ConnectedSocket() client: any,
        @MessageBody() data: { conversationId: string },
    ) {
        const meta = this.socketMeta.get(client.id);
        if (!meta) return;

        await this.agentConsoleService.resolveConversation(
            meta.tenantId,
            data.conversationId,
            meta.agentId,
        );

        this.server.to(`tenant:${meta.tenantId}`).emit('inbox:refresh');
        this.server
            .to(`conversation:${data.conversationId}`)
            .emit('conversation:resolved', { conversationId: data.conversationId });
    }

    @SubscribeMessage('agent:typing')
    async handleTyping(
        @ConnectedSocket() client: any,
        @MessageBody() data: { conversationId: string; typing: boolean },
    ) {
        const meta = this.socketMeta.get(client.id);
        client.to(`conversation:${data.conversationId}`).emit('agent:typing', {
            agentId: meta?.agentId,
            typing: data.typing,
        });
    }

    /**
     * Called by the system when a new customer message arrives
     */
    notifyNewMessage(tenantId: string, conversationId: string, message: any) {
        this.server?.to(`tenant:${tenantId}`).emit('inbox:new_message', {
            conversationId,
            message,
        });
        this.server
            ?.to(`conversation:${conversationId}`)
            .emit('conversation:message', message);
    }

    /**
     * Listen for handoff escalation events from HandoffService.
     * Notifies all agents in the tenant via WebSocket.
     */
    @OnEvent('handoff.escalated')
    handleHandoffEscalated(event: HandoffEscalatedEvent) {
        this.logger.log(`Handoff event received for conversation ${event.conversationId} in tenant ${event.tenantId}`);

        this.server?.to(`tenant:${event.tenantId}`).emit('inbox:handoff', {
            conversationId: event.conversationId,
            reason: event.reason,
            summary: event.summary,
            assignedTo: event.assignedTo,
        });

        // Also refresh inbox for all agents
        this.server?.to(`tenant:${event.tenantId}`).emit('inbox:refresh');
    }

    /**
     * Listen for handoff completed events.
     */
    @OnEvent('handoff.completed')
    handleHandoffCompleted(event: { tenantId: string; conversationId: string }) {
        this.server?.to(`tenant:${event.tenantId}`).emit('inbox:handoff_completed', {
            conversationId: event.conversationId,
        });
        this.server?.to(`tenant:${event.tenantId}`).emit('inbox:refresh');
    }
}
