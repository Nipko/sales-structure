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
        @CurrentTenant() schema: string,
        @Query('status') status?: string,
        @Query('make') make?: string,
        @Query('category') category?: string,
        @Query('condition') condition?: string,
        @Query('minPrice') minPrice?: string,
        @Query('maxPrice') maxPrice?: string,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
    ) {
        const result = await this.vehicleService.listVehicles(schema, {
            status, make, category, condition,
            minPrice: minPrice ? parseInt(minPrice) : undefined,
            maxPrice: maxPrice ? parseInt(maxPrice) : undefined,
            limit: limit ? parseInt(limit) : undefined,
            offset: offset ? parseInt(offset) : undefined,
        });
        return { success: true, data: result };
    }

    @Get(':tenantId/stats')
    @ApiOperation({ summary: 'Get inventory statistics' })
    async getStats(@CurrentTenant() schema: string) {
        const stats = await this.vehicleService.getInventoryStats(schema);
        return { success: true, data: stats };
    }

    @Get(':tenantId/:vehicleId')
    @ApiOperation({ summary: 'Get a single vehicle' })
    async getVehicle(@CurrentTenant() schema: string, @Param('vehicleId') vehicleId: string) {
        const vehicle = await this.vehicleService.getVehicle(schema, vehicleId);
        return { success: true, data: vehicle };
    }

    @Post(':tenantId')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Add a vehicle to inventory' })
    async createVehicle(
        @Param('tenantId') tenantId: string,
        @CurrentTenant() schema: string,
        @Body() body: any,
    ) {
        const vehicle = await this.vehicleService.createVehicle(tenantId, schema, body);
        return { success: true, data: vehicle };
    }

    @Put(':tenantId/:vehicleId')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Update a vehicle' })
    async updateVehicle(@CurrentTenant() schema: string, @Param('vehicleId') vehicleId: string, @Body() body: any) {
        const vehicle = await this.vehicleService.updateVehicle(schema, vehicleId, body);
        return { success: true, data: vehicle };
    }

    @Put(':tenantId/:vehicleId/sold')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Mark a vehicle as sold' })
    async markSold(@CurrentTenant() schema: string, @Param('vehicleId') vehicleId: string, @Body() body: any) {
        const vehicle = await this.vehicleService.markSold(schema, vehicleId, body.soldPriceCents, body.buyerContactId);
        return { success: true, data: vehicle };
    }

    @Post(':tenantId/test-drives')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @ApiOperation({ summary: 'Schedule a test drive' })
    async scheduleTestDrive(@CurrentTenant() schema: string, @Body() body: any) {
        const td = await this.vehicleService.scheduleTestDrive(schema, body);
        return { success: true, data: td };
    }

    @Get(':tenantId/test-drives/list')
    @ApiOperation({ summary: 'List test drives' })
    async listTestDrives(
        @CurrentTenant() schema: string,
        @Query('vehicleId') vehicleId?: string,
        @Query('status') status?: string,
        @Query('date') date?: string,
    ) {
        const items = await this.vehicleService.listTestDrives(schema, { vehicleId, status, date });
        return { success: true, data: items };
    }

    @Get(':tenantId/search')
    @ApiOperation({ summary: 'AI-oriented vehicle search' })
    async searchForAI(
        @CurrentTenant() schema: string,
        @Query('make') make?: string,
        @Query('budgetMax') budgetMax?: string,
        @Query('category') category?: string,
        @Query('fuelType') fuelType?: string,
        @Query('condition') condition?: string,
        @Query('year') year?: string,
    ) {
        const vehicles = await this.vehicleService.searchVehiclesForAI(schema, {
            make, category, fuelType, condition,
            budgetMax: budgetMax ? parseInt(budgetMax) : undefined,
            year: year ? parseInt(year) : undefined,
        });
        return { success: true, data: vehicles };
    }
}
