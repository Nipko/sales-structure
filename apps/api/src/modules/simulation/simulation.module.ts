import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AIModule } from '../ai/ai.module';
import { PersonaModule } from '../persona/persona.module';
import { QualityModule } from '../quality/quality.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { SimulationService, SIMULATION_QUEUE } from './simulation.service';
import { SimulationController } from './simulation.controller';
import { SimulationProcessor } from './simulation.processor';

/**
 * Agent Simulation pre-deploy (T2.13). Reuses:
 *  - AgentTestService (ConversationsModule) to run the full prompt pipeline per
 *    turn without persisting anything, with tools disabled for safety.
 *  - QualityService.judgeTranscript (QualityModule) as the shared LLM-as-judge.
 */
@Module({
    imports: [
        PrismaModule,
        RedisModule,
        AIModule,
        PersonaModule,
        QualityModule,
        ConversationsModule,
        BullModule.registerQueue({ name: SIMULATION_QUEUE }),
    ],
    providers: [SimulationService, SimulationProcessor],
    controllers: [SimulationController],
    exports: [SimulationService],
})
export class SimulationModule {}
