import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { InboundQueueService } from './inbound-queue.service';
import { INBOUND_QUEUE } from './inbound-queue.constants';

/**
 * Producer side only — deliberately an empty dependency graph (the queue plus a
 * service that injects globals). Every webhook module can import this with a
 * PLAIN import and never a forwardRef, because it can't close a cycle.
 *
 * The consumer lives in InboundProcessorModule, which imports the business
 * modules and is imported by nobody.
 */
@Module({
    imports: [BullModule.registerQueue({ name: INBOUND_QUEUE })],
    providers: [InboundQueueService],
    exports: [InboundQueueService],
})
export class InboundQueueModule {}
