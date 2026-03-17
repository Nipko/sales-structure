import { Controller, Get, Post, Body, Query, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AnalyticsService } from './analytics.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';

@ApiTags('analytics')
@Controller('analytics')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class AnalyticsController {
    private readonly logger = new Logger(AnalyticsController.name);

    constructor(private analyticsService: AnalyticsService) { }

    @Get('dashboard')
    @ApiOperation({ summary: 'Get real-time dashboard metrics for the tenant' })
    async getDashboardMetrics(@CurrentTenant() tenantId: string) {
        const metrics = await this.analyticsService.getDashboardMetrics(tenantId);
        return { success: true, data: metrics };
    }

    @Get('overview')
    @ApiOperation({ summary: 'Get commercial overview: leads, hot leads, cost, handoffs (replaces dashboard mocks)' })
    async getCommercialOverview(@CurrentTenant() tenantId: string) {
        const data = await this.analyticsService.getCommercialOverview(tenantId);
        return { success: true, data };
    }

    @Get('range')
    @ApiOperation({ summary: 'Get metrics for a date range' })
    async getMetricsRange(
        @CurrentTenant() tenantId: string,
        @Query('start') startDate: string,
        @Query('end') endDate: string,
    ) {
        const data = await this.analyticsService.getMetricsRange(tenantId, startDate, endDate);
        return { success: true, data };
    }
}
