import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BroadcastController } from './broadcast.controller';
import { BroadcastService, BROADCAST_QUEUE } from './broadcast.service';
import { BroadcastQueueProcessor } from './broadcast-queue.processor';
import { RedisModule } from '../redis/redis.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
    imports: [
        RedisModule,
        forwardRef(() => WhatsappModule),
        BullModule.registerQueue({
            name: BROADCAST_QUEUE,
        }),
    ],
    controllers: [BroadcastController],
    providers: [BroadcastService, BroadcastQueueProcessor],
    exports: [BroadcastService],
})
export class BroadcastModule {}
