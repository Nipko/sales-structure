import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { AgentAnalyticsService } from './agent-analytics.service';

@Controller('api/v1/analytics')
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
}
