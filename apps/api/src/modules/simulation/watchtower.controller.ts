import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { WatchtowerService } from './watchtower.service';

@Controller('quality-sampling')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class WatchtowerController {
    constructor(private readonly sampling: WatchtowerService) {}

    @Get(':tenantId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async report(@Param('tenantId') tenantId: string, @Query('day') day?: string) {
        return { success: true, data: await this.sampling.report(tenantId, day) };
    }
}
