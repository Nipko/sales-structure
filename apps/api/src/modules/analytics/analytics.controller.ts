import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ComplianceService } from './compliance.service';
import { AuditService } from './audit.service';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {

    constructor(
        private analyticsService: AnalyticsService,
        private complianceService: ComplianceService,
        private auditService: AuditService,
    ) {}

    // ---- Dashboard Endpoints ----

    @Get('dashboard/:tenantId')
    async getDashboard(@Param('tenantId') tenantId: string) {
        const data = await this.analyticsService.getDashboardMetrics(tenantId);
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

    // ---- Compliance ----

    @Get('compliance/:tenantId')
    async getComplianceStats(@Param('tenantId') tenantId: string) {
        const data = await this.complianceService.getStats(tenantId);
        return { success: true, data };
    }

    @Get('compliance/:tenantId/opt-outs')
    async getOptOuts(
        @Param('tenantId') tenantId: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        const data = await this.complianceService.getOptOuts(tenantId, parseInt(page || '1'), parseInt(limit || '50'));
        return { success: true, data };
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
