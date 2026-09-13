import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AgentPublicationService } from './agent-publication.service';
import type { PublishAgentConfiguration, RollbackAgentConfiguration } from './agent-publication-store';

/**
 * Publication and rollback of an approved candidate.
 *
 * Everything the request carries is a CAS expectation, never the change itself:
 * the version and hash the caller believes are serving, the candidate version it
 * reviewed and the hash of the evidence it approved. The configuration comes
 * from the stored revision, so a payload cannot smuggle one in, and a stale
 * expectation is a conflict rather than a silent overwrite of somebody else's
 * publication.
 */
@Controller('agent-publications/:tenantId/agents/:agentId')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class AgentPublicationController {
    constructor(private readonly publications: AgentPublicationService) {}

    private actor(req: any) {
        return { id: req.user?.sub ?? req.user?.id, role: req.user?.role,
            isImpersonation: req.user?.isImpersonation, impersonatedBy: req.user?.impersonatedBy };
    }

    @Get()
    @Roles('tenant_admin', 'tenant_supervisor', 'super_admin')
    async history(@Param('tenantId') tenantId: string, @Param('agentId') agentId: string,
        @Query('limit') limit: string, @Req() req: any) {
        return { success: true, data: await this.publications.history(
            tenantId, agentId, this.actor(req), limit ? Number(limit) : undefined) };
    }

    @Post('candidates/:candidateId')
    @Roles('tenant_admin', 'super_admin')
    async publish(@Param('tenantId') tenantId: string, @Param('agentId') agentId: string,
        @Param('candidateId') candidateId: string, @Body() body: PublishAgentConfiguration, @Req() req: any) {
        return { success: true, data: await this.publications.publish(
            tenantId, agentId, candidateId, body, this.actor(req)) };
    }

    @Post('rollback')
    @Roles('tenant_admin', 'super_admin')
    async rollback(@Param('tenantId') tenantId: string, @Param('agentId') agentId: string,
        @Body() body: RollbackAgentConfiguration, @Req() req: any) {
        return { success: true, data: await this.publications.rollback(
            tenantId, agentId, body, this.actor(req)) };
    }
}
