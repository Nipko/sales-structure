import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AIModule } from '../ai/ai.module';
import { EvaluationRevisionService } from './evaluation-revision.service';
import { EvaluationKnowledgeService } from './evaluation-knowledge.service';

@Module({imports:[PrismaModule,AIModule],providers:[EvaluationRevisionService,EvaluationKnowledgeService],exports:[EvaluationRevisionService,EvaluationKnowledgeService]})
export class EvaluationRevisionModule {}
