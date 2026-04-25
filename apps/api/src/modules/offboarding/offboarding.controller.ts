import { Controller, Get, Post, Body, Param, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OffboardingService } from './offboarding.service';

@ApiTags('offboarding')
@Controller('offboarding')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@ApiBearerAuth()
export class OffboardingController {
    private readonly logger = new Logger(OffboardingController.name);

    constructor(private offboardingService: OffboardingService) {}

    @Post(':tenantId/cancel')
    @Roles('tenant_admin', 'super_admin')
    @ApiOperation({ summary: 'Voluntary subscription cancellation' })
    async voluntaryCancel(
        @Param('tenantId') tenantId: string,
        @Body() body: { reason?: string },
    ) {
        const result = await this.offboardingService.voluntaryCancel(tenantId, body.reason);
        return { success: true, data: result };
    }

    @Post(':tenantId/suspend')
    @Roles('super_admin')
    @ApiOperation({ summary: 'Admin suspension — immediately offboards tenant' })
    async adminSuspend(
        @Param('tenantId') tenantId: string,
        @Body() body: { reason: string },
    ) {
        await this.offboardingService.adminSuspend(tenantId, body.reason);
        return { success: true, message: `Tenant ${tenantId} suspended` };
    }

    @Get(':tenantId/status')
    @Roles('super_admin')
    @ApiOperation({ summary: 'Get offboarding status for a tenant' })
    async getStatus(@Param('tenantId') tenantId: string) {
        const status = await this.offboardingService.getOffboardingStatus(tenantId);
        return { success: true, data: status };
    }
}
