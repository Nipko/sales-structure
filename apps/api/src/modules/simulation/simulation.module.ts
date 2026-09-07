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
import { EvalService } from './eval.service';
import { EvalController } from './eval.controller';
import { EvalAutorunListener, EVAL_GATE_QUEUE } from './eval-autorun.listener';
import { EvalGateProcessor } from './eval-gate.processor';
import { EvalAutorunStateService } from './eval-autorun-state.service';
import { WatchtowerService } from './watchtower.service';
import { WatchtowerController } from './watchtower.controller';
import { QUALITY_QUEUE } from '../quality/quality.service';

/**
 * Agent Simulation pre-deploy (T2.13). Reuses:
 *  - AgentTestService (ConversationsModule) to run the full prompt pipeline per
 *    turn against a frozen configuration and audited sandbox tools. External
 *    effects stay disabled; sandbox fixtures are cleaned under an ownership lease.
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
        BullModule.registerQueue({ name: EVAL_GATE_QUEUE }),
        BullModule.registerQueue({ name: QUALITY_QUEUE }),
    ],
    providers: [SimulationService, SimulationProcessor, EvalService, EvalAutorunListener, EvalAutorunStateService, EvalGateProcessor, WatchtowerService],
    controllers: [SimulationController, EvalController, WatchtowerController],
    exports: [SimulationService, EvalService],
})
export class SimulationModule {}
