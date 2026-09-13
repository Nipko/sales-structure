import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { QualityRegressionService } from './quality-regression.service';
import type { RegressionProposal, RegressionReview, RegressionScope } from './quality-regression-contracts';
import type { RegressionSourceKind } from './quality-regression-source';

@Controller('quality/:tenantId/agents/:agentId/regressions')
@UseGuards(AuthGuard('jwt'),RolesGuard,TenantGuard)
@Roles('super_admin','tenant_admin','tenant_supervisor')
export class QualityRegressionController {
    constructor(private readonly regressions:QualityRegressionService){}
    @Get('options') async options(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string){return {success:true,data:await this.regressions.options(tenantId,agentId)};}
    @Get('metrics') async metrics(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,
        @Query('start') start?:string,@Query('end') end?:string){return {success:true,data:await this.regressions.metrics(tenantId,agentId,start,end)};}
    @Get('sources') async sources(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string){
        return {success:true,data:await this.regressions.sources(tenantId,agentId)};
    }
    @Get() async list(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string){return {success:true,data:await this.regressions.list(tenantId,agentId)};}
    @Post() async propose(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,
        @Body() body:{kind:RegressionSourceKind;evidenceId:string},@Req() req:any){
        return {success:true,data:await this.regressions.propose(tenantId,agentId,body,req.user?.sub||req.user?.id)};
    }
    @Patch(':caseId') async edit(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Param('caseId') caseId:string,
        @Body() body:{expectedRevision:number;proposal:RegressionProposal;scope:RegressionScope},@Req() req:any){
        return {success:true,data:await this.regressions.edit(tenantId,agentId,caseId,body,req.user?.sub||req.user?.id)};
    }
    @Post(':caseId/review') async review(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Param('caseId') caseId:string,
        @Body() body:RegressionReview,@Req() req:any){
        return {success:true,data:await this.regressions.review(tenantId,agentId,caseId,body,req.user?.sub||req.user?.id)};
    }
}
