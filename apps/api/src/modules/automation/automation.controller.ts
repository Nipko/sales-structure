import { Controller, Get, Post, Put, Delete, Body, Param, Logger, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AutomationService } from './automation.service';
import { NurturingService } from './nurturing.service';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';

@ApiTags('automation')
@Controller('automation')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class AutomationController {
    private readonly logger = new Logger(AutomationController.name);

    constructor(
        private readonly automationService: AutomationService,
        private readonly nurturingService: NurturingService,
        private readonly prisma: PrismaService,
        private readonly throttle: TenantThrottleService,
    ) {}

    private async schemaFor(tenantId: string): Promise<string> {
        return this.prisma.getTenantSchemaName(tenantId);
    }

    /**
     * Gate the `http_request` automation action behind the plan's
     * httpRequestAction flag (pro+). The action is identified at runtime by
     * action.type === 'http_request' (see ActionExecutorService).
     */
    private async assertActionsAllowed(tenantId: string, payload: any): Promise<void> {
        const actions = Array.isArray(payload?.actions_json) ? payload.actions_json : [];
        const usesHttpRequest = actions.some((a: any) => a?.type === 'http_request');
        if (usesHttpRequest && !(await this.throttle.isFeatureEnabled(tenantId, 'httpRequestAction'))) {
            throw new ForbiddenException({
                error: 'feature_not_available',
                feature: 'httpRequestAction',
                message: 'La acción de solicitud HTTP no está disponible en tu plan actual. Actualizá tu plan para usarla.',
            });
        }
    }

    @Get('rules/:tenantId')
    @ApiOperation({ summary: 'List all automation rules for a tenant' })
    async getRules(@Param('tenantId') tenantId: string) {
        const schemaName = await this.schemaFor(tenantId);
        const rules = await this.automationService.getRules(schemaName);
        return { success: true, data: rules };
    }

    @Post('rules/:tenantId')
    @ApiOperation({ summary: 'Create a new automation rule' })
    async createRule(
        @Param('tenantId') tenantId: string,
        @Body() payload: any
    ) {
        const schemaName = await this.schemaFor(tenantId);

        // Plan gate — count existing active rules and reject if tier limit is reached.
        const existing = await this.automationService.getRules(schemaName);
        const activeCount = Array.isArray(existing)
            ? existing.filter((r: any) => r.active !== false).length
            : 0;
        await this.throttle.enforcePlanLimit(tenantId, 'automationRules', activeCount, 'reglas de automatización');
        await this.assertActionsAllowed(tenantId, payload);

        const created = await this.automationService.createRule(schemaName, { ...payload, tenant_id: tenantId });
        return { success: true, data: created };
    }

    @Put('rules/:tenantId/:ruleId/toggle')
    @ApiOperation({ summary: 'Toggle active state for an automation rule' })
    async toggleRule(
        @Param('tenantId') tenantId: string,
        @Param('ruleId') ruleId: string,
        @Body() payload: { isActive?: boolean },
    ) {
        const schemaName = await this.schemaFor(tenantId);
        const updated = await this.automationService.toggleRule(schemaName, ruleId, payload?.isActive);
        return { success: true, data: updated };
    }

    @Put('rules/:tenantId/:ruleId')
    @ApiOperation({ summary: 'Update an automation rule' })
    async updateRule(
        @Param('tenantId') tenantId: string,
        @Param('ruleId') ruleId: string,
        @Body() payload: any,
    ) {
        const schemaName = await this.schemaFor(tenantId);
        await this.assertActionsAllowed(tenantId, payload);
        const updated = await this.automationService.updateRule(schemaName, ruleId, payload);
        return { success: true, data: updated };
    }

    @Get('rules/:tenantId/:ruleId/executions')
    @ApiOperation({ summary: 'Get execution history for a rule' })
    async getExecutions(
        @Param('tenantId') tenantId: string,
        @Param('ruleId') ruleId: string,
    ) {
        const schemaName = await this.schemaFor(tenantId);
        const executions = await this.automationService.getExecutions(schemaName, ruleId);
        return { success: true, data: executions };
    }

    @Delete('rules/:tenantId/:ruleId')
    @ApiOperation({ summary: 'Delete an automation rule' })
    async deleteRule(
        @Param('tenantId') tenantId: string,
        @Param('ruleId') ruleId: string,
    ) {
        const schemaName = await this.schemaFor(tenantId);
        await this.automationService.deleteRule(schemaName, ruleId);
        return { success: true, message: 'Rule deleted' };
    }

    // ─── Nurturing Config ─────────────────────────────────────────────

    @Get('nurturing/:tenantId')
    @Roles('tenant_admin', 'super_admin')
    @ApiOperation({ summary: 'Get nurturing/follow-up configuration for a tenant' })
    async getNurturingConfig(@Param('tenantId') tenantId: string) {
        const config = await this.nurturingService.getNurturingConfig(tenantId);
        return { success: true, data: config };
    }

    @Put('nurturing/:tenantId')
    @Roles('tenant_admin', 'super_admin')
    @ApiOperation({ summary: 'Update nurturing/follow-up configuration' })
    async updateNurturingConfig(
        @Param('tenantId') tenantId: string,
        @Body() body: any,
    ) {
        const updated = await this.nurturingService.updateNurturingConfig(tenantId, body);
        return { success: true, data: updated };
    }
}
