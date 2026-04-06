import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OutboundMessage } from '@parallext/shared';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { OUTBOUND_QUEUE, OutboundJobData } from './outbound-queue.processor';

@Injectable()
export class OutboundQueueService {
    private readonly logger = new Logger(OutboundQueueService.name);

    constructor(
        @InjectQueue(OUTBOUND_QUEUE)
        private outboundQueue: Queue<OutboundJobData>,
        private throttle: TenantThrottleService,
    ) {}

    /**
     * Enqueue an outbound message with retry policy and plan-based priority.
     * 3 attempts, exponential backoff (2s, 4s, 8s).
     */
    async enqueue(outbound: OutboundMessage, accessToken: string): Promise<void> {
        const priority = await this.throttle.getPriority(outbound.tenantId);

        await this.outboundQueue.add(
            'send',
            { outbound, accessToken },
            {
                priority,
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 },
                removeOnComplete: { age: 3600 },
                removeOnFail: { age: 86400 },
            },
        );

        this.logger.debug(
            `Enqueued outbound to ${outbound.to} via ${outbound.channelType} (priority=${priority})`,
        );
    }
}
