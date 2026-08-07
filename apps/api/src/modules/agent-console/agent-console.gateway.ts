import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    ConnectedSocket,
    MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { AgentConsoleService } from './agent-console.service';
import { CopilotService } from '../copilot/copilot.service';
import { CollisionDetectionService } from './collision-detection.service';
import { HandoffEscalatedEvent } from '../handoff/handoff.service';
import { PrismaService } from '../prisma/prisma.service';
import { WsRelayService } from '../redis/ws-relay.service';
import { JwtPayload } from '@parallext/shared';

@WebSocketGateway({
    cors: { origin: '*' },
    namespace: '/agent',
})
export class AgentConsoleGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: any;

    private readonly logger = new Logger(AgentConsoleGateway.name);
    private connectedAgents = new Map<string, string>(); // agentId -> socketId
    private socketMeta = new Map<string, { agentId: string; tenantId: string; role: string; agentName: string }>();

    constructor(
        private agentConsoleService: AgentConsoleService,
        private copilotService: CopilotService,
        private collisionDetectionService: CollisionDetectionService,
        private prisma: PrismaService,
        private jwtService: JwtService,
        private configService: ConfigService,
        private wsRelay: WsRelayService,
    ) { }

    /**
     * Solo corre donde existe un servidor WebSocket real (el contenedor API):
     * el worker jamás llega acá, así que la suscripción no se duplica.
     */
    afterInit() {
        this.wsRelay.subscribe('agent', ({ room, event, payload }) => {
            if (room) this.server?.to(room).emit(event, payload);
        });
    }

    /**
     * Emite al room si este proceso tiene servidor; si no (worker), delega en
     * el API vía Redis. Sin esto, todo emit del pipeline encolado se perdía.
     */
    private relayEmit(room: string, event: string, payload: any) {
        if (this.server) this.server.to(room).emit(event, payload);
        else this.wsRelay.publish('agent', { room, event, payload });
    }

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
            // Clean up collision detection state and notify affected conversations
            try {
                const affected = await this.collisionDetectionService.removeAgent(meta.agentId);
                for (const { tenantId, conversationId } of affected) {
                    const viewers = await this.collisionDetectionService.getViewers(tenantId, conversationId);
                    this.server
                        ?.to(`conversation:${conversationId}`)
                        .emit('conversation:viewers_update', { conversationId, viewers });
                }
            } catch (error: any) {
                this.logger.error(`Collision cleanup failed for agent ${meta.agentId}: ${error.message}`);
            }

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

        // Resolve agent name from database (users.name is a generated column, use firstName/lastName)
        let agentName = jwtPayload.email;
        try {
            const user = await this.prisma.user.findUnique({
                where: { id: verifiedUserId },
                select: { firstName: true, lastName: true, email: true },
            });
            if (user?.firstName) {
                agentName = [user.firstName, user.lastName].filter(Boolean).join(' ');
            }
        } catch {
            // Fallback to email from JWT
        }

        this.socketMeta.set(client.id, {
            agentId: verifiedUserId,
            tenantId: verifiedTenantId,
            role: verifiedRole,
            agentName,
        });
        this.connectedAgents.set(verifiedUserId, client.id);

        // Join tenant room for broadcasts
        client.join(`tenant:${verifiedTenantId}`);
        client.join(`agent:${verifiedUserId}`);

        // Send initial inbox
        const inbox = await this.agentConsoleService.getInbox(verifiedTenantId, verifiedUserId);
        client.emit('inbox:update', inbox);

        this.logger.log(`Agent ${verifiedUserId} (${agentName}) joined tenant ${verifiedTenantId} (role: ${verifiedRole})`);
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

        // Track viewer and broadcast to other agents
        await this.collisionDetectionService.startViewing(
            meta.tenantId,
            data.conversationId,
            meta.agentId,
            meta.agentName,
        );
        const viewers = await this.collisionDetectionService.getViewers(meta.tenantId, data.conversationId);
        this.server
            .to(`conversation:${data.conversationId}`)
            .emit('conversation:viewers_update', { conversationId: data.conversationId, viewers });
    }

    @SubscribeMessage('conversation:viewing_start')
    async handleViewingStart(
        @ConnectedSocket() client: any,
        @MessageBody() data: { conversationId: string },
    ) {
        const meta = this.socketMeta.get(client.id);
        if (!meta) return;

        await this.collisionDetectionService.startViewing(
            meta.tenantId,
            data.conversationId,
            meta.agentId,
            meta.agentName,
        );
        const viewers = await this.collisionDetectionService.getViewers(meta.tenantId, data.conversationId);
        this.server
            .to(`conversation:${data.conversationId}`)
            .emit('conversation:viewers_update', { conversationId: data.conversationId, viewers });
    }

    @SubscribeMessage('conversation:viewing_stop')
    async handleViewingStop(
        @ConnectedSocket() client: any,
        @MessageBody() data: { conversationId: string },
    ) {
        const meta = this.socketMeta.get(client.id);
        if (!meta) return;

        await this.collisionDetectionService.stopViewing(
            meta.tenantId,
            data.conversationId,
            meta.agentId,
        );
        const viewers = await this.collisionDetectionService.getViewers(meta.tenantId, data.conversationId);
        this.server
            .to(`conversation:${data.conversationId}`)
            .emit('conversation:viewers_update', { conversationId: data.conversationId, viewers });
    }

    @SubscribeMessage('conversation:heartbeat')
    async handleHeartbeat(
        @ConnectedSocket() client: any,
        @MessageBody() data: { conversationId: string },
    ) {
        const meta = this.socketMeta.get(client.id);
        if (!meta) return;

        await this.collisionDetectionService.heartbeat(
            meta.tenantId,
            data.conversationId,
            meta.agentId,
            meta.agentName,
        );
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
        this.server?.to(`agent:${data.agentId}`).emit('inbox:assigned', {
            conversationId: data.conversationId,
        });

        // Notify tenant room
        this.server?.to(`tenant:${meta.tenantId}`).emit('inbox:refresh');
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

        this.server?.to(`tenant:${meta.tenantId}`).emit('inbox:refresh');
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
        this.relayEmit(`tenant:${tenantId}`, 'inbox:new_message', {
            conversationId,
            message,
        });
        this.relayEmit(`conversation:${conversationId}`, 'conversation:message', message);
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
        this.fanoutHandoffEscalated(event);
    }

    private fanoutHandoffEscalated(event: HandoffEscalatedEvent) {
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
        this.relayEmit(`tenant:${event.tenantId}`, 'inbox:handoff', payload);

        // Notificación directa al asignado, por su room `agent:{userId}` (se une
        // en el register, mismo patrón que 'inbox:assigned'). El bloque anterior
        // recorría sockets con 3 bugs acumulados (Namespace.sockets no tiene
        // .adapter, el Map estaba destructurado al revés y meta nunca vivió en
        // socket.data) — 'inbox:assigned_to_you' jamás llegó a nadie pese a que
        // el móvil y el TopBar del dashboard lo escuchan.
        if (event.assignedTo) {
            this.relayEmit(`agent:${event.assignedTo}`, 'inbox:assigned_to_you', {
                ...payload,
                message: `${event.contactName || 'Un cliente'} ha sido asignado a ti: ${event.reason}`,
            });
        }

        // Refresh inbox for all agents
        this.relayEmit(`tenant:${event.tenantId}`, 'inbox:refresh', {});
    }

    /**
     * Draft-for-approval (WS3 #6): the AI generated a reply but draft mode is on,
     * so instead of sending it we surface it to the console for a human to
     * approve/edit/send in one click.
     */
    @OnEvent('draft.suggested')
    handleDraftSuggested(event: { tenantId: string; conversationId: string; text: string; contactName?: string }) {
        this.relayEmit(`tenant:${event.tenantId}`, 'inbox:draft_suggestion', {
            conversationId: event.conversationId,
            suggestedText: event.text,
            contactName: event.contactName,
        });
        this.relayEmit(`tenant:${event.tenantId}`, 'inbox:refresh', {});
    }

    @OnEvent('handoff.escalated_supervisor')
    handleSupervisorEscalation(event: { tenantId: string; conversationId: string; contactName: string; reason: string; waitMinutes: number }) {
        this.logger.warn(`[Escalation] Supervisor notified: ${event.contactName} waiting ${event.waitMinutes}min`);
        this.relayEmit(`tenant:${event.tenantId}`, 'inbox:escalation', {
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
        this.relayEmit(`tenant:${event.tenantId}`, 'inbox:handoff_completed', {
            conversationId: event.conversationId,
        });
        this.relayEmit(`tenant:${event.tenantId}`, 'inbox:refresh', {});
    }

    /**
     * Listen for conversation archived events.
     */
    @OnEvent('conversation.archived')
    handleConversationArchived(event: { tenantId: string; conversationId: string }) {
        this.relayEmit(`tenant:${event.tenantId}`, 'conversation:archived', {
            conversationId: event.conversationId,
        });
        this.relayEmit(`tenant:${event.tenantId}`, 'inbox:refresh', {});
    }

    /**
     * Listen for conversation deleted events.
     */
    @OnEvent('conversation.deleted')
    handleConversationDeleted(event: { tenantId: string; conversationId: string }) {
        this.relayEmit(`tenant:${event.tenantId}`, 'conversation:deleted', {
            conversationId: event.conversationId,
        });
        this.relayEmit(`tenant:${event.tenantId}`, 'inbox:refresh', {});
    }
}
