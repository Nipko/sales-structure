import { Module, Controller, Post, Param, UseGuards } from '@nestjs/common';
import { BullModule, Processor, WorkerHost } from '@nestjs/bullmq';
import { randomUUID } from 'crypto';
import { AuthGuard } from '@nestjs/passport';
import { Job } from 'bullmq';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { LearningModule } from './learning.module';
import { LearningService } from './learning.service';
import { learningAbandonmentReason } from './learning-contracts';
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
    async process(job:Job<LearningEvaluationJob>){
        // This token belongs to this invocation, never to a shared job.data
        // object or a delayed failed event from another invocation.
        const workerToken=randomUUID();
        const {tenantId,agentId,releaseId,attemptId}=job.data;
        try{return await this.evaluation.run(job.data,workerToken);}catch(error:any){
            // A ceiling is not a transient fault. Rethrowing would spend the
            // remaining queue attempt on a run that is already over its own
            // budget or past its own deadline, and the second attempt would only
            // discover the same wall. It ends here, and it ends named: the
            // release turns terminal with the code that stopped it, so an
            // operator reading it later can tell this apart from a candidate
            // that was judged and lost.
            const abandoned=learningAbandonmentReason(error);
            if(abandoned){
                await this.learning.abandonEvaluation(tenantId,agentId,releaseId,attemptId,abandoned,workerToken);
                return {abandoned,passed:false};
            }
            if(job.attemptsMade+1>=(job.opts.attempts||1)){
                await this.learning.failEvaluation(tenantId,agentId,releaseId,attemptId,String(error.message||'evaluation_failed').slice(0,160),workerToken);
            }
            throw error;
        }
    }
}

@Module({imports:[LearningModule,ConversationsModule,SimulationModule,AIModule,PrismaModule,BullModule.registerQueue({name:LEARNING_EVALUATION_QUEUE})],
    providers:[LearningEvaluationService,LearningEvaluationProcessor],controllers:[LearningEvaluationController],exports:[LearningEvaluationService]})
export class LearningEvaluationModule {}
