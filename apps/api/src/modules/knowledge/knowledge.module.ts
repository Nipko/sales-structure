import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeRecrawlService } from './knowledge-recrawl.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { AIModule } from '../ai/ai.module';

@Module({
    imports: [PrismaModule, ConfigModule, SettingsModule, AIModule],
    controllers: [KnowledgeController],
    providers: [KnowledgeService, KnowledgeRecrawlService],
    exports: [KnowledgeService],
})
export class KnowledgeModule {}
