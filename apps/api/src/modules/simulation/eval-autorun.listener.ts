import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron } from '@nestjs/schedule';
import { EvalAutorunStateService } from './eval-autorun-state.service';

export const EVAL_GATE_QUEUE = 'eval-gate';

export interface EvalGateJob {
    tenantId: string;
    agentId: string;
    trigger: string;
    revision?: string;
}

/**
 * Auto-runs the eval gate (EvalService.runGateV2) when an agent's behaviour config
 * changes. Listens for `agent.config.updated`, emitted by
 * `AgentPublicationService.settle` after a publication or a rollback commits —
 * the moment the change reaches customers. It used to say `PersonaService.updateAgent`,
 * which stopped emitting anything when the edit path moved to the draft flow and
 * left this listener with no emitter at all. Enqueues a deduped, delayed job onto
 * EVAL_GATE_QUEUE. Best-effort — a failure here never breaks the publication.
 */
@Injectable()
export class EvalAutorunListener {
    private readonly logger = new Logger(EvalAutorunListener.name);

    constructor(
        @InjectQueue(EVAL_GATE_QUEUE) private readonly queue: Queue<EvalGateJob>,
        private readonly state: EvalAutorunStateService,
    ) {}

    @OnEvent('agent.config.updated')
    async handle(ev: { tenantId: string; agentId: string; changed?: string }): Promise<void> {
        if (!ev?.tenantId || !ev?.agentId) return;
        try {
            const revision = await this.state.request(ev.tenantId, ev.agentId);
            await this.enqueue({ tenantId: ev.tenantId, agentId: ev.agentId, revision });
        } catch (e: any) {
            this.logger.warn(`[EvalAutorun] request/dispatch failed for ${ev.tenantId}/${ev.agentId}: ${e.message}`);
        }
    }

    private async enqueue(ev: { tenantId: string; agentId: string; revision: string }): Promise<void> {
            // After the 30s quiet window, the processor discards superseded revisions.
            // An edit during an active run creates another durable request.
            await this.queue.add(
                'run',
                { tenantId: ev.tenantId, agentId: ev.agentId, trigger: 'persona_edit', revision: ev.revision },
                {
                    jobId: `eval-gate-${ev.tenantId}-${ev.agentId}-${ev.revision}`, // dedupe concurrent edits
                    delay: 30_000,
                    attempts: 3,
                    backoff: { type: 'exponential', delay: 30_000 },
                    removeOnComplete: true,
                    removeOnFail: 50,
                },
            );
    }

    @Cron('*/2 * * * *')
    async recoverPending(): Promise<void> {
        for (const request of await this.state.recoverable()) {
            try {
                const id = `eval-gate-${request.tenantId}-${request.agentId}-${request.revision}`;
                const job = await this.queue.getJob(id);
                if (!job) await this.enqueue(request);
                else if (await job.getState() === 'failed') await job.retry();
            } catch (error: any) { this.logger.warn(`[EvalAutorun] recovery failed: ${error.message}`); }
        }
    }
}
