import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BroadcastController } from './broadcast.controller';
import { BroadcastService, BROADCAST_QUEUE } from './broadcast.service';
import { BroadcastQueueProcessor } from './broadcast-queue.processor';
import { AbTestService } from './ab-test.service';
import { RedisModule } from '../redis/redis.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { EmailModule } from '../email/email.module';
import { SmsCreditsModule } from '../sms-credits/sms-credits.module';
import { WhatsappSpendModule } from '../billing/whatsapp-spend/whatsapp-spend.module';
import { ChannelsModule } from '../channels/channels.module';

@Module({
    imports: [
        RedisModule,
        forwardRef(() => WhatsappModule),
        EmailModule,
        SmsCreditsModule,
        // A campaign declares its own ceiling before it fans out.
        WhatsappSpendModule,
        // And each of its messages commits an `agent_dispatch_outbox` row
        // before it is sent, so the processor needs the lane that writes one.
        forwardRef(() => ChannelsModule),
        BullModule.registerQueue({
            name: BROADCAST_QUEUE,
        }),
    ],
    controllers: [BroadcastController],
    providers: [BroadcastService, BroadcastQueueProcessor, AbTestService],
    exports: [BroadcastService, AbTestService],
})
export class BroadcastModule {}
