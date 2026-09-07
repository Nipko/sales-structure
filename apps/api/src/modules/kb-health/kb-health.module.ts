import { Module } from '@nestjs/common';
import { KbHealthService } from './kb-health.service';
import { KbHealthController } from './kb-health.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { AIModule } from '../ai/ai.module';
import { KnowledgeConflictService } from './knowledge-conflict.service';

@Module({
    imports: [PrismaModule, RedisModule, AIModule],
    providers: [KbHealthService, KnowledgeConflictService],
    controllers: [KbHealthController],
    exports: [KbHealthService, KnowledgeConflictService],
})
export class KbHealthModule {}
