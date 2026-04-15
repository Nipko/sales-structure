import { Controller, Get, Post, Put, Delete, Param, Body, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AlertsService } from './alerts.service';
import { ScheduledReportsService } from './scheduled-reports.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('analytics-alerts')
@Controller('analytics-config')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class AlertsController {
    constructor(
        private alerts: AlertsService,
        private reports: ScheduledReportsService,
        private prisma: PrismaService,
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
        const schema = await this.getSchema(tenantId);
        const config = await this.reports.upsertConfig(schema, tenantId, body);
        return { success: true, data: config };
    }
}
