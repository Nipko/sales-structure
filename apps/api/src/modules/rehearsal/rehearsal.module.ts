import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReadinessModule } from '../readiness/readiness.module';
import { RehearsalController } from './rehearsal.controller';
import { RehearsalJudge } from './rehearsal-judge';
import { RehearsalService } from './rehearsal.service';

/**
 * Ensayo antes de salir (C0 §1.4 C4, rebanada R7, ADR 0013): el banco del paquete @parallext/business-spec, corrido por
 * Agent Test (ConversationsModule) en vista previa y calificado contra `qaTruth`, con el juez de paráfrasis por el router
 * de LLM (AIModule). No importa canales, la bandeja de pendientes ni el control de salida: el ensayo no tiene efectos.
 */
@Module({
    imports: [PrismaModule, ReadinessModule, ConversationsModule, AIModule],
    providers: [RehearsalService, RehearsalJudge],
    controllers: [RehearsalController],
    exports: [RehearsalService],
})
export class RehearsalModule {}
