import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AgentConfigurationRevisionStore, type RevisionQuery } from '../persona/agent-configuration-revision';
import type { PrismaService } from '../prisma/prisma.service';
import { resolveEvaluationSnapshot, type AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { revisionHash } from '../evaluation-revision/evaluation-revision';
import { assertReviewedRegressionScenarios, regressionCaseIds, regressionAppliesToSnapshot } from '../quality/regressions/quality-regression-runtime';
import { scenarioAppliesToMission } from './agent-release-policy';
import { assertReleaseActor, assertReleaseChannels, assertReleaseIds, assertReleaseRequestKey, releaseReviewEvidence,
    RELEASE_TABLES, type ReleaseActor, type ReviewAgentRelease } from './agent-release-contract';

function conflict(error:string):never{throw new ConflictException({error});}
export class AgentReleaseStore {
    constructor(private readonly prisma:PrismaService){}
    async ensure(schema:string):Promise<void>{await this.prisma.ensureCanonicalTables(schema,RELEASE_TABLES);}
    async exists(query:RevisionQuery):Promise<boolean>{return !!(await query<any[]>("SELECT to_regclass('agent_release_candidates')::text AS name"))[0]?.name;}
    private async privacy(query:RevisionQuery,schema:string):Promise<void>{
        await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text',[`agent-privacy:${schema}`]);
    }
    async findRequest(query:RevisionQuery,agentId:string,actor:ReleaseActor,requestKey:string,configurationRevisionId:string):Promise<any|null>{
        assertReleaseActor(actor);assertReleaseIds(agentId,configurationRevisionId);assertReleaseRequestKey(requestKey);
        if(!await this.exists(query))return null;
        const row=(await query<any[]>('SELECT * FROM agent_release_candidates WHERE requested_by=$1::uuid AND request_key=$2',[actor.id,requestKey]))[0];
        if(row&&(row.agent_id!==agentId||row.request_hash!==revisionHash({agentId,configurationRevisionId})))conflict('agent_release_request_conflict');
        return row||null;
    }
    async create(query:RevisionQuery,schema:string,input:{tenantId:string;agentId:string;actor:ReleaseActor;requestKey:string;
        snapshot:AgentEvaluationSnapshot;scenarios:any[]}):Promise<any>{
        assertReleaseActor(input.actor);assertReleaseIds(input.tenantId,input.agentId,input.snapshot.configurationRevisionId!);
        assertReleaseRequestKey(input.requestKey);resolveEvaluationSnapshot(input.snapshot,input.tenantId,input.agentId);
        if(!input.snapshot.manifest)conflict('agent_release_complete_revision_required');
        const channels=assertReleaseChannels(input.snapshot);
        await this.privacy(query,schema);
        if(!(await query<any[]>('SELECT id FROM public.tenants WHERE id=$1::uuid AND schema_name=current_schema() FOR UPDATE',[input.tenantId]))[0])
            throw new NotFoundException({error:'tenant_not_found'});
        const replay=await this.findRequest(query,input.agentId,input.actor,input.requestKey,input.snapshot.configurationRevisionId!);
        if(replay)return replay;
        const draft=await new AgentConfigurationRevisionStore(this.prisma).readCurrentRevisionWithQuery(query,input.agentId,input.snapshot.configurationRevisionId!);
        if(draft.body_hash!==input.snapshot.configurationRevisionHash||revisionHash(draft.body.configJson)!==input.snapshot.configHash
            ||draft.base_operational_hash!==input.snapshot.configurationBaseOperationalHash)
            conflict('agent_release_draft_mismatch');
        await assertReviewedRegressionScenarios(query,input.scenarios,input.agentId);
        const ids=regressionCaseIds(input.scenarios);
        const row=(await query<any[]>(`INSERT INTO agent_release_candidates(agent_id,configuration_revision_id,agent_snapshot,scenarios,
            scenario_hash,channels,regression_case_ids,requested_by,request_key,request_hash)
            VALUES($1::uuid,$2::uuid,$3::jsonb,$4::jsonb,$5,$6::text[],$7::uuid[],$8::uuid,$9,$10) RETURNING *`,
            [input.agentId,draft.id,JSON.stringify(input.snapshot),JSON.stringify(input.scenarios),revisionHash(input.scenarios),channels,ids,
                input.actor.id,input.requestKey,revisionHash({agentId:input.agentId,configurationRevisionId:draft.id})]))[0];
        for(const channel of channels)await query('INSERT INTO agent_release_evaluations(candidate_id,channel_type) VALUES($1::uuid,$2)',[row.id,channel]);
        return row;
    }
    async read(query:RevisionQuery,agentId:string,candidateId:string,lock=false):Promise<{candidate:any;evaluations:any[]}|null>{
        assertReleaseIds(agentId,candidateId);
        if(!await this.exists(query))return null;
        const candidate=(await query<any[]>(`SELECT * FROM agent_release_candidates WHERE id=$1::uuid AND agent_id=$2::uuid${lock?' FOR UPDATE':''}`,[candidateId,agentId]))[0];
        if(!candidate)return null;
        const evaluations=await query<any[]>('SELECT * FROM agent_release_evaluations WHERE candidate_id=$1::uuid ORDER BY channel_type',[candidateId]);
        return {candidate,evaluations};
    }
    private assertCandidate(candidate:any,tenantId:string):void {
        if(!candidate||['invalidated','rejected'].includes(candidate.status)||!candidate.agent_snapshot)conflict('agent_release_invalidated');
        resolveEvaluationSnapshot(candidate.agent_snapshot,tenantId,candidate.agent_id);
        if(candidate.configuration_revision_id!==candidate.agent_snapshot.configurationRevisionId
            ||revisionHash(candidate.scenarios)!==candidate.scenario_hash
            ||revisionHash(candidate.channels)!==revisionHash(assertReleaseChannels(candidate.agent_snapshot)))conflict('agent_release_integrity_mismatch');
    }
    async lockReviewed(query:RevisionQuery,tenantId:string,agentId:string,candidateId:string):Promise<{candidate:any;evaluations:any[]}|null>{
        const before=await this.read(query,agentId,candidateId);
        if(!before)return null;
        this.assertCandidate(before.candidate,tenantId);
        // Same order as source retirement: source rows, then derived artifacts.
        await assertReviewedRegressionScenarios(query,before.candidate.scenarios,agentId);
        const locked=await this.read(query,agentId,candidateId,true);
        if(locked)this.assertCandidate(locked.candidate,tenantId);
        return locked;
    }
    async claim(query:RevisionQuery,schema:string,tenantId:string,agentId:string,candidateId:string,evaluationId:string):Promise<any|null>{
        assertReleaseIds(tenantId,agentId,candidateId,evaluationId);await this.privacy(query,schema);
        const data=await this.lockReviewed(query,tenantId,agentId,candidateId);
        if(!data||!['pending','evaluating'].includes(data.candidate.status))return null;
        this.assertCandidate(data.candidate,tenantId);
        await assertReviewedRegressionScenarios(query,data.candidate.scenarios,agentId);
        const token=randomUUID();
        const evaluation=(await query<any[]>(`UPDATE agent_release_evaluations SET status='running',lease_token=$3::uuid,
            lease_until=NOW()+INTERVAL '180 seconds',attempts=attempts+1,error=NULL,updated_at=NOW()
            WHERE id=$1::uuid AND candidate_id=$2::uuid
              AND ((status IN ('pending','failed','budget_deferred') AND next_attempt_at<=NOW()) OR (status='running' AND lease_until<NOW())) RETURNING *`,
            [evaluationId,candidateId,token]))[0];
        if(!evaluation)return null;
        await query("UPDATE agent_release_candidates SET status='evaluating',version=version+1,updated_at=NOW() WHERE id=$1::uuid",[candidateId]);
        return {...data,evaluation,leaseToken:token};
    }
    /** Read authority inside an already protected source use without renewing it.
     * The database wall clock advances even while that outer transaction stays open. */
    async assertExecutionLease(query:RevisionQuery,input:{tenantId:string;agentId:string;candidateId:string;evaluationId:string;leaseToken:string}):Promise<void>{
        assertReleaseIds(input.tenantId,input.agentId,input.candidateId,input.evaluationId,input.leaseToken);
        if(!(await query<any[]>('SELECT id FROM public.tenants WHERE id=$1::uuid AND schema_name=current_schema()',[input.tenantId]))[0])
            throw new NotFoundException({error:'tenant_not_found'});
        const data=await this.read(query,input.agentId,input.candidateId);
        if(!data)conflict('agent_release_invalidated');
        this.assertCandidate(data.candidate,input.tenantId);
        const evaluation=(await query<any[]>(`SELECT *,lease_until>clock_timestamp() AS lease_valid FROM agent_release_evaluations
            WHERE id=$1::uuid AND candidate_id=$2::uuid`,[input.evaluationId,input.candidateId]))[0];
        if(data.candidate.status!=='evaluating'||!evaluation||evaluation.status!=='running'
            ||evaluation.lease_token!==input.leaseToken||!evaluation.lease_valid)conflict('agent_release_lease_lost');
        // The outer source fence already protects the case currently in use.
        // Check all other provenance without adding row locks, renewing the
        // worker lease or opening another source transaction behind erasure.
        await assertReviewedRegressionScenarios(query,data.candidate.scenarios,input.agentId,undefined,{lockRows:false});
    }
    /** Renew only outside a source-use fence, where updates keep their own transaction. */
    async checkpoint(query:RevisionQuery,schema:string,input:{tenantId:string;agentId:string;candidateId:string;evaluationId:string;leaseToken:string;
        results?:any[];evidence?:any;runId?:string;status?:'completed'|'failed'|'budget_deferred';error?:string}):Promise<any>{
        assertReleaseIds(input.tenantId,input.agentId,input.candidateId,input.evaluationId,input.leaseToken);
        await this.privacy(query,schema);
        const data=await this.lockReviewed(query,input.tenantId,input.agentId,input.candidateId);
        if(!data)conflict('agent_release_invalidated');
        this.assertCandidate(data.candidate,input.tenantId);
        const evaluation=(await query<any[]>(`SELECT *,lease_until>NOW() AS lease_valid FROM agent_release_evaluations
            WHERE id=$1::uuid AND candidate_id=$2::uuid FOR UPDATE`,[input.evaluationId,input.candidateId]))[0];
        if(!evaluation||evaluation.status!=='running'||evaluation.lease_token!==input.leaseToken||!evaluation.lease_valid)
            conflict('agent_release_lease_lost');
        await assertReviewedRegressionScenarios(query,data.candidate.scenarios,input.agentId);
        const ids=regressionCaseIds(data.candidate.scenarios);
        if(regressionCaseIds(input.results||[]).some(id=>!ids.includes(id)))conflict('regression_provenance_required');
        if(input.status==='completed') {
            const ev=input.evidence,snapshot=data.candidate.agent_snapshot;
            if(!ev||ev.agentId!==input.agentId||ev.channelType!==evaluation.channel_type||ev.dependencyRevision!==snapshot.manifest.revision
                ||ev.configHash!==snapshot.configHash||ev.status!=='completed'||ev.k!==3||ev.threshold!==8||ev.passPolicy!=='all'
                ||ev.evidenceHash!==revisionHash(Object.fromEntries(Object.entries(ev).filter(([key])=>key!=='evidenceHash')))
                ||revisionHash(ev.results)!==revisionHash(input.results))conflict('agent_release_evidence_mismatch');
            const applicable=data.candidate.scenarios.filter((row:any)=>regressionAppliesToSnapshot(row,snapshot,evaluation.channel_type)
                &&(row.seedState||'active')==='active'&&scenarioAppliesToMission(row,snapshot.releaseScope));
            if(revisionHash(ev.scenarios)!==revisionHash(applicable))conflict('agent_release_scenario_mismatch');
            assertReleaseIds(input.runId!);
        }
        const status=input.status||'running';
        await query(`UPDATE agent_release_evaluations SET status=$3,results=COALESCE($4::jsonb,results),evidence=COALESCE($5::jsonb,evidence),run_id=COALESCE($6::uuid,run_id),
            error=$7,lease_until=CASE WHEN $3='running' THEN NOW()+INTERVAL '180 seconds' ELSE NULL END,
            lease_token=CASE WHEN $3='running' THEN lease_token ELSE NULL END,
            next_attempt_at=CASE WHEN $3='budget_deferred' THEN CURRENT_DATE+INTERVAL '1 day' WHEN $3='failed' THEN NOW()+INTERVAL '5 minutes' ELSE next_attempt_at END,updated_at=NOW()
            WHERE id=$1::uuid AND candidate_id=$2::uuid`,[input.evaluationId,input.candidateId,status,input.results?JSON.stringify(input.results):null,
                input.evidence?JSON.stringify(input.evidence):null,input.runId||null,input.error||null]);
        if(input.status)await query(`UPDATE agent_release_candidates SET status=CASE WHEN NOT EXISTS(
            SELECT 1 FROM agent_release_evaluations WHERE candidate_id=$1::uuid AND status<>'completed') THEN 'evaluated' ELSE 'evaluating' END,
            version=version+1,updated_at=NOW() WHERE id=$1::uuid`,[input.candidateId]);
        return data.candidate.agent_snapshot;
    }
    async invalidate(query:RevisionQuery,agentId:string,candidateId:string,reason:string):Promise<void>{
        assertReleaseIds(agentId,candidateId);
        const row=(await query<any[]>(`UPDATE agent_release_candidates SET status='invalidated',version=version+1,error=$3,
            agent_snapshot=NULL,scenarios='[]'::jsonb,regression_case_ids='{}'::uuid[],updated_at=NOW()
            WHERE id=$1::uuid AND agent_id=$2::uuid AND status<>'invalidated' RETURNING id`,[candidateId,agentId,reason]))[0];
        if(!row)return;
        await query(`UPDATE agent_release_evaluations SET status='invalidated',results='[]'::jsonb,evidence=NULL,
            lease_token=NULL,lease_until=NULL,error=$2,updated_at=NOW() WHERE candidate_id=$1::uuid`,[candidateId,reason]);
    }
    async review(query:RevisionQuery,schema:string,input:{tenantId:string;agentId:string;candidateId:string;actor:ReleaseActor;body:ReviewAgentRelease},assertCurrent:(snapshot:AgentEvaluationSnapshot)=>Promise<void>):Promise<any>{
        assertReleaseActor(input.actor);assertReleaseIds(input.tenantId,input.agentId,input.candidateId);assertReleaseRequestKey(input.body?.requestKey);
        const body=input.body;
        if(!Number.isInteger(body.expectedVersion)||body.expectedVersion<1||!['approve','reject'].includes(body.decision)
            ||!/^[a-f0-9]{64}$/.test(body.evidenceHash)||!Array.isArray(body.sampleHashes)||body.sampleHashes.length>100
            ||new Set(body.sampleHashes).size!==body.sampleHashes.length||body.sampleHashes.some(hash=>!/^[a-f0-9]{64}$/.test(hash))
            ||!body.checks||Object.keys(body.checks).length!==6||(['objective','instructions','facts','tools','style','limits'] as const).some(key=>typeof body.checks[key]!=='boolean'))
            throw new BadRequestException({error:'agent_release_review_invalid'});
        await this.privacy(query,schema);
        await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',[`agent-release-review:${schema}:${input.actor.id}:${body.requestKey}`]);
        const hash=revisionHash({agentId:input.agentId,candidateId:input.candidateId,...body});
        const replay=(await query<any[]>('SELECT * FROM agent_release_reviews WHERE reviewer_id=$1::uuid AND request_key=$2',[input.actor.id,body.requestKey]))[0];
        if(replay){if(replay.request_hash!==hash)conflict('agent_release_request_conflict');return replay;}
        const data=await this.lockReviewed(query,input.tenantId,input.agentId,input.candidateId);if(!data)throw new NotFoundException({error:'agent_release_not_found'});
        this.assertCandidate(data.candidate,input.tenantId);
        if(data.candidate.status!=='evaluated'||Number(data.candidate.version)!==body.expectedVersion)conflict('agent_release_version_changed');
        await assertReviewedRegressionScenarios(query,data.candidate.scenarios,input.agentId);
        await assertCurrent(data.candidate.agent_snapshot);
        const evidence=releaseReviewEvidence(data.candidate,data.evaluations);
        if(evidence.evidenceHash!==body.evidenceHash)conflict('agent_release_evidence_changed');
        if(body.decision==='approve'&&(!evidence.eligibleForReview||Object.values(body.checks).some(value=>value!==true)
            ||revisionHash([...body.sampleHashes].sort())!==revisionHash(evidence.sampleHashes)))conflict('agent_release_review_incomplete');
        const review=(await query<any[]>(`INSERT INTO agent_release_reviews(candidate_id,reviewer_id,request_key,request_hash,evidence_hash,decision,checks,sample_hashes)
            VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7::jsonb,$8::text[]) RETURNING *`,
            [input.candidateId,input.actor.id,body.requestKey,hash,body.evidenceHash,body.decision,JSON.stringify(body.checks),body.sampleHashes]))[0];
        await query("UPDATE agent_release_candidates SET status=$2,version=version+1,updated_at=NOW() WHERE id=$1::uuid",[input.candidateId,body.decision==='approve'?'approved':'rejected']);
        return review;
    }
}
