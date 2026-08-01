import {
    Controller, Get, Post, Put, Delete, Param, Body, Query,
    UseGuards, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RestaurantsService } from './restaurants.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('restaurants')
@Controller('restaurants')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class RestaurantsController {
    constructor(
        private readonly service: RestaurantsService,
        private readonly prisma: PrismaService,
    ) {}

    // ── Categories ────────────────────────────────────────────────

    @Get(':tenantId/categories')
    async listCategories(
        @Param('tenantId') tenantId: string,
        @Query('includeInactive') includeInactive?: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.listCategories(schemaName, includeInactive === 'true');
        return { success: true, data };
    }

    @Post(':tenantId/categories')
    @Roles('tenant_admin', 'tenant_supervisor')
    async createCategory(@Param('tenantId') tenantId: string, @Body() body: any) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.createCategory(schemaName, body);
        return { success: true, data };
    }

    @Put(':tenantId/categories/:id')
    @Roles('tenant_admin', 'tenant_supervisor')
    async updateCategory(
        @Param('tenantId') tenantId: string,
        @Param('id') id: string,
        @Body() body: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.updateCategory(schemaName, id, body);
        return { success: true, data };
    }

    @Delete(':tenantId/categories/:id')
    @Roles('tenant_admin', 'tenant_supervisor')
    @HttpCode(HttpStatus.OK)
    async deleteCategory(
        @Param('tenantId') tenantId: string,
        @Param('id') id: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.service.deleteCategory(schemaName, id);
        return { success: true };
    }

    // ── Menu Items ────────────────────────────────────────────────

    @Get(':tenantId/items')
    async listItems(
        @Param('tenantId') tenantId: string,
        @Query('categoryId') categoryId?: string,
        @Query('availableOnly') availableOnly?: string,
        @Query('includeInactive') includeInactive?: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.listItems(schemaName, {
            categoryId,
            availableOnly: availableOnly === 'true',
            includeInactive: includeInactive === 'true',
        });
        return { success: true, data };
    }

    @Get(':tenantId/items/:id')
    async getItem(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.getItemById(schemaName, id);
        if (!data) throw new BadRequestException('Item not found');
        return { success: true, data };
    }

    @Post(':tenantId/items')
    @Roles('tenant_admin', 'tenant_supervisor')
    async createItem(@Param('tenantId') tenantId: string, @Body() body: any) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.createItem(schemaName, body);
        return { success: true, data };
    }

    @Put(':tenantId/items/:id')
    @Roles('tenant_admin', 'tenant_supervisor')
    async updateItem(
        @Param('tenantId') tenantId: string,
        @Param('id') id: string,
        @Body() body: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.updateItem(schemaName, id, body);
        return { success: true, data };
    }

    @Delete(':tenantId/items/:id')
    @Roles('tenant_admin', 'tenant_supervisor')
    @HttpCode(HttpStatus.OK)
    async deleteItem(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.service.deleteItem(schemaName, id);
        return { success: true };
    }

    // ── Orders ────────────────────────────────────────────────────

    @Get(':tenantId/orders')
    async listOrders(
        @Param('tenantId') tenantId: string,
        @Query('status') status?: string,
        @Query('limit') limit?: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.listOrders(schemaName, {
            status,
            limit: limit ? Number(limit) : undefined,
        });
        return { success: true, data };
    }

    @Get(':tenantId/orders/:id')
    async getOrder(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.getOrderById(schemaName, id);
        if (!data) throw new BadRequestException('Order not found');
        return { success: true, data };
    }

    @Post(':tenantId/orders')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async createOrder(@Param('tenantId') tenantId: string, @Body() body: any) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.createOrder(schemaName, body);
        return { success: true, data };
    }

    @Put(':tenantId/orders/:id/status')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @ApiOperation({ summary: 'Transition order status (received → preparing → ready → delivered)' })
    async updateOrderStatus(
        @Param('tenantId') tenantId: string,
        @Param('id') id: string,
        @Body() body: { status: string },
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.updateOrderStatus(schemaName, id, body.status);
        return { success: true, data };
    }

    // ── Promotions ────────────────────────────────────────────────

    @Get(':tenantId/promotions')
    async listPromotions(
        @Param('tenantId') tenantId: string,
        @Query('activeOnly') activeOnly?: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.listPromotions(schemaName, activeOnly !== 'false');
        return { success: true, data };
    }

    @Post(':tenantId/promotions')
    @Roles('tenant_admin', 'tenant_supervisor')
    async createPromotion(@Param('tenantId') tenantId: string, @Body() body: any) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.createPromotion(schemaName, body);
        return { success: true, data };
    }

    @Delete(':tenantId/promotions/:id')
    @Roles('tenant_admin', 'tenant_supervisor')
    @HttpCode(HttpStatus.OK)
    async deletePromotion(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.service.deletePromotion(schemaName, id);
        return { success: true };
    }
}
