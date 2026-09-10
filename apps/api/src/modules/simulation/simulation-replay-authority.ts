import { randomUUID } from 'crypto';
import type { PrismaService } from '../prisma/prisma.service';
import { hasAgentSourceFence, withAgentSourceFence } from '../../common/utils/agent-source-fence';
import { revisionHash } from '../evaluation-revision/evaluation-revision';
import { retireSimulationReplayRuns, type SimulationReplayQuery } from './simulation-replay-retention';
import type { EvalNamespaceLease } from './isolated-eval-namespace';

const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
export interface ReplayAuthority {
    version: 1; scope: 'simulation_replay'; sourceId: string; originRunId: string;
    conversationId: string; contactId: string; agentId: string; channelType: string;
    messageIds: string[]; sourceRevision: string; sourceHash: string; definitionHash: string;
    language: string; authorizedBy: string; authorizedAt: string;
}
export class SimulationReplayUnavailable extends Error {
    constructor() { super('simulation_replay_source_unavailable'); }
}
export const isReplayDefinition = (s: any): boolean => s?.source === 'replay'
    || String(s?.key || '').startsWith('replay:') || !!s?.replaySource || !!s?.replayMessages;
export function scenarioDefinition(s: any): any {
    const keys = ['key','title','personaDescription','goal','difficulty','language','source','openingMessage','replayMessages','replaySource'];
    return Object.fromEntries(keys.filter(key => s[key] !== undefined).map(key => [key,s[key]]));
}
async function source(query: SimulationReplayQuery, conversationId: string, lock = false): Promise<any> {
    const [conversation] = await query<any[]>(`SELECT id,contact_id,agent_id,channel_type,qa_revision::text FROM conversations
        WHERE id=$1::uuid ${lock ? 'FOR SHARE NOWAIT' : ''}`, [conversationId]);
    if (!conversation?.contact_id || !conversation.agent_id || conversation.qa_revision == null) throw new SimulationReplayUnavailable();
    // A missing tombstone relation is an unavailable privacy gate, never an implicit permission.
    if (!(await query<any[]>(`SELECT to_regclass('customer_memory_erasure')::text AS name`))[0]?.name)
        throw new SimulationReplayUnavailable();
    if ((await query<any[]>(`SELECT 1 FROM customer_memory_erasure WHERE contact_id=$1::uuid`,[conversation.contact_id])).length)
        throw new SimulationReplayUnavailable();
    const messages = await query<any[]>(`SELECT id,content_text FROM messages WHERE conversation_id=$1::uuid
        AND direction='inbound' AND NULLIF(BTRIM(content_text),'') IS NOT NULL ORDER BY created_at,id LIMIT 8`, [conversationId]);
    if (!messages.length) throw new SimulationReplayUnavailable();
    const [after] = await query<any[]>(`SELECT qa_revision::text FROM conversations WHERE id=$1::uuid`,[conversationId]);
    if (after?.qa_revision !== conversation.qa_revision) throw new SimulationReplayUnavailable();
    return {conversation, messages, hash: revisionHash({conversation, messages})};
}
function replayDefinition(authority: ReplayAuthority, messages: any[]): any {
    return {key:`replay:${authority.sourceId}`,title:String(messages[0].content_text).slice(0,80),
        goal:'Reproducir una conversación real de un cliente histórico',language:authority.language,source:'replay',
        openingMessage:messages[0].content_text,replayMessages:messages.map(m=>m.content_text),
        replaySource:{version:1,sourceId:authority.sourceId,originRunId:authority.originRunId}};
}
/** The authenticated tenant actor's explicit replay request authorizes only this captured source set for evaluation. */
export async function captureSimulationReplays(query: SimulationReplayQuery, input: {
    runId: string; agentId: string; channelType: string; language: string; actor: string; count: number;
}): Promise<{scenarios:any[]; authorities:ReplayAuthority[]}> {
    if (!input.actor?.trim() || !UUID.test(input.runId)) throw new SimulationReplayUnavailable();
    if (!(await query<any[]>(`SELECT to_regclass('customer_memory_erasure')::text AS name`))[0]?.name)
        throw new SimulationReplayUnavailable();
    const conversations = await query<any[]>(`SELECT c.id FROM conversations c WHERE c.agent_id=$1::uuid
        AND c.channel_type=$2 AND c.contact_id IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM customer_memory_erasure e WHERE e.contact_id=c.contact_id)
        AND EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.direction='inbound'
            AND NULLIF(BTRIM(m.content_text),'') IS NOT NULL)
        ORDER BY c.created_at DESC,c.id LIMIT $3`, [input.agentId,input.channelType,Math.min(Math.max(input.count,1),100)]);
    const scenarios:any[]=[], authorities:ReplayAuthority[]=[];
    for (const conversation of conversations) {
        const current = await source(query,conversation.id,true);
        if (current.conversation.agent_id !== input.agentId || current.conversation.channel_type !== input.channelType)
            throw new SimulationReplayUnavailable();
        const authority:ReplayAuthority = {version:1,scope:'simulation_replay',sourceId:randomUUID(),originRunId:input.runId,
            conversationId:conversation.id,contactId:current.conversation.contact_id,agentId:input.agentId,channelType:input.channelType,
            messageIds:current.messages.map((m:any)=>m.id),sourceRevision:current.conversation.qa_revision,sourceHash:current.hash,
            definitionHash:'',language:input.language,authorizedBy:input.actor,authorizedAt:new Date().toISOString()};
        const definition = replayDefinition(authority,current.messages);
        authority.definitionHash=revisionHash(definition); authorities.push(authority); scenarios.push(definition);
    }
    if (!scenarios.length) throw new SimulationReplayUnavailable();
    return {scenarios,authorities};
}

/** Commit the lease before the first copied inbound. A worker crash must not orphan source text outside erasure. */
export async function registerSimulationReplayNamespace(prisma:PrismaService,schema:string,runId:string,lease:EvalNamespaceLease):Promise<void> {
    if (!/^tenant_eval_[a-f\d]{8}_[a-f\d]{24}$/.test(lease.schemaName) || lease.sourceSchema!==schema
        || !UUID.test(lease.tenantId) || !UUID.test(lease.token)) throw new SimulationReplayUnavailable();
    await prisma.transactionInTenantSchema(schema,async(query)=>{
        await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text',['agent-privacy:'+schema]);
        const [run]=await query<any[]>('SELECT * FROM simulation_runs WHERE id=$1::uuid',[runId]);
        await assertSimulationReplayRun(query,run);
        const owner=await query<any[]>(`SELECT 1 FROM "${lease.schemaName}".__eval_namespace
            WHERE tenant_id=$1::uuid AND owner_token=$2::uuid AND source_schema=$3 AND expires_at>clock_timestamp()`,
        [lease.tenantId,lease.token,schema]);
        if(owner.length!==1)throw new SimulationReplayUnavailable();
        await query(`UPDATE simulation_runs SET replay_namespace_leases=COALESCE(replay_namespace_leases,'[]'::jsonb)||$2::jsonb
            WHERE id=$1::uuid AND NOT COALESCE(replay_namespace_leases,'[]'::jsonb) @> $3::jsonb`,
            [runId,JSON.stringify([lease]),JSON.stringify([{schemaName:lease.schemaName}])]);
        await assertSimulationReplayRun(query,run);
    });
}
export async function assertSimulationReplayRun(query: SimulationReplayQuery, run:any, lock = false): Promise<void> {
    if (!run || run.status==='retired' || run.retired_at) throw new SimulationReplayUnavailable();
    const definitions = [...(run.scenario_definitions || []),...(run.results || [])].filter(isReplayDefinition);
    const authorities:ReplayAuthority[] = Array.isArray(run.replay_authority) ? run.replay_authority : [];
    if ((run.scenario_source==='replay' || definitions.length) && !authorities.length) throw new SimulationReplayUnavailable();
    for (const a of authorities) {
        if (a.version!==1 || a.scope!=='simulation_replay' || !a.authorizedBy || !a.authorizedAt
            || !UUID.test(a.sourceId) || !UUID.test(a.originRunId) || !UUID.test(a.conversationId)
            || a.agentId!==run.agent_id || a.channelType!==run.channel_type) throw new SimulationReplayUnavailable();
        const [origin] = await query<any[]>(`SELECT status,retired_at,replay_authority FROM simulation_runs WHERE id=$1::uuid`,[a.originRunId]);
        if (!origin || origin.status==='retired' || origin.retired_at
            || !origin.replay_authority?.some((grant:any)=>grant.sourceId===a.sourceId && revisionHash(grant)===revisionHash(a)))
            throw new SimulationReplayUnavailable();
        const current = await source(query,a.conversationId,lock);
        if (current.hash!==a.sourceHash || current.conversation.qa_revision!==a.sourceRevision
            || current.conversation.contact_id!==a.contactId || current.conversation.agent_id!==a.agentId
            || current.conversation.channel_type!==a.channelType
            || revisionHash(current.messages.map((m:any)=>m.id))!==revisionHash(a.messageIds)
            || revisionHash(replayDefinition(a,current.messages))!==a.definitionHash) throw new SimulationReplayUnavailable();
    }
    for (const definition of definitions) {
        const a=authorities.find(item=>item.sourceId===definition.replaySource?.sourceId);
        if (!a || revisionHash(scenarioDefinition(definition))!==a.definitionHash) throw new SimulationReplayUnavailable();
    }
}
/** Holds the erasure fence across bounded external use, but never locks the conversation while awaiting a provider. */
export async function withSimulationReplayRun<T>(prisma:PrismaService,schema:string,runId:string,
    work:(query:SimulationReplayQuery,run:any)=>Promise<T>, options:{commit?:boolean}={}):Promise<T> {
    try {
        return await withAgentSourceFence(prisma,schema,async query=>{
            const [run]=await query<any[]>(`SELECT * FROM simulation_runs WHERE id=$1::uuid`,[runId]);
            await assertSimulationReplayRun(query,run,!!options.commit);
            const result=await work(query,run);
            await assertSimulationReplayRun(query,run,!!options.commit);
            return result;
        });
    } catch(error) {
        // The outer replay owner retires after releasing the shared fence. A
        // nested replay must not request exclusive retirement on another TX.
        if (error instanceof SimulationReplayUnavailable && !hasAgentSourceFence(prisma,schema)) await prisma.transactionInTenantSchema(schema,async query=>{
            await query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text`,[`agent-privacy:${schema}`]);
            const [run]=await query<any[]>(`SELECT replay_authority FROM simulation_runs WHERE id=$1::uuid`,[runId]);
            const origins=(run?.replay_authority || []).map((a:ReplayAuthority)=>a.originRunId).filter((id:string)=>UUID.test(id));
            await retireSimulationReplayRuns(query,{runIds:[runId,...origins]});
        });
        throw error;
    }
}
