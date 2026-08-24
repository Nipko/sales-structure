import { Controller, Get, Post, Put, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { CurrentUser, CurrentTenant } from '../../common/decorators/tenant.decorator';
import { ECOMMERCE_SECRET_FIELDS, EcommerceService, EcommerceConfig } from './ecommerce.service';
import { TENANT_SECRET_MASK } from '../../common/crypto/tenant-secret-crypto.service';

function redactEcommerceConfig(config: EcommerceConfig | Record<string, any> | null) {
    if (!config) return null;
    return {
        ...config,
        ...Object.fromEntries(ECOMMERCE_SECRET_FIELDS.map((field) => [
            field,
            config[field] ? TENANT_SECRET_MASK : undefined,
        ])),
    };
}

@ApiTags('ecommerce')
@Controller('ecommerce')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard, FeatureGuard)
@RequireFeature('ecommerce')
@ApiBearerAuth()
export class EcommerceController {
    constructor(
        private readonly ecommerce: EcommerceService,
    ) {}

    @Get('config')
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Get e-commerce integration config' })
    async getConfig(@CurrentUser() user: any) {
        const config = await this.ecommerce.getRedactedConfig(user.tenantId);
        return {
            success: true,
            data: redactEcommerceConfig(config),
        };
    }

    @Put('config')
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Update e-commerce integration config' })
    async updateConfig(@CurrentUser() user: any, @Body() body: Partial<EcommerceConfig>) {
        const config = await this.ecommerce.updateConfig(user.tenantId, body);
        return {
            success: true,
            data: redactEcommerceConfig(config),
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
        @CurrentTenant() tenantId: string,
        @Query('status') status?: string,
        @Query('search') search?: string,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
    ) {
        const result = await this.ecommerce.listProducts(tenantId, {
            status, search,
            limit: limit ? parseInt(limit) : undefined,
            offset: offset ? parseInt(offset) : undefined,
        });
        return { success: true, data: result };
    }

    @Get('products/search')
    @ApiOperation({ summary: 'AI-oriented product search' })
    async searchForAI(
        @CurrentTenant() tenantId: string,
        @Query('search') search?: string,
        @Query('maxPrice') maxPrice?: string,
        @Query('category') category?: string,
    ) {
        const products = await this.ecommerce.searchProductsForAIByTenant(tenantId, {
            search, category,
            maxPrice: maxPrice ? parseInt(maxPrice) : undefined,
        });
        return { success: true, data: products };
    }
}
