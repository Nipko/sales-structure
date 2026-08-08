import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';
import { VerticalIntegrationsService, VerticalProvider } from './vertical-integrations.service';

/**
 * Real vertical integrations (T3.19): Toast / Mindbody / Cliniko.
 */
@Controller('vertical-integrations')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class VerticalIntegrationsController {
    constructor(private readonly vi: VerticalIntegrationsService) {}

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
    async updateConfig(
        @Param('tenantId') tenantId: string,
        @Param('provider') provider: VerticalProvider,
        @Body() body: any,
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
    async disconnect(@Param('tenantId') tenantId: string, @Param('provider') provider: VerticalProvider) {
        await this.vi.disconnect(tenantId, provider);
        return { success: true };
    }

    @Post(':tenantId/:provider/test')
    @Roles('super_admin', 'tenant_admin')
    async test(@Param('tenantId') tenantId: string, @Param('provider') provider: VerticalProvider) {
        return { success: true, data: await this.vi.testConnection(tenantId, provider) };
    }

    @Post(':tenantId/:provider/sync')
    @Roles('super_admin', 'tenant_admin')
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
        @CurrentTenant() schema: string,
        @Query('provider') provider?: string,
        @Query('type') type?: string,
    ) {
        return { success: true, data: await this.vi.listItems(schema, provider, type) };
    }
}
