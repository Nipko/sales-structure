import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AgentAnalyticsService } from './agent-analytics.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';

@Controller('agent-analytics')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class AgentAnalyticsController {
    constructor(private analyticsService: AgentAnalyticsService) { }

    @Get('overview/:tenantId')
    async getOverview(@Param('tenantId') tenantId: string) {
        const stats = await this.analyticsService.getOverviewStats(tenantId);
        return { success: true, data: stats };
    }

    @Get('agents/:tenantId')
    async getLeaderboard(@Param('tenantId') tenantId: string) {
        const agents = await this.analyticsService.getAgentLeaderboard(tenantId);
        return { success: true, data: agents };
    }

    @Get('csat/:tenantId')
    async getCSATResponses(
        @Param('tenantId') tenantId: string,
        @Query('limit') limit: string,
    ) {
        const responses = await this.analyticsService.getCSATResponses(tenantId, parseInt(limit) || 50);
        return { success: true, data: responses };
    }

    @Get('csat/:tenantId/distribution')
    async getCSATDistribution(@Param('tenantId') tenantId: string) {
        const dist = await this.analyticsService.getCSATDistribution(tenantId);
        return { success: true, data: dist };
    }

    @Post('csat/:tenantId')
    async submitCSAT(
        @Param('tenantId') tenantId: string,
        @Body() body: {
            conversationId: string; contactId: string; agentId: string;
            rating: number; feedback?: string;
        },
    ) {
        await this.analyticsService.submitCSAT(tenantId, body);
        return { success: true, message: 'CSAT submitted' };
    }

    // ---- Enhanced Analytics Endpoints ----

    @Get(':tenantId/channels')
    async getChannelStats(
        @Param('tenantId') tenantId: string,
        @Query('start') start: string,
        @Query('end') end: string,
    ) {
        const data = await this.analyticsService.getChannelStats(tenantId, start, end);
        return { success: true, data };
    }

    @Get(':tenantId/csat')
    async getCSATReport(
        @Param('tenantId') tenantId: string,
        @Query('start') start: string,
        @Query('end') end: string,
    ) {
        const data = await this.analyticsService.getCSATReport(tenantId, start, end);
        return { success: true, data };
    }

    @Get(':tenantId/overview-series')
    async getOverviewTimeSeries(
        @Param('tenantId') tenantId: string,
        @Query('start') start: string,
        @Query('end') end: string,
    ) {
        const data = await this.analyticsService.getOverviewTimeSeries(tenantId, start, end);
        return { success: true, data };
    }

    @Get(':tenantId/performance')
    async getAgentPerformance(
        @Param('tenantId') tenantId: string,
        @Query('start') start: string,
        @Query('end') end: string,
    ) {
        const data = await this.analyticsService.getAgentPerformance(tenantId, start, end);
        return { success: true, data };
    }
}
