import { Controller, Get, GoneException, Put, Body, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SmsNotificationsService, SmsNotificationsConfig } from './sms-notifications.service';
import { RequiresVerifiedEmail } from '../../common/decorators/requires-verified-email.decorator';

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
    @RequiresVerifiedEmail('send_outbound')
    async updateConfig(@Param('tenantId') tenantId: string, @Body() body: Partial<SmsNotificationsConfig>) {
        if (body.enabled === true && !(await this.service.getConfig(tenantId)).enabled) {
            throw new GoneException({
                error: 'sms_product_retired',
                operation: 'enable_notifications',
                message: 'No se admiten activaciones nuevas de notificaciones SMS.',
            });
        }
        const data = await this.service.updateConfig(tenantId, body);
        return { success: true, data };
    }
}
