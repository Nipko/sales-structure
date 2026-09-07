import { Controller, Get, Post, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { KbHealthService } from './kb-health.service';
import { KnowledgeConflictService } from './knowledge-conflict.service';
import type { ConflictReviewInput } from './knowledge-conflict.contracts';

@Controller('kb-health')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class KbHealthController {
    constructor(private readonly kbHealth: KbHealthService, private readonly conflicts: KnowledgeConflictService) {}

    @Get(':tenantId/conflicts')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async conflictsOverview(@Param('tenantId') tenantId: string) {
        return {success:true,data:await this.conflicts.overview(tenantId)};
    }

    @Post(':tenantId/conflicts/scan')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async scanEvidence(@Param('tenantId') tenantId: string, @Body() input: {language?:string}) {
        return {success:true,data:await this.conflicts.scan(tenantId,input?.language)};
    }

    @Post(':tenantId/conflicts/:caseId/review')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async reviewConflict(@Param('tenantId') tenantId: string, @Param('caseId') caseId: string, @Req() req: any, @Body() input: ConflictReviewInput) {
        return {success:true,data:await this.conflicts.review(tenantId,caseId,req.user.sub || req.user.id,input)};
    }

    @Get(':tenantId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async getIssues(@Param('tenantId') tenantId: string, @Query('status') status?: string) {
        const data = await this.kbHealth.getIssues(tenantId, status || 'open');
        return { success: true, data };
    }

    @Post(':tenantId/scan')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async scan(@Param('tenantId') tenantId: string) {
        const report = await this.conflicts.scan(tenantId);
        return { success: true, data: {...report,found:report.newIssues} };
    }

    @Post(':tenantId/:id/status')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async updateIssue(
        @Param('tenantId') tenantId: string,
        @Param('id') id: string,
        @Body() body: { status: string },
    ) {
        await this.kbHealth.updateIssue(tenantId, id, body?.status || 'open');
        return { success: true };
    }
}
