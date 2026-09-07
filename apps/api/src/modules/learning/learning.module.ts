import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AIModule } from '../ai/ai.module';
import { LearningService } from './learning.service';
import { LearningController } from './learning.controller';

@Module({imports:[PrismaModule,KnowledgeModule,AIModule],controllers:[LearningController],providers:[LearningService],exports:[LearningService]})
export class LearningModule {}
