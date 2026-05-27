import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    ConnectedSocket,
    MessageBody
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
    cors: {
        origin: '*',
        credentials: true
    },
    namespace: '/inbox'
})
export class ConversationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(ConversationsGateway.name);
    // Maps socket ID → { tenantId, role }
    private connectedClients = new Map<string, { tenantId: string; role: string }>();

    constructor(
        private jwtService: JwtService,
        private configService: ConfigService,
    ) { }

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
    handleSwitchTenant(
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
        // Leave old room, join new one
        client.leave(meta.tenantId);
        client.join(data.tenantId);
        this.connectedClients.set(client.id, { ...meta, tenantId: data.tenantId });
        (client as any).tenantId = data.tenantId;
        this.logger.log(`[AUDIT] super_admin switched tenant room: ${meta.tenantId} → ${data.tenantId} (client: ${client.id})`);
        client.emit('tenantSwitched', { tenantId: data.tenantId });
    }

    // --- Emit Events ---

    emitNewMessage(tenantId: string, message: any, conversationId: string) {
        this.server.to(tenantId).emit('newMessage', { conversationId, message });
    }

    emitConversationUpdated(tenantId: string, conversation: any) {
        this.server.to(tenantId).emit('conversationUpdated', conversation);
    }

    emitAppointmentCreated(tenantId: string, appointment: any) {
        this.server.to(tenantId).emit('appointmentCreated', appointment);
    }

    emitAppointmentUpdated(tenantId: string, appointment: any) {
        this.server.to(tenantId).emit('appointmentUpdated', appointment);
    }

    emitCalendarSynced(tenantId: string) {
        this.server.to(tenantId).emit('calendarSynced', {});
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
        const notified = new Set<string>();
        for (const [, meta] of this.connectedClients) {
            if ((meta.role === 'super_admin' || meta.role === 'tenant_admin') && !notified.has(meta.tenantId)) {
                notified.add(meta.tenantId);
                this.server.to(meta.tenantId).emit('system:llm_alert', payload);
            }
        }
    }
}
