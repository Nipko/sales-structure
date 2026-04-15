import { Controller, Get, Param, Query, UseGuards, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { DashboardAnalyticsService } from './dashboard-analytics.service';
import { Response } from 'express';

@ApiTags('dashboard-analytics')
@Controller('dashboard-analytics')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class DashboardAnalyticsController {
    constructor(private dashboardAnalytics: DashboardAnalyticsService) { }

    @Get('overview-kpis/:tenantId')
    @ApiOperation({ summary: 'Get 6 KPIs with period comparison' })
    async getOverviewKPIs(
        @Param('tenantId') tenantId: string,
        @Query('start') start: string,
        @Query('end') end: string,
    ) {
        const result = await this.dashboardAnalytics.getOverviewKPIs(tenantId, start, end);
        return { success: true, data: result };
    }

    @Get('conversations-volume/:tenantId')
    @ApiOperation({ summary: 'Conversation volume stacked by channel' })
    async getConversationsVolume(
        @Param('tenantId') tenantId: string,
        @Query('start') start: string,
        @Query('end') end: string,
    ) {
        const result = await this.dashboardAnalytics.getConversationsVolume(tenantId, start, end);
        return { success: true, data: result };
    }

    @Get('response-times/:tenantId')
    @ApiOperation({ summary: 'Response and resolution times (median + P90)' })
    async getResponseTimes(
        @Param('tenantId') tenantId: string,
        @Query('start') start: string,
        @Query('end') end: string,
    ) {
        const result = await this.dashboardAnalytics.getResponseTimes(tenantId, start, end);
        return { success: true, data: result };
    }

    @Get('ai-metrics/:tenantId')
    @ApiOperation({ summary: 'AI resolution rate, containment, cost, model usage' })
    async getAIMetrics(
        @Param('tenantId') tenantId: string,
        @Query('start') start: string,
        @Query('end') end: string,
    ) {
        const result = await this.dashboardAnalytics.getAIMetrics(tenantId, start, end);
        return { success: true, data: result };
    }

    @Get('heatmap/:tenantId')
    @ApiOperation({ summary: 'Message volume heatmap (day x hour)' })
    async getHeatmap(
        @Param('tenantId') tenantId: string,
        @Query('start') start: string,
        @Query('end') end: string,
    ) {
        const result = await this.dashboardAnalytics.getHeatmap(tenantId, start, end);
        return { success: true, data: result };
    }

    @Get('export/:tenantId')
    @ApiOperation({ summary: 'Export analytics report as CSV' })
    async exportReport(
        @Param('tenantId') tenantId: string,
        @Query('start') start: string,
        @Query('end') end: string,
        @Res() res: Response,
    ) {
        const csv = await this.dashboardAnalytics.exportCSV(tenantId, start, end);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=parallly-analytics-${start}-${end}.csv`);
        res.send(csv);
    }
}
