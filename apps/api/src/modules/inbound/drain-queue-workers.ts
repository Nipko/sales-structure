import type { INestApplicationContext } from '@nestjs/common';
import { InboundQueueProcessor } from './inbound-queue.processor';

/**
 * F4300-61 (production 28/29-oct, Sentry «Inbound job stalled»): a deploy sent SIGTERM to the API while its inbound consumer was
 * four seconds into a turn. `app.close()` runs every `onModuleDestroy` (Prisma disconnects, Redis quits) BEFORE
 * `onApplicationShutdown`, where @nestjs/bullmq closes its workers — so the turn lost its database mid-way, the job's lock expired
 * 120 s later («stalled»), the next process resumed it while the customer's follow-up was answered too, and the customer got no
 * reply for two minutes and then two identical ones.
 *
 * The inbound worker is closed first, while every dependency is still up: BullMQ's `close()` stops taking jobs and waits for the
 * active ones to finish (the container grace period, 150–160 s, covers the 100 s p99 of a turn).
 */
export async function drainInboundWorker(app: INestApplicationContext, log: (line: string) => void = console.log): Promise<void> {
    let processor: InboundQueueProcessor | undefined;
    try {
        processor = app.get(InboundQueueProcessor, { strict: false });
    } catch {
        return; // This process has no inbound consumer.
    }
    const worker = (processor as any)?.worker;
    if (!worker || typeof worker.close !== 'function') return;
    const started = Date.now();
    try {
        await worker.close();
        log(`Inbound worker drained in ${Math.round((Date.now() - started) / 1000)}s`);
    } catch (err: any) {
        log(`Inbound worker drain failed: ${err?.message ?? err}`);
    }
}
