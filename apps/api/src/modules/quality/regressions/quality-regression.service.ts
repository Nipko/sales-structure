import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QualityService } from '../quality.service';
import { QUALITY_RUBRIC_HASH } from '../quality-rubric';
import { QUALITY_REGRESSION_SCHEMA } from './quality-regression-schema';
import { assertRegressionCaseSource, readRegressionSource, type RegressionSourceKind, type RegressionQuery } from './quality-regression-source';
import { invalidateRegressionArtifacts } from './quality-regression-retention';
import { missionMetrics } from '../mission-metrics';
import { buildDomainContractDraft, listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import { EVAL_WRITER_SANDBOX_FAMILIES } from '../../conversations/agent-test-tool-policy';
import { buildRegressionProposal, regressionRedact, regressionScope, reviewedRegressionScenario, sanitizeRegressionRevision,
    type RegressionProposal, type RegressionReview, type RegressionScope } from './quality-regression-contracts';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const requireUuid=(value:string)=>{if(!UUID.test(value||''))throw new BadRequestException({error:'invalid_regression_identifier'});};

@Injectable()
export class QualityRegressionService {
    private readonly initialized=new Map<string,Promise<void>>();
    constructor(private readonly prisma:PrismaService,private readonly quality:QualityService){}
    async ensureTables(schema:string){
        const pending=this.initialized.get(schema);if(pending)return pending;
        const initialize=(async()=>{await this.quality.ensureTables(schema);for(const sql of QUALITY_REGRESSION_SCHEMA)await this.prisma.executeInTenantSchema(schema,sql);})()
            .catch(error=>{this.initialized.delete(schema);throw error;});
        this.initialized.set(schema,initialize);await initialize;
    }
    private async schema(tenantId:string,agentId:string){
        requireUuid(tenantId);requireUuid(agentId);
        const schema=await this.prisma.getTenantSchemaName(tenantId);
        const agents=await this.prisma.executeInTenantSchema<any[]>(schema,`SELECT id FROM agent_personas WHERE id=$1::uuid`,[agentId]);
        if(!agents.length)throw new NotFoundException({error:'regression_agent_not_found'});
        await this.ensureTables(schema);return schema;
    }
    private fence(query:RegressionQuery,schema:string){return query(`SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text`,[`agent-privacy:${schema}`]);}
    private async contactTerms(query:RegressionQuery,contactId:string):Promise<string[]>{
        const contacts=await query<any[]>(`SELECT name,phone,email FROM contacts WHERE id=$1::uuid`,[contactId]);
        return [contacts[0]?.name,contacts[0]?.phone,contacts[0]?.email].filter(value=>typeof value==='string');
    }
    private project(row:any){return {id:row.id,agentId:row.agent_id,sourceKind:row.source_kind,sourceEvidenceId:row.source_evidence_id,
        sourceConversationId:row.source_conversation_id,sourceRevision:String(row.source_revision),sourceAgentVersion:row.source_agent_version,
        sourceConfiguration:row.source_configuration_hash?'captured':'unavailable',state:row.state,revision:row.revision,
        scope:row.scope,proposal:row.proposal,approvedHash:row.approved_hash,createdAt:row.created_at,updatedAt:row.updated_at,
        evidenceKind:row.source_kind==='quality_score'?'conversational_opinion':'canonical_tool_failure'};}

    async sources(tenantId:string,agentId:string){
        const schema=await this.schema(tenantId,agentId);
        const sources=await this.prisma.executeInTenantSchema<any[]>(schema,`SELECT q.id,'quality_score' AS kind,q.conversation_id,q.created_at,
            q.overall_score,CASE WHEN jsonb_typeof(q.flags)='array' THEN jsonb_array_length(q.flags) ELSE 0 END AS flags_count,NULL::text AS tool_name,NULL::text AS status
            FROM conversation_quality_scores q JOIN conversations c ON c.id=q.conversation_id
            WHERE c.agent_persona_id=$1::uuid AND q.agent_id=$1::uuid AND q.agent_config_version=c.agent_config_version
              AND NOT COALESCE(c.agent_attribution_conflicted,false) AND q.source_revision=c.qa_revision AND q.rubric_hash=$2
              AND (q.overall_score<6 OR CASE WHEN jsonb_typeof(q.flags)='array' THEN jsonb_array_length(q.flags)>0 ELSE false END)
              AND NOT EXISTS(SELECT 1 FROM customer_memory_erasure e WHERE e.contact_id=c.contact_id)
            ORDER BY q.created_at DESC LIMIT 50`,[agentId,QUALITY_RUBRIC_HASH]);
        const tables=await this.prisma.executeInTenantSchema<any[]>(schema,`SELECT to_regclass('tool_execution_ledger')::text AS name`);
        if(tables[0]?.name){
            const failures=await this.prisma.executeInTenantSchema<any[]>(schema,`SELECT l.id,'tool_ledger' AS kind,l.conversation_id,l.created_at,
                NULL::numeric AS overall_score,0 AS flags_count,l.tool_name,l.status
                FROM tool_execution_ledger l JOIN conversations c ON c.id=l.conversation_id
                WHERE c.agent_persona_id=$1::uuid AND l.status IN ('failed','reconciliation_required')
                  AND NOT COALESCE(c.agent_attribution_conflicted,false) AND c.agent_config_version IS NOT NULL
                  AND l.contact_id=c.contact_id AND NOT EXISTS(SELECT 1 FROM customer_memory_erasure e WHERE e.contact_id=c.contact_id)
                ORDER BY l.created_at DESC LIMIT 50`,[agentId]);
            sources.push(...failures);
        }
        return sources.sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime()).slice(0,50);
    }

    async metrics(tenantId:string,agentId:string,start?:string,end?:string){
        if(end&&!Number.isFinite(new Date(end).getTime()))throw new BadRequestException({error:'invalid_mission_metrics_range'});
        const until=end||new Date().toISOString(),from=start||new Date(new Date(until).getTime()-30*86_400_000).toISOString();
        return missionMetrics(this.prisma,await this.schema(tenantId,agentId),agentId,from,until);
    }
    async options(tenantId:string,agentId:string){
        await this.schema(tenantId,agentId);
        return {profiles:listCanonicalSubtypeExperienceProfileIds().map(id=>{const [industry,subtype]=id.split('/');
            return {id,intents:buildDomainContractDraft(industry,subtype).intents.map(intent=>({key:intent.key,tools:intent.toolPlan,commits:intent.commits}))};}),
            families:Object.entries(EVAL_WRITER_SANDBOX_FAMILIES).filter(([,family])=>(family.status==='audited'||family.verifierAudited)&&family.contactColumn)
                .map(([key,family])=>({key,table:family.table,executable:family.status==='audited'}))};
    }

    async propose(tenantId:string,agentId:string,input:{kind:RegressionSourceKind;evidenceId:string},actorId:string){
        requireUuid(actorId);requireUuid(input?.evidenceId);
        if(!['quality_score','tool_ledger'].includes(input?.kind))throw new BadRequestException({error:'invalid_regression_source'});
        const schema=await this.schema(tenantId,agentId);
        return this.prisma.transactionInTenantSchema(schema,async query=>{
            await this.fence(query,schema);
            const source=await readRegressionSource(query,input.kind,input.evidenceId,agentId,true);
            const terms=await this.contactTerms(query,source.contact_id);
            const messages=await query<any[]>(`SELECT * FROM (SELECT id,direction,content_text,created_at FROM messages
                WHERE conversation_id=$1::uuid AND direction IN ('inbound','outbound') AND content_text IS NOT NULL
                  AND (created_at,id)<=($2::timestamptz,$3::uuid)
                ORDER BY created_at DESC,id DESC LIMIT 16) episode ORDER BY created_at,id`,[source.conversation_id,source.anchor.created_at,source.anchor.id]);
            const counts=await query<any[]>(`SELECT COUNT(*)::int AS count FROM messages WHERE conversation_id=$1::uuid
                AND direction IN ('inbound','outbound') AND (created_at,id)<=($2::timestamptz,$3::uuid)`,[source.conversation_id,source.anchor.created_at,source.anchor.id]);
            let scope:RegressionScope={profileId:null,mission:null,language:null,channel:source.channel_type,difficulty:'unknown',provenance:'unknown',contractVersion:null};
            if((await query<any[]>(`SELECT to_regclass('agent_mission_turns')::text AS name`))[0]?.name){
                const observations=await query<any[]>(`SELECT t.profile_id,t.language,t.contract_version,s.mission_key,s.basis,s.difficulty
                    FROM agent_mission_turns t JOIN agent_mission_steps s ON s.message_id=t.message_id
                    JOIN messages m ON m.id=t.message_id AND t.source_message_hash=MD5(COALESCE(m.content_text,''))
                    WHERE t.message_id=ANY($1::uuid[]) AND t.agent_id=$2::uuid AND t.agent_version=$3 AND s.mission_key IS NOT NULL
                    ORDER BY t.created_at DESC,s.ordinal DESC`,[messages.map(row=>row.id),agentId,source.agent_config_version]);
                if(observations.length&&new Set(observations.map(row=>row.mission_key)).size===1){
                    const observed=observations[0];
                    scope=regressionScope({profileId:observed.profile_id,mission:observed.mission_key,language:observed.language,
                        channel:source.channel_type,difficulty:observed.difficulty,contractVersion:observed.contract_version,
                        provenance:observed.basis==='tool_plan_projection'?'contract_tool_projection':'runtime_observation'});
                }
            }
            const proposal=buildRegressionProposal(messages,Number(counts[0].count),terms);
            if(!proposal.messages.length)throw new ConflictException({error:'regression_customer_request_missing'});
            // Source and all selected messages must still belong to the same
            // conversation revision at publication; edits trigger qa_revision.
            const rows=await query<any[]>(`INSERT INTO quality_regression_cases
                (agent_id,source_contact_id,source_conversation_id,source_kind,source_evidence_id,source_message_ids,
                 source_revision,source_hash,source_agent_version,source_configuration_hash,scope,proposal,created_by)
                VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6::uuid[],$7::bigint,$8,$9,$10,$11::jsonb,$12::jsonb,$13::uuid)
                ON CONFLICT(agent_id,source_kind,source_evidence_id,source_hash) DO NOTHING RETURNING *`,[agentId,source.contact_id,source.conversation_id,input.kind,input.evidenceId,
                messages.map(row=>row.id),String(source.qa_revision),source.fingerprint,source.agent_config_version,
                source.configuration_snapshot?.state==='captured'?source.configuration_snapshot.hash:null,JSON.stringify(scope),JSON.stringify(proposal),actorId]);
            if(!rows.length){const duplicate=await query<any[]>(`SELECT * FROM quality_regression_cases WHERE agent_id=$1::uuid AND source_kind=$2 AND source_evidence_id=$3::uuid AND source_hash=$4`,[agentId,input.kind,input.evidenceId,source.fingerprint]);return this.project(duplicate[0]);}
            await query(`INSERT INTO quality_regression_revisions(case_id,revision,proposal,scope,created_by) VALUES($1::uuid,1,$2::jsonb,$3::jsonb,$4::uuid)`,[rows[0].id,JSON.stringify(proposal),JSON.stringify(scope),actorId]);
            return this.project(rows[0]);
        });
    }

    async list(tenantId:string,agentId:string){
        const schema=await this.schema(tenantId,agentId);
        const rows=await this.prisma.executeInTenantSchema<any[]>(schema,`SELECT r.* FROM quality_regression_cases r
            WHERE agent_id=$1::uuid AND NOT EXISTS(SELECT 1 FROM customer_memory_erasure e WHERE e.contact_id=r.source_contact_id)
            ORDER BY updated_at DESC LIMIT 100`,[agentId]);
        return this.prisma.transactionInTenantSchema(schema,async query=>{
            await this.fence(query,schema);
            const output=[];
            for(const row of rows){
                // Re-read after taking the fence so a deletion cannot surface a copied proposal.
                const current=await query<any[]>(`SELECT * FROM quality_regression_cases WHERE id=$1::uuid`,[row.id]);
                if(!current[0])continue;
                let sourceState='current';
                try{await assertRegressionCaseSource(query,current[0]);}catch{sourceState='blocked';}
                output.push({...this.project(current[0]),sourceState});
            }
            return output;
        });
    }

    async edit(tenantId:string,agentId:string,caseId:string,input:{expectedRevision:number;proposal:RegressionProposal;scope:RegressionScope},actorId:string){
        requireUuid(caseId);requireUuid(actorId);
        if(!Number.isSafeInteger(input?.expectedRevision)||input.expectedRevision<1||!input.proposal||JSON.stringify(input.proposal).length>30_000)
            throw new BadRequestException({error:'invalid_regression_revision'});
        const scope=regressionScope({...input.scope,provenance:'human_review'});
        const schema=await this.schema(tenantId,agentId);
        return this.prisma.transactionInTenantSchema(schema,async query=>{
            await this.fence(query,schema);
            const rows=await query<any[]>(`SELECT * FROM quality_regression_cases WHERE id=$1::uuid AND agent_id=$2::uuid FOR UPDATE`,[caseId,agentId]);
            const row=rows[0];if(!row)throw new NotFoundException({error:'regression_case_not_found'});
            if(Number(row.revision)!==input.expectedRevision||row.state==='retired')throw new ConflictException({error:'regression_revision_changed'});
            await assertRegressionCaseSource(query,row,true);
            const proposal={...sanitizeRegressionRevision(input.proposal,row.proposal.coverage,await this.contactTerms(query,row.source_contact_id)),
                observedReplies:row.proposal.observedReplies||[]};
            await invalidateRegressionArtifacts(query,[caseId]);
            const updated=await query<any[]>(`UPDATE quality_regression_cases SET proposal=$3::jsonb,scope=$4::jsonb,revision=revision+1,
                state='proposed',approved_scenario=NULL,approved_hash=NULL,updated_at=NOW() WHERE id=$1::uuid AND revision=$2 RETURNING *`,[caseId,input.expectedRevision,JSON.stringify(proposal),JSON.stringify(scope)]);
            await query(`INSERT INTO quality_regression_revisions(case_id,revision,proposal,scope,created_by) VALUES($1::uuid,$2,$3::jsonb,$4::jsonb,$5::uuid)`,[caseId,updated[0].revision,JSON.stringify(proposal),JSON.stringify(scope),actorId]);
            return this.project(updated[0]);
        });
    }

    async review(tenantId:string,agentId:string,caseId:string,input:RegressionReview,actorId:string){
        requireUuid(caseId);requireUuid(actorId);
        if(!Number.isSafeInteger(input?.expectedRevision)||!['approved','rejected','retired'].includes(input?.decision)
            ||typeof input.note!=='string'||!input.note.trim()||input.note.length>1500)throw new BadRequestException({error:'invalid_regression_review'});
        const schema=await this.schema(tenantId,agentId);
        return this.prisma.transactionInTenantSchema(schema,async query=>{
            await this.fence(query,schema);
            const rows=await query<any[]>(`SELECT * FROM quality_regression_cases WHERE id=$1::uuid AND agent_id=$2::uuid FOR UPDATE`,[caseId,agentId]);
            const row=rows[0];if(!row)throw new NotFoundException({error:'regression_case_not_found'});
            if(row.revision!==input.expectedRevision||row.state==='retired')throw new ConflictException({error:'regression_revision_changed'});
            let approved:any=null;
            if(input.decision==='approved'){
                if(row.state!=='proposed'||input.checks?.privacy!==true||input.checks?.correctness!==true||input.checks?.reproduction!==true)
                    throw new BadRequestException({error:'regression_human_checks_required'});
                await assertRegressionCaseSource(query,row,true);
                approved=reviewedRegressionScenario(row.id,row.revision,{...row.scope,provenance:'human_review'},row.proposal,
                    {agentId,hash:row.source_hash,revision:String(row.source_revision),agentVersion:Number(row.source_agent_version)});
            }
            await invalidateRegressionArtifacts(query,[caseId]);
            const updated=await query<any[]>(`UPDATE quality_regression_cases SET state=$3,approved_scenario=$4::jsonb,approved_hash=$5,updated_at=NOW()
                WHERE id=$1::uuid AND revision=$2 RETURNING *`,[caseId,input.expectedRevision,input.decision,approved?JSON.stringify(approved.scenario):null,approved?.hash??null]);
            await query(`INSERT INTO quality_regression_reviews(case_id,revision,decision,checks,note,reviewed_by) VALUES($1::uuid,$2,$3,$4::jsonb,$5,$6::uuid)`,
                [caseId,row.revision,input.decision,JSON.stringify({privacy:input.checks?.privacy===true,correctness:input.checks?.correctness===true,
                    reproduction:input.checks?.reproduction===true}),regressionRedact(input.note,await this.contactTerms(query,row.source_contact_id)),actorId]);
            return this.project(updated[0]);
        });
    }
}
