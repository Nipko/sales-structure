import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeRecrawlService } from './knowledge-recrawl.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
    imports: [PrismaModule, ConfigModule],
    controllers: [KnowledgeController],
    providers: [KnowledgeService, KnowledgeRecrawlService],
    exports: [KnowledgeService],
})
export class KnowledgeModule {}
