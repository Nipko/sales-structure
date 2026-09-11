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

@Module({
    imports: [
        RedisModule,
        forwardRef(() => WhatsappModule),
        EmailModule,
        SmsCreditsModule,
        // A campaign declares its own ceiling before it fans out.
        WhatsappSpendModule,
        BullModule.registerQueue({
            name: BROADCAST_QUEUE,
        }),
    ],
    controllers: [BroadcastController],
    providers: [BroadcastService, BroadcastQueueProcessor, AbTestService],
    exports: [BroadcastService, AbTestService],
})
export class BroadcastModule {}
