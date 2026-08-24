import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConversationsModule } from '../conversations/conversations.module';
import { InboundQueueProcessor } from './inbound-queue.processor';
import { INBOUND_QUEUE } from './inbound-queue.constants';
import { InboundFailedRedriveService } from './inbound-failed-redrive.service';

/**
 * Consumer side. Imports the business graph it needs and exports nothing, so
 * it is a sink: only AppModule imports it and nothing imports it back, which
 * makes it structurally incapable of closing a dependency cycle.
 */
@Module({
    imports: [
        BullModule.registerQueue({ name: INBOUND_QUEUE }),
        ConversationsModule,
    ],
    providers: [InboundQueueProcessor, InboundFailedRedriveService],
})
export class InboundProcessorModule {}
