import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DashboardAnalyticsService } from './dashboard-analytics.service';
import { BiApiGuard } from './bi-api.guard';

/**
 * BI API: External-facing analytics endpoints authenticated via API key.
 * No JWT required — designed for Grafana, Metabase, custom BI dashboards.
 *
 * API keys use the hashed, revocable Public API key store and require the
 * `read:analytics` scope. Legacy tenant.settings.biApiKey values must be
 * migrated before this surface is promoted.
 * Header: X-API-Key: <key>
 */
@ApiTags('bi-api')
@Controller('bi-api')
@UseGuards(BiApiGuard)
export class BIApiController {
    constructor(
        private dashboardAnalytics: DashboardAnalyticsService,
    ) { }

    @Get('kpis')
    @ApiOperation({ summary: 'BI: Get KPIs with period comparison' })
    async getKPIs(
        @Req() req: any,
        @Query('start') start: string,
        @Query('end') end: string,
    ) {
        const result = await this.dashboardAnalytics.getOverviewKPIs(req.tenantId, start, end);
        return { success: true, data: result };
    }

    @Get('time-series')
    @ApiOperation({ summary: 'BI: Conversation volume time series' })
    async getTimeSeries(
        @Req() req: any,
        @Query('start') start: string,
        @Query('end') end: string,
    ) {
        const result = await this.dashboardAnalytics.getConversationsVolume(req.tenantId, start, end);
        return { success: true, data: result };
    }

    @Get('ai-metrics')
    @ApiOperation({ summary: 'BI: AI resolution, containment, cost metrics' })
    async getAIMetrics(
        @Req() req: any,
        @Query('start') start: string,
        @Query('end') end: string,
    ) {
        const result = await this.dashboardAnalytics.getAIMetrics(req.tenantId, start, end);
        return { success: true, data: result };
    }

    @Get('channel-accounts')
    @ApiOperation({ summary: 'BI: Metrics attributed to operational channel accounts' })
    async getChannelAccounts(
        @Req() req: any,
        @Query('start') start: string,
        @Query('end') end: string,
        @Query('channelType') channelType?: string,
    ) {
        const result = await this.dashboardAnalytics.getChannelAccountBreakdown(req.tenantId, start, end, channelType);
        return { success: true, data: result };
    }

    @Get('realtime')
    @ApiOperation({ summary: 'BI: Real-time stats (active convos, agents, queue)' })
    async getRealtime(@Req() req: any) {
        const result = await this.dashboardAnalytics.getRealtime(req.tenantId);
        return { success: true, data: result };
    }

    @Get('export')
    @ApiOperation({ summary: 'BI: Full data export (KPIs + time series + AI + channels)' })
    async getFullExport(
        @Req() req: any,
        @Query('start') start: string,
        @Query('end') end: string,
    ) {
        const result = await this.dashboardAnalytics.getBIData(req.tenantId, start, end);
        return { success: true, data: result };
    }

    @Get('anomalies')
    @ApiOperation({ summary: 'BI: Detected anomalies (z-score > 2)' })
    async getAnomalies(@Req() req: any) {
        const result = await this.dashboardAnalytics.getAnomalies(req.tenantId);
        return { success: true, data: result };
    }

    @Get('cohorts')
    @ApiOperation({ summary: 'BI: Cohort retention analysis' })
    async getCohorts(
        @Req() req: any,
        @Query('months') months?: string,
    ) {
        const result = await this.dashboardAnalytics.getCohortAnalysis(req.tenantId, Number(months) || 6);
        return { success: true, data: result };
    }
}
