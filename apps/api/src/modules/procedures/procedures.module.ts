import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AIModule } from '../ai/ai.module';
import { ProceduresService } from './procedures.service';
import { ProceduresController } from './procedures.controller';

/**
 * Procedures (AOP/SOP) — T2.12. CRUD + NL→graph compiler. The deterministic
 * execution engine lives in ConversationsModule (ProcedureEngineService) so it
 * can reuse the AI tool executor; it reads procedure definitions directly from
 * the tenant schema, so this module has no dependency on conversations.
 */
@Module({
    imports: [PrismaModule, RedisModule, AIModule],
    providers: [ProceduresService],
    controllers: [ProceduresController],
    exports: [ProceduresService],
})
export class ProceduresModule {}
