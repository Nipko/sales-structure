import { Controller, Get, Post, Put, Body, Query, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, CurrentTenant } from '../../common/decorators/tenant.decorator';
import { EcommerceService, EcommerceConfig } from './ecommerce.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';

@ApiTags('ecommerce')
@Controller('ecommerce')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class EcommerceController {
    constructor(
        private readonly ecommerce: EcommerceService,
        private readonly throttle: TenantThrottleService,
    ) {}

    private async ensureFeatureEnabled(tenantId: string) {
        if (!await this.throttle.isFeatureEnabled(tenantId, 'ecommerce')) {
            throw new ForbiddenException({
                error: 'feature_not_available',
                feature: 'ecommerce',
                message: 'E-commerce no está disponible en tu plan actual. Actualiza tu plan para acceder.',
            });
        }
    }

    @Get('config')
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Get e-commerce integration config' })
    async getConfig(@CurrentUser() user: any) {
        await this.ensureFeatureEnabled(user.tenantId);
        const config = await this.ecommerce.getConfig(user.tenantId);
        return {
            success: true,
            data: config ? { ...config, apiSecret: '***', accessToken: config.accessToken ? '***' : undefined } : null,
        };
    }

    @Put('config')
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Update e-commerce integration config' })
    async updateConfig(@CurrentUser() user: any, @Body() body: Partial<EcommerceConfig>) {
        const config = await this.ecommerce.updateConfig(user.tenantId, body);
        return {
            success: true,
            data: { ...config, apiSecret: '***', accessToken: config.accessToken ? '***' : undefined },
        };
    }

    @Post('sync')
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Sync products from e-commerce platform' })
    async syncProducts(@CurrentUser() user: any) {
        const config = await this.ecommerce.getConfig(user.tenantId);
        if (!config) return { success: false, error: 'E-commerce not configured' };

        const result = config.provider === 'shopify'
            ? await this.ecommerce.syncShopifyProducts(user.tenantId)
            : await this.ecommerce.syncWooCommerceProducts(user.tenantId);

        return { success: true, data: result };
    }

    @Get('products')
    @ApiOperation({ summary: 'List synced products' })
    async listProducts(
        @CurrentTenant() schema: string,
        @Query('status') status?: string,
        @Query('search') search?: string,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
    ) {
        const result = await this.ecommerce.listProducts(schema, {
            status, search,
            limit: limit ? parseInt(limit) : undefined,
            offset: offset ? parseInt(offset) : undefined,
        });
        return { success: true, data: result };
    }

    @Get('products/search')
    @ApiOperation({ summary: 'AI-oriented product search' })
    async searchForAI(
        @CurrentTenant() schema: string,
        @Query('search') search?: string,
        @Query('maxPrice') maxPrice?: string,
        @Query('category') category?: string,
    ) {
        const products = await this.ecommerce.searchProductsForAI(schema, {
            search, category,
            maxPrice: maxPrice ? parseInt(maxPrice) : undefined,
        });
        return { success: true, data: products };
    }
}
