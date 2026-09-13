import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AgentReleaseService } from './agent-release.service';
import type { RequestAgentRelease, ReviewAgentRelease } from './agent-release-contract';

@Controller('agent-releases/:tenantId/agents/:agentId')
@UseGuards(AuthGuard('jwt'),RolesGuard,TenantGuard)
export class AgentReleaseController {
    constructor(private readonly releases:AgentReleaseService){}
    private actor(req:any){return {id:req.user?.sub??req.user?.id,role:req.user?.role};}
    @Get()
    @Roles('tenant_admin','tenant_supervisor','super_admin')
    async list(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Req() req:any){
        return {success:true,data:await this.releases.list(tenantId,agentId,this.actor(req))};
    }
    @Post()
    @Roles('tenant_admin','super_admin')
    async request(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Body() body:RequestAgentRelease,@Req() req:any){
        return {success:true,data:await this.releases.request(tenantId,agentId,body,this.actor(req))};
    }
    @Get(':candidateId')
    @Roles('tenant_admin','tenant_supervisor','super_admin')
    async read(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Param('candidateId') candidateId:string,@Req() req:any){
        return {success:true,data:await this.releases.read(tenantId,agentId,candidateId,this.actor(req))};
    }
    @Post(':candidateId/review')
    @Roles('tenant_admin','super_admin')
    async review(@Param('tenantId') tenantId:string,@Param('agentId') agentId:string,@Param('candidateId') candidateId:string,
        @Body() body:ReviewAgentRelease,@Req() req:any){return {success:true,data:await this.releases.review(tenantId,agentId,candidateId,body,this.actor(req))};}
}
