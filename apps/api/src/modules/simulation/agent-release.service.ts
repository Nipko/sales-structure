import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AgentTestService } from '../conversations/agent-test.service';
import { EvalService } from './eval.service';
import { EvalAutorunStateService } from './eval-autorun-state.service';
import { AgentReleaseStore } from './agent-release-store';
import { AGENT_RELEASE_QUEUE, assertReleaseActor, assertReleaseIds, assertReleaseRequestKey, releaseReviewEvidence,
    type ReleaseActor, type RequestAgentRelease, type ReviewAgentRelease } from './agent-release-contract';
import { assertReviewedRegressionScenarios, regressionAppliesToSnapshot } from '../quality/regressions/quality-regression-runtime';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';
import type { AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { hasAgentSourceFence, withAgentSourceFence } from '../../common/utils/agent-source-fence';

export interface AgentReleaseJob {tenantId:string;agentId:string;candidateId:string;evaluationId:string}
/** One frozen configuration and dependency revision for all assigned channels.
 * SQL owns requests, leases and reviews; queue messages contain identifiers only. */
@Injectable()
export class AgentReleaseService {
    private readonly store:AgentReleaseStore;
    private readonly logger=new Logger(AgentReleaseService.name);
    constructor(private readonly prisma:PrismaService,private readonly tests:AgentTestService,
        private readonly evals:EvalService,private readonly budget:EvalAutorunStateService,
        @InjectQueue(AGENT_RELEASE_QUEUE) private readonly queue:Queue<AgentReleaseJob>){this.store=new AgentReleaseStore(prisma);}

    async request(tenantId:string,agentId:string,body:RequestAgentRelease,actor:ReleaseActor):Promise<any>{
        assertReleaseActor(actor);assertReleaseIds(tenantId,agentId,body?.configurationRevisionId);assertReleaseRequestKey(body?.requestKey);
        if(Object.keys(body).some(key=>!['configurationRevisionId','requestKey'].includes(key)))throw new BadRequestException({error:'agent_release_request_invalid'});
        const schema=await this.prisma.getTenantSchemaName(tenantId);
        await this.store.ensure(schema);
        const prior=await this.prisma.transactionInTenantSchema(schema,q=>this.store.findRequest(q,agentId,actor,body.requestKey,body.configurationRevisionId));
        if(prior)return this.read(tenantId,agentId,prior.id,actor);
        await this.budget.prepare(tenantId);await this.evals.listScenarios(tenantId);
        const snapshot=await this.tests.captureSnapshot(tenantId,agentId,{configurationRevisionId:body.configurationRevisionId});
        let scenarios:any[];
        try{
            scenarios=(await this.evals.listScenarios(tenantId)).filter(scenario=>snapshot.releaseScope?.channels
                .some(channel=>regressionAppliesToSnapshot(scenario,snapshot,channel)));
            await this.tests.assertSnapshotExecutable(snapshot,tenantId,agentId);
        }catch(error){await this.tests.releaseSnapshot(snapshot);throw error;}
        let candidate:any,saveBodyRejected=false;
        try{
            candidate=await this.prisma.transactionInTenantSchema(schema,async q=>{
                try{return await this.store.create(q,schema,{tenantId,agentId,actor,requestKey:body.requestKey,snapshot,scenarios});}
                catch(error){saveBodyRejected=true;throw error;}
            });
        }catch(error){
            // A rejected callback never reaches COMMIT, including partial channel
            // inserts rolled back by the transaction. No candidate owns this usage.
            if(saveBodyRejected){await this.tests.releaseSnapshot(snapshot);throw error;}
            // A rejected transaction promise can mean COMMIT succeeded but its
            // acknowledgement was lost. Never revoke a possibly persisted usage.
            try{candidate=await this.prisma.transactionInTenantSchema(schema,q=>this.store.findRequest(q,agentId,actor,body.requestKey,body.configurationRevisionId));}
            catch{/* Unknown ownership remains bounded by the durable usage TTL. */}
            if(!candidate){this.logger.warn('Agent release save outcome unknown; knowledge usage retained until durable expiry');throw error;}
        }
        // A concurrent identical request may have persisted another capture.
        // The winning request owns its reference; this unused one is ours to close.
        if(!sameKnowledgeUsage(snapshot,candidate.agent_snapshot))await this.tests.releaseSnapshot(snapshot);
        await this.dispatch(tenantId,agentId,candidate.id).catch(()=>this.logger.warn('Agent release saved; evaluation queue dispatch deferred'));
        return this.read(tenantId,agentId,candidate.id,actor);
    }
    async read(tenantId:string,agentId:string,candidateId:string,actor:ReleaseActor):Promise<any>{
        assertReleaseActor(actor,false);assertReleaseIds(tenantId,agentId,candidateId);
        const schema=await this.prisma.getTenantSchemaName(tenantId);
        return this.prisma.transactionInTenantSchema(schema,async q=>{
        await q('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text',[`agent-privacy:${schema}`]);
        const data=await this.store.read(q,agentId,candidateId);
        if(!data)throw new NotFoundException({error:'agent_release_not_found'});
        let revisionState:'current'|'changed'|'unavailable'|'invalidated'='invalidated';
        if(data.candidate.agent_snapshot) {
            try{await assertReviewedRegressionScenarios(q,data.candidate.scenarios,agentId);
                await this.tests.assertSnapshotCurrent(data.candidate.agent_snapshot,tenantId,agentId);revisionState='current';}
            catch(error){revisionState=releaseErrorCode(error)==='agent_release_revision_changed'?'changed':'unavailable';}
        }
        return {id:candidateId,agentId,configurationRevisionId:data.candidate.configuration_revision_id,status:data.candidate.status,
            version:data.candidate.version,revisionState,channels:data.candidate.channels,createdAt:data.candidate.created_at,error:data.candidate.error,
            evaluations:data.evaluations.map(row=>({id:row.id,channel:row.channel_type,status:row.status,attempts:row.attempts,
                error:row.error,runId:row.run_id,nextAttemptAt:row.next_attempt_at,completedScenarios:row.results?.length||0})),
            review:data.candidate.agent_snapshot&&revisionState==='current'?{...releaseReviewEvidence(data.candidate,data.evaluations),
                eligibleForReview:revisionState==='current'&&data.candidate.status==='evaluated'&&releaseReviewEvidence(data.candidate,data.evaluations).eligibleForReview}:null,
            activationAllowed:false,certified:false};
        },{timeout:120_000});
    }
    async list(tenantId:string,agentId:string,actor:ReleaseActor):Promise<any[]>{
        assertReleaseActor(actor,false);assertReleaseIds(tenantId,agentId);
        const schema=await this.prisma.getTenantSchemaName(tenantId);
        return this.prisma.transactionInTenantSchema(schema,async q=>!await this.store.exists(q)?[]:q<any[]>(
            `SELECT id,configuration_revision_id,status,version,error,created_at FROM agent_release_candidates
             WHERE agent_id=$1::uuid ORDER BY created_at DESC,id LIMIT 30`,[agentId]));
    }
    async review(tenantId:string,agentId:string,candidateId:string,body:ReviewAgentRelease,actor:ReleaseActor):Promise<any>{
        const schema=await this.prisma.getTenantSchemaName(tenantId);
        await this.prisma.transactionInTenantSchema(schema,q=>this.store.review(q,schema,{tenantId,agentId,candidateId,body,actor},
            snapshot=>this.tests.assertSnapshotCurrent(snapshot,tenantId,agentId)),{timeout:120_000});
        return this.read(tenantId,agentId,candidateId,actor);
    }
    private async dispatch(tenantId:string,agentId:string,candidateId:string):Promise<void>{
        const schema=await this.prisma.getTenantSchemaName(tenantId);
        const rows=await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT id FROM agent_release_evaluations WHERE candidate_id=$1::uuid
             AND ((status IN ('pending','failed','budget_deferred') AND next_attempt_at<=NOW()) OR (status='running' AND lease_until<NOW()))`,[candidateId]);
        for(const row of rows){
            const jobId=`agent-release-${tenantId}-${row.id}`,existing=await this.queue.getJob(jobId);
            if(existing){if(await existing.getState()==='failed')await existing.retry();continue;}
            await this.queue.add('evaluate',{tenantId,agentId,candidateId,evaluationId:row.id},
                {jobId,attempts:1,removeOnComplete:true,removeOnFail:50});
        }
    }
    @Cron('*/2 * * * *')
    async recover():Promise<void>{
        const tenants=await this.prisma.tenant.findMany({where:{isActive:true},select:{id:true}});
        for(const tenant of tenants)try{
            const schema=await this.prisma.getTenantSchemaName(tenant.id);
            const candidates=await this.prisma.transactionInTenantSchema(schema,async q=>!await this.store.exists(q)?[]:q<any[]>(
                `SELECT c.id,c.agent_id FROM agent_release_candidates c WHERE c.status IN ('pending','evaluating')
                 AND EXISTS(SELECT 1 FROM agent_release_evaluations e WHERE e.candidate_id=c.id
                    AND ((e.status IN ('pending','failed','budget_deferred') AND e.next_attempt_at<=NOW())
                        OR (e.status='running' AND e.lease_until<NOW()))) ORDER BY c.created_at,c.id LIMIT 50`));
            for(const candidate of candidates)await this.dispatch(tenant.id,candidate.agent_id,candidate.id);
        }catch{this.logger.warn('Agent release queue recovery deferred');}
    }
    async process(job:AgentReleaseJob):Promise<any>{
        assertReleaseIds(job.tenantId,job.agentId,job.candidateId,job.evaluationId);
        const access=await resolveTenantSubscriptionAccess(this.prisma,job.tenantId,'write');
        if(!access.allowed)return {ok:false,deferred:true,reason:'subscription_entitlement_unavailable'};
        const schema=await this.prisma.getTenantSchemaName(job.tenantId);
        let claimed:any,capturedSnapshot:AgentEvaluationSnapshot|undefined;
        try {
            claimed=await this.prisma.transactionInTenantSchema(schema,async q=>{
                await q('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text',[`agent-privacy:${schema}`]);
                const before=await this.store.read(q,job.agentId,job.candidateId);
                // claim can reject a retired source before returning a lease;
                // invalidation then removes the persisted reference entirely.
                if(before?.candidate.agent_snapshot)capturedSnapshot=structuredClone(before.candidate.agent_snapshot);
                return this.store.claim(q,schema,job.tenantId,job.agentId,job.candidateId,job.evaluationId);
            });
            if(!claimed)return {ok:false,skipped:true};
            const executionSnapshot:AgentEvaluationSnapshot=structuredClone(claimed.candidate.agent_snapshot);
            capturedSnapshot=executionSnapshot;
            const authority={...job,leaseToken:claimed.leaseToken};
            const checkpoint=(extra:any={})=>Object.keys(extra).length===0&&hasAgentSourceFence(this.prisma,schema)
                ?withAgentSourceFence(this.prisma,schema,q=>this.store.assertExecutionLease(q,authority))
                :this.prisma.transactionInTenantSchema(schema,q=>this.store.checkpoint(q,schema,{...authority,...extra}));
            await this.tests.assertSnapshotExecutable(executionSnapshot,job.tenantId,job.agentId);
            const result=await this.evals.runGateV2(job.tenantId,job.agentId,{
                agentSnapshot:structuredClone(executionSnapshot),scenarios:claimed.candidate.scenarios,
                channelType:claimed.evaluation.channel_type,previousResults:claimed.evaluation.results,
                threshold:8,k:3,passPolicy:'all',trigger:'release_candidate',
                assertExecutionAuthority:()=>checkpoint().then(()=>undefined),
                beforeModelUnits:async units=>{await checkpoint();await this.budget.consumeBudget(job.tenantId,units);},
                onScenarioCompleted:results=>checkpoint({results}).then(()=>undefined),
            });
            await this.tests.assertSnapshotExecutable(executionSnapshot,job.tenantId,job.agentId);
            await checkpoint({status:'completed',results:result.scenarios,evidence:result.releaseEvidence,runId:result.runId});
            await this.releaseCompletedSnapshot(schema,job,executionSnapshot);
            return {ok:true};
        }catch(error){
            const code=releaseErrorCode(error);
            if(['agent_release_revision_changed','agent_release_source_changed'].includes(code)) {
                await this.prisma.transactionInTenantSchema(schema,q=>this.store.invalidate(q,job.agentId,job.candidateId,code));
                if(capturedSnapshot)await this.tests.releaseSnapshot(capturedSnapshot);
                return {ok:false,invalidated:true,reason:code};
            }
            if(!claimed||code==='agent_release_lease_lost')return {ok:false,skipped:true,reason:code};
            try{await this.prisma.transactionInTenantSchema(schema,q=>this.store.checkpoint(q,schema,{...job,leaseToken:claimed.leaseToken,
                status:code==='eval_autorun_budget_exhausted'?'budget_deferred':'failed',error:code}));}
            catch{/* A retired request or replaced lease has no remaining write authority. */}
            return {ok:false,deferred:true,reason:code};
        }
    }
    private async releaseCompletedSnapshot(schema:string,job:AgentReleaseJob,snapshot:AgentEvaluationSnapshot):Promise<void>{
        try{
            const complete=await this.prisma.transactionInTenantSchema(schema,async q=>{
                const data=await this.store.read(q,job.agentId,job.candidateId);
                return !!data&&['evaluated','approved','rejected'].includes(data.candidate.status)
                    &&sameKnowledgeUsage(snapshot,data.candidate.agent_snapshot)
                    &&data.evaluations.length===snapshot.releaseScope?.channels.length
                    &&snapshot.releaseScope.channels.every(channel=>data.evaluations.some(row=>row.channel_type===channel&&row.status==='completed'));
            });
            if(complete)await this.tests.releaseSnapshot(snapshot);
        }catch{/* Completion remains durable; ambiguous cleanup is retried by usage expiry. */
            this.logger.warn('Agent release completed; knowledge cleanup deferred to durable expiry');
        }
    }
}
function sameKnowledgeUsage(left:AgentEvaluationSnapshot,right?:AgentEvaluationSnapshot|null):boolean{
    return !!left.knowledgeInputs?.usage?.token&&left.tenantId===right?.tenantId&&left.agentId===right.agentId
        &&left.knowledgeInputs.usage.token===right.knowledgeInputs?.usage?.token;
}
/** Never persist provider exception bodies, SQL or arbitrary customer text as a status. */
export function releaseErrorCode(error:any):string{
    const code=String(error?.response?.error||error?.message||'').replace(/^agent_runtime_failed:/,'');
    if(code==='eval_autorun_budget_exhausted'||code==='agent_release_lease_lost')return code;
    if(/regression_|agent_release_invalidated|evaluation_knowledge_|llm_source_authority_unavailable/.test(code))return 'agent_release_source_changed';
    if(/evaluation_dependencies_changed|evaluation_revision_changed|evaluation_revision_dependency|agent_.*(integrity_mismatch|configuration_changed|revision_changed)|snapshot_.*mismatch/.test(code))return 'agent_release_revision_changed';
    return 'agent_release_evaluation_unavailable';
}
