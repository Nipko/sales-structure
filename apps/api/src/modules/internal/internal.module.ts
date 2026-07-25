import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InternalController } from './internal.controller';
import { InboundQueueModule } from '../inbound/inbound-queue.module';

/**
 * The controller now hands inbound messages to the queue instead of calling
 * ConversationsService directly, so the forwardRef(() => ConversationsModule)
 * this used to need is gone — and with it that cycle.
 */
@Module({
  imports: [ConfigModule, InboundQueueModule],
  controllers: [InternalController],
})
export class InternalModule {}
