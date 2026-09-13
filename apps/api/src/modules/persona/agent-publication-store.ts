import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { revisionHash } from '../evaluation-revision/evaluation-revision';
import { AgentReleaseStore } from '../simulation/agent-release-store';
import { assertReleaseActor, assertReleaseIds, assertReleaseRequestKey, releaseReviewEvidence, type ReleaseActor } from '../simulation/agent-release-contract';
import { AgentConfigurationRevisionStore, operationalConfigurationBody, operationalConfigurationHash, validateConfigurationBody,
    type AgentConfigurationBody, type RevisionQuery } from './agent-configuration-revision';

export const AGENT_PUBLICATION_TABLES=['agent_publication_events','agent_publication_heads'];
interface PublicationCas {expectedOperationalVersion:number;expectedOperationalHash:string;requestKey:string;}
export interface PublishAgentConfiguration extends PublicationCas {
    expectedCandidateVersion:number;evidenceHash:string;activation:'preserve'|'activate';
}
export interface RollbackAgentConfiguration extends PublicationCas {expectedPublicationId:string;}
export interface PublicationReceipt {
    id:string;agentId:string;kind:'publish'|'rollback';operationalVersion:number;operationalHash:string;idempotentReplay:boolean;
}
/** These checks must be supplied by the application, not by an HTTP payload.
 * The configuration CAS and routing changes are committed on this same query.
 * Evaluation source checks are separate from a claim about current factual truth. */
export interface PublicationChecks {
    assertCandidateCurrent(snapshot:AgentEvaluationSnapshot,query:RevisionQuery):Promise<void>;
    assertCurrentPrerequisites(query:RevisionQuery,input:{tenantId:string;agentId:string;operational:any;body:AgentConfigurationBody}):Promise<void>;
}
const conflict=(error:string):never=>{throw new ConflictException({error});};
const HASH=/^[a-f0-9]{64}$/;

/** Transactional publication primitive. It is not an HTTP endpoint: a caller
 * must supply the live entitlement/source checks before exposing publication. */
export class AgentPublicationStore {
    constructor(private readonly prisma:PrismaService){}
    async ensure(schema:string):Promise<void>{await this.prisma.ensureCanonicalTables(schema,AGENT_PUBLICATION_TABLES);}
    private validate(tenantId:string,agentId:string,actor:ReleaseActor,body:PublicationCas,keys:string[]):void{
        assertReleaseActor(actor);assertReleaseIds(tenantId,agentId);assertReleaseRequestKey(body?.requestKey);
        if(!body||Object.keys(body).some(key=>!keys.includes(key))||!Number.isInteger(body.expectedOperationalVersion)
            ||body.expectedOperationalVersion<1||!HASH.test(body.expectedOperationalHash))throw new BadRequestException({error:'agent_publication_request_invalid'});
    }
    private async lock(query:RevisionQuery,schema:string,tenantId:string,actor:ReleaseActor,key:string):Promise<void>{
        await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text',[`agent-privacy:${schema}`]);
        // Match Persona/Assist ordering. This also serializes assignment checks.
        if(!(await query<any[]>('SELECT id FROM public.tenants WHERE id=$1::uuid AND schema_name=current_schema() FOR UPDATE',[tenantId]))[0])
            throw new NotFoundException({error:'tenant_not_found'});
        await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',[`agent-publication:${schema}:${actor.id}:${key}`]);
    }
    private receipt(row:any,replay=false):PublicationReceipt{
        return {id:row.id,agentId:row.agent_id,kind:row.kind,operationalVersion:Number(row.published_version),operationalHash:row.after_hash,idempotentReplay:replay};
    }
    private async replay(query:RevisionQuery,actor:ReleaseActor,key:string,hash:string):Promise<PublicationReceipt|null>{
        const row=(await query<any[]>('SELECT * FROM agent_publication_events WHERE requested_by=$1::uuid AND request_key=$2',[actor.id,key]))[0];
        if(!row)return null;if(row.request_hash!==hash)conflict('agent_publication_request_conflict');return this.receipt(row,true);
    }
    private async operational(query:RevisionQuery,agentId:string,body:PublicationCas):Promise<any>{
        const agent=(await query<any[]>('SELECT * FROM agent_personas WHERE id=$1::uuid FOR UPDATE',[agentId]))[0];
        if(!agent)throw new NotFoundException({error:'agent_not_found'});
        if(Number(agent.version)!==body.expectedOperationalVersion||operationalConfigurationHash(agent)!==body.expectedOperationalHash)
            conflict('agent_operational_configuration_changed');
        return agent;
    }
    private async routing(query:RevisionQuery,agentId:string,body:AgentConfigurationBody):Promise<void>{
        if(!body.isActive)return;
        // No implicit stealing or arbitrary winner. Existing defaults may coexist
        // with an exact binding; a second owner at the same priority may not.
        const conflicts=await query<any[]>(`SELECT id FROM agent_personas WHERE id<>$1::uuid AND is_active=true
            AND (($2::boolean AND is_default=true) OR channels && $3::text[] OR channel_bindings && $4::text[])`,
            [agentId,body.isDefault,body.channels,body.channelBindings]);
        if(conflicts.length)conflict('agent_connection_assignment_conflict');
    }
    async publish(query:RevisionQuery,schema:string,input:{tenantId:string;agentId:string;candidateId:string;actor:ReleaseActor;body:PublishAgentConfiguration},checks:PublicationChecks):Promise<PublicationReceipt>{
        const {body,actor,tenantId,agentId,candidateId}=input;
        this.validate(tenantId,agentId,actor,body,['expectedOperationalVersion','expectedOperationalHash','requestKey','expectedCandidateVersion','evidenceHash','activation']);
        assertReleaseIds(candidateId);
        if(!Number.isInteger(body.expectedCandidateVersion)||body.expectedCandidateVersion<1||!HASH.test(body.evidenceHash)
            ||!['preserve','activate'].includes(body.activation))throw new BadRequestException({error:'agent_publication_request_invalid'});
        const requestHash=revisionHash({agentId,candidateId,kind:'publish',...body});
        await this.lock(query,schema,tenantId,actor,body.requestKey);
        const replay=await this.replay(query,actor,body.requestKey,requestHash);if(replay)return replay;
        const operational=await this.operational(query,agentId,body);
        const data=await new AgentReleaseStore(this.prisma).lockReviewed(query,tenantId,agentId,candidateId);
        if(!data)throw new NotFoundException({error:'agent_release_not_found'});
        if(data.candidate.status!=='approved'||Number(data.candidate.version)!==body.expectedCandidateVersion)conflict('agent_release_version_changed');
        const evidence=releaseReviewEvidence(data.candidate,data.evaluations);
        const approval=(await query<any[]>(`SELECT id FROM agent_release_reviews WHERE candidate_id=$1::uuid AND decision='approve' AND evidence_hash=$2`,[candidateId,body.evidenceHash]))[0];
        if(!evidence.eligibleForReview||evidence.evidenceHash!==body.evidenceHash||!approval)conflict('agent_release_evidence_changed');
        const revision=await new AgentConfigurationRevisionStore(this.prisma).readCurrentRevisionWithQuery(query,agentId,data.candidate.configuration_revision_id);
        if(revision.body_hash!==data.candidate.agent_snapshot.configurationRevisionHash
            ||revision.base_operational_hash!==data.candidate.agent_snapshot.configurationBaseOperationalHash)conflict('agent_release_draft_mismatch');
        await checks.assertCandidateCurrent(data.candidate.agent_snapshot,query);
        const next:AgentConfigurationBody=structuredClone(revision.body);
        if(body.activation==='activate')next.isActive=true;
        validateConfigurationBody(next);await this.routing(query,agentId,next);
        await checks.assertCurrentPrerequisites(query,{tenantId,agentId,operational,body:next});
        const receipt=await this.write(query,{agentId,actor,requestKey:body.requestKey,requestHash,operational,body:next,kind:'publish',candidateId,evidenceHash:body.evidenceHash});
        const removed=await query<any[]>('DELETE FROM agent_configuration_drafts WHERE agent_id=$1::uuid AND revision_id=$2::uuid RETURNING agent_id',[agentId,revision.id]);
        if(!removed[0])conflict('agent_draft_revision_changed');
        return receipt;
    }
    async rollback(query:RevisionQuery,schema:string,input:{tenantId:string;agentId:string;actor:ReleaseActor;body:RollbackAgentConfiguration},checks:Pick<PublicationChecks,'assertCurrentPrerequisites'>):Promise<PublicationReceipt>{
        const {body,actor,tenantId,agentId}=input;
        this.validate(tenantId,agentId,actor,body,['expectedOperationalVersion','expectedOperationalHash','requestKey','expectedPublicationId']);
        assertReleaseIds(body.expectedPublicationId);
        const requestHash=revisionHash({agentId,kind:'rollback',...body});
        await this.lock(query,schema,tenantId,actor,body.requestKey);
        const replay=await this.replay(query,actor,body.requestKey,requestHash);if(replay)return replay;
        const operational=await this.operational(query,agentId,body);
        const event=(await query<any[]>(`SELECT e.* FROM agent_publication_heads h JOIN agent_publication_events e ON e.id=h.event_id AND e.agent_id=h.agent_id
            WHERE h.agent_id=$1::uuid FOR UPDATE OF h`,[agentId]))[0];
        if(!event||event.id!==body.expectedPublicationId||event.kind!=='publish'||event.after_hash!==body.expectedOperationalHash)
            conflict('agent_publication_head_changed');
        const next:AgentConfigurationBody=event.before_body;validateConfigurationBody(next);
        if(operationalConfigurationHash({id:agentId,version:event.base_version,name:next.name,config_json:next.configJson,
            channels:next.channels,channel_bindings:next.channelBindings,schedule_mode:next.scheduleMode,is_active:next.isActive,is_default:next.isDefault})!==event.before_hash)
            conflict('agent_publication_history_invalid');
        await this.routing(query,agentId,next);await checks.assertCurrentPrerequisites(query,{tenantId,agentId,operational,body:next});
        // Rollback never moves an editable pointer or reuses an old version.
        return this.write(query,{agentId,actor,requestKey:body.requestKey,requestHash,operational,body:next,kind:'rollback',rollbackOf:event.id});
    }
    private async write(query:RevisionQuery,input:{agentId:string;actor:ReleaseActor;requestKey:string;requestHash:string;operational:any;body:AgentConfigurationBody;
        kind:'publish'|'rollback';candidateId?:string;evidenceHash?:string;rollbackOf?:string}):Promise<PublicationReceipt>{
        const {body,operational}=input,nextVersion=Number(operational.version)+1;
        const updated=(await query<any[]>(`UPDATE agent_personas SET name=$2,config_json=$3::jsonb,channels=$4::text[],channel_bindings=$5::text[],
            schedule_mode=$6,is_active=$7,is_default=$8,version=$9,updated_at=NOW() WHERE id=$1::uuid AND version=$10 RETURNING *`,
            [input.agentId,body.name,JSON.stringify(body.configJson),body.channels,body.channelBindings,body.scheduleMode,body.isActive,body.isDefault,nextVersion,operational.version]))[0];
        if(!updated)conflict('agent_operational_configuration_changed');
        const event=(await query<any[]>(`INSERT INTO agent_publication_events(agent_id,kind,candidate_id,rollback_of,base_version,published_version,before_body,after_body,
            before_hash,after_hash,evidence_hash,requested_by,request_key,request_hash)
            VALUES($1::uuid,$2,$3::uuid,$4::uuid,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12::uuid,$13,$14) RETURNING *`,
            [input.agentId,input.kind,input.candidateId||null,input.rollbackOf||null,operational.version,nextVersion,JSON.stringify(operationalConfigurationBody(operational)),
                JSON.stringify(body),operationalConfigurationHash(operational),operationalConfigurationHash(updated),input.evidenceHash||null,input.actor.id,input.requestKey,input.requestHash]))[0];
        await query(`INSERT INTO agent_publication_heads(agent_id,event_id) VALUES($1::uuid,$2::uuid)
            ON CONFLICT(agent_id) DO UPDATE SET event_id=EXCLUDED.event_id`,[input.agentId,event.id]);
        return this.receipt(event);
    }
}
