import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PoliciesService, UpsertPolicyInput } from './policies.service';
import type { PolicyType } from '@parallext/shared';

@Controller('policies')
export class PoliciesController {
    constructor(private readonly service: PoliciesService) {}

    /** Public — active policy by tenant slug + type (no auth). */
    @Get('public/:tenantSlug/:type')
    async getPublic(
        @Param('tenantSlug') slug: string,
        @Param('type') type: PolicyType,
    ) {
        const policy = await this.service.getPublicBySlug(slug, type);
        return { success: true, data: policy };
    }

    @Get(':tenantId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin', 'tenant_admin', 'tenant_agent')
    async listActive(@Param('tenantId') tenantId: string) {
        const policies = await this.service.listActive(tenantId);
        return { success: true, data: policies };
    }

    @Get(':tenantId/:type/versions')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin', 'tenant_admin', 'tenant_agent')
    async listVersions(
        @Param('tenantId') tenantId: string,
        @Param('type') type: PolicyType,
    ) {
        const versions = await this.service.listVersions(tenantId, type);
        return { success: true, data: versions };
    }

    @Get(':tenantId/:type')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin', 'tenant_admin', 'tenant_agent')
    async getActive(
        @Param('tenantId') tenantId: string,
        @Param('type') type: PolicyType,
    ) {
        const policy = await this.service.getActive(tenantId, type);
        return { success: true, data: policy };
    }

    @Post(':tenantId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin', 'tenant_admin')
    async upsert(@Param('tenantId') tenantId: string, @Body() body: UpsertPolicyInput) {
        const policy = await this.service.upsert(tenantId, body);
        return { success: true, data: policy };
    }

    @Delete(':tenantId/:id')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin', 'tenant_admin')
    async delete(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        await this.service.delete(tenantId, id);
        return { success: true };
    }
}
