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
    // Maps socket ID to tenant ID
    private connectedClients = new Map<string, string>();

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
            
            const tenantId = payload.tenantId;

            client.join(tenantId);
            this.connectedClients.set(client.id, tenantId);
            
            this.logger.log(`Client ${client.id} connected. Joined tenant room: ${tenantId}`);
        } catch (error) {
            this.logger.error(`Connection error for client ${client.id}: ${error.message}`);
            client.disconnect();
        }
    }

    handleDisconnect(client: Socket) {
        this.connectedClients.delete(client.id);
        this.logger.log(`Client ${client.id} disconnected.`);
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
}
