import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const EVAL_GATE_QUEUE = 'eval-gate';

export interface EvalGateJob {
    tenantId: string;
    agentId: string;
    trigger: string;
}

/**
 * Auto-runs the eval gate (EvalService.runGateV2) when an agent's behaviour config
 * changes. Listens for `agent.config.updated` (emitted by PersonaService.updateAgent)
 * and enqueues a deduped, delayed job onto EVAL_GATE_QUEUE. Best-effort — a failure
 * here never breaks the agent-save request.
 */
@Injectable()
export class EvalAutorunListener {
    private readonly logger = new Logger(EvalAutorunListener.name);

    constructor(
        @InjectQueue(EVAL_GATE_QUEUE) private readonly queue: Queue<EvalGateJob>,
    ) {}

    @OnEvent('agent.config.updated')
    async handle(ev: { tenantId: string; agentId: string; changed?: string }): Promise<void> {
        if (!ev?.tenantId || !ev?.agentId) return;
        try {
            // Trailing-edge debounce: a 30s delay + per-agent jobId dedupe collapses a
            // burst of saves into ONE run that reads the LATEST config at run time. (A
            // leading-edge Redis lock would silently drop a save made just after a fast
            // gate completed within the window.)
            await this.queue.add(
                'run',
                { tenantId: ev.tenantId, agentId: ev.agentId, trigger: 'persona_edit' },
                {
                    jobId: `eval-gate-${ev.tenantId}-${ev.agentId}`, // dedupe concurrent edits
                    delay: 30_000,
                    attempts: 1,
                    removeOnComplete: true,
                    removeOnFail: 50,
                },
            );
        } catch (e: any) {
            this.logger.warn(`[EvalAutorun] enqueue failed for ${ev.tenantId}/${ev.agentId}: ${e.message}`);
        }
    }
}
