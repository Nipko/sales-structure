import { Controller, Get, Put, Body, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SmsNotificationsService, SmsNotificationsConfig } from './sms-notifications.service';

@Controller('sms-notifications')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class SmsNotificationsController {
    constructor(private readonly service: SmsNotificationsService) {}

    @Get(':tenantId/config')
    @Roles('super_admin', 'tenant_admin')
    async getConfig(@Param('tenantId') tenantId: string) {
        const data = await this.service.getConfig(tenantId);
        return { success: true, data };
    }

    @Put(':tenantId/config')
    @Roles('super_admin', 'tenant_admin')
    async updateConfig(@Param('tenantId') tenantId: string, @Body() body: Partial<SmsNotificationsConfig>) {
        const data = await this.service.updateConfig(tenantId, body);
        return { success: true, data };
    }
}
