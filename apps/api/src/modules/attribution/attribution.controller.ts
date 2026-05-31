import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AttributionService } from './attribution.service';

/**
 * Attribution analytics (T3.22): CTWA ads funnel + revenue, broadcast revenue.
 */
@Controller('attribution')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class AttributionController {
    constructor(private readonly attribution: AttributionService) {}

    @Get(':tenantId/ctwa/summary')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async ctwaSummary(@Param('tenantId') tenantId: string, @Query('start') start?: string, @Query('end') end?: string) {
        return { success: true, data: await this.attribution.getCtwaSummary(tenantId, start, end) };
    }

    @Get(':tenantId/ctwa/ads')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async ctwaAds(@Param('tenantId') tenantId: string, @Query('start') start?: string, @Query('end') end?: string) {
        return { success: true, data: await this.attribution.getCtwaByAd(tenantId, start, end) };
    }

    @Get(':tenantId/broadcast/revenue')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async broadcastRevenue(@Param('tenantId') tenantId: string, @Query('start') start?: string, @Query('end') end?: string) {
        return { success: true, data: await this.attribution.getBroadcastRevenue(tenantId, start, end) };
    }
}
