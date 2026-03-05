import { Controller, Get, Post, Put, Body, Param } from '@nestjs/common';

import { InventoryService } from './inventory.service';

@Controller('api/v1/inventory')
export class InventoryController {
    constructor(private inventoryService: InventoryService) { }

    // ---- Overview ----

    @Get('overview/:tenantId')
    async getOverview(@Param('tenantId') tenantId: string) {
        const data = await this.inventoryService.getOverview(tenantId);
        return { success: true, data };
    }

    // ---- Products ----

    @Get('products/:tenantId')
    async getProducts(@Param('tenantId') tenantId: string) {
        const products = await this.inventoryService.getProducts(tenantId);
        return { success: true, data: products };
    }

    @Post('products/:tenantId')
    async createProduct(
        @Param('tenantId') tenantId: string,
        @Body() body: {
            name: string; sku: string; description?: string; categoryId?: string;
            price: number; cost?: number; stock: number; minStock?: number;
            maxStock?: number; unit?: string; imageUrl?: string; tags?: string[];
        },
    ) {
        const product = await this.inventoryService.createProduct(tenantId, body);
        return { success: true, data: product };
    }

    @Put('products/:tenantId/:productId')
    async updateProduct(
        @Param('tenantId') tenantId: string,
        @Param('productId') productId: string,
        @Body() body: any,
    ) {
        await this.inventoryService.updateProduct(tenantId, productId, body);
        return { success: true, message: 'Product updated' };
    }

    // ---- Stock Adjustments ----

    @Post('products/:tenantId/:productId/stock')
    async adjustStock(
        @Param('tenantId') tenantId: string,
        @Param('productId') productId: string,
        @Body() body: { type: 'in' | 'out' | 'adjustment'; quantity: number; reason: string },
    ) {
        await this.inventoryService.adjustStock(tenantId, productId, body);
        return { success: true, message: 'Stock adjusted' };
    }

    // ---- Categories ----

    @Post('categories/:tenantId')
    async createCategory(
        @Param('tenantId') tenantId: string,
        @Body() body: { name: string; color: string },
    ) {
        const category = await this.inventoryService.createCategory(tenantId, body);
        return { success: true, data: category };
    }
}
