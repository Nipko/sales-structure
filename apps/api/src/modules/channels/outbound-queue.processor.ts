import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ChannelGatewayService } from './channel-gateway.service';
import { OutboundMessage } from '@parallext/shared';

export const OUTBOUND_QUEUE = 'outbound-messages';

export interface OutboundJobData {
    outbound: OutboundMessage;
    accessToken: string;
}

@Processor(OUTBOUND_QUEUE)
export class OutboundQueueProcessor extends WorkerHost {
    private readonly logger = new Logger(OutboundQueueProcessor.name);

    constructor(private channelGateway: ChannelGatewayService) {
        super();
    }

    async process(job: Job<OutboundJobData>): Promise<string | null> {
        const { outbound, accessToken } = job.data;
        this.logger.log(`Processing outbound message job ${job.id} to ${outbound.to} via ${outbound.channelType}`);

        const result = await this.channelGateway.sendMessage(outbound, accessToken);

        if (!result) {
            throw new Error(`Failed to send message to ${outbound.to} via ${outbound.channelType}`);
        }

        return result;
    }
}
