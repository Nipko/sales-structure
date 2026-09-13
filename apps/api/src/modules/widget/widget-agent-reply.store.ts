import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { hasAgentSourceFence } from '../../common/utils/agent-source-fence';
import { PrismaService } from '../prisma/prisma.service';
import { assertServedAgentConnectionAuthority, validServedAgentAuthority, type ServedAgentAuthority } from '../persona/served-agent-authority';
import { assertRuntimeLearningFootprint, type RuntimeLearningFootprint } from '../learning/learning-runtime-footprint';
import { WidgetMessageStore, type WidgetMessageQuery, type WidgetMessageReference } from './widget-message-store.service';
import { WIDGET_AGENT_REPLY_DDL } from './widget-agent-reply-retention';
import { readWidgetAgentHistoryFootprints } from './widget-agent-history-footprints';
import { handoffReceiptNotice, readHandoffReceipt } from '../handoff/handoff-receipt';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export interface WidgetAgentReplyBinding {
    conversationId:string;contactId:string;inboundMessageId:string;channelAccountId:string;
}
export interface WidgetAgentReplyReceipt {
    status:'stored'|'redacted';messages:WidgetMessageReference[];
}
/** Internal turn result. Never deserialize an HTTP body into this authority. */
export interface WidgetAgentReplyInput extends WidgetAgentReplyBinding {
    tenantId:string;schemaName:string;operationalScope:ServedAgentAuthority;
    learningFootprints:RuntimeLearningFootprint[];text:string;
}
/** Internal turn result for a turn that transferred the conversation itself. */
export interface WidgetHandoffNoticeInput extends WidgetAgentReplyBinding {
    tenantId:string;schemaName:string;operationalScope:ServedAgentAuthority;
    learningFootprints:RuntimeLearningFootprint[];
    /** What this same turn produced BEFORE the transition, when it produced anything. */
    precedingText?:string;
}

@Injectable()
export class WidgetAgentReplyStore {
    private readonly initialized=new Map<string,Promise<void>>();
    constructor(private readonly prisma:PrismaService,private readonly messages:WidgetMessageStore){}

    async lookup(tenantId:string,input:WidgetAgentReplyBinding):Promise<WidgetAgentReplyReceipt|null>{
        this.validateBinding(tenantId,input);
        const schema=await this.prepare(tenantId);
        return this.prisma.transactionInTenantSchema(schema,async query=>{
            await this.privacy(query,schema,tenantId);
            return this.existing(query,schema,tenantId,input);
        });
    }

    async historyFootprints(tenantId:string,schemaName:string,conversationId:string,messageIds:string[]){
        if(!UUID.test(tenantId)||!UUID.test(conversationId)||!Array.isArray(messageIds)||messageIds.some(id=>!UUID.test(id)))
            throw new Error('widget_agent_reply_invalid_binding');
        const schema=await this.prepare(tenantId,schemaName);
        return this.prisma.transactionInTenantSchema(schema,async query=>{
            await this.privacy(query,schema,tenantId);
            await this.messages.assertConversation(query,schema,tenantId,conversationId);
            return readWidgetAgentHistoryFootprints(query,schema,tenantId,conversationId,messageIds);
        });
    }

    async commit(input:WidgetAgentReplyInput):Promise<WidgetAgentReplyReceipt>{
        input=structuredClone(input);
        this.validateBinding(input.tenantId,input);
        const schema=await this.prepare(input.tenantId,input.schemaName);
        // NOWAIT avoids an inversion with message edits (message row -> revision
        // trigger -> conversation). Only a definite local rollback is retried.
        for(let attempt=0;;attempt++){
            try{
                const receipt=await this.prisma.transactionInTenantSchema(schema,async query=>{
                    await this.privacy(query,schema,input.tenantId);
                    const prior=await this.existing(query,schema,input.tenantId,input);
                    if(prior)return prior;
                    if(!validServedAgentAuthority(input.operationalScope,schema,input.tenantId))throw new Error('widget_agent_reply_authority_required');
                    if(typeof input.text!=='string'||!input.text.trim()||input.text.length>32000)throw new Error('widget_agent_reply_invalid_text');
                    await assertServedAgentConnectionAuthority(query,schema,input.operationalScope,'web_widget',input.channelAccountId);
                    await query('LOCK TABLE contact_identities IN SHARE MODE');
                    const target=await query<any[]>(`SELECT id FROM conversations WHERE id=$1::uuid AND contact_id=$2::uuid
                        AND channel_type='web_widget' FOR UPDATE NOWAIT`,[input.conversationId,input.contactId]);
                    if(!target[0])throw new Error('widget_agent_reply_invalid_binding');
                    const raced=await this.existing(query,schema,input.tenantId,input);
                    if(raced)return raced;
                    const rows=await query<any[]>(input.operationalScope.kind==='agent'
                        ?'SELECT config_json FROM agent_personas WHERE id=$1::uuid'
                        :'SELECT config_json FROM persona_config WHERE is_active=true ORDER BY version DESC LIMIT 1',
                        input.operationalScope.kind==='agent'?[input.operationalScope.agentId]:[]);
                    if(rows[0]?.config_json?.behavior?.draftMode===true)throw new Error('widget_agent_reply_draft_not_deliverable');
                    if(!Array.isArray(input.learningFootprints)
                        ||(input.operationalScope.kind==='agent'&&!input.learningFootprints.some(group=>group?.agentId===(input.operationalScope as any).agentId)))
                        throw new Error('widget_agent_reply_learning_provenance_required');
                    const footprints=structuredClone(input.learningFootprints);
                    for(const footprint of [...footprints].sort((a,b)=>String(a.agentId).localeCompare(String(b.agentId))))
                        await assertRuntimeLearningFootprint(query,schema,{tenantId:input.tenantId,agentId:footprint?.agentId},footprint,{mode:'admission'});
                    await this.assertBinding(query,schema,input.tenantId,input,true);
                    const sources=await this.sources(query,footprints);
                    const message=await this.messages.persistWithQuery(query,schema,input.tenantId,{
                        conversationId:input.conversationId,contactId:input.contactId,channelAccountId:input.channelAccountId,
                        source:'ai',content:{type:'text',text:input.text},dedupeId:`normal-agent-reply:${input.inboundMessageId}`});
                    const replyId=randomUUID();
                    await query(`INSERT INTO widget_agent_replies(id,conversation_id,contact_id,inbound_message_id,channel_account_id,
                        operational_scope,learning_footprint,message_id,status) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::jsonb,$7::jsonb,$8::uuid,'stored')`,
                        [replyId,input.conversationId,input.contactId,input.inboundMessageId,input.channelAccountId,
                            JSON.stringify(input.operationalScope),JSON.stringify(footprints),message.id]);
                    for(const source of sources)await query(`INSERT INTO widget_agent_reply_sources(reply_id,source_id,source_contact_id)
                        VALUES($1::uuid,$2::uuid,$3::uuid)`,[replyId,source.id,source.source_contact_id]);
                    return {status:'stored' as const,messages:[{tenantId:input.tenantId,conversationId:input.conversationId,messageId:message.id}]};
                });
                for(const reference of receipt.messages)this.messages.publish(reference);
                return receipt;
            }catch(error:any){
                if((error?.meta?.code||error?.code)!=='55P03'||attempt>=2)throw error;
                await new Promise(resolve=>setTimeout(resolve,25*(attempt+1)));
            }
        }
    }

    /**
     * Admit what a turn that transferred the conversation still owes the customer.
     *
     * `commit` above is right to refuse a model reply once a person owns the
     * conversation. But the turn that performed the transfer produced its answer
     * while the agent still owned it, and the customer must be told they were
     * transferred. The durable handoff receipt is what separates those two cases:
     * it names this exact conversation, contact and inbound, and it exists only
     * because the transition happened from a status the agent still owned.
     *
     * The receipt widens WHEN words may be admitted, never WHOSE. The notice
     * sentence is derived from the receipt's own kind and language, so it cannot
     * be supplied by a caller; text from the model keeps every authority and
     * provenance check `commit` applies. Nothing here reads public metadata.
     *
     * Returns null when the receipt asks for no sentence and the turn produced
     * none: there is simply nothing to say, and no row is created.
     */
    async commitHandoffNotice(input:WidgetHandoffNoticeInput):Promise<WidgetAgentReplyReceipt|null>{
        input=structuredClone(input);
        this.validateBinding(input.tenantId,input);
        const schema=await this.prepare(input.tenantId,input.schemaName);
        for(let attempt=0;;attempt++){
            try{
                const receipt=await this.prisma.transactionInTenantSchema(schema,async query=>{
                    await this.privacy(query,schema,input.tenantId);
                    const prior=await this.existing(query,schema,input.tenantId,input);
                    if(prior)return prior;
                    if(!validServedAgentAuthority(input.operationalScope,schema,input.tenantId))throw new Error('widget_agent_reply_authority_required');
                    const handoff=await readHandoffReceipt(query,schema,{conversationId:input.conversationId,
                        contactId:input.contactId,inboundMessageId:input.inboundMessageId});
                    if(!handoff)throw new Error('widget_agent_reply_handoff_receipt_required');
                    const preceding=typeof input.precedingText==='string'?input.precedingText.trim():'';
                    const text=[preceding,handoffReceiptNotice(handoff)].filter(Boolean).join('\n\n');
                    if(!text)return null;
                    if(text.length>32000)throw new Error('widget_agent_reply_invalid_text');
                    await query('LOCK TABLE contact_identities IN SHARE MODE');
                    const target=await query<any[]>(`SELECT id FROM conversations WHERE id=$1::uuid AND contact_id=$2::uuid
                        AND channel_type='web_widget' FOR UPDATE NOWAIT`,[input.conversationId,input.contactId]);
                    if(!target[0])throw new Error('widget_agent_reply_invalid_binding');
                    const raced=await this.existing(query,schema,input.tenantId,input);
                    if(raced)return raced;
                    const footprints=structuredClone(input.learningFootprints)||[];
                    if(preceding){
                        // These are the model's own words. They keep the checks
                        // they would face in a conversation the agent still owns.
                        await assertServedAgentConnectionAuthority(query,schema,input.operationalScope,'web_widget',input.channelAccountId);
                        const rows=await query<any[]>(input.operationalScope.kind==='agent'
                            ?'SELECT config_json FROM agent_personas WHERE id=$1::uuid'
                            :'SELECT config_json FROM persona_config WHERE is_active=true ORDER BY version DESC LIMIT 1',
                            input.operationalScope.kind==='agent'?[input.operationalScope.agentId]:[]);
                        if(rows[0]?.config_json?.behavior?.draftMode===true)throw new Error('widget_agent_reply_draft_not_deliverable');
                        if(!Array.isArray(footprints)
                            ||(input.operationalScope.kind==='agent'&&!footprints.some(group=>group?.agentId===(input.operationalScope as any).agentId)))
                            throw new Error('widget_agent_reply_learning_provenance_required');
                        for(const footprint of [...footprints].sort((a,b)=>String(a.agentId).localeCompare(String(b.agentId))))
                            await assertRuntimeLearningFootprint(query,schema,{tenantId:input.tenantId,agentId:footprint?.agentId},footprint,{mode:'admission'});
                    }
                    await this.assertBinding(query,schema,input.tenantId,input,true,true);
                    const sources=preceding?await this.sources(query,footprints):[];
                    const message=await this.messages.persistWithQuery(query,schema,input.tenantId,{
                        conversationId:input.conversationId,contactId:input.contactId,channelAccountId:input.channelAccountId,
                        source:'ai',content:{type:'text',text},dedupeId:`normal-agent-reply:${input.inboundMessageId}`});
                    const replyId=randomUUID();
                    await query(`INSERT INTO widget_agent_replies(id,conversation_id,contact_id,inbound_message_id,channel_account_id,
                        operational_scope,learning_footprint,message_id,status) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::jsonb,$7::jsonb,$8::uuid,'stored')`,
                        [replyId,input.conversationId,input.contactId,input.inboundMessageId,input.channelAccountId,
                            JSON.stringify(input.operationalScope),JSON.stringify(preceding?footprints:[]),message.id]);
                    for(const source of sources)await query(`INSERT INTO widget_agent_reply_sources(reply_id,source_id,source_contact_id)
                        VALUES($1::uuid,$2::uuid,$3::uuid)`,[replyId,source.id,source.source_contact_id]);
                    return {status:'stored' as const,messages:[{tenantId:input.tenantId,conversationId:input.conversationId,messageId:message.id}]};
                });
                if(receipt)for(const reference of receipt.messages)this.messages.publish(reference);
                return receipt;
            }catch(error:any){
                if((error?.meta?.code||error?.code)!=='55P03'||attempt>=2)throw error;
                await new Promise(resolve=>setTimeout(resolve,25*(attempt+1)));
            }
        }
    }

    private async existing(query:WidgetMessageQuery,schema:string,tenantId:string,input:WidgetAgentReplyBinding):Promise<WidgetAgentReplyReceipt|null>{
        const [row]=await query<any[]>('SELECT * FROM widget_agent_replies WHERE inbound_message_id=$1::uuid',[input.inboundMessageId]);
        if(!row)return null;
        // No content or original identity is returned for an erasure tombstone.
        // It must not become a cache miss that permits another generation.
        await this.messages.assertConversation(query,schema,tenantId,input.conversationId,input.contactId);
        if(row.status==='redacted')return {status:'redacted',messages:[]};
        if(row.status!=='stored'||row.conversation_id!==input.conversationId||row.contact_id!==input.contactId
            ||row.channel_account_id!==input.channelAccountId)throw new Error('widget_agent_reply_receipt_binding_changed');
        await this.assertBinding(query,schema,tenantId,input,false);
        const [message]=await query<any[]>(`SELECT id FROM messages WHERE id=$1::uuid AND conversation_id=$2::uuid
            AND direction='outbound' AND content_type='text' AND status<>'redacted'`,[row.message_id,input.conversationId]);
        if(!message)throw new Error('widget_agent_reply_receipt_unavailable');
        return {status:'stored',messages:[{tenantId,conversationId:input.conversationId,messageId:row.message_id}]};
    }
    private async assertBinding(query:WidgetMessageQuery,schema:string,tenantId:string,input:WidgetAgentReplyBinding,fresh:boolean,handedOff=false){
        const binding=await this.messages.assertConversation(query,schema,tenantId,input.conversationId,input.contactId);
        // Exact widget IDs prevent a legacy generic alias from bypassing routing
        // to a more specific agent for this operational connection.
        if(input.channelAccountId!==binding.widget_id)throw new Error('widget_agent_reply_channel_changed');
        // A receipt-authorized notice requires the OPPOSITE status: a person must
        // still own the conversation. Somebody handing it back inside the turn
        // makes "an agent will reply shortly" false, so the caller falls back to
        // the turn's own answer instead of delivering a promise nobody kept.
        if(fresh&&handedOff&&!['waiting_human','with_human'].includes(binding.status))throw new Error('widget_agent_reply_handoff_no_longer_active');
        if(fresh&&!handedOff&&['waiting_human','with_human','closed','resolved','archived'].includes(binding.status))throw new Error('widget_agent_reply_conversation_unavailable');
        const rows=await query<any[]>(`SELECT id FROM messages WHERE id=$1::uuid AND conversation_id=$2::uuid
            AND direction='inbound' ${fresh?'FOR SHARE NOWAIT':''}`,[input.inboundMessageId,input.conversationId]);
        if(!rows[0])throw new Error('widget_agent_reply_inbound_unavailable');
    }
    private async sources(query:WidgetMessageQuery,footprints:RuntimeLearningFootprint[]){
        const releaseIds=[...new Set(footprints.flatMap(group=>group.entries.map(entry=>entry.releaseId)))].sort();
        if(!releaseIds.length)return [];
        const releases=await query<any[]>('SELECT snapshot FROM learning_releases WHERE id=ANY($1::uuid[]) ORDER BY id',[releaseIds]);
        const ids=[...new Set(releases.flatMap(row=>[...row.snapshot.examples,...row.snapshot.heldout].map((source:any)=>source.source_id)))].sort();
        const sources=await query<any[]>('SELECT id,source_contact_id FROM learning_sources WHERE id=ANY($1::uuid[]) ORDER BY id',[ids]);
        if(sources.length!==ids.length)throw new Error('widget_agent_reply_source_changed');
        return sources;
    }
    private validateBinding(tenantId:string,input:WidgetAgentReplyBinding){
        if(!input||![tenantId,input.conversationId,input.contactId,input.inboundMessageId].every(id=>UUID.test(id))
            ||typeof input.channelAccountId!=='string'||!input.channelAccountId.trim()||input.channelAccountId.length>300)
            throw new Error('widget_agent_reply_invalid_binding');
    }
    private privacy(query:WidgetMessageQuery,schema:string,tenantId:string){
        return (async()=>{
            await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text',[`agent-privacy:${schema}`]);
            if(!(await query<any[]>('SELECT id FROM public.tenants WHERE id=$1::uuid AND schema_name=$2 AND current_schema()=$2 AND is_active=true FOR SHARE',[tenantId,schema]))[0])
                throw new Error('widget_agent_reply_tenant_unavailable');
        })();
    }
    private async prepare(tenantId:string,expectedSchema?:string):Promise<string>{
        if(expectedSchema&&hasAgentSourceFence(this.prisma,expectedSchema))throw new Error('widget_agent_reply_nested_source_fence');
        const schema=await this.messages.assertAvailable(tenantId);
        if(!/^tenant_[a-z0-9_]+$/.test(schema)||schema.startsWith('tenant_eval_')||(expectedSchema&&schema!==expectedSchema))
            throw new Error('widget_agent_reply_tenant_unavailable');
        if(hasAgentSourceFence(this.prisma,schema))throw new Error('widget_agent_reply_nested_source_fence');
        if(!this.initialized.has(schema)){
            const initialize=this.prisma.transactionInTenantSchema(schema,async query=>{
                await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',[`widget-agent-reply-bootstrap:${schema}`]);
                if(!(await query<any[]>('SELECT id FROM public.tenants WHERE id=$1::uuid AND schema_name=$2 AND current_schema()=$2 AND is_active=true FOR SHARE',[tenantId,schema]))[0])
                    throw new Error('widget_agent_reply_tenant_unavailable');
                for(const statement of WIDGET_AGENT_REPLY_DDL)await query(statement);
            }).catch(error=>{this.initialized.delete(schema);throw error;});
            this.initialized.set(schema,initialize);
        }
        await this.initialized.get(schema);
        return schema;
    }
}
