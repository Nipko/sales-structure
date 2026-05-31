import { Controller, Get, Post, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { KbHealthService } from './kb-health.service';

@Controller('kb-health')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class KbHealthController {
    constructor(private readonly kbHealth: KbHealthService) {}

    @Get(':tenantId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async getIssues(@Param('tenantId') tenantId: string, @Query('status') status?: string) {
        const data = await this.kbHealth.getIssues(tenantId, status || 'open');
        return { success: true, data };
    }

    @Post(':tenantId/scan')
    @Roles('super_admin', 'tenant_admin')
    async scan(@Param('tenantId') tenantId: string) {
        const found = await this.kbHealth.scanContradictions(tenantId);
        return { success: true, data: { found } };
    }

    @Post(':tenantId/:id/status')
    @Roles('super_admin', 'tenant_admin')
    async updateIssue(
        @Param('tenantId') tenantId: string,
        @Param('id') id: string,
        @Body() body: { status: string },
    ) {
        await this.kbHealth.updateIssue(tenantId, id, body?.status || 'open');
        return { success: true };
    }
}
