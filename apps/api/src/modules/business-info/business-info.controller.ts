import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { BusinessInfoService, UpsertBusinessIdentityInput } from './business-info.service';

@Controller('business-info')
export class BusinessInfoController {
    constructor(private readonly service: BusinessInfoService) {}

    /** Public endpoint (no auth) — tenant's public business card by slug. */
    @Get('public/:tenantSlug')
    async getPublic(@Param('tenantSlug') slug: string) {
        const info = await this.service.getPublicBySlug(slug);
        return { success: true, data: info };
    }

    @Get(':tenantId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin', 'tenant_admin', 'tenant_agent')
    async getPrimary(@Param('tenantId') tenantId: string) {
        const info = await this.service.getPrimary(tenantId);
        return { success: true, data: info };
    }

    @Put(':tenantId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin', 'tenant_admin')
    async upsertPrimary(
        @Param('tenantId') tenantId: string,
        @Body() body: UpsertBusinessIdentityInput,
    ) {
        const info = await this.service.upsertPrimary(tenantId, body);
        return { success: true, data: info };
    }
}
