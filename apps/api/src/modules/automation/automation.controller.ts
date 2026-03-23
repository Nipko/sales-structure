import { Controller, Get, Post, Put, Delete, Body, Param, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AutomationService } from './automation.service';

@ApiTags('automation')
@Controller('automation')
export class AutomationController {
    private readonly logger = new Logger(AutomationController.name);

    constructor(private readonly automationService: AutomationService) {}

    @Get('rules/:tenantId')
    @ApiOperation({ summary: 'List all automation rules for a tenant' })
    async getRules(@Param('tenantId') tenantId: string) {
        const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;
        return this.automationService.getRules(schemaName);
    }

    @Post('rules/:tenantId')
    @ApiOperation({ summary: 'Create a new automation rule' })
    async createRule(
        @Param('tenantId') tenantId: string,
        @Body() payload: any
    ) {
        const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;
        return this.automationService.createRule(schemaName, { ...payload, tenant_id: tenantId });
    }
}
