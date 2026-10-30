import { Module, forwardRef } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReadinessModule } from '../readiness/readiness.module';
import { PendingAnswerNotifier } from './pending-answer-notifier.service';
import { PendingQuestionsController } from './pending-questions.controller';
import { PendingQuestionsService } from './pending-questions.service';

/**
 * Bucle de conocimiento pendiente (C0 §1.5, rebanada R5, ADR 0011): la cola `pending_questions` y sus esperas, la
 * bandeja del dueño (`/readiness/:t/pending`) y el aviso al cliente por la salida durable (ChannelsModule exporta
 * ProactiveDispatchService; el ciclo con ConversationsModule se difiere con forwardRef).
 */
@Module({
    imports: [PrismaModule, ReadinessModule, forwardRef(() => ChannelsModule)],
    providers: [PendingQuestionsService, PendingAnswerNotifier],
    controllers: [PendingQuestionsController],
    exports: [PendingQuestionsService],
})
export class PendingKnowledgeModule {}
