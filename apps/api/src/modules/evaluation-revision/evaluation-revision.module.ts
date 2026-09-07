import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AIModule } from '../ai/ai.module';
import { EvaluationRevisionService } from './evaluation-revision.service';

@Module({imports:[PrismaModule,AIModule],providers:[EvaluationRevisionService],exports:[EvaluationRevisionService]})
export class EvaluationRevisionModule {}
