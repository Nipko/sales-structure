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
import { RedisService } from '../redis/redis.service';
import { JwtPayload } from '@parallext/shared';
import { resolveReadyUserTenantContext } from '../../common/utils/tenant-lifecycle.util';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';
import { BillingEventType } from '../billing/types/billing-event.enum';

const INBOX_SOCKET_ROLES = ['tenant_admin', 'tenant_supervisor', 'tenant_agent'] as const;
const RELAY_EVICT_CONVERSATION_ROOM = '__evict_conversation_room';
const READ_ONLY_AGENT_EVENTS = new Set(['agent:join', 'conversation:open']);

@WebSocketGateway({
    cors: { origin: '*' },
    namespace: '/agent',
})
export class AgentConsoleGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: any;

    private readonly logger = new Logger(AgentConsoleGateway.name);
    private connectedAgents = new Map<string, string>(); // tenantId:agentId -> socketId
    private socketMeta = new Map<string, { agentId: string; tenantId: string; role: string; agentName: string }>();

    constructor(
        private agentConsoleService: AgentConsoleService,
        private copilotService: CopilotService,
        private collisionDetectionService: CollisionDetectionService,
        private prisma: PrismaService,
        private redis: RedisService,
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
            if (event === RELAY_EVICT_CONVERSATION_ROOM && room) {
                this.server?.in?.(room).socketsLeave(room);
                return;
            }
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

    private conversationRoom(tenantId: string, conversationId: string): string {
        return `conversation:${tenantId}:${conversationId}`;
    }

    private agentRoom(tenantId: string, agentId: string): string {
        return `agent:${tenantId}:${agentId}`;
    }

    private roleRoom(tenantId: string, role: 'tenant_admin' | 'tenant_supervisor'): string {
        return `role:${tenantId}:${role}`;
    }

    private evictConversationRoom(tenantId: string, conversationId: string): void {
        const room = this.conversationRoom(tenantId, conversationId);
        if (this.server) this.server.in?.(room).socketsLeave(room);
        else this.wsRelay.publish('agent', { room, event: RELAY_EVICT_CONVERSATION_ROOM, payload: {} });
    }

    private relaySensitiveToElevatedRoles(tenantId: string, event: string, payload: any): void {
        this.relayEmit(this.roleRoom(tenantId, 'tenant_admin'), event, payload);
        this.relayEmit(this.roleRoom(tenantId, 'tenant_supervisor'), event, payload);
    }

    private agentKey(tenantId: string, agentId: string): string {
        return `${tenantId}:${agentId}`;
    }

    private isAllowedInboxRole(role: string): boolean {
        return (INBOX_SOCKET_ROLES as readonly string[]).includes(role);
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

            const readyContext = await resolveReadyUserTenantContext(
                this.prisma,
                this.redis,
                payload.sub,
                payload.tenantId,
            );
            if (!readyContext) {
                this.logger.warn(`Connection rejected (tenant not ready): ${client.id}`);
                client.emit('error', { message: 'Tenant is inactive or still provisioning' });
                client.disconnect(true);
                return;
            }

            const currentUser = await this.prisma.user.findFirst({
                where: {
                    id: payload.sub,
                    tenantId: readyContext.tenantId,
                    isActive: true,
                    role: { in: [...INBOX_SOCKET_ROLES] },
                },
                select: { role: true, email: true },
            });
            if (!currentUser || !this.isAllowedInboxRole(currentUser.role)) {
                this.logger.warn(`Connection rejected (role not allowed): ${client.id}`);
                client.emit('error', { message: 'Role is not allowed to use the agent console' });
                client.disconnect(true);
                return;
            }

            const entitlement = await resolveTenantSubscriptionAccess(
                this.prisma,
                readyContext.tenantId,
                'read',
            );
            if (!entitlement.allowed) {
                client.emit('error', {
                    message: 'Subscription does not allow agent-console access.',
                    code: entitlement.error,
                });
                client.disconnect(true);
                return;
            }

            client.use?.(async (packet: unknown[], next: (error?: Error) => void) => {
                const eventName = String(packet?.[0] ?? '');
                const mode = READ_ONLY_AGENT_EVENTS.has(eventName) ? 'read' : 'write';
                const current = await resolveTenantSubscriptionAccess(
                    this.prisma,
                    readyContext.tenantId,
                    mode,
                );
                if (current.allowed) return next();
                client.emit('error', { message: 'Subscription access changed.', code: current.error });
                if (current.restrictionLevel !== 'soft_lock') client.disconnect(true);
                next(new Error(current.error ?? 'subscription_unavailable'));
            });

            // Store current database role and authoritative tenant context. A
            // stale JWT cannot retain Inbox access after a role downgrade.
            (client as any).jwtPayload = {
                ...payload,
                email: currentUser.email,
                role: currentUser.role,
                tenantId: readyContext.tenantId,
            };
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
                        ?.to(this.conversationRoom(tenantId, conversationId))
                        .emit('conversation:viewers_update', { conversationId, viewers });
                }
            } catch (error: any) {
                this.logger.error(`Collision cleanup failed for agent ${meta.agentId}: ${error.message}`);
            }

            this.connectedAgents.delete(this.agentKey(meta.tenantId, meta.agentId));
            this.socketMeta.delete(client.id);
            this.logger.log(`Agent disconnected: ${meta.agentId}`);
        }
    }

    @OnEvent(BillingEventType.SUBSCRIPTION_CANCELLED, { async: true })
    async handleSubscriptionCancelled(event: { tenantId: string }) {
        await this.disconnectTenantIfHardLocked(event?.tenantId);
    }

    @OnEvent(BillingEventType.SUBSCRIPTION_EXPIRED, { async: true })
    async handleSubscriptionExpired(event: { tenantId: string }) {
        await this.disconnectTenantIfHardLocked(event?.tenantId);
    }

    private async disconnectTenantIfHardLocked(tenantId?: string): Promise<void> {
        if (!tenantId || !this.server) return;
        const entitlement = await resolveTenantSubscriptionAccess(this.prisma, tenantId, 'read');
        if (!entitlement.allowed) {
            this.server.in?.(`tenant:${tenantId}`).disconnectSockets(true);
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

        if (!this.isAllowedInboxRole(verifiedRole)) {
            client.emit('error', { message: 'Role is not allowed to use the agent console' });
            client.disconnect(true);
            return;
        }

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
        this.connectedAgents.set(this.agentKey(verifiedTenantId, verifiedUserId), client.id);

        // Join tenant room for broadcasts
        client.join(`tenant:${verifiedTenantId}`);
        client.join(this.agentRoom(verifiedTenantId, verifiedUserId));
        if (verifiedRole === 'tenant_admin' || verifiedRole === 'tenant_supervisor') {
            client.join(this.roleRoom(verifiedTenantId, verifiedRole));
        }

        // Send initial inbox
        const inbox = await this.agentConsoleService.getInbox(
            verifiedTenantId, verifiedUserId, 'all', 50, 0, verifiedRole,
        );
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

        const canView = await this.agentConsoleService.canViewConversation(
            meta.tenantId,
            data.conversationId,
            meta.agentId,
            meta.role,
        );
        if (!canView) {
            client.emit('error', { message: 'No tienes permiso para ver esta conversación.' });
            return;
        }

        const conversation = await this.agentConsoleService.getConversation(
            meta.tenantId,
            data.conversationId,
        );
        if (!conversation) {
            client.emit('error', { message: 'Conversation not found' });
            return;
        }

        const room = this.conversationRoom(meta.tenantId, data.conversationId);
        // Join before the final visibility check. This closes the eviction race:
        // a concurrent assignment either makes the re-check fail (and we leave)
        // or runs afterwards and evicts this already-joined socket from the room.
        client.join(room);
        if (!await this.agentConsoleService.canViewConversation(
            meta.tenantId, data.conversationId, meta.agentId, meta.role,
        )) {
            client.leave(room);
            return;
        }

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
            .to(this.conversationRoom(meta.tenantId, data.conversationId))
            .emit('conversation:viewers_update', { conversationId: data.conversationId, viewers });
    }

    @SubscribeMessage('conversation:viewing_start')
    async handleViewingStart(
        @ConnectedSocket() client: any,
        @MessageBody() data: { conversationId: string },
    ) {
        const meta = this.socketMeta.get(client.id);
        if (!meta) return;
        if (!await this.agentConsoleService.canViewConversation(
            meta.tenantId, data.conversationId, meta.agentId, meta.role,
        )) return;

        const room = this.conversationRoom(meta.tenantId, data.conversationId);
        client.join(room);
        if (!await this.agentConsoleService.canViewConversation(
            meta.tenantId, data.conversationId, meta.agentId, meta.role,
        )) {
            client.leave(room);
            return;
        }

        await this.collisionDetectionService.startViewing(
            meta.tenantId,
            data.conversationId,
            meta.agentId,
            meta.agentName,
        );
        const viewers = await this.collisionDetectionService.getViewers(meta.tenantId, data.conversationId);
        this.server
            .to(this.conversationRoom(meta.tenantId, data.conversationId))
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
        client.leave(this.conversationRoom(meta.tenantId, data.conversationId));
        if (!await this.agentConsoleService.canViewConversation(
            meta.tenantId, data.conversationId, meta.agentId, meta.role,
        )) return;
        const viewers = await this.collisionDetectionService.getViewers(meta.tenantId, data.conversationId);
        this.server
            .to(this.conversationRoom(meta.tenantId, data.conversationId))
            .emit('conversation:viewers_update', { conversationId: data.conversationId, viewers });
    }

    @SubscribeMessage('conversation:heartbeat')
    async handleHeartbeat(
        @ConnectedSocket() client: any,
        @MessageBody() data: { conversationId: string },
    ) {
        const meta = this.socketMeta.get(client.id);
        if (!meta) return;
        if (!await this.agentConsoleService.canViewConversation(
            meta.tenantId, data.conversationId, meta.agentId, meta.role,
        )) return;

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

        const canAct = await this.agentConsoleService.canActOnConversation(
            meta.tenantId, data.conversationId, meta.agentId, meta.role,
        );
        if (!canAct) {
            client.emit('error', { message: 'No tienes permiso para enviar mensajes en esta conversación.' });
            return;
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
            .to(this.conversationRoom(meta.tenantId, data.conversationId))
            .emit('conversation:message', message);
    }

    @SubscribeMessage('conversation:assign')
    async handleAssign(
        @ConnectedSocket() client: any,
        @MessageBody() data: { conversationId: string; agentId: string },
    ) {
        const meta = this.socketMeta.get(client.id);
        if (!meta) return;

        const elevated = this.hasElevatedRole(meta.role);
        if (!elevated && data.agentId !== meta.agentId) {
            client.emit('error', { message: 'No tienes permiso para asignar conversaciones a otros agentes.' });
            return;
        }
        const targetAgentId = elevated ? data.agentId : meta.agentId;

        if (elevated) {
            await this.agentConsoleService.assignConversation(
                meta.tenantId,
                data.conversationId,
                targetAgentId,
            );
        } else {
            // An agent may take only a currently unassigned conversation. The
            // target identity comes from the authenticated socket metadata.
            await this.agentConsoleService.claimConversation(
                meta.tenantId,
                data.conversationId,
                meta.agentId,
            );
        }

        this.evictConversationRoom(meta.tenantId, data.conversationId);

        // Notify assigned agent
        this.server?.to(this.agentRoom(meta.tenantId, targetAgentId)).emit('inbox:assigned', {
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

        const canAct = await this.agentConsoleService.canActOnConversation(
            meta.tenantId, data.conversationId, meta.agentId, meta.role,
        );
        if (!canAct) {
            client.emit('error', { message: 'No tienes permiso para resolver esta conversación.' });
            return;
        }

        await this.agentConsoleService.resolveConversation(
            meta.tenantId,
            data.conversationId,
            meta.agentId,
        );

        this.server?.to(`tenant:${meta.tenantId}`).emit('inbox:refresh');
        this.server
            .to(this.conversationRoom(meta.tenantId, data.conversationId))
            .emit('conversation:resolved', { conversationId: data.conversationId });
        this.evictConversationRoom(meta.tenantId, data.conversationId);
    }

    @SubscribeMessage('agent:typing')
    async handleTyping(
        @ConnectedSocket() client: any,
        @MessageBody() data: { conversationId: string; typing: boolean },
    ) {
        const meta = this.socketMeta.get(client.id);
        if (!meta) return;
        if (!await this.agentConsoleService.canViewConversation(
            meta.tenantId, data.conversationId, meta.agentId, meta.role,
        )) return;
        client.to(this.conversationRoom(meta.tenantId, data.conversationId)).emit('agent:typing', {
            agentId: meta.agentId,
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

        if (!await this.agentConsoleService.canViewConversation(
            meta.tenantId, data.conversationId, meta.agentId, meta.role,
        )) {
            client.emit('error', { message: 'No tienes permiso para usar Copilot en esta conversación.' });
            return;
        }

        try {
            const suggestions = await this.copilotService.getSuggestions(
                meta.tenantId,
                data.conversationId,
                meta.agentId,
                meta.role,
            );
            client.emit('copilot:suggestions', { conversationId: data.conversationId, suggestions });
        } catch (error: any) {
            this.logger.error(`Copilot suggest failed: ${error.message}`);
            if (error?.getStatus?.() === 429) {
                client.emit('error', { statusCode: 429, code: 'copilot_rate_limit', message: error.message });
            }
            client.emit('copilot:suggestions', { conversationId: data.conversationId, suggestions: [] });
        }
    }

    /**
     * Called by the system when a new customer message arrives
     */
    notifyNewMessage(tenantId: string, conversationId: string, message: any) {
        // Tenant-wide listeners receive only a refresh signal. Message content
        // stays in the tenant-scoped conversation room whose members passed
        // canViewConversation before joining.
        this.relayEmit(`tenant:${tenantId}`, 'inbox:refresh', {});
        this.relayEmit(this.conversationRoom(tenantId, conversationId), 'conversation:message', message);
    }

    /**
     * Check if the agent role allows acting on any conversation (supervisor or admin).
     */
    private hasElevatedRole(role: string): boolean {
        return role === 'tenant_admin' || role === 'tenant_supervisor';
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
            structuredSummary: event.structuredSummary,
            traceId: event.traceId,
            assignedTo: event.assignedTo,
            assignedAgentName: event.assignedAgentName,
            contactName: event.contactName,
            contactPhone: event.contactPhone,
            lastMessage: event.lastMessage,
            triggeredAt: event.handoffTriggeredAt,
            urgent: true,
        };

        // Sensitive handoff context is never sent tenant-wide. Only elevated
        // roles, the assigned agent and authorized viewers in the scoped
        // conversation room receive it.
        this.relaySensitiveToElevatedRoles(event.tenantId, 'inbox:handoff', payload);
        this.relayEmit(this.conversationRoom(event.tenantId, event.conversationId), 'inbox:handoff', payload);

        // Notificación directa al asignado, por su room tenant-scoped (se une
        // en el register, mismo patrón que 'inbox:assigned'). El bloque anterior
        // recorría sockets con 3 bugs acumulados (Namespace.sockets no tiene
        // .adapter, el Map estaba destructurado al revés y meta nunca vivió en
        // socket.data) — 'inbox:assigned_to_you' jamás llegó a nadie pese a que
        // el móvil y el TopBar del dashboard lo escuchan.
        if (event.assignedTo) {
            this.relayEmit(this.agentRoom(event.tenantId, event.assignedTo), 'inbox:assigned_to_you', {
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
        const payload = {
            conversationId: event.conversationId,
            suggestedText: event.text,
            contactName: event.contactName,
        };
        this.relaySensitiveToElevatedRoles(event.tenantId, 'inbox:draft_suggestion', payload);
        this.relayEmit(
            this.conversationRoom(event.tenantId, event.conversationId),
            'inbox:draft_suggestion',
            payload,
        );
        this.relayEmit(`tenant:${event.tenantId}`, 'inbox:refresh', {});
    }

    /**
     * A4 notifications originate in the tenant approval outbox. The workflow
     * marks that row published only after this listener runs, so a process
     * crash is recoverable and the dashboard can refresh its tenant-scoped
     * approval queue without ever routing ticket UUIDs through the LLM.
     */
    @OnEvent('tool.approval.notification')
    handleToolApprovalNotification(event: {
        tenantId: string;
        eventId: string;
        eventType: string;
        ticketId: string;
        toolName?: string;
        contactId?: string | null;
        conversationId?: string | null;
        expiresAt?: string;
        decidedBy?: string;
        ledgerStatus?: string;
        error?: string;
    }) {
        if (!event?.tenantId) return;
        this.relaySensitiveToElevatedRoles(event.tenantId, 'inbox:tool_approval', event);
        if (event.conversationId) {
            this.relayEmit(
                this.conversationRoom(event.tenantId, event.conversationId),
                'inbox:tool_approval',
                event,
            );
        }
        this.relayEmit(`tenant:${event.tenantId}`, 'inbox:refresh', {});
    }

    @OnEvent('handoff.escalated_supervisor')
    handleSupervisorEscalation(event: { tenantId: string; conversationId: string; contactName: string; reason: string; waitMinutes: number }) {
        this.logger.warn(`[Escalation] Supervisor notified: ${event.contactName} waiting ${event.waitMinutes}min`);
        this.relaySensitiveToElevatedRoles(event.tenantId, 'inbox:escalation', {
            conversationId: event.conversationId,
            contactName: event.contactName,
            reason: event.reason,
            waitMinutes: event.waitMinutes,
            urgent: true,
        });
        this.relayEmit(`tenant:${event.tenantId}`, 'inbox:refresh', {});
    }

    @OnEvent('conversation.assigned')
    handleConversationAssigned(event: { tenantId: string; conversationId: string }) {
        this.evictConversationRoom(event.tenantId, event.conversationId);
        this.relayEmit(`tenant:${event.tenantId}`, 'inbox:refresh', {});
    }

    @OnEvent('conversation.resolved')
    handleConversationResolvedAccess(event: { tenantId: string; conversationId: string }) {
        this.evictConversationRoom(event.tenantId, event.conversationId);
        this.relayEmit(`tenant:${event.tenantId}`, 'inbox:refresh', {});
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
