import { Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { CurrentTenant } from '../../common/decorators/tenant.decorator';
import { VehicleInventoryService } from './vehicle-inventory.service';
import { bulkImportRows } from '../../common/utils/bulk-import.util';

@ApiTags('vehicles')
@Controller('vehicles')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard, FeatureGuard)
@RequireFeature('vehicleInventory')
@ApiBearerAuth()
export class VehicleInventoryController {
    constructor(
        private readonly vehicleService: VehicleInventoryService,
    ) {}

    @Get(':tenantId')
    @ApiOperation({ summary: 'List vehicles with optional filters' })
    async listVehicles(
        @CurrentTenant() tenantId: string,
        @Query('status') status?: string,
        @Query('search') search?: string,
        @Query('make') make?: string,
        @Query('category') category?: string,
        @Query('condition') condition?: string,
        @Query('minPrice') minPrice?: string,
        @Query('maxPrice') maxPrice?: string,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
    ) {
        const result = await this.vehicleService.listVehicles(tenantId, {
            status, search, make, category, condition,
            minPrice: minPrice ? parseInt(minPrice) : undefined,
            maxPrice: maxPrice ? parseInt(maxPrice) : undefined,
            limit: limit ? parseInt(limit) : undefined,
            offset: offset ? parseInt(offset) : undefined,
        });
        return { success: true, data: result };
    }

    @Get(':tenantId/stats')
    @ApiOperation({ summary: 'Get inventory statistics' })
    async getStats(@CurrentTenant() tenantId: string) {
        const stats = await this.vehicleService.getInventoryStats(tenantId);
        return { success: true, data: stats };
    }

    // Keep static GET routes above `:vehicleId`: Nest registers controller
    // handlers in declaration order, so `/search` must not be interpreted as
    // a vehicle UUID by the dynamic route below.
    @Get(':tenantId/search')
    @ApiOperation({ summary: 'AI-oriented vehicle search' })
    async searchForAI(
        @CurrentTenant() tenantId: string,
        @Query('make') make?: string,
        @Query('budgetMax') budgetMax?: string,
        @Query('category') category?: string,
        @Query('fuelType') fuelType?: string,
        @Query('condition') condition?: string,
        @Query('year') year?: string,
    ) {
        const vehicles = await this.vehicleService.searchVehiclesForAI(tenantId, {
            make, category, fuelType, condition,
            budgetMax: budgetMax ? parseInt(budgetMax) : undefined,
            year: year ? parseInt(year) : undefined,
        });
        return { success: true, data: vehicles };
    }

    @Get(':tenantId/:vehicleId')
    @ApiOperation({ summary: 'Get a single vehicle' })
    async getVehicle(@CurrentTenant() tenantId: string, @Param('vehicleId') vehicleId: string) {
        const vehicle = await this.vehicleService.getVehicle(tenantId, vehicleId);
        return { success: true, data: vehicle };
    }

    @Post(':tenantId')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Add a vehicle to inventory' })
    async createVehicle(
        @CurrentTenant() tenantId: string,
        @Body() body: any,
    ) {
        const vehicle = await this.vehicleService.createVehicle(tenantId, body);
        return { success: true, data: vehicle };
    }

    /**
     * Import masivo. En autos usados el inventario rota entero cada pocas
     * semanas: cargarlo de a un vehículo es el punto de abandono del alta.
     * Reusa `createVehicle` fila por fila, así que la validación es la misma
     * que por la UI.
     *
     * Va ANTES de `@Put(':tenantId/:vehicleId')` a propósito — no por orden de
     * método (uno es POST y el otro PUT) sino porque este controller ya tiene
     * rutas estáticas que conviven con `:vehicleId` y mantenerlas agrupadas
     * arriba evita que la próxima ruta dinámica se las coma.
     */
    @Post(':tenantId/bulk-import')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Bulk-import vehicles from a parsed CSV/XLSX' })
    async bulkImport(
        @CurrentTenant() tenantId: string,
        @Body() body: { rows?: any[] },
    ) {
        const data = await bulkImportRows(body?.rows, row => this.vehicleService.createVehicle(tenantId, row));
        return { success: true, data };
    }

    @Put(':tenantId/:vehicleId')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Update a vehicle' })
    async updateVehicle(@CurrentTenant() tenantId: string, @Param('vehicleId') vehicleId: string, @Body() body: any) {
        const vehicle = await this.vehicleService.updateVehicle(tenantId, vehicleId, body);
        return { success: true, data: vehicle };
    }

    @Put(':tenantId/:vehicleId/sold')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Mark a vehicle as sold' })
    async markSold(@CurrentTenant() tenantId: string, @Param('vehicleId') vehicleId: string, @Body() body: any) {
        const vehicle = await this.vehicleService.markSold(tenantId, vehicleId, body.soldPriceCents, body.buyerContactId);
        return { success: true, data: vehicle };
    }

    @Post(':tenantId/test-drives')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @ApiOperation({ summary: 'Schedule a test drive' })
    async scheduleTestDrive(@CurrentTenant() tenantId: string, @Body() body: any) {
        const td = await this.vehicleService.scheduleTestDrive(tenantId, body);
        return { success: true, data: td };
    }

    @Get(':tenantId/test-drives/list')
    @ApiOperation({ summary: 'List test drives' })
    async listTestDrives(
        @CurrentTenant() tenantId: string,
        @Query('vehicleId') vehicleId?: string,
        @Query('status') status?: string,
        @Query('date') date?: string,
    ) {
        const items = await this.vehicleService.listTestDrives(tenantId, { vehicleId, status, date });
        return { success: true, data: items };
    }

}
