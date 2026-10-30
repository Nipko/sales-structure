import { Module } from '@nestjs/common';
import { AIModule } from '../ai/ai.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReadinessModule } from '../readiness/readiness.module';
import { CopilotProposalsListener } from './copilot-proposals.listener';
import { CopilotProposalsService } from './copilot-proposals.service';
import { OnboardingCopilotController } from './onboarding-copilot.controller';
import { OnboardingExtractionService } from './onboarding-extraction.service';

/**
 * Copiloto de onboarding (C0 §1.3, rebanada R6, ADR 0012): la ejecución de extracción sobre las fuentes ya ingeridas,
 * las propuestas con cita verificada en `agent_content_proposals` y su aprobación por BusinessFactsService. Ninguna pieza
 * de este módulo escribe un valor del negocio sin la aprobación de una persona.
 */
@Module({
    imports: [PrismaModule, ReadinessModule, AIModule],
    providers: [CopilotProposalsService, OnboardingExtractionService, CopilotProposalsListener],
    controllers: [OnboardingCopilotController],
    exports: [CopilotProposalsService],
})
export class OnboardingCopilotModule {}
