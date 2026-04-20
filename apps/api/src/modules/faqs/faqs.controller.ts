import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { FaqsService, UpsertFaqInput } from './faqs.service';

@Controller('faqs')
export class FaqsController {
    constructor(private readonly service: FaqsService) {}

    /** Public — published FAQs by tenant slug (no auth). */
    @Get('public/:tenantSlug')
    async listPublic(@Param('tenantSlug') slug: string) {
        const faqs = await this.service.listPublicBySlug(slug);
        return { success: true, data: faqs };
    }

    @Get(':tenantId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin', 'tenant_admin', 'tenant_agent')
    async list(
        @Param('tenantId') tenantId: string,
        @Query('publishedOnly') publishedOnly?: string,
        @Query('category') category?: string,
    ) {
        const faqs = await this.service.list(tenantId, {
            publishedOnly: publishedOnly === 'true',
            category,
        });
        return { success: true, data: faqs };
    }

    @Get(':tenantId/:id')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin', 'tenant_admin', 'tenant_agent')
    async get(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        const faq = await this.service.get(tenantId, id);
        return { success: true, data: faq };
    }

    @Post(':tenantId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin', 'tenant_admin')
    async create(@Param('tenantId') tenantId: string, @Body() body: UpsertFaqInput) {
        const faq = await this.service.create(tenantId, body);
        return { success: true, data: faq };
    }

    @Put(':tenantId/:id')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin', 'tenant_admin')
    async update(
        @Param('tenantId') tenantId: string,
        @Param('id') id: string,
        @Body() body: Partial<UpsertFaqInput>,
    ) {
        const faq = await this.service.update(tenantId, id, body);
        return { success: true, data: faq };
    }

    @Delete(':tenantId/:id')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin', 'tenant_admin')
    async delete(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        await this.service.delete(tenantId, id);
        return { success: true };
    }
}
