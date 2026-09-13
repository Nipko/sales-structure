import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import * as jwt from 'jsonwebtoken';
import type { MessageContent, OutboundMessage } from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WsRelayService } from '../redis/ws-relay.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { resolveReadyTenantContext } from '../../common/utils/tenant-lifecycle.util';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';
import { isWidgetOriginAllowed } from './widget-security';

export type WidgetMessageQuery = <T = any[]>(sql: string, params?: any[]) => Promise<T>;
export interface WidgetMessageReference { tenantId: string; conversationId: string; messageId: string; }
export interface WidgetSessionCredentials { token: string; origin?: string; }
export interface WidgetStoredMessage {
    id: string; conversation_id: string; direction: string; content_type: string;
    content_text: string | null; media_url: string | null; caption: string | null;
    status: string; metadata: Record<string, any>; created_at: string;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Shared persisted transport for AI, approval effects and human widget messages. */
@Injectable()
export class WidgetMessageStore {
    private readonly jwtSecret: string;
    constructor(private readonly prisma: PrismaService, private readonly redis: RedisService,
        private readonly relay: WsRelayService, private readonly throttle: TenantThrottleService, config: ConfigService) {
        this.jwtSecret = config.get<string>('WIDGET_JWT_SECRET') || config.getOrThrow<string>('JWT_SECRET');
    }

    async assertAvailable(tenantId: string): Promise<string> {
        const ready = await resolveReadyTenantContext(this.prisma, this.redis, tenantId);
        if (!ready || !(await resolveTenantSubscriptionAccess(this.prisma,tenantId,'write')).allowed
            || (await this.throttle.getPlanFeatures(tenantId)).widget !== true) throw new Error('widget_delivery_unavailable');
        return ready.schemaName;
    }

    async ensureConversation(credentials:WidgetSessionCredentials):Promise<any>{
        const claims=this.claims(credentials.token),schema=await this.assertAvailable(claims.tenantId);
        return this.prisma.transactionInTenantSchema(schema,async query=>{
            await this.privacyFence(query,schema);
            const session=await this.authorize(query,schema,claims,credentials,true);
            if(session.conversation_id){
                await this.assertConversation(query,schema,claims.tenantId,session.conversation_id,session.contact_id);
                return session;
            }
            // Visitor IDs are public tracking hints, never identities that grant access to a prior conversation.
            const contacts=await query<any[]>(`INSERT INTO contacts(name,phone,email,channel_type,external_id,created_at,updated_at)
                VALUES($1,$2,$3,'web_widget',$4,NOW(),NOW()) RETURNING id`,
            [session.visitor_name||null,session.visitor_phone||null,session.visitor_email||null,`widget_${session.id}`]);
            const conversations=await query<any[]>(`INSERT INTO conversations(contact_id,channel_type,channel_account_id,status,metadata,created_at,updated_at)
                VALUES($1::uuid,'web_widget',$2,'active',$3::jsonb,NOW(),NOW()) RETURNING id`,
            [contacts[0].id,session.widget_id,JSON.stringify({widgetSessionId:session.id,page:session.page_url})]);
            await query('UPDATE public.widget_sessions SET contact_id=$2::uuid,conversation_id=$3::uuid,last_seen_at=NOW() WHERE id=$1::uuid',
                [session.id,contacts[0].id,conversations[0].id]);
            return {...session,contact_id:contacts[0].id,conversation_id:conversations[0].id};
        });
    }

    async receive(credentials:WidgetSessionCredentials,text:string):Promise<{session:any;messageId:string}>{
        await this.ensureConversation(credentials);
        const claims=this.claims(credentials.token),schema=await this.assertAvailable(claims.tenantId);
        return this.prisma.transactionInTenantSchema(schema,async query=>{
            await this.privacyFence(query,schema);
            const session=await this.authorize(query,schema,claims,credentials);
            await this.assertConversation(query,schema,claims.tenantId,session.conversation_id,session.contact_id);
            const rows=await query<any[]>(`INSERT INTO messages(conversation_id,direction,content_type,content_text,status,metadata,created_at)
                VALUES($1::uuid,'inbound','text',$2,'delivered','{"channel":"web_widget"}'::jsonb,NOW()) RETURNING id`,[session.conversation_id,text]);
            await query('UPDATE conversations SET updated_at=NOW() WHERE id=$1::uuid',[session.conversation_id]);
            return {session,messageId:rows[0].id};
        });
    }

    /** Caller-supplied query must be the server's current tenant transaction. */
    async assertConversation(query: WidgetMessageQuery, schema: string, tenantId: string, conversationId: string, contactId?: string): Promise<any> {
        if (![tenantId,conversationId].every(id=>UUID.test(id))) throw new Error('widget_delivery_invalid_scope');
        await this.privacyFence(query,schema);
        const rows=await query<any[]>(`SELECT c.id AS conversation_id,c.contact_id,c.channel_account_id,c.status,
            ct.external_id,ws.id AS session_id,ws.widget_config_id,wc.widget_id,wc.locale
            FROM conversations c JOIN contacts ct ON ct.id=c.contact_id
            JOIN public.widget_sessions ws ON ws.conversation_id=c.id AND ws.contact_id=ct.id AND ws.tenant_id=$1::uuid
            JOIN public.widget_configs wc ON wc.id=ws.widget_config_id AND wc.tenant_id=ws.tenant_id AND wc.is_active=true
            JOIN public.tenants t ON t.id=ws.tenant_id AND t.schema_name=$3 AND t.is_active=true
            WHERE c.id=$2::uuid AND c.channel_type='web_widget' AND ct.channel_type='web_widget'
              AND (c.channel_account_id=wc.widget_id OR c.channel_account_id='widget')
              AND c.metadata->>'widgetSessionId'=ws.id::text AND ws.last_seen_at>NOW()-INTERVAL '90 days'
            FOR SHARE OF ws,wc,t`,[tenantId,conversationId,schema]);
        const row=rows[0];
        if (!row || (contactId && row.contact_id!==contactId)) throw new Error('widget_delivery_binding_changed');
        await this.assertNotErased(query,schema,row.contact_id);
        return row;
    }

    async persistWithQuery(query: WidgetMessageQuery, schema: string, tenantId: string, input: {
        conversationId: string; contactId?: string; content: MessageContent; dedupeId: string;
        source: 'ai' | 'agent' | 'approval'; agentId?: string; approvalEffectId?: string;
        channelAccountId?: string; recipient?: string;
    }): Promise<WidgetStoredMessage> {
        const binding=await this.assertConversation(query,schema,tenantId,input.conversationId,input.contactId);
        if ((input.recipient && input.recipient!==binding.external_id)
            || (input.channelAccountId && input.channelAccountId!==binding.widget_id && input.channelAccountId!==binding.channel_account_id)) {
            throw new Error('widget_delivery_binding_changed');
        }
        if (['resolved','archived','closed'].includes(binding.status)) throw new Error('widget_conversation_closed');
        if (!input.dedupeId || input.dedupeId.length>240) throw new Error('widget_delivery_identity_required');
        const content=this.validContent(input.content);
        if (input.source==='agent') {
            const actors=await query<any[]>('SELECT id FROM public.users WHERE id=$1::uuid AND tenant_id=$2::uuid AND is_active=true FOR SHARE',[input.agentId,tenantId]);
            if(!actors[0])throw new Error('widget_agent_unavailable');
            await query(`UPDATE conversations SET was_handed_off=true,handoff_at=COALESCE(handoff_at,NOW()),metadata=COALESCE(metadata,'{}'::jsonb)-'pendingDraft',updated_at=NOW()
                WHERE id=$1::uuid`,[input.conversationId]);
            const assignments=await query<any[]>('SELECT to_regclass($1)::text AS name', [schema+'.conversation_assignments']);
            if(assignments[0]?.name)await query('UPDATE conversation_assignments SET first_response_at=NOW() WHERE conversation_id=$1::uuid AND agent_id=$2::uuid AND first_response_at IS NULL AND resolved_at IS NULL',[input.conversationId,input.agentId]);
        }
        const metadata={channel:'web_widget',source:input.source,ai:input.source==='ai',widgetSessionId:binding.session_id,
            ...(input.agentId?{agentId:input.agentId}:{}),...(input.approvalEffectId?{approvalEffectId:input.approvalEffectId}:{}),
            ...(content.mediaUrl?{mediaUrl:content.mediaUrl,caption:content.caption,filename:content.filename}:{})};
        const externalId=`widget:outbound:${createHash('sha256').update(`${tenantId}:${input.conversationId}:${input.dedupeId}`).digest('hex')}`;
        const rows=await query<WidgetStoredMessage[]>(`INSERT INTO messages(conversation_id,direction,content_type,content_text,media_url,caption,status,external_id,metadata,created_at)
            VALUES($1::uuid,'outbound',$2,$3,$4,$5,'pending',$6,$7::jsonb,NOW())
            ON CONFLICT(external_id) WHERE external_id IS NOT NULL DO NOTHING RETURNING *`,
        [input.conversationId,content.type,content.text||content.caption||null,content.mediaUrl||null,content.caption||null,externalId,JSON.stringify(metadata)]);
        const message=rows[0] || (await query<WidgetStoredMessage[]>('SELECT * FROM messages WHERE external_id=$1 AND conversation_id=$2::uuid',[externalId,input.conversationId]))[0];
        if(!message)throw new Error('widget_reply_persistence_failed');
        return message;
    }

    async persist(tenantId: string, input: Parameters<WidgetMessageStore['persistWithQuery']>[3]): Promise<WidgetStoredMessage> {
        const schema=await this.assertAvailable(tenantId);
        const message=await this.prisma.transactionInTenantSchema(schema,query=>this.persistWithQuery(query,schema,tenantId,input));
        this.publish({tenantId,conversationId:input.conversationId,messageId:message.id});
        return message;
    }

    async sendOutbound(outbound: OutboundMessage): Promise<string> {
        const conversationId=String(outbound.metadata?.conversationId||'');
        const message=await this.persist(outbound.tenantId,{conversationId,content:outbound.content,
            dedupeId:outbound.dedupeId||String(outbound.metadata?.messageId||''),source:'ai',
            channelAccountId:outbound.channelAccountId,recipient:outbound.to});
        return `widget:stored:${message.id}`;
    }

    /** Pub/sub carries only references. Missed signals are recovered from messages on reconnect/poll. */
    publish(reference: WidgetMessageReference): void {
        this.relay.publish('widget',{room:null,event:'widget:persisted',payload:reference});
    }

    async withSessionMessages<T>(credentials: WidgetSessionCredentials, selection: {history?: boolean; messageId?: string},
        consume: (session:any,messages:WidgetStoredMessage[])=>Promise<T>):Promise<T> {
        const claims=this.claims(credentials.token);
        const schema=await this.assertAvailable(claims.tenantId);
        return this.prisma.transactionInTenantSchema(schema,async query=>{
            await this.privacyFence(query,schema);
            const session=await this.authorize(query,schema,claims,credentials);
            if(!session.conversation_id)return consume(session,[]);
            await this.assertConversation(query,schema,claims.tenantId,session.conversation_id,session.contact_id);
            if(selection.messageId && !UUID.test(selection.messageId))throw new Error('widget_message_invalid');
            const params:any[]=[session.conversation_id];
            let filter='';
            if(selection.messageId){params.push(selection.messageId);filter='AND id=$2::uuid';}
            else if(!selection.history)filter="AND direction='outbound' AND status='pending'";
            const messages=await query<WidgetStoredMessage[]>(`SELECT * FROM messages WHERE conversation_id=$1::uuid AND direction IN ('inbound','outbound') AND content_type IN ('text','image','audio','video','document') ${filter}
                ORDER BY created_at ${selection.history?'DESC':'ASC'},id ${selection.history?'DESC':'ASC'} LIMIT 100`,params);
            // The callback emits while the persisted token/config rows and privacy fence remain locked.
            return consume(session,selection.history?[...messages].reverse():messages);
        });
    }

    async acknowledge(credentials:WidgetSessionCredentials,messageId:string):Promise<boolean>{
        if(!UUID.test(messageId))return false;
        const claims=this.claims(credentials.token),schema=await this.assertAvailable(claims.tenantId);
        return this.prisma.transactionInTenantSchema(schema,async query=>{
            await this.privacyFence(query,schema);
            const session=await this.authorize(query,schema,claims,credentials);
            if(!session.conversation_id)return false;
            await this.assertConversation(query,schema,claims.tenantId,session.conversation_id,session.contact_id);
            const rows=await query<any[]>(`UPDATE messages SET status='delivered',metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('widgetReceivedAt',NOW())
                WHERE id=$1::uuid AND conversation_id=$2::uuid AND direction='outbound' AND status='pending' RETURNING id`,[messageId,session.conversation_id]);
            return Boolean(rows[0]);
        });
    }

    private claims(token:string):any{
        const decoded=jwt.verify(token,this.jwtSecret,{algorithms:['HS256']}) as any;
        if(!UUID.test(decoded?.sessionId||'')||!UUID.test(decoded?.tenantId||'')||typeof decoded?.widgetId!=='string')throw new Error('widget_session_invalid');
        return decoded;
    }
    private async authorize(query:WidgetMessageQuery,schema:string,claims:any,credentials:WidgetSessionCredentials,lockSession=false){
        const rows=await query<any[]>(`SELECT ws.*,wc.widget_id,wc.allowed_domains FROM public.widget_sessions ws
            JOIN public.widget_configs wc ON wc.id=ws.widget_config_id AND wc.tenant_id=ws.tenant_id
            WHERE ws.id=$1::uuid AND ws.tenant_id=$2::uuid AND ws.token=$3 AND wc.widget_id=$4 AND wc.is_active=true
                AND ws.last_seen_at>NOW()-INTERVAL '90 days' ${lockSession?'FOR UPDATE OF ws FOR SHARE OF wc':'FOR SHARE OF ws,wc'}`,[claims.sessionId,claims.tenantId,credentials.token,claims.widgetId]);
        const session=rows[0];
        if(!session||!isWidgetOriginAllowed(credentials.origin,session.allowed_domains))throw new Error('widget_session_invalid');
        if(session.contact_id)await this.assertNotErased(query,schema,session.contact_id);
        return session;
    }
    private privacyFence(query:WidgetMessageQuery,schema:string){
        return query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text',[`agent-privacy:${schema}`]);
    }
    private async assertNotErased(query:WidgetMessageQuery,schema:string,contactId:string){
        const exists=await query<any[]>('SELECT to_regclass($1)::text AS name',[`${schema}.customer_memory_erasure`]);
        if(exists[0]?.name && (await query<any[]>('SELECT contact_id FROM customer_memory_erasure WHERE contact_id=$1::uuid',[contactId])).length)throw new Error('widget_contact_erased');
    }
    private validContent(content:MessageContent):MessageContent{
        if(content.type==='text'&&typeof content.text==='string'&&content.text.trim()&&content.text.length<=32000)return content;
        if(['image','audio','video','document'].includes(content.type)&&content.mediaUrl){
            const url=new URL(content.mediaUrl);
            if(url.protocol==='https:'&&!url.username&&!url.password)return content;
        }
        throw new Error('widget_message_content_invalid');
    }
}
