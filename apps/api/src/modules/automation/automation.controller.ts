import { Controller, Get, Post, Put, Delete, Body, Param, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AutomationService } from './automation.service';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';

@ApiTags('automation')
@Controller('automation')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class AutomationController {
    private readonly logger = new Logger(AutomationController.name);

    constructor(
        private readonly automationService: AutomationService,
        private readonly prisma: PrismaService,
    ) {}

    private async schemaFor(tenantId: string): Promise<string> {
        return this.prisma.getTenantSchemaName(tenantId);
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
}
