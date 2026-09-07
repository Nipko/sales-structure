import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { EvalService } from './eval.service';
import { EvalAutorunStateService } from './eval-autorun-state.service';
import { EVAL_GATE_QUEUE, EvalGateJob } from './eval-autorun.listener';
import { PrismaService } from '../prisma/prisma.service';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';
import { regressionAppliesToSnapshot } from '../quality/regressions/quality-regression-runtime';

/**
 * Drains the auto-run eval gate. Each job runs the full τ² gate (golden set × k ×
 * multi-turn LLM-judge). Retries reuse the frozen revision and scenario checkpoints.
 * The durable request survives queue outages and budget deferral.
 */
@Processor(EVAL_GATE_QUEUE, { concurrency: 1 })
export class EvalGateProcessor extends WorkerHost {
    private readonly logger = new Logger(EvalGateProcessor.name);

    constructor(
        private readonly evals: EvalService,
        private readonly prisma: PrismaService,
        private readonly state: EvalAutorunStateService,
    ) {
        super();
    }

    async process(job: Job<EvalGateJob>): Promise<any> {
        const access = await resolveTenantSubscriptionAccess(this.prisma, job.data.tenantId, 'write');
        if (!access.allowed) {
            if (access.restrictionLevel === 'unavailable') throw new Error('subscription_entitlement_unavailable');
            return { ok: false, skipped: true, reason: access.error };
        }
        const { tenantId, agentId } = job.data;
        // Old queued jobs are upgraded once; new ones identify an immutable request.
        const revision = job.data.revision || await this.state.request(tenantId, agentId);
        const request = await this.state.get(tenantId, agentId, revision);
        if (!request || request.status === 'completed') return { ok: true, skipped: true, reason: 'superseded_or_completed' };
        if (request.status === 'invalidated') return { ok: false, skipped: true, reason: 'evaluation_invalidated' };
        if (request.status === 'budget_deferred' && new Date(request.next_attempt_at).getTime() > Date.now()) return { ok: false, deferred: true };
        try {
            // Keep stale applicable approvals visible to the source guard. Removing
            // review_required here would silently turn an invalid regression into absence.
            const scenarios = (request.scenarios || await this.evals.listScenarios(tenantId))
                .filter((scenario:any)=>regressionAppliesToSnapshot(scenario,request.agent_snapshot,'web_widget'));
            await this.state.update(tenantId, agentId, revision, 'running', undefined, scenarios);
            const admitted=await this.state.get(tenantId,agentId,revision);
            if(!admitted||admitted.status!=='running')return {ok:false,skipped:true,reason:'evaluation_invalidated_or_superseded'};
            await this.evals.runGateV2(tenantId, agentId, {
                trigger: job.data.trigger || 'persona_edit', agentSnapshot: request.agent_snapshot,
                scenarios, previousResults: request.results || [],
                beforeModelUnits: async units => {
                    const current=await this.state.get(tenantId,agentId,revision);
                    if (!current||current.status!=='running') throw new Error('eval_revision_invalidated_or_superseded');
                    await this.state.consumeBudget(tenantId, units);
                },
                onScenarioCompleted: results => this.state.update(tenantId, agentId, revision, 'running', undefined, undefined, results),
            });
            await this.state.update(tenantId, agentId, revision, 'completed');
            const completed=await this.state.get(tenantId,agentId,revision);
            if(!completed||completed.status!=='completed')return {ok:false,skipped:true,reason:'evaluation_invalidated_or_superseded'};
            return { ok: true };
        } catch (error: any) {
            const current=await this.state.get(tenantId,agentId,revision);
            if(!current||current.status==='invalidated')return {ok:false,skipped:true,reason:'evaluation_invalidated_or_superseded'};
            const budget = error.message === 'eval_autorun_budget_exhausted';
            await this.state.update(tenantId, agentId, revision, budget ? 'budget_deferred' : 'failed', String(error.message || error));
            if (budget) return { ok: false, deferred: true, reason: error.message };
            throw error;
        }
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job<EvalGateJob>, err: Error) {
        this.logger.error(`Eval-gate job ${job.id} failed: ${err.message}`);
        Sentry.captureException(err, {
            tags: { queue: EVAL_GATE_QUEUE },
            extra: { tenantId: job.data?.tenantId, agentId: job.data?.agentId },
        });
    }
}
