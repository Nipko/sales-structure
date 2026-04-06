import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ChannelGatewayService } from './channel-gateway.service';
import { OutboundMessage } from '@parallext/shared';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';

export const OUTBOUND_QUEUE = 'outbound-messages';

export interface OutboundJobData {
    outbound: OutboundMessage;
    accessToken: string;
}

@Processor(OUTBOUND_QUEUE, {
    concurrency: 5,
    limiter: { max: 20, duration: 1000 },
})
export class OutboundQueueProcessor extends WorkerHost {
    private readonly logger = new Logger(OutboundQueueProcessor.name);

    constructor(
        private channelGateway: ChannelGatewayService,
        private throttle: TenantThrottleService,
    ) {
        super();
    }

    async process(job: Job<OutboundJobData>): Promise<string | null> {
        const { outbound, accessToken } = job.data;
        const startTime = Date.now();

        // Per-tenant rate limit — retry if exceeded
        if (await this.throttle.isLimited(outbound.tenantId, 'outbound')) {
            throw new Error(`Tenant ${outbound.tenantId} rate limited for outbound — will retry`);
        }

        this.logger.log(
            `[Outbound] Sending to ${outbound.to} via ${outbound.channelType} tenant=${outbound.tenantId}`,
        );

        const result = await this.channelGateway.sendMessage(outbound, accessToken);

        if (!result) {
            throw new Error(`Failed to send message to ${outbound.to} via ${outbound.channelType}`);
        }

        const durationMs = Date.now() - startTime;
        this.logger.log(
            `[Outbound] Sent to ${outbound.to} via ${outbound.channelType} tenant=${outbound.tenantId} (${durationMs}ms)`,
        );

        return result;
    }
}
