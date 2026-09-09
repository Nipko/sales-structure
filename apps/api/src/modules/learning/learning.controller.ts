import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { LearningService } from './learning.service';
import type { LearningFileImport, LearningReview } from './learning-contracts';

@ApiTags('learning')
@Controller('learning/:tenantId/:agentId')
@Roles('tenant_admin','tenant_supervisor','super_admin')
@UseGuards(AuthGuard('jwt'),RolesGuard,TenantGuard)
export class LearningController {
    constructor(private readonly learning:LearningService) {}
    private actor(req:any){return String(req.user.id||req.user.sub);}

    @Get()
    async list(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string){
        return {success:true,data:await this.learning.list(tenantId,agentId)};
    }
    @Post('import')
    async importFile(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Body() body:LearningFileImport,@Req() req:any){
        return {success:true,data:await this.learning.importSource(tenantId,agentId,body,this.actor(req))};
    }
    @Get('sources/:sourceId/original')
    async original(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Param('sourceId') sourceId:string){
        return {success:true,data:await this.learning.originalSource(tenantId,agentId,sourceId)};
    }
    @Post('inbox')
    async importInbox(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Body() body:{conversationId:string},@Req() req:any){
        return {success:true,data:await this.learning.importInbox(tenantId,agentId,body.conversationId,this.actor(req))};
    }
    @Post('examples/:exampleId/analyze')
    async analyze(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Param('exampleId') exampleId:string){
        return {success:true,data:await this.learning.analyze(tenantId,agentId,exampleId)};
    }
    @Post('examples/:exampleId/review')
    async review(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Param('exampleId') exampleId:string,@Body() body:LearningReview,@Req() req:any){
        return {success:true,data:await this.learning.review(tenantId,agentId,exampleId,body,this.actor(req))};
    }
    @Put('examples/:exampleId/revision')
    async revise(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Param('exampleId') exampleId:string,@Body() body:{revision:number;responsePattern:string},@Req() req:any){
        return {success:true,data:await this.learning.revise(tenantId,agentId,exampleId,body.revision,body.responsePattern,this.actor(req))};
    }
    @Post('releases')
    async createRelease(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Body() body:{exampleIds:string[]},@Req() req:any){
        return {success:true,data:await this.learning.createRelease(tenantId,agentId,body.exampleIds,this.actor(req))};
    }
    @Post('releases/:releaseId/publish')
    async publish(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Param('releaseId') releaseId:string,@Body() body:{trafficPercent:number},@Req() req:any){
        return {success:true,data:await this.learning.publish(tenantId,agentId,releaseId,body.trafficPercent,this.actor(req))};
    }
    @Post('releases/:releaseId/rollback')
    async rollback(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Param('releaseId') releaseId:string,@Req() req:any){
        // Publishing recorded who did it and rolling back recorded nobody, which
        // is backwards: taking words out of service is the decision more likely
        // to be asked about afterwards.
        return {success:true,data:await this.learning.rollback(tenantId,agentId,releaseId,this.actor(req))};
    }
    @Delete('sources/:sourceId')
    async withdraw(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Param('sourceId') sourceId:string){
        return {success:true,data:await this.learning.withdrawSource(tenantId,agentId,sourceId)};
    }
}
