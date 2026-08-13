import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AgentQualityService } from './agent-quality.service';
import { QualityService } from './quality.service';

@Controller('quality')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class QualityController {
    constructor(
        private readonly quality: QualityService,
        private readonly agentQuality: AgentQualityService,
    ) {}

    private resolveRange(start?: string, end?: string): { startDate: string; endDate: string } {
        if (start && end) return { startDate: start, endDate: end };
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        return { startDate: startDate.toISOString(), endDate: endDate.toISOString() };
    }

    @Get(':tenantId/agents')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async listAgents(@Param('tenantId') tenantId: string) {
        const data = await this.agentQuality.listAgents(tenantId);
        return { success: true, data };
    }

    @Get(':tenantId/agents/:agentId/overview')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async getAgentOverview(
        @Param('tenantId') tenantId: string,
        @Param('agentId') agentId: string,
    ) {
        const data = await this.agentQuality.getOverview(tenantId, agentId);
        return { success: true, data };
    }

    @Get(':tenantId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async getSummary(
        @Param('tenantId') tenantId: string,
        @Query('start') start?: string,
        @Query('end') end?: string,
    ) {
        const { startDate, endDate } = this.resolveRange(start, end);
        const data = await this.quality.getQualitySummary(tenantId, startDate, endDate);
        return { success: true, data };
    }

    @Get(':tenantId/flagged')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async getFlagged(
        @Param('tenantId') tenantId: string,
        @Query('start') start?: string,
        @Query('end') end?: string,
        @Query('limit') limit?: string,
    ) {
        const { startDate, endDate } = this.resolveRange(start, end);
        const data = await this.quality.getFlagged(tenantId, startDate, endDate, parseInt(limit || '50') || 50);
        return { success: true, data };
    }
}
