import { Controller, Get, Put, Param, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { MediaThrottleService } from './media-throttle.service';

@Controller('media-processing')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class MediaProcessingController {

    constructor(private readonly mediaThrottle: MediaThrottleService) {}

    @Get(':tenantId/usage')
    @Roles('super_admin', 'tenant_admin')
    async getUsage(@Param('tenantId') tenantId: string) {
        const stats = await this.mediaThrottle.getUsageStats(tenantId);
        return { success: true, data: stats };
    }
}
