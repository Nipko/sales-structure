import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';
import { VerticalIntegrationsService, VerticalProvider } from './vertical-integrations.service';
import { UpdateVerticalIntegrationConfigDto } from './vertical-integrations.dto';
import { RequiresVerifiedEmail } from '../../common/decorators/requires-verified-email.decorator';
import { ProviderResourceBindingService } from './provider-resource-binding.service';

/**
 * Real vertical integrations (T3.19): Toast / Mindbody / Cliniko.
 */
@Controller('vertical-integrations')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class VerticalIntegrationsController {
    constructor(
        private readonly vi: VerticalIntegrationsService,
        private readonly bindings: ProviderResourceBindingService,
    ) {}

    @Get(':tenantId/config')
    @Roles('super_admin', 'tenant_admin')
    async getConfig(@Param('tenantId') tenantId: string) {
        return { success: true, data: await this.vi.getAllConfigs(tenantId) };
    }

    @Get(':tenantId/health')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async getAllHealth(@Param('tenantId') tenantId: string) {
        return { success: true, data: await this.vi.getAllHealth(tenantId) };
    }

    @Get(':tenantId/:provider/health')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async getHealth(
        @Param('tenantId') tenantId: string,
        @Param('provider') provider: VerticalProvider,
    ) {
        return { success: true, data: await this.vi.getProviderHealth(tenantId, provider) };
    }

    @Put(':tenantId/:provider/config')
    @Roles('super_admin', 'tenant_admin')
    @RequiresVerifiedEmail('activate_integration')
    async updateConfig(
        @Param('tenantId') tenantId: string,
        @Param('provider') provider: VerticalProvider,
        @Body() body: UpdateVerticalIntegrationConfigDto,
    ) {
        const cfg = await this.vi.updateConfig(tenantId, provider, body);
        const health = await this.vi.getProviderHealth(tenantId, provider);
        return {
            success: true,
            data: {
                ...cfg,
                clientSecret: undefined,
                apiKey: undefined,
                password: undefined,
                connected: health.connected,
                status: health.status,
                health,
            },
        };
    }

    @Delete(':tenantId/:provider')
    @Roles('super_admin', 'tenant_admin')
    @RequiresVerifiedEmail('sensitive_admin')
    async disconnect(@Param('tenantId') tenantId: string, @Param('provider') provider: VerticalProvider) {
        await this.bindings.tombstoneProvider(tenantId, provider);
        await this.vi.disconnect(tenantId, provider);
        return { success: true };
    }

    @Get(':tenantId/bindings/resources')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async listBindings(
        @Param('tenantId') tenantId: string,
        @Query('provider') provider?: string,
    ) {
        return { success: true, data: await this.bindings.list(tenantId, provider) };
    }

    @Put(':tenantId/bindings/resources')
    @Roles('super_admin', 'tenant_admin')
    @RequiresVerifiedEmail('activate_integration')
    async upsertBinding(
        @Param('tenantId') tenantId: string,
        @Body() body: {
            provider: string;
            connectionId: string;
            resourceType: string;
            resourceId: string;
            externalId: string;
            scopeType?: string;
            scopeId?: string;
        },
    ) {
        return { success: true, data: await this.bindings.upsert(tenantId, body) };
    }

    @Delete(':tenantId/bindings/resources/:bindingId')
    @Roles('super_admin', 'tenant_admin')
    @RequiresVerifiedEmail('activate_integration')
    async tombstoneBinding(
        @Param('tenantId') tenantId: string,
        @Param('bindingId') bindingId: string,
    ) {
        await this.bindings.tombstone(tenantId, bindingId);
        return { success: true };
    }

    @Get(':tenantId/bindings/resolve')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async resolveBinding(
        @Param('tenantId') tenantId: string,
        @Query('provider') provider: string,
        @Query('connectionId') connectionId: string,
        @Query('resourceType') resourceType: string,
        @Query('resourceId') resourceId: string,
    ) {
        return {
            success: true,
            data: await this.bindings.resolve(tenantId, { provider, connectionId, resourceType, resourceId }),
        };
    }

    @Post(':tenantId/:provider/test')
    @Roles('super_admin', 'tenant_admin')
    async test(@Param('tenantId') tenantId: string, @Param('provider') provider: VerticalProvider) {
        return { success: true, data: await this.vi.testConnection(tenantId, provider) };
    }

    @Post(':tenantId/:provider/sync')
    @Roles('super_admin', 'tenant_admin')
    @RequiresVerifiedEmail('activate_integration')
    async sync(@Param('tenantId') tenantId: string, @Param('provider') provider: VerticalProvider) {
        const result = await this.vi.sync(tenantId, provider);
        return {
            success: true,
            data: { ...result, health: await this.vi.getProviderHealth(tenantId, provider) },
        };
    }

    @Get(':tenantId/items')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async items(
        @CurrentTenant() tenantId: string,
        @Query('provider') provider?: string,
        @Query('type') type?: string,
    ) {
        return { success: true, data: await this.vi.listItems(tenantId, provider, type) };
    }
}
