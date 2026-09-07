import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OperationalNoticeService } from './operational-notice.service';

@Controller('operational-notices')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class OperationalNoticeController {
    constructor(private readonly notices: OperationalNoticeService) {}

    @Get(':tenantId')
    @Roles('super_admin','tenant_admin','tenant_supervisor')
    async list(@Param('tenantId') tenantId:string) {
        return {success:true,data:await this.notices.list(tenantId)};
    }
}
