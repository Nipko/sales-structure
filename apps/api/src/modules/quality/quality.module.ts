import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QualityService, QUALITY_QUEUE } from './quality.service';
import { QualityListenerService } from './quality-listener.service';
import { QualityProcessor } from './quality.processor';
import { QualityController } from './quality.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AIModule } from '../ai/ai.module';

@Module({
    imports: [
        PrismaModule,
        RedisModule,
        AIModule,
        BullModule.registerQueue({ name: QUALITY_QUEUE }),
    ],
    providers: [QualityService, QualityListenerService, QualityProcessor],
    controllers: [QualityController],
    exports: [QualityService],
})
export class QualityModule {}
