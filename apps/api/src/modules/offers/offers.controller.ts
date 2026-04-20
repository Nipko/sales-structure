import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OffersService, UpsertOfferInput } from './offers.service';

@Controller('offers')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class OffersController {
    constructor(private readonly service: OffersService) {}

    @Get(':tenantId')
    @Roles('super_admin', 'tenant_admin', 'tenant_agent')
    async list(
        @Param('tenantId') tenantId: string,
        @Query('activeOnly') activeOnly?: string,
    ) {
        const offers = activeOnly === 'true'
            ? await this.service.listActive(tenantId)
            : await this.service.list(tenantId);
        return { success: true, data: offers };
    }

    @Get(':tenantId/:id')
    @Roles('super_admin', 'tenant_admin', 'tenant_agent')
    async get(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        const offer = await this.service.get(tenantId, id);
        return { success: true, data: offer };
    }

    @Post(':tenantId')
    @Roles('super_admin', 'tenant_admin')
    async create(@Param('tenantId') tenantId: string, @Body() body: UpsertOfferInput) {
        const offer = await this.service.create(tenantId, body);
        return { success: true, data: offer };
    }

    @Put(':tenantId/:id')
    @Roles('super_admin', 'tenant_admin')
    async update(
        @Param('tenantId') tenantId: string,
        @Param('id') id: string,
        @Body() body: Partial<UpsertOfferInput>,
    ) {
        const offer = await this.service.update(tenantId, id, body);
        return { success: true, data: offer };
    }

    @Delete(':tenantId/:id')
    @Roles('super_admin', 'tenant_admin')
    async delete(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        await this.service.delete(tenantId, id);
        return { success: true };
    }
}
