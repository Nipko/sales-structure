import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ComplianceService } from './compliance.service';
import { AuditService } from './audit.service';
import { AnalyticsService } from './analytics.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';

@Controller('analytics')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class AnalyticsController {

    constructor(
        private analyticsService: AnalyticsService,
        private complianceService: ComplianceService,
        private auditService: AuditService,
    ) {}

    // ---- Dashboard Endpoints ----

    @Get('commercial-overview/:tenantId')
    async getCommercialOverview(@Param('tenantId') tenantId: string) {
        const data = await this.analyticsService.getCommercialOverview(tenantId);
        return { success: true, data };
    }

    @Get('dashboard/:tenantId')
    async getDashboard(@Param('tenantId') tenantId: string) {
        const data = await this.analyticsService.getDashboardMetrics(tenantId);
        return { success: true, data };
    }

    @Get('pipeline/:tenantId')
    async getPipelineFunnel(@Param('tenantId') tenantId: string) {
        const data = await this.analyticsService.getPipelineFunnel(tenantId);
        return { success: true, data };
    }

    @Get('conversations/:tenantId')
    async getConversationMetrics(
        @Param('tenantId') tenantId: string,
        @Query('days') days?: string,
    ) {
        const data = await this.analyticsService.getConversationMetrics(tenantId, parseInt(days || '30'));
        return { success: true, data };
    }

    @Get('crm/:tenantId')
    async getCrmStats(@Param('tenantId') tenantId: string) {
        const data = await this.analyticsService.getCrmStats(tenantId);
        return { success: true, data };
    }

    @Get('whatsapp/:tenantId')
    async getWhatsappStats(@Param('tenantId') tenantId: string) {
        const data = await this.analyticsService.getWhatsappStats(tenantId);
        return { success: true, data };
    }

    @Get('ai/:tenantId')
    async getAiStats(@Param('tenantId') tenantId: string) {
        const data = await this.analyticsService.getAiStats(tenantId);
        return { success: true, data };
    }

    @Get('campaigns/:tenantId')
    async getCampaignAnalytics(@Param('tenantId') tenantId: string) {
        const data = await this.analyticsService.getCampaignAnalytics(tenantId);
        return { success: true, data };
    }

    @Get('funnel/:tenantId')
    async getConversionFunnel(@Param('tenantId') tenantId: string) {
        const data = await this.analyticsService.getConversionFunnel(tenantId);
        return { success: true, data };
    }

    // ---- Compliance ----

    @Get('compliance/:tenantId')
    async getComplianceStats(@Param('tenantId') tenantId: string) {
        const data = await this.complianceService.getStats(tenantId);
        return { success: true, data };
    }

    @Get('compliance/:tenantId/opt-outs')
    async getOptOuts(
        @Param('tenantId') tenantId: string,
        @Query('status') status?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        const result = await this.complianceService.getOptOuts(tenantId, status, parseInt(page || '1'), parseInt(limit || '50'));
        return { success: true, data: result.data, total: result.total };
    }

    @Post('compliance/:tenantId/opt-out')
    async registerOptOut(
        @Param('tenantId') tenantId: string,
        @Body() body: {
            leadId?: string;
            phone?: string;
            channel: string;
            triggerMessage: string;
            detectedFrom: 'ai' | 'keyword' | 'manual';
        },
    ) {
        await this.complianceService.processOptOut(tenantId, body);
        return { success: true, message: 'Opt-out registered' };
    }

    @Get('compliance/:tenantId/check/:phoneOrLeadId')
    async checkBlocked(
        @Param('tenantId') tenantId: string,
        @Param('phoneOrLeadId') phoneOrLeadId: string,
    ) {
        const isBlocked = await this.complianceService.isBlocked(tenantId, phoneOrLeadId);
        return { success: true, isBlocked };
    }

    // ---- Audit Logs ----

    @Get('audit/:tenantId')
    async getAuditLogs(
        @Param('tenantId') tenantId: string,
        @Query('action') action?: string,
        @Query('resourceType') resourceType?: string,
        @Query('resourceId') resourceId?: string,
        @Query('actorId') actorId?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        const logs = await this.auditService.getLogs(tenantId, {
            action, resourceType, resourceId, actorId,
            page: parseInt(page || '1'),
            limit: parseInt(limit || '50'),
        });
        return { success: true, data: logs };
    }
}
