import { randomUUID } from 'crypto';
import { buildDomainContractDraft, EVAL_LANGUAGES, listCanonicalSubtypeExperienceProfileIds, VERTICAL_DOMAIN_CONTRACT_VERSION } from '@parallext/shared';
import { revisionHash } from '../evaluation-revision/evaluation-revision';
import type { PrismaService } from '../prisma/prisma.service';
import type { RegressionQuery } from './regressions/quality-regression-source';

export const MISSION_EVIDENCE_SCHEMA=[
    `CREATE TABLE IF NOT EXISTS customer_memory_erasure(contact_id UUID PRIMARY KEY,erased_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS agent_mission_turns (
        message_id UUID PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,agent_id UUID REFERENCES agent_personas(id) ON DELETE SET NULL,
        agent_version INTEGER,config_hash TEXT NOT NULL,profile_id TEXT,contract_version INTEGER,language TEXT,channel_type TEXT NOT NULL,
        execution_mode TEXT NOT NULL,transcript_revision BIGINT NOT NULL,source_message_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'started',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS agent_mission_instances (
        id UUID PRIMARY KEY,conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        agent_id UUID REFERENCES agent_personas(id) ON DELETE SET NULL,engine TEXT NOT NULL,mission_key TEXT,attempt_key TEXT NOT NULL,
        definition_id UUID,definition_version INTEGER,workflow_state TEXT NOT NULL DEFAULT 'active',
        operational_outcome TEXT NOT NULL DEFAULT 'unknown',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(conversation_id,engine,attempt_key))`,
    `CREATE TABLE IF NOT EXISTS agent_mission_steps (
        message_id UUID NOT NULL REFERENCES agent_mission_turns(message_id) ON DELETE CASCADE,ordinal INTEGER NOT NULL,
        instance_id UUID REFERENCES agent_mission_instances(id) ON DELETE CASCADE,kind TEXT NOT NULL,mission_key TEXT,
        basis TEXT NOT NULL,state TEXT,tool_name TEXT,tool_status TEXT,definition_id UUID,definition_version INTEGER,
        difficulty TEXT NOT NULL DEFAULT 'unknown',difficulty_rubric TEXT NOT NULL DEFAULT 'observed_trajectory_v1',
        operational_outcome TEXT NOT NULL DEFAULT 'unknown',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(message_id,ordinal))`,
    `CREATE INDEX IF NOT EXISTS idx_agent_mission_turn_agent ON agent_mission_turns(agent_id,created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_mission_instances_conversation ON agent_mission_instances(conversation_id,engine,workflow_state)`,
];
const initialized=new WeakMap<object,Map<string,Promise<void>>>();
export async function ensureMissionEvidence(prisma:PrismaService,schema:string){
    let schemas=initialized.get(prisma);if(!schemas){schemas=new Map();initialized.set(prisma,schemas);}
    if(!schemas.has(schema))schemas.set(schema,(async()=>{for(const ddl of MISSION_EVIDENCE_SCHEMA)await prisma.executeInTenantSchema(schema,ddl);})()
        .catch(error=>{schemas!.delete(schema);throw error;}));
    await schemas.get(schema);
}
export async function eraseContactMissionEvidence(query:RegressionQuery,contactIds:string[]):Promise<void>{
    const [tables]=await query<any[]>(`SELECT to_regclass('agent_mission_turns')::text AS turns,to_regclass('agent_mission_instances')::text AS instances`);
    if(tables?.turns)await query(`DELETE FROM agent_mission_turns WHERE contact_id=ANY($1::uuid[])`,[contactIds]);
    if(tables?.instances)await query(`DELETE FROM agent_mission_instances WHERE conversation_id IN
        (SELECT id FROM conversations WHERE contact_id=ANY($1::uuid[]))`,[contactIds]);
}
export interface MissionObservation {
    kind:'context'|'intent'|'booking'|'procedure'|'tool'|'final'|'error';
    intent?:string;state?:string;tool?:string;toolStatus?:'succeeded'|'failed'|'pending'|'unknown';
    handled?:boolean;completed?:boolean;handoff?:boolean;dialogueAct?:string;
    procedureId?:string;procedureVersion?:number;procedureStartedAt?:string;profileId?:string;
    /** IDs-only mission identity emitted by the deterministic focus/state owner. */
    instanceKey?:string;
}
interface MissionTurnContext {conversationId:string;messageId:string;agentId?:string;agentVersion?:number;configHash:string;
    language:string;channel:string;executionMode:string;profileId?:string;}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CODE=/^[a-z][a-z0-9_]{0,99}$/;
const profiles=new Set(listCanonicalSubtypeExperienceProfileIds());

/** Awaited, references-only telemetry. Failure remains missing coverage and never becomes a successful mission. */
export class MissionTurnRecorder {
    private ordinal=0;
    constructor(private readonly prisma:PrismaService,private readonly schema:string,private readonly context:MissionTurnContext){}
    async observe(input:MissionObservation):Promise<void>{
        if(!UUID.test(this.context.messageId)||this.context.executionMode!=='live')return;
        await ensureMissionEvidence(this.prisma,this.schema);
        const ordinal=++this.ordinal;
        if(input.profileId&&profiles.has(input.profileId))this.context.profileId=input.profileId;
        const profile=profiles.has(this.context.profileId||'')?this.context.profileId!:null;
        const [industry,subtype]=(profile||'').split('/');
        const intents=profile?buildDomainContractDraft(industry,subtype).intents:[];
        let mission:string|null=null,basis='unknown';
        if(input.kind==='intent'){
            const key=input.intent==='general_question'?'ask_question':input.intent;
            if(intents.some(item=>item.key===key)){mission=key!;basis='interpreted_intent';}
        }
        if(input.kind==='booking'&&input.handled&&input.state!=='idle'&&intents.some(item=>item.key==='book_appointment')){
            mission='book_appointment';basis='booking_state';
        }
        if(input.kind==='tool'&&input.tool){
            const matches=intents.filter(item=>item.commits&&item.toolPlan.at(-1)===input.tool);
            if(matches.length===1){mission=matches[0].key;basis='tool_plan_projection';}
        }
        const recovery=input.kind==='error'||input.toolStatus==='failed'||input.handoff||['resume','invalid'].includes(input.dialogueAct||'');
        const state=CODE.test(input.state||'')?input.state!:null;
        const procedureId=UUID.test(input.procedureId||'')?input.procedureId!:null;
        const procedureVersion=Number.isSafeInteger(input.procedureVersion)?input.procedureVersion!:null;
        await this.prisma.transactionInTenantSchema(this.schema,async query=>{
            await query(`SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text`,[`agent-privacy:${this.schema}`]);
            const rows=await query<any[]>(`SELECT c.contact_id,COALESCE((to_jsonb(c)->>'qa_revision')::bigint,0) AS qa_revision,
                m.direction,MD5(COALESCE(m.content_text,'')) AS source_hash,m.created_at
                FROM conversations c JOIN messages m ON m.conversation_id=c.id WHERE c.id=$1::uuid AND m.id=$2::uuid
                AND m.direction='inbound' AND NOT EXISTS(SELECT 1 FROM customer_memory_erasure e WHERE e.contact_id=c.contact_id)`,[this.context.conversationId,this.context.messageId]);
            if(!rows[0])return;
            const row=rows[0];
            const language=EVAL_LANGUAGES.includes(this.context.language.slice(0,2) as any)?this.context.language.slice(0,2):null;
            await query(`INSERT INTO agent_mission_turns(message_id,conversation_id,contact_id,agent_id,agent_version,config_hash,profile_id,
                contract_version,language,channel_type,execution_mode,transcript_revision,source_message_hash,created_at)
                VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12::bigint,$13,$14::timestamptz)
                ON CONFLICT(message_id) DO UPDATE SET profile_id=COALESCE(EXCLUDED.profile_id,agent_mission_turns.profile_id),
                    contract_version=COALESCE(EXCLUDED.contract_version,agent_mission_turns.contract_version),updated_at=NOW()
                WHERE agent_mission_turns.config_hash=EXCLUDED.config_hash AND agent_mission_turns.source_message_hash=EXCLUDED.source_message_hash`,
                [this.context.messageId,this.context.conversationId,row.contact_id,this.context.agentId||null,this.context.agentVersion||null,
                    this.context.configHash,profile,profile?VERTICAL_DOMAIN_CONTRACT_VERSION:null,language,this.context.channel,this.context.executionMode,
                    String(row.qa_revision),row.source_hash,row.created_at]);
            const current=await query<any[]>(`SELECT config_hash,source_message_hash FROM agent_mission_turns WHERE message_id=$1::uuid FOR UPDATE`,[this.context.messageId]);
            if(current[0]?.config_hash!==this.context.configHash||current[0]?.source_message_hash!==row.source_hash)return;
            let instanceId:string|null=null;
            if((input.kind==='booking'&&input.handled)||(input.kind==='procedure'&&input.handled)||mission&&input.kind==='tool'){
                const engine=input.kind;
                const attemptKey=input.instanceKey?revisionHash({engine,instance:input.instanceKey})
                    :procedureId&&input.procedureStartedAt?revisionHash({procedureId,version:procedureVersion,start:input.procedureStartedAt})
                    :input.kind==='tool'?revisionHash({message:this.context.messageId,mission,tool:input.tool}):this.context.messageId;
                const active=input.kind==='booking'&&!input.instanceKey?await query<any[]>(`SELECT id,attempt_key FROM agent_mission_instances
                    WHERE conversation_id=$1::uuid AND agent_id=$2::uuid AND engine='booking' AND workflow_state='active' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,[this.context.conversationId,this.context.agentId||null]):[];
                instanceId=active[0]?.id||randomUUID();
                const workflow=input.completed||input.kind==='booking'&&input.state==='booked'?'completed'
                    :input.dialogueAct==='cancel'||input.kind==='booking'&&input.state==='idle'?'cancelled':input.dialogueAct==='pause'?'paused':'active';
                const instances=await query<any[]>(`INSERT INTO agent_mission_instances(id,conversation_id,agent_id,engine,mission_key,attempt_key,
                    definition_id,definition_version,workflow_state) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::uuid,$8,$9)
                    ON CONFLICT(conversation_id,engine,attempt_key) DO UPDATE SET workflow_state=EXCLUDED.workflow_state,updated_at=NOW() RETURNING id`,
                    [instanceId,this.context.conversationId,this.context.agentId||null,engine,mission,active[0]?.attempt_key||attemptKey,procedureId,procedureVersion,workflow]);
                instanceId=instances[0].id;
            }
            let difficulty=recovery?'recovery':mission?'standard':'unknown';
            if(instanceId&&!recovery){
                const prior=await query<any[]>(`SELECT difficulty,state FROM agent_mission_steps WHERE instance_id=$1::uuid`,[instanceId]);
                if(prior.some(step=>step.difficulty==='recovery'))difficulty='recovery';
                else if(prior.some(step=>step.state&&step.state!==state))difficulty='multi_step';
            }
            await query(`INSERT INTO agent_mission_steps(message_id,ordinal,instance_id,kind,mission_key,basis,state,tool_name,tool_status,
                definition_id,definition_version,difficulty) VALUES($1::uuid,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10::uuid,$11,$12)
                ON CONFLICT(message_id,ordinal) DO NOTHING`,[this.context.messageId,ordinal,instanceId,input.kind,mission,basis,state,
                    CODE.test(input.tool||'')?input.tool:null,input.toolStatus||null,procedureId,procedureVersion,difficulty]);
            if(input.kind==='final'||input.kind==='error')await query(`UPDATE agent_mission_turns SET status=$2,updated_at=NOW() WHERE message_id=$1::uuid`,[this.context.messageId,input.kind==='final'?'responded':'failed']);
        });
    }
}
