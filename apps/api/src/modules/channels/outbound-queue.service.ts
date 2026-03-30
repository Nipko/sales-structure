import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OutboundMessage } from '@parallext/shared';
import { OUTBOUND_QUEUE, OutboundJobData } from './outbound-queue.processor';

@Injectable()
export class OutboundQueueService {
    private readonly logger = new Logger(OutboundQueueService.name);

    constructor(
        @InjectQueue(OUTBOUND_QUEUE)
        private outboundQueue: Queue<OutboundJobData>,
    ) {}

    /**
     * Enqueue an outbound message with retry policy.
     * 3 attempts, exponential backoff (2s, 4s, 8s).
     */
    async enqueue(outbound: OutboundMessage, accessToken: string): Promise<void> {
        await this.outboundQueue.add(
            'send',
            { outbound, accessToken },
            {
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 },
                removeOnComplete: { age: 3600 }, // keep completed jobs for 1h
                removeOnFail: { age: 86400 },    // keep failed jobs for 24h
            },
        );

        this.logger.debug(`Enqueued outbound message to ${outbound.to} via ${outbound.channelType}`);
    }
}
