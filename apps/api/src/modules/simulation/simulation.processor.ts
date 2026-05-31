import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { SimulationService, SimulationJob, SIMULATION_QUEUE } from './simulation.service';

/**
 * Runs agent-simulation batches in the background. Each job executes a full
 * pre-deploy run (N scenarios × multi-turn) which can take minutes, so we keep
 * concurrency low and never auto-retry the whole batch (attempts: 1 set on add).
 */
@Processor(SIMULATION_QUEUE, {
    concurrency: 2,
})
export class SimulationProcessor extends WorkerHost {
    private readonly logger = new Logger(SimulationProcessor.name);

    constructor(private readonly simulation: SimulationService) {
        super();
    }

    async process(job: Job<SimulationJob>): Promise<any> {
        await this.simulation.executeRun(job.data.tenantId, job.data.runId);
        return { ok: true };
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job<SimulationJob>, err: Error) {
        this.logger.error(`Simulation job ${job.id} failed: ${err.message}`);
        Sentry.captureException(err, {
            tags: { queue: SIMULATION_QUEUE },
            extra: { tenantId: job.data?.tenantId, runId: job.data?.runId },
        });
    }
}
