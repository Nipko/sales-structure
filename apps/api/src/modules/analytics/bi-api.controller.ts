import { Controller, Get, Param, Query, Headers, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardAnalyticsService } from './dashboard-analytics.service';

/**
 * BI API: External-facing analytics endpoints authenticated via API key.
 * No JWT required — designed for Grafana, Metabase, custom BI dashboards.
 *
 * API key is stored in tenant.settings.biApiKey
 * Header: X-API-Key: <key>
 */
@ApiTags('bi-api')
@Controller('bi-api')
export class BIApiController {
    constructor(
        private prisma: PrismaService,
        private dashboardAnalytics: DashboardAnalyticsService,
    ) { }

    private async validateApiKey(apiKey: string | undefined): Promise<string> {
        if (!apiKey) throw new UnauthorizedException('X-API-Key header required');

        const tenant = await this.prisma.tenant.findFirst({
            where: {
                isActive: true,
                settings: { path: ['biApiKey'], equals: apiKey },
            },
            select: { id: true },
        });

        if (!tenant) throw new UnauthorizedException('Invalid API key');
        return tenant.id;
    }

    @Get('kpis')
    @ApiOperation({ summary: 'BI: Get KPIs with period comparison' })
    async getKPIs(
        @Headers('x-api-key') apiKey: string,
        @Query('start') start: string,
        @Query('end') end: string,
    ) {
        const tenantId = await this.validateApiKey(apiKey);
        const result = await this.dashboardAnalytics.getOverviewKPIs(tenantId, start, end);
        return { success: true, data: result };
    }

    @Get('time-series')
    @ApiOperation({ summary: 'BI: Conversation volume time series' })
    async getTimeSeries(
        @Headers('x-api-key') apiKey: string,
        @Query('start') start: string,
        @Query('end') end: string,
    ) {
        const tenantId = await this.validateApiKey(apiKey);
        const result = await this.dashboardAnalytics.getConversationsVolume(tenantId, start, end);
        return { success: true, data: result };
    }

    @Get('ai-metrics')
    @ApiOperation({ summary: 'BI: AI resolution, containment, cost metrics' })
    async getAIMetrics(
        @Headers('x-api-key') apiKey: string,
        @Query('start') start: string,
        @Query('end') end: string,
    ) {
        const tenantId = await this.validateApiKey(apiKey);
        const result = await this.dashboardAnalytics.getAIMetrics(tenantId, start, end);
        return { success: true, data: result };
    }

    @Get('realtime')
    @ApiOperation({ summary: 'BI: Real-time stats (active convos, agents, queue)' })
    async getRealtime(@Headers('x-api-key') apiKey: string) {
        const tenantId = await this.validateApiKey(apiKey);
        const result = await this.dashboardAnalytics.getRealtime(tenantId);
        return { success: true, data: result };
    }

    @Get('export')
    @ApiOperation({ summary: 'BI: Full data export (KPIs + time series + AI + channels)' })
    async getFullExport(
        @Headers('x-api-key') apiKey: string,
        @Query('start') start: string,
        @Query('end') end: string,
    ) {
        const tenantId = await this.validateApiKey(apiKey);
        const result = await this.dashboardAnalytics.getBIData(tenantId, start, end);
        return { success: true, data: result };
    }

    @Get('anomalies')
    @ApiOperation({ summary: 'BI: Detected anomalies (z-score > 2)' })
    async getAnomalies(@Headers('x-api-key') apiKey: string) {
        const tenantId = await this.validateApiKey(apiKey);
        const result = await this.dashboardAnalytics.getAnomalies(tenantId);
        return { success: true, data: result };
    }

    @Get('cohorts')
    @ApiOperation({ summary: 'BI: Cohort retention analysis' })
    async getCohorts(
        @Headers('x-api-key') apiKey: string,
        @Query('months') months?: string,
    ) {
        const tenantId = await this.validateApiKey(apiKey);
        const result = await this.dashboardAnalytics.getCohortAnalysis(tenantId, Number(months) || 6);
        return { success: true, data: result };
    }
}
