import { Body, Controller, Delete, Get, Logger, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Prisma } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { auditActor } from '../../common/utils/audit-actor.util';
import { PrismaService } from '../prisma/prisma.service';
import { LearningService } from './learning.service';
import type { LearningFileImport, LearningReview } from './learning-contracts';

@ApiTags('learning')
@Controller('learning/:tenantId/:agentId')
@Roles('tenant_admin','tenant_supervisor','super_admin')
@UseGuards(AuthGuard('jwt'),RolesGuard,TenantGuard)
export class LearningController {
    private readonly logger=new Logger(LearningController.name);
    constructor(private readonly learning:LearningService,private readonly prisma:PrismaService) {}
    private actor(req:any){return String(req.user.id||req.user.sub);}

    /**
     * Who decided this, kept outside the tenant schema.
     *
     * `created_by`, `published_by` and `retired_by` record the operator inside
     * the tenant schema, next to the thing they describe — which is exactly why
     * they cannot be the audit trail. A retraction blanks the release row it
     * retires, and an erasure blanks the source: the moment a decision becomes
     * the one worth asking about, the in-schema record of who made it is gone
     * with the data. The audit row survives because it holds no transcript.
     *
     * `auditActor` is what keeps an impersonated session honest: during
     * impersonation `req.user` IS the tenant's own admin, so the effective id
     * alone would tell an auditor the customer published this to themselves.
     * Both identities are recorded, never one substituted for the other.
     *
     * A failed audit write warns and does not throw. The action it describes has
     * already committed; turning a successful publication into an error response
     * would send the operator back to publish a second time.
     */
    private async audit(req:any,tenantId:string,action:string,resource:string,details:Record<string,unknown>){
        const {userId,delegation}=auditActor(req?.user);
        try{
            await this.prisma.auditLog.create({data:{tenantId,userId,action:`learning.${action}`,resource,
                details:{...details,...delegation} as Prisma.InputJsonObject}});
        }catch(error:any){this.logger.warn(`Learning audit log failed: ${error?.message}`);}
    }

    @Get()
    async list(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string){
        return {success:true,data:await this.learning.list(tenantId,agentId)};
    }
    /** The decisions themselves. Without a reader these rows are only storage. */
    @Get('audit')
    async auditTrail(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Query('limit') limit?:string){
        const take=Math.min(Math.max(parseInt(limit||'50',10)||50,1),200);
        // Filtered by the database, not after the page is cut: reading a page and
        // then dropping the other agents' rows returns fewer than asked and hides
        // the rest behind a limit the caller has no way to raise.
        return {success:true,data:await this.prisma.auditLog.findMany({
            where:{tenantId,action:{startsWith:'learning.'},details:{path:['agentId'],equals:agentId}},
            orderBy:{createdAt:'desc'},take})};
    }
    /**
     * What the judge and the people who review it agree about.
     *
     * A `GET` before the `:param` routes below, for the same reason `audit` is.
     */
    @Get('calibration')
    async calibration(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Query('limit') limit?:string){
        return {success:true,data:await this.learning.judgeCalibration(tenantId,agentId,parseInt(limit||'',10)||undefined)};
    }
    @Post('import')
    async importFile(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Body() body:LearningFileImport,@Req() req:any){
        const data=await this.learning.importSource(tenantId,agentId,body,this.actor(req));
        await this.audit(req,tenantId,'source_imported','learning_source',{agentId,kind:'file',...data});
        return {success:true,data};
    }
    /**
     * The review history of one example.
     *
     * Read-only by construction: no write verb, and the service method appends
     * nothing. Reading a decision is not itself a decision, so unlike a
     * publication or a withdrawal this writes no audit row of its own — the rows
     * it returns ARE the trail.
     */
    @Get('examples/:exampleId/reviews')
    async reviews(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,
        @Param('exampleId') exampleId:string,@Query('limit') limit?:string){
        // Bounded in the service, not here: a caller reaching the method from
        // anywhere else must get the same page, and a nonsense limit is a
        // default rather than a crash.
        return {success:true,data:await this.learning.reviewHistory(tenantId,agentId,exampleId,parseInt(limit||'',10))};
    }
    @Get('sources/:sourceId/original')
    async original(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Param('sourceId') sourceId:string){
        return {success:true,data:await this.learning.originalSource(tenantId,agentId,sourceId)};
    }
    @Post('inbox')
    async importInbox(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Body() body:{conversationId:string},@Req() req:any){
        const data=await this.learning.importInbox(tenantId,agentId,body.conversationId,this.actor(req));
        // The conversation id, never its words: an audit row outlives the erasure
        // it may one day have to explain, so it must hold nothing to erase.
        await this.audit(req,tenantId,'source_imported','learning_source',
            {agentId,kind:'inbox',conversationId:body.conversationId,...data});
        return {success:true,data};
    }
    @Post('examples/:exampleId/analyze')
    async analyze(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Param('exampleId') exampleId:string){
        return {success:true,data:await this.learning.analyze(tenantId,agentId,exampleId)};
    }
    @Post('examples/:exampleId/review')
    async review(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Param('exampleId') exampleId:string,@Body() body:LearningReview,@Req() req:any){
        const data=await this.learning.review(tenantId,agentId,exampleId,body,this.actor(req));
        await this.audit(req,tenantId,'example_reviewed','learning_example',
            {agentId,exampleId,decision:body?.decision??null});
        return {success:true,data};
    }
    @Put('examples/:exampleId/revision')
    async revise(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Param('exampleId') exampleId:string,@Body() body:{revision:number;responsePattern:string},@Req() req:any){
        const data=await this.learning.revise(tenantId,agentId,exampleId,body.revision,body.responsePattern,this.actor(req));
        await this.audit(req,tenantId,'example_revised','learning_example',{agentId,exampleId,revision:body?.revision});
        return {success:true,data};
    }
    @Post('releases')
    async createRelease(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Body() body:{exampleIds:string[]},@Req() req:any){
        const data=await this.learning.createRelease(tenantId,agentId,body.exampleIds,this.actor(req));
        await this.audit(req,tenantId,'release_created','learning_release',
            {agentId,exampleCount:body?.exampleIds?.length??0,...data});
        return {success:true,data};
    }
    @Post('releases/:releaseId/publish')
    async publish(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Param('releaseId') releaseId:string,@Body() body:{trafficPercent:number},@Req() req:any){
        const data=await this.learning.publish(tenantId,agentId,releaseId,body.trafficPercent,this.actor(req));
        await this.audit(req,tenantId,'release_published','learning_release',
            {agentId,releaseId,trafficPercent:body?.trafficPercent});
        return {success:true,data};
    }
    @Post('releases/:releaseId/rollback')
    async rollback(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Param('releaseId') releaseId:string,@Req() req:any){
        // Publishing recorded who did it and rolling back recorded nobody, which
        // is backwards: taking words out of service is the decision more likely
        // to be asked about afterwards.
        const data=await this.learning.rollback(tenantId,agentId,releaseId,this.actor(req));
        // How much came out with it. `retired_by` on the release says who, but the
        // rollback retracts descendants too, and that count lives nowhere else.
        await this.audit(req,tenantId,'release_rolled_back','learning_release',{agentId,releaseId,...data});
        return {success:true,data};
    }
    @Delete('sources/:sourceId')
    async withdraw(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Param('sourceId') sourceId:string,@Req() req:any){
        const data=await this.learning.withdrawSource(tenantId,agentId,sourceId);
        await this.audit(req,tenantId,'source_withdrawn','learning_source',{agentId,sourceId,...data});
        return {success:true,data};
    }
}
