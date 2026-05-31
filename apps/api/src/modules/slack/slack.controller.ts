import { Controller, Get, Put, Post, Param, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SlackService, SlackConfig } from './slack.service';

@Controller('slack')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class SlackController {
    constructor(private readonly slack: SlackService) {}

    @Get(':tenantId/config')
    @Roles('super_admin', 'tenant_admin')
    async getConfig(@Param('tenantId') tenantId: string) {
        const data = await this.slack.getConfig(tenantId);
        return { success: true, data };
    }

    @Put(':tenantId/config')
    @Roles('super_admin', 'tenant_admin')
    async updateConfig(@Param('tenantId') tenantId: string, @Body() body: Partial<SlackConfig>) {
        const data = await this.slack.updateConfig(tenantId, body);
        return { success: true, data };
    }

    @Post(':tenantId/test')
    @Roles('super_admin', 'tenant_admin')
    async test(@Param('tenantId') tenantId: string) {
        const data = await this.slack.sendTest(tenantId);
        return { success: true, data };
    }
}
