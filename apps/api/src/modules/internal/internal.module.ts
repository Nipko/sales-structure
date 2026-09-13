import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InternalController } from './internal.controller';
import { InboundQueueModule } from '../inbound/inbound-queue.module';
import { WhatsappSpendModule } from '../billing/whatsapp-spend/whatsapp-spend.module';

/**
 * The controller now hands inbound messages to the queue instead of calling
 * ConversationsService directly, so the forwardRef(() => ConversationsModule)
 * this used to need is gone — and with it that cycle.
 */
@Module({
  // The receipts this controller receives have to reach the money, not only
  // the conversation record: a WhatsApp charge lands on delivery.
  imports: [ConfigModule, InboundQueueModule, WhatsappSpendModule],
  controllers: [InternalController],
})
export class InternalModule {}
