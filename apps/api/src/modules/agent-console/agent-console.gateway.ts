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
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { AgentConsoleService } from './agent-console.service';
import { CopilotService } from '../copilot/copilot.service';
import { HandoffEscalatedEvent } from '../handoff/handoff.service';
import { JwtPayload } from '@parallext/shared';

@WebSocketGateway({
    cors: { origin: '*' },
    namespace: '/agent',
})
export class AgentConsoleGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: any;

    private readonly logger = new Logger(AgentConsoleGateway.name);
    private connectedAgents = new Map<string, string>(); // agentId -> socketId
    private socketMeta = new Map<string, { agentId: string; tenantId: string; role: string }>();

    constructor(
        private agentConsoleService: AgentConsoleService,
        private copilotService: CopilotService,
        private jwtService: JwtService,
        private configService: ConfigService,
    ) { }

    async handleConnection(client: any) {
        try {
            const token = client.handshake?.auth?.token;
            if (!token) {
                this.logger.warn(`Connection rejected (no token): ${client.id}`);
                client.emit('error', { message: 'Authentication required' });
                client.disconnect(true);
                return;
            }

            const payload = this.jwtService.verify<JwtPayload>(token, {
                secret: this.configService.get<string>('auth.jwtSecret'),
            });

            if (!payload.sub || !payload.tenantId) {
                this.logger.warn(`Connection rejected (invalid payload): ${client.id}`);
                client.emit('error', { message: 'Invalid token: missing user or tenant info' });
                client.disconnect(true);
                return;
            }

            // Store verified JWT data on the socket for later use
            (client as any).jwtPayload = payload;
            this.logger.log(`Agent authenticated: ${payload.sub} (tenant: ${payload.tenantId}) socket: ${client.id}`);
        } catch (error: any) {
            const reason = error?.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
            this.logger.warn(`Connection rejected (${reason}): ${client.id}`);
            client.emit('error', { message: reason });
            client.disconnect(true);
        }
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
        const jwtPayload: JwtPayload | undefined = (client as any).jwtPayload;
        if (!jwtPayload) {
            client.emit('error', { message: 'Not authenticated' });
            client.disconnect(true);
            return;
        }

        // Use verified JWT values — never trust client-supplied tenantId
        const verifiedUserId = jwtPayload.sub;
        const verifiedTenantId = jwtPayload.tenantId!;
        const verifiedRole = jwtPayload.role;

        // If client supplies agentId, validate it matches the JWT user
        if (data.agentId && data.agentId !== verifiedUserId) {
            this.logger.warn(
                `agent:join mismatch: client sent agentId=${data.agentId} but JWT sub=${verifiedUserId}`,
            );
            client.emit('error', { message: 'Agent ID does not match authenticated user' });
            return;
        }

        this.socketMeta.set(client.id, {
            agentId: verifiedUserId,
            tenantId: verifiedTenantId,
            role: verifiedRole,
        });
        this.connectedAgents.set(verifiedUserId, client.id);

        // Join tenant room for broadcasts
        client.join(`tenant:${verifiedTenantId}`);
        client.join(`agent:${verifiedUserId}`);

        // Send initial inbox
        const inbox = await this.agentConsoleService.getInbox(verifiedTenantId, verifiedUserId);
        client.emit('inbox:update', inbox);

        this.logger.log(`Agent ${verifiedUserId} joined tenant ${verifiedTenantId} (role: ${verifiedRole})`);
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

        // Permission check: agent must be assigned, or have supervisor/admin role
        if (!this.hasElevatedRole(meta.role)) {
            const canAct = await this.agentConsoleService.canActOnConversation(
                meta.tenantId, data.conversationId, meta.agentId,
            );
            if (!canAct) {
                client.emit('error', { message: 'No tienes permiso para enviar mensajes en esta conversación.' });
                return;
            }
        }

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

        // Permission check: only allow if assigning to themselves OR has supervisor/admin role
        const isAssigningToSelf = data.agentId === meta.agentId;
        if (!isAssigningToSelf && !this.hasElevatedRole(meta.role)) {
            client.emit('error', { message: 'No tienes permiso para asignar conversaciones a otros agentes.' });
            return;
        }

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

        // Permission check: agent must be assigned, or have supervisor/admin role
        if (!this.hasElevatedRole(meta.role)) {
            const canAct = await this.agentConsoleService.canActOnConversation(
                meta.tenantId, data.conversationId, meta.agentId,
            );
            if (!canAct) {
                client.emit('error', { message: 'No tienes permiso para resolver esta conversación.' });
                return;
            }
        }

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

    @SubscribeMessage('copilot:suggest')
    async handleCopilotSuggest(
        @ConnectedSocket() client: any,
        @MessageBody() data: { conversationId: string },
    ) {
        const meta = this.socketMeta.get(client.id);
        if (!meta) return;

        try {
            const suggestions = await this.copilotService.getSuggestions(
                meta.tenantId,
                data.conversationId,
            );
            client.emit('copilot:suggestions', { conversationId: data.conversationId, suggestions });
        } catch (error: any) {
            this.logger.error(`Copilot suggest failed: ${error.message}`);
            client.emit('copilot:suggestions', { conversationId: data.conversationId, suggestions: [] });
        }
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
     * Check if the agent role allows acting on any conversation (supervisor or admin).
     */
    private hasElevatedRole(role: string): boolean {
        return ['super_admin', 'tenant_admin', 'tenant_supervisor'].includes(role);
    }

    /**
     * Listen for handoff escalation events from HandoffService.
     * Notifies all agents in the tenant via WebSocket.
     */
    @OnEvent('handoff.escalated')
    handleHandoffEscalated(event: HandoffEscalatedEvent) {
        this.logger.log(`Handoff event received for conversation ${event.conversationId} in tenant ${event.tenantId}`);

        const payload = {
            conversationId: event.conversationId,
            reason: event.reason,
            summary: event.summary,
            assignedTo: event.assignedTo,
            assignedAgentName: event.assignedAgentName,
            contactName: event.contactName,
            contactPhone: event.contactPhone,
            lastMessage: event.lastMessage,
            triggeredAt: event.handoffTriggeredAt,
            urgent: true,
        };

        // Broadcast to all agents in tenant
        this.server?.to(`tenant:${event.tenantId}`).emit('inbox:handoff', payload);

        // Direct notification to the assigned agent (if any)
        if (event.assignedTo) {
            // Find the socket for this specific agent and send a direct alert
            const rooms = this.server?.sockets?.adapter?.rooms;
            if (rooms) {
                for (const [socketId, tenantId] of this.connectedAgents) {
                    if (tenantId === event.tenantId) {
                        const socket = this.server?.sockets?.sockets?.get(socketId);
                        const meta = socket?.data?.meta;
                        if (meta?.userId === event.assignedTo) {
                            socket?.emit('inbox:assigned_to_you', {
                                ...payload,
                                message: `${event.contactName || 'Un cliente'} ha sido asignado a ti: ${event.reason}`,
                            });
                        }
                    }
                }
            }
        }

        // Refresh inbox for all agents
        this.server?.to(`tenant:${event.tenantId}`).emit('inbox:refresh');
    }

    @OnEvent('handoff.escalated_supervisor')
    handleSupervisorEscalation(event: { tenantId: string; conversationId: string; contactName: string; reason: string; waitMinutes: number }) {
        this.logger.warn(`[Escalation] Supervisor notified: ${event.contactName} waiting ${event.waitMinutes}min`);
        this.server?.to(`tenant:${event.tenantId}`).emit('inbox:escalation', {
            conversationId: event.conversationId,
            contactName: event.contactName,
            reason: event.reason,
            waitMinutes: event.waitMinutes,
            urgent: true,
        });
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

    /**
     * Listen for conversation archived events.
     */
    @OnEvent('conversation.archived')
    handleConversationArchived(event: { tenantId: string; conversationId: string }) {
        this.server?.to(`tenant:${event.tenantId}`).emit('conversation:archived', {
            conversationId: event.conversationId,
        });
        this.server?.to(`tenant:${event.tenantId}`).emit('inbox:refresh');
    }

    /**
     * Listen for conversation deleted events.
     */
    @OnEvent('conversation.deleted')
    handleConversationDeleted(event: { tenantId: string; conversationId: string }) {
        this.server?.to(`tenant:${event.tenantId}`).emit('conversation:deleted', {
            conversationId: event.conversationId,
        });
        this.server?.to(`tenant:${event.tenantId}`).emit('inbox:refresh');
    }
}
