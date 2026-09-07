import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QualityService, QUALITY_QUEUE } from './quality.service';
import { QualityListenerService } from './quality-listener.service';
import { QualityProcessor } from './quality.processor';
import { QualityController } from './quality.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AIModule } from '../ai/ai.module';
import { AgentQualityService } from './agent-quality.service';
import { AgentQualitySignalService } from './agent-quality-signal.service';
import { QualityRegressionService } from './regressions/quality-regression.service';
import { QualityRegressionController } from './regressions/quality-regression.controller';

@Module({
    imports: [
        PrismaModule,
        RedisModule,
        AIModule,
        BullModule.registerQueue({ name: QUALITY_QUEUE }),
    ],
    providers: [QualityService, AgentQualityService, AgentQualitySignalService, QualityListenerService, QualityProcessor, QualityRegressionService],
    controllers: [QualityController, QualityRegressionController],
    exports: [QualityService, AgentQualityService, AgentQualitySignalService],
})
export class QualityModule {}
