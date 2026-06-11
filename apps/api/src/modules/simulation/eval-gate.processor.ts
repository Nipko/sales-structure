import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { EvalService } from './eval.service';
import { EVAL_GATE_QUEUE, EvalGateJob } from './eval-autorun.listener';

/**
 * Drains the auto-run eval gate. Each job runs the full τ² gate (golden set × k ×
 * multi-turn LLM-judge) which can take minutes, so concurrency is 1 and we never
 * auto-retry the whole gate (attempts: 1 set on add). Mirrors SimulationProcessor.
 */
@Processor(EVAL_GATE_QUEUE, { concurrency: 1 })
export class EvalGateProcessor extends WorkerHost {
    private readonly logger = new Logger(EvalGateProcessor.name);

    constructor(private readonly evals: EvalService) {
        super();
    }

    async process(job: Job<EvalGateJob>): Promise<any> {
        await this.evals.runGateV2(job.data.tenantId, job.data.agentId, {
            trigger: job.data.trigger || 'persona_edit',
        });
        return { ok: true };
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
