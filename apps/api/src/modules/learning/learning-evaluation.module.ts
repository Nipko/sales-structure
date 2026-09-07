import { Module, Controller, Post, Param, UseGuards } from '@nestjs/common';
import { BullModule, Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { AuthGuard } from '@nestjs/passport';
import { Job } from 'bullmq';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { LearningModule } from './learning.module';
import { LearningService } from './learning.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { SimulationModule } from '../simulation/simulation.module';
import { AIModule } from '../ai/ai.module';
import { PrismaModule } from '../prisma/prisma.module';
import { LearningEvaluationService, LEARNING_EVALUATION_QUEUE, type LearningEvaluationJob } from './learning-evaluation.service';

@Controller('learning/:tenantId/:agentId')
@Roles('tenant_admin','tenant_supervisor','super_admin')
@UseGuards(AuthGuard('jwt'),RolesGuard,TenantGuard)
export class LearningEvaluationController {
    constructor(private readonly evaluation:LearningEvaluationService){}
    @Post('releases/:releaseId/evaluate')
    async evaluate(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Param('releaseId') releaseId:string){
        return {success:true,data:await this.evaluation.enqueue(tenantId,agentId,releaseId)};
    }
}

@Processor(LEARNING_EVALUATION_QUEUE,{concurrency:1})
export class LearningEvaluationProcessor extends WorkerHost {
    constructor(private readonly evaluation:LearningEvaluationService,private readonly learning:LearningService){super();}
    process(job:Job<LearningEvaluationJob>){return this.evaluation.run(job.data);}
    @OnWorkerEvent('failed')
    async failed(job:Job<LearningEvaluationJob>,error:Error){
        if(job&&job.attemptsMade>=(job.opts.attempts||1)){
            const {tenantId,agentId,releaseId,attemptId}=job.data;
            await this.learning.failEvaluation(tenantId,agentId,releaseId,attemptId,String(error.message||'evaluation_failed').slice(0,160));
        }
    }
}

@Module({imports:[LearningModule,ConversationsModule,SimulationModule,AIModule,PrismaModule,BullModule.registerQueue({name:LEARNING_EVALUATION_QUEUE})],
    providers:[LearningEvaluationService,LearningEvaluationProcessor],controllers:[LearningEvaluationController],exports:[LearningEvaluationService]})
export class LearningEvaluationModule {}
