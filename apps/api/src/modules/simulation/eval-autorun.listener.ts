import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RedisService } from '../redis/redis.service';

export const EVAL_GATE_QUEUE = 'eval-gate';

export interface EvalGateJob {
    tenantId: string;
    agentId: string;
    trigger: string;
}

/**
 * Auto-runs the eval gate (EvalService.runGateV2) when an agent's behaviour config
 * changes. Listens for `agent.config.updated` (emitted by PersonaService.updateAgent),
 * debounces bursts of saves with a short Redis lock, and enqueues a deduped job onto
 * EVAL_GATE_QUEUE for the worker to drain. Best-effort — a failure here never breaks
 * the agent-save request.
 */
@Injectable()
export class EvalAutorunListener {
    private readonly logger = new Logger(EvalAutorunListener.name);

    constructor(
        private readonly redis: RedisService,
        @InjectQueue(EVAL_GATE_QUEUE) private readonly queue: Queue<EvalGateJob>,
    ) {}

    @OnEvent('agent.config.updated')
    async handle(ev: { tenantId: string; agentId: string; changed?: string }): Promise<void> {
        if (!ev?.tenantId || !ev?.agentId) return;
        try {
            // Debounce: collapse a burst of saves (~30s) into a single gate run.
            const fresh = await this.redis.acquireLock(`eval-gate-debounce:${ev.tenantId}:${ev.agentId}`, 30);
            if (!fresh) return;

            await this.queue.add(
                'run',
                { tenantId: ev.tenantId, agentId: ev.agentId, trigger: 'persona_edit' },
                {
                    jobId: `eval-gate-${ev.tenantId}-${ev.agentId}`, // dedupe concurrent edits
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
