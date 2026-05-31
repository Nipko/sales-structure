import { Controller, Get, Param, Query, UseGuards, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DashboardAnalyticsService } from './dashboard-analytics.service';
import { AiResolutionService } from './ai-resolution.service';
import { Response } from 'express';

@ApiTags('dashboard-analytics')
@Controller('dashboard-analytics')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class DashboardAnalyticsController {
    constructor(
        private dashboardAnalytics: DashboardAnalyticsService,
        private aiResolutionService: AiResolutionService,
    ) { }

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

    @Get('realtime/:tenantId')
    @ApiOperation({ summary: 'Real-time analytics: active convos, agents, queue' })
    async getRealtime(@Param('tenantId') tenantId: string) {
        const result = await this.dashboardAnalytics.getRealtime(tenantId);
        return { success: true, data: result };
    }

    @Get('automation/:tenantId')
    @ApiOperation({ summary: 'Automation rules metrics and execution stats' })
    async getAutomation(
        @Param('tenantId') tenantId: string,
        @Query('start') start: string,
        @Query('end') end: string,
    ) {
        const result = await this.dashboardAnalytics.getAutomationMetrics(tenantId, start, end);
        return { success: true, data: result };
    }

    @Get('broadcast/:tenantId')
    @ApiOperation({ summary: 'Broadcast campaign funnel analytics' })
    async getBroadcast(
        @Param('tenantId') tenantId: string,
        @Query('start') start: string,
        @Query('end') end: string,
    ) {
        const result = await this.dashboardAnalytics.getBroadcastFunnel(tenantId, start, end);
        return { success: true, data: result };
    }

    @Get('anomalies/:tenantId')
    @ApiOperation({ summary: 'Anomaly detection (z-score > 2σ on 30-day window)' })
    async getAnomalies(@Param('tenantId') tenantId: string) {
        const result = await this.dashboardAnalytics.getAnomalies(tenantId);
        return { success: true, data: result };
    }

    @Get('cohorts/:tenantId')
    @ApiOperation({ summary: 'Cohort retention analysis' })
    async getCohorts(
        @Param('tenantId') tenantId: string,
        @Query('months') months?: string,
    ) {
        const result = await this.dashboardAnalytics.getCohortAnalysis(tenantId, Number(months) || 6);
        return { success: true, data: result };
    }

    @Get('appointments/:tenantId')
    @ApiOperation({ summary: 'Appointment analytics (KPIs, daily volume, by service, by source, peak hours)' })
    async getAppointmentMetrics(
        @Param('tenantId') tenantId: string,
        @Query('start') start: string,
        @Query('end') end: string,
    ) {
        const result = await this.dashboardAnalytics.getAppointmentMetrics(tenantId, start, end);
        return { success: true, data: result };
    }

    @Get('ai-resolution/:tenantId')
    @Roles('super_admin', 'tenant_admin')
    @ApiOperation({ summary: 'AI resolution rate: stats, trend, and breakdown by channel' })
    async getAiResolution(
        @Param('tenantId') tenantId: string,
        @Query('start') start: string,
        @Query('end') end: string,
        @Query('granularity') granularity: string,
    ) {
        const [stats, rawTrend, byChannel] = await Promise.all([
            this.aiResolutionService.getResolutionStats(tenantId, start, end),
            this.aiResolutionService.getResolutionTrend(tenantId, start, end, (granularity as any) || 'day'),
            this.aiResolutionService.getResolutionByChannel(tenantId, start, end),
        ]);

        // Map to the shape consumed by the dashboard widget (AiResolutionWidget):
        // it reads `summary` + `trend` with `date`/`aiResolutionRate` fields.
        const summary = {
            totalConversations: stats.total,
            aiResolved: stats.aiResolved,
            agentResolved: stats.agentResolved,
            autoResolved: stats.autoResolved,
            unresolved: stats.unresolved,
            aiResolutionRate: stats.aiResolutionRate,
            avgMessages: stats.avgMessagesToResolution,
            avgMessagesBeforeHandoff: stats.avgAiMessagesBeforeHandoff,
        };

        const trend = (rawTrend || []).map((r: any) => {
            // `period` is a timestamptz text (e.g. "2026-05-01 00:00:00+00"); normalize to YYYY-MM-DD.
            let date = r.period as string;
            try {
                date = new Date(r.period).toISOString().slice(0, 10);
            } catch {
                date = (r.period || '').slice(0, 10);
            }
            return {
                date,
                period: r.period,
                aiResolutionRate: r.rate,
                rate: r.rate,
                aiResolved: r.aiResolved,
                agentResolved: r.agentResolved,
                autoResolved: 0,
                total: r.total,
            };
        });

        // Return both `summary` (widget contract) and `stats` (back-compat) for safety.
        return { success: true, data: { summary, stats, trend, byChannel } };
    }
}
