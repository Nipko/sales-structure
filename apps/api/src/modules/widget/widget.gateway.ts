import { WidgetMessageStore } from './widget-message-store.service';
import { widgetPublicMessage } from './widget-message-protocol';
import { WsRelayService } from '../redis/ws-relay.service';
import { Interval } from '@nestjs/schedule';
import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    MessageBody,
    ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, Optional, UsePipes, ValidationPipe } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';
import { WidgetService } from './widget.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { RedisService } from '../redis/redis.service';
import { resolveReadyTenantContext } from '../../common/utils/tenant-lifecycle.util';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';
import { BillingEventType } from '../billing/types/billing-event.enum';
import { WidgetMessageDto } from './dto/widget-public.dto';
import { isWidgetOriginAllowed, resolveWidgetSocketIp } from './widget-security';
import { WidgetRateLimitService } from './widget-rate-limit.service';
import {
    hasWidgetCapability,
    resolveWidgetCapabilities,
    type WidgetCapabilitySnapshot,
} from './widget-capability-policy';

@WebSocketGateway({
    namespace: '/widget',
    cors: { origin: '*', credentials: false },
})
export class WidgetGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
    @WebSocketServer() server: Server;
    private readonly logger = new Logger(WidgetGateway.name);
    private readonly clients = new Map<string, Socket>();
    private polling = false;

    constructor(
        private readonly widgetService: WidgetService,
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly conversations: ConversationsService,
        private readonly rateLimit: WidgetRateLimitService,
        @Optional() private readonly messages?: WidgetMessageStore,
        @Optional() private readonly relay?: WsRelayService,
    ) {}

    afterInit():void {
        if (!this.server) return;
        this.relay?.subscribe('widget',signal=>{
            if(signal.event!=='widget:persisted'||!signal.payload?.tenantId||!signal.payload?.messageId)return;
            for(const client of this.clients.values()) {
                const session=(client as any).widgetSession;
                if(session?.tenant_id===signal.payload.tenantId && session?.conversation_id===signal.payload.conversationId)
                    this.syncClient(client,false,signal.payload.messageId).catch(()=>this.rejectClient(client,'Invalid session'));
            }
        });
    }

    @Interval(15000)
    async replayPending():Promise<void>{
        if(!this.server||this.polling||!this.messages)return;
        this.polling=true;
        try{for(const client of this.clients.values())await this.syncClient(client).catch(()=>this.rejectClient(client,'Invalid session'));}
        finally{this.polling=false;}
    }

    private async syncClient(client:Socket,history=false,messageId?:string){
        if(!this.messages)throw new Error('widget_delivery_unavailable');
        return this.messages.withSessionMessages({token:(client as any).widgetToken,origin:client.handshake.headers.origin},
            {history,messageId},async(session,messages)=>{
                (client as any).widgetSession=session;
                if(history)client.emit('widget:history',{messages:messages.map(widgetPublicMessage)});
                else for(const message of messages)client.emit('widget:message',widgetPublicMessage(message));
                return messages;
            });
    }

    @SubscribeMessage('widget:received')
    async handleReceipt(@ConnectedSocket() client:Socket,@MessageBody() data:{messageId?:string}){
        if(!this.messages||typeof data?.messageId!=='string')return;
        try{await this.messages.acknowledge({token:(client as any).widgetToken,origin:client.handshake.headers.origin},data.messageId);}
        catch{this.rejectClient(client,'Invalid session');}
    }

    async handleConnection(client: Socket) {
        const token = client.handshake.auth?.token || client.handshake.query?.token as string;
        if (!token) {
            this.rejectClient(client, 'Invalid session');
            return;
        }

        const session = await this.widgetService.getSessionByToken(token);
        if (!session) {
            this.rejectClient(client, 'Invalid session');
            return;
        }
        if (!isWidgetOriginAllowed(client.handshake.headers.origin, session.allowed_domains)) {
            this.rejectClient(client, 'Origin not allowed');
            return;
        }
        if (!await resolveReadyTenantContext(this.prisma, this.redis, session.tenant_id)) {
            this.rejectClient(client, 'Tenant unavailable');
            return;
        }
        const entitlement = await resolveTenantSubscriptionAccess(this.prisma, session.tenant_id, 'write');
        if (!entitlement.allowed) {
            this.rejectClient(client, 'Subscription unavailable', entitlement.error);
            return;
        }

        const capabilities = this.resolveCurrentCapabilities(session);
        if (!capabilities.formalChannel) {
            this.rejectClient(client, 'Widget channel unavailable');
            return;
        }

        (client as any).widgetSession = session;
        (client as any).widgetToken = token;
        (client as any).widgetCapabilities = capabilities;
        this.clients.set(client.id,client);
        client.join(`session:${session.id}`);
        client.join(`tenant:${session.tenant_id}`);
        client.use(async (_packet, next) => {
            const fresh=await this.widgetService.getSessionByToken(token);
            if(!fresh||!isWidgetOriginAllowed(client.handshake.headers.origin,fresh.allowed_domains)){
                this.rejectClient(client,'Invalid session');next(new Error('widget_session_invalid'));return;
            }
            const current = await resolveTenantSubscriptionAccess(this.prisma, session.tenant_id, 'write');
            if (current.allowed) return next();
            client.emit('widget:error', {
                message: 'Subscription unavailable',
                code: current.error,
            });
            client.disconnect();
            next(new Error(current.error ?? 'subscription_unavailable'));
        });

        if (session.conversation_id) {
            let history;
            try{history=await this.syncClient(client,true);}
            catch{this.rejectClient(client,'Invalid session');return;}
            const newest=history[history.length-1];

            // If the newest message is inbound, the previous turn never produced a
            // reply - the API was restarted or crashed mid-stream. The widget is
            // the one channel with no queue behind it, so nothing would ever retry
            // and the visitor would sit in front of an unanswered question.
            if (newest && newest.direction === 'inbound' && newest.content_text) {
                // Two browser tabs can reconnect at the same time. Claim the
                // exact inbound before regenerating so only one of them can
                // create the missing outbound turn. A failed attempt releases
                // the claim; a successful one leaves the short TTL in place.
                const regenerationKey = [
                    'idem', 'widget', 'regenerate', session.tenant_id,
                    session.conversation_id, newest.id,
                ].join(':');
                if (await this.redis.acquireLock(regenerationKey, 300)) {
                    this.logger.warn(
                        `[Widget] Conversation ${session.conversation_id} reconnected with an unanswered message - regenerating`,
                    );
                    this.regenerateReply(client, session, newest.content_text, newest.id).catch(async (err) => {
                        await this.redis.releaseLock(regenerationKey).catch(() => undefined);
                        this.logger.error(`[Widget] Regeneration failed: ${err?.message}`);
                    });
                }
            }
        }

        client.emit('widget:connected', { sessionId: session.id });
    }

    /**
     * Re-run the AI turn for a message left unanswered by a restart. Streams
     * through the same path as a live message so the visitor sees a normal reply.
     */
    private async regenerateReply(
        client: Socket,
        session: any,
        text: string,
        inboundMessageId?: string,
    ): Promise<void> {
        const entitlement = await resolveTenantSubscriptionAccess(this.prisma, session.tenant_id, 'write');
        if (!entitlement.allowed) {
            this.rejectClient(client, 'Subscription unavailable', entitlement.error);
            return;
        }
        const schemaName = await this.prisma.getTenantSchemaName(session.tenant_id);
        await this.streamAssistantReply(
            client, session.tenant_id, schemaName, session.conversation_id, session.contact_id, text,
            inboundMessageId,
        );
    }

    handleDisconnect(client: Socket) {
        this.clients.delete(client.id);
    }

    @OnEvent(BillingEventType.SUBSCRIPTION_CANCELLED, { async: true })
    async handleSubscriptionCancelled(event: { tenantId: string }) {
        await this.disconnectTenantIfRestricted(event?.tenantId);
    }

    @OnEvent(BillingEventType.SUBSCRIPTION_EXPIRED, { async: true })
    async handleSubscriptionExpired(event: { tenantId: string }) {
        await this.disconnectTenantIfRestricted(event?.tenantId);
    }

    private async disconnectTenantIfRestricted(tenantId?: string): Promise<void> {
        if (!tenantId || !this.server) return;
        const entitlement = await resolveTenantSubscriptionAccess(this.prisma, tenantId, 'write');
        if (!entitlement.allowed) {
            this.server.in(`tenant:${tenantId}`).disconnectSockets(true);
        }
    }

    @SubscribeMessage('widget:message')
    @UsePipes(new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
    }))
    async handleMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody() data: WidgetMessageDto,
    ) {
        const token = (client as any).widgetToken as string | undefined;
        if (!token || !data.content?.trim()) return;

        // Re-read the token, widget config, tenant lifecycle and plan entitlement
        // for every message. A socket opened before suspension, plan downgrade,
        // widget disable or token rotation must stop immediately.
        const session = await this.widgetService.getSessionByToken(token);
        if (!session) {
            this.rejectClient(client, 'Invalid session');
            return;
        }
        if (!isWidgetOriginAllowed(client.handshake.headers.origin, session.allowed_domains)) {
            this.rejectClient(client, 'Origin not allowed');
            return;
        }
        (client as any).widgetSession = session;

        const tenantId = session.tenant_id;
        const ready = await resolveReadyTenantContext(this.prisma, this.redis, tenantId);
        if (!ready) {
            this.rejectClient(client, 'Tenant unavailable');
            return;
        }
        const entitlement = await resolveTenantSubscriptionAccess(this.prisma, tenantId, 'write');
        if (!entitlement.allowed) {
            this.rejectClient(client, 'Subscription unavailable', entitlement.error);
            return;
        }
        const messageLimit = await this.rateLimit.consumeMessage({
            ip: resolveWidgetSocketIp(client),
            visitorId: session.visitor_id,
            sessionId: session.id,
            widgetId: session.widget_id,
            tenantId,
        });
        if (!messageLimit.allowed) {
            client.emit('widget:error', {
                message: 'Rate limit exceeded',
                code: 'rate_limited',
                retryAfterSeconds: messageLimit.retryAfterSeconds,
            });
            client.disconnect();
            return;
        }
        const capabilities = this.resolveCurrentCapabilities(session);
        if (!capabilities.formalChannel) {
            this.rejectClient(client, 'Widget channel unavailable');
            return;
        }
        (client as any).widgetCapabilities = capabilities;
        const schemaName = ready.schemaName;

        if(!this.messages){this.rejectClient(client,'Widget channel unavailable');return;}
        let received;
        try{received=await this.messages.receive({token,origin:client.handshake.headers.origin},data.content);}
        catch{this.rejectClient(client,'Invalid session');return;}
        const {conversation_id:conversationId,contact_id:contactId}=received.session;
        (client as any).widgetSession=received.session;
        client.emit('widget:message-received',{id:received.messageId,content:data.content,timestamp:new Date().toISOString()});

        await this.streamAssistantReply(
            client, tenantId, schemaName, conversationId, contactId, data.content,
            received.messageId,
        );
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
        inboundMessageId?: string,
    ): Promise<void> {
        client.emit('widget:typing', { isTyping: true });
        try {
            const receipt = await this.conversations.processWidgetMessage(
                tenantId, schemaName, conversationId, contactId, text,
                {
                    inboundMessageId,
                    channelAccountId: (client as any).widgetSession?.widget_id,
                    allowHumanHandoff: hasWidgetCapability(
                        (client as any).widgetCapabilities as WidgetCapabilitySnapshot | undefined,
                        'human_handoff',
                    ),
                },
            );
            // Text and private provenance were committed together by the core.
            // Session authorization is checked again while reading/emitting IDs.
            for (const reference of receipt?.status === 'stored' ? receipt.messages : [])
                await this.syncClient(client, false, reference.messageId);
        } catch (err: any) {
            this.logger.warn(`Widget AI stream failed: ${err.message}`);
            client.emit('widget:error', { code: 'assistant_turn_failed', message: 'Failed to process message' });
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
        // Legacy callers may only signal a stored message. Arbitrary payloads cannot bypass session revalidation.
        if(event!=='widget:message'||typeof data?.messageId!=='string')return;
        for(const client of this.clients.values())if((client as any).widgetSession?.id===sessionId)
            this.syncClient(client,false,data.messageId).catch(()=>this.rejectClient(client,'Invalid session'));
    }

    private resolveCurrentCapabilities(session: any): WidgetCapabilitySnapshot {
        // Every caller invokes this only after the matching checks above have
        // succeeded. The same persisted transport serves authenticated human replies.
        return resolveWidgetCapabilities({
            delivery: Boolean(this.messages),
            identity: Boolean(session?.id && session?.tenant_id && session?.widget_id && session?.visitor_id),
            policy: true,
            revocation: true,
            humanDelivery: Boolean(this.messages),
        });
    }

    private rejectClient(client: Socket, message: string, code?: string): void {
        client.emit('widget:error', { message, ...(code ? { code } : {}) });
        client.disconnect();
    }
}
