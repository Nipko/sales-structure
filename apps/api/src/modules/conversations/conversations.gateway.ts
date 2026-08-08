import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    ConnectedSocket,
    MessageBody
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { WsRelayService } from '../redis/ws-relay.service';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import {
    resolveReadyTenantContext,
    resolveReadyUserTenantContext,
} from '../../common/utils/tenant-lifecycle.util';

// Evento interno del relay: la alerta LLM se entrega por-socket según rol, así
// que el suscriptor la resuelve con el fanout local en vez de un emit a room.
const RELAY_LLM_ALERT = '__llm_alert';

@WebSocketGateway({
    cors: {
        origin: '*',
        credentials: true
    },
    namespace: '/inbox'
})
export class ConversationsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(ConversationsGateway.name);
    // Maps socket ID → { tenantId, role }
    private connectedClients = new Map<string, { tenantId: string; role: string }>();

    constructor(
        private jwtService: JwtService,
        private configService: ConfigService,
        private wsRelay: WsRelayService,
        private prisma: PrismaService,
        private redis: RedisService,
    ) { }

    /**
     * Solo corre donde existe un servidor WebSocket real (el contenedor API):
     * el worker jamás llega acá, así que la suscripción no se duplica.
     */
    afterInit() {
        this.wsRelay.subscribe('inbox', ({ room, event, payload }) => {
            if (event === RELAY_LLM_ALERT) {
                this.fanoutLlmAlert(payload);
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
        else this.wsRelay.publish('inbox', { room, event, payload });
    }

    async handleConnection(client: Socket) {
        try {
            // Check auth
            const authHeader = client.handshake.auth.token || client.handshake.headers.authorization;
            if (!authHeader) {
                client.disconnect();
                return;
            }

            const token = authHeader.replace('Bearer ', '');
            const payload = this.jwtService.verify(token, { secret: this.configService.get<string>('auth.jwtSecret') });

            // Resolve tenantId: JWT first, then handshake query for super_admin
            let tenantId = payload.tenantId;
            const role = payload.role || '';

            if (!tenantId && role === 'super_admin') {
                // super_admin can specify tenant via handshake query
                tenantId = client.handshake.query?.tenantId as string;
            }

            if (!tenantId) {
                this.logger.warn(`Connection rejected — no tenantId (role: ${role}, client: ${client.id})`);
                client.emit('error', { message: 'No tenant context. Select a tenant first.' });
                client.disconnect();
                return;
            }

            const readyContext = role === 'super_admin'
                ? await resolveReadyTenantContext(this.prisma, this.redis, tenantId)
                : await resolveReadyUserTenantContext(this.prisma, this.redis, payload.sub, tenantId);
            if (!readyContext) {
                this.logger.warn(`Connection rejected — tenant inactive, provisioning or purging (client: ${client.id})`);
                client.emit('error', { message: 'Tenant is inactive or still provisioning.' });
                client.disconnect();
                return;
            }
            tenantId = readyContext.tenantId;

            client.join(tenantId);
            this.connectedClients.set(client.id, { tenantId, role });
            // Store on socket data for use in message handlers
            (client as any).tenantId = tenantId;
            (client as any).role = role;

            this.logger.log(`Client ${client.id} connected. Joined tenant room: ${tenantId} (role: ${role})`);
        } catch (error) {
            this.logger.error(`Connection error for client ${client.id}: ${error.message}`);
            client.disconnect();
        }
    }

    handleDisconnect(client: Socket) {
        this.connectedClients.delete(client.id);
        this.logger.log(`Client ${client.id} disconnected.`);
    }

    /**
     * Allow super_admin to switch tenant room at runtime (when they change
     * the tenant dropdown in the dashboard). Regular users are rejected.
     */
    @SubscribeMessage('switchTenant')
    async handleSwitchTenant(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: { tenantId: string },
    ) {
        const meta = this.connectedClients.get(client.id);
        if (!meta || meta.role !== 'super_admin') {
            client.emit('error', { message: 'Only super_admin can switch tenant context' });
            return;
        }
        if (!data?.tenantId) {
            client.emit('error', { message: 'tenantId is required' });
            return;
        }
        const readyContext = await resolveReadyTenantContext(this.prisma, this.redis, data.tenantId);
        if (!readyContext) {
            client.emit('error', { message: 'Tenant is inactive or still provisioning.' });
            return;
        }
        // Leave old room, join new one
        client.leave(meta.tenantId);
        client.join(readyContext.tenantId);
        this.connectedClients.set(client.id, { ...meta, tenantId: readyContext.tenantId });
        (client as any).tenantId = readyContext.tenantId;
        this.logger.log(`[AUDIT] super_admin switched tenant room: ${meta.tenantId} → ${readyContext.tenantId} (client: ${client.id})`);
        client.emit('tenantSwitched', { tenantId: readyContext.tenantId });
    }

    // --- Emit Events ---
    //
    // These run inside the AI pipeline, which since the inbound queue executes
    // in the WORKER container (no HTTP server → @WebSocketServer() never
    // populated). relayEmit() covers that: with a live server it emits direct;
    // without one it publishes to Redis and the API-side subscriber (afterInit)
    // re-emits into the room — so worker-processed turns reach the dashboard
    // and the mobile inbox in real time instead of only on refresh.

    emitNewMessage(tenantId: string, message: any, conversationId: string) {
        this.relayEmit(tenantId, 'newMessage', { conversationId, message });
    }

    emitConversationUpdated(tenantId: string, conversation: any) {
        this.relayEmit(tenantId, 'conversationUpdated', conversation);
    }

    emitAppointmentCreated(tenantId: string, appointment: any) {
        this.relayEmit(tenantId, 'appointmentCreated', appointment);
    }

    emitAppointmentUpdated(tenantId: string, appointment: any) {
        this.relayEmit(tenantId, 'appointmentUpdated', appointment);
    }

    emitCalendarSynced(tenantId: string) {
        this.relayEmit(tenantId, 'calendarSynced', {});
    }

    /** Relay appointment WebSocket events from EventEmitter (avoids circular DI) */
    @OnEvent('appointment.ws')
    onAppointmentWs(payload: { tenantId: string; type: string; appointment: any }) {
        if (payload.type === 'created') {
            this.emitAppointmentCreated(payload.tenantId, payload.appointment);
        } else if (payload.type === 'updated') {
            this.emitAppointmentUpdated(payload.tenantId, payload.appointment);
        }
    }

    @OnEvent('calendar.synced')
    onCalendarSynced(payload: { tenantId: string }) {
        this.emitCalendarSynced(payload.tenantId);
    }

    @OnEvent('llm.provider.alert')
    onLlmProviderAlert(payload: { provider: string; severity: string; failures: number; error: string; timestamp: string }) {
        this.logger.warn(`[LLM Alert] ${payload.provider}: ${payload.error} (failures: ${payload.failures})`);
        if (!this.server) {
            // Worker: el fanout por-socket necesita los clientes del proceso
            // con servidor — se relaya el evento entero.
            this.wsRelay.publish('inbox', { room: null, event: RELAY_LLM_ALERT, payload });
            return;
        }
        this.fanoutLlmAlert(payload);
    }

    private fanoutLlmAlert(payload: any) {
        // Emit to each admin's OWN socket, not the tenant room — emitting to the
        // room delivered the alert to every connected client (incl. agents); the
        // role check only gated whether to emit, not who received it.
        for (const [socketId, meta] of this.connectedClients) {
            if (meta.role === 'super_admin' || meta.role === 'tenant_admin') {
                this.server?.to(socketId).emit('system:llm_alert', payload);
            }
        }
    }
}
