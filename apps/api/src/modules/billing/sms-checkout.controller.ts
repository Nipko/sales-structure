import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { SmsCheckoutService } from './sms-checkout.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';

/**
 * Tenant-facing SMS package purchase endpoints. Lives under the same
 * `sms-credits` route prefix as the read/admin endpoints. The write route is
 * intentionally retained so clients receive the explicit product/rail
 * retirement response from SmsCheckoutService instead of a missing route.
 */
@Controller('sms-credits')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class SmsCheckoutController {
    constructor(private readonly checkout: SmsCheckoutService) { }

    /** Start a package purchase when the SMS product and its checkout rail exist. */
    @Post(':tenantId/checkout')
    @Roles('super_admin', 'tenant_admin')
    async createCheckout(@Param('tenantId') tenantId: string, @Body() body: { packageId: string }) {
        if (!body?.packageId) return { success: false, error: 'packageId es obligatorio' };
        try {
            const data = await this.checkout.createCheckout(tenantId, body.packageId);
            return { success: true, data };
        } catch (e: any) {
            return { success: false, error: e?.response?.message || e?.message || 'No se pudo iniciar la compra' };
        }
    }

    /** Purchase history for the tenant. */
    @Get(':tenantId/orders')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async listOrders(@Param('tenantId') tenantId: string, @Query('limit') limit?: string) {
        const data = await this.checkout.listOrders(tenantId, limit ? parseInt(limit, 10) : 20);
        return { success: true, data };
    }
}
