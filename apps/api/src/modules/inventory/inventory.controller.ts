import { Controller, Get, Post, Put, Body, Param, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';

import { InventoryService } from './inventory.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentUser } from '../../common/decorators/tenant.decorator';

/**
 * Marcar o desmarcar "venta bajo fórmula médica" no es editar un producto.
 *
 * El resto del alta de producto la puede hacer un agente. Quitar esta marca
 * amplía lo que el agente de IA puede vender por chat —justo lo que el bloqueo
 * del writer existe para impedir— así que es decisión de supervisión.
 */
function assertMayChangePrescriptionFlag(body: any, user: any): void {
    if (body?.requiresPrescription === undefined) return;
    const role = String(user?.role || '');
    if (role !== 'tenant_admin' && role !== 'tenant_supervisor' && role !== 'super_admin') {
        throw new ForbiddenException(
            'Cambiar la marca de venta bajo fórmula médica requiere un rol de supervisión.',
        );
    }
}

@Controller('inventory')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
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
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async createProduct(
        @Param('tenantId') tenantId: string,
        @Body() body: {
            name: string; sku: string; description?: string; categoryId?: string;
            price: number; cost?: number; stock: number; minStock?: number;
            maxStock?: number; unit?: string; imageUrl?: string; tags?: string[];
            requiresPrescription?: boolean;
        },
        @CurrentUser() user: any,
    ) {
        assertMayChangePrescriptionFlag(body, user);
        const product = await this.inventoryService.createProduct(tenantId, body);
        return { success: true, data: product };
    }

    @Put('products/:tenantId/:productId')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async updateProduct(
        @Param('tenantId') tenantId: string,
        @Param('productId') productId: string,
        @Body() body: any,
        @CurrentUser() user: any,
    ) {
        assertMayChangePrescriptionFlag(body, user);
        await this.inventoryService.updateProduct(tenantId, productId, body);
        return { success: true, message: 'Product updated' };
    }

    // ---- Stock Adjustments ----

    @Post('products/:tenantId/:productId/stock')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
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
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async createCategory(
        @Param('tenantId') tenantId: string,
        @Body() body: { name: string; color: string },
    ) {
        const category = await this.inventoryService.createCategory(tenantId, body);
        return { success: true, data: category };
    }
}
