import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, HttpCode, HttpStatus, ForbiddenException, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AlertsService } from './alerts.service';
import { ScheduledReportsService } from './scheduled-reports.service';
import { SavedReportsService } from './saved-reports.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';

@ApiTags('analytics-alerts')
@Controller('analytics-config')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class AlertsController {
    constructor(
        private alerts: AlertsService,
        private reports: ScheduledReportsService,
        private savedReports: SavedReportsService,
        private prisma: PrismaService,
        private throttle: TenantThrottleService,
    ) { }

    private async getSchema(tenantId: string): Promise<string> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { schemaName: true },
        });
        return tenant?.schemaName || '';
    }

    // ── Alert Rules ──────────────────────────────────────────────

    @Get('alerts/:tenantId')
    @ApiOperation({ summary: 'List alert rules' })
    async getAlerts(@Param('tenantId') tenantId: string) {
        const schema = await this.getSchema(tenantId);
        const rules = await this.alerts.getRules(schema, tenantId);
        return { success: true, data: rules };
    }

    @Post('alerts/:tenantId')
    @Roles('tenant_admin', 'super_admin')
    @ApiOperation({ summary: 'Create alert rule' })
    async createAlert(
        @Param('tenantId') tenantId: string,
        @Body() body: {
            name: string; metric: string; operator: string; threshold: number;
            channel?: string; notifyEmails?: string[]; cooldownMinutes?: number;
        },
    ) {
        const schema = await this.getSchema(tenantId);
        const rule = await this.alerts.createRule(schema, tenantId, body);
        return { success: true, data: rule };
    }

    @Put('alerts/:tenantId/:ruleId')
    @Roles('tenant_admin', 'super_admin')
    @ApiOperation({ summary: 'Update alert rule' })
    async updateAlert(
        @Param('tenantId') tenantId: string,
        @Param('ruleId') ruleId: string,
        @Body() body: any,
    ) {
        const schema = await this.getSchema(tenantId);
        const rule = await this.alerts.updateRule(schema, ruleId, body);
        return { success: true, data: rule };
    }

    @Delete('alerts/:tenantId/:ruleId')
    @Roles('tenant_admin', 'super_admin')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Delete alert rule' })
    async deleteAlert(
        @Param('tenantId') tenantId: string,
        @Param('ruleId') ruleId: string,
    ) {
        const schema = await this.getSchema(tenantId);
        await this.alerts.deleteRule(schema, ruleId);
        return { success: true };
    }

    @Get('alerts/:tenantId/:ruleId/history')
    @ApiOperation({ summary: 'Get alert trigger history' })
    async getAlertHistory(
        @Param('tenantId') tenantId: string,
        @Param('ruleId') ruleId: string,
    ) {
        const schema = await this.getSchema(tenantId);
        const history = await this.alerts.getHistory(schema, ruleId);
        return { success: true, data: history };
    }

    // ── Scheduled Reports ────────────────────────────────────────

    @Get('reports/:tenantId')
    @ApiOperation({ summary: 'Get scheduled report config' })
    async getReportConfig(@Param('tenantId') tenantId: string) {
        const enabled = await this.throttle.isFeatureEnabled(tenantId, 'scheduledReports');
        if (!enabled) {
            throw new ForbiddenException({ error: 'feature_not_available', feature: 'scheduledReports' });
        }
        const schema = await this.getSchema(tenantId);
        const config = await this.reports.getConfig(schema, tenantId);
        return { success: true, data: config };
    }

    @Post('reports/:tenantId')
    @Roles('tenant_admin', 'super_admin')
    @ApiOperation({ summary: 'Create or update scheduled report config' })
    async upsertReportConfig(
        @Param('tenantId') tenantId: string,
        @Body() body: { frequency: string; recipients: string[]; isActive: boolean },
    ) {
        const enabled = await this.throttle.isFeatureEnabled(tenantId, 'scheduledReports');
        if (!enabled) {
            throw new ForbiddenException({ error: 'feature_not_available', feature: 'scheduledReports' });
        }
        const schema = await this.getSchema(tenantId);
        const config = await this.reports.upsertConfig(schema, tenantId, body);
        return { success: true, data: config };
    }

    // ── Saved Reports (Custom Report Builder) ────────────────────

    @Get('saved-reports/:tenantId')
    @ApiOperation({ summary: 'List saved custom reports' })
    async listSavedReports(@Param('tenantId') tenantId: string) {
        const schema = await this.getSchema(tenantId);
        const reports = await this.savedReports.list(schema);
        return { success: true, data: reports };
    }

    @Get('saved-reports/:tenantId/:reportId')
    @ApiOperation({ summary: 'Get saved report by id' })
    async getSavedReport(
        @Param('tenantId') tenantId: string,
        @Param('reportId') reportId: string,
    ) {
        const schema = await this.getSchema(tenantId);
        const report = await this.savedReports.getById(schema, reportId);
        return { success: true, data: report };
    }

    @Post('saved-reports/:tenantId')
    @Roles('tenant_admin', 'super_admin')
    @ApiOperation({ summary: 'Create a custom saved report' })
    async createSavedReport(
        @Param('tenantId') tenantId: string,
        @Body() body: { name: string; description?: string; config: any },
        @Request() req: any,
    ) {
        const schema = await this.getSchema(tenantId);
        const report = await this.savedReports.create(schema, {
            ...body,
            createdBy: req.user?.id,
        });
        return { success: true, data: report };
    }

    @Put('saved-reports/:tenantId/:reportId')
    @Roles('tenant_admin', 'super_admin')
    @ApiOperation({ summary: 'Update a saved report' })
    async updateSavedReport(
        @Param('tenantId') tenantId: string,
        @Param('reportId') reportId: string,
        @Body() body: { name?: string; description?: string; config?: any; isFavorite?: boolean },
    ) {
        const schema = await this.getSchema(tenantId);
        const report = await this.savedReports.update(schema, reportId, body);
        return { success: true, data: report };
    }

    @Delete('saved-reports/:tenantId/:reportId')
    @Roles('tenant_admin', 'super_admin')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Delete a saved report' })
    async deleteSavedReport(
        @Param('tenantId') tenantId: string,
        @Param('reportId') reportId: string,
    ) {
        const schema = await this.getSchema(tenantId);
        await this.savedReports.remove(schema, reportId);
        return { success: true };
    }
}
