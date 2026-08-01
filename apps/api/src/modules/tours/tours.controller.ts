import {
    Controller, Get, Post, Put, Delete, Param, Body, Query,
    UseGuards, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { ToursService } from './tours.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('tours')
@Controller('tours')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class ToursController {
    constructor(
        private readonly toursService: ToursService,
        private readonly prisma: PrismaService,
    ) {}

    // ── Packages ──────────────────────────────────────────────

    @Get(':tenantId/packages')
    @ApiOperation({ summary: 'List all tour packages for a tenant' })
    async listPackages(
        @Param('tenantId') tenantId: string,
        @Query('includeInactive') includeInactive?: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.toursService.listPackages(schemaName, includeInactive === 'true');
        return { success: true, data };
    }

    @Post(':tenantId/packages')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Create a tour package' })
    async createPackage(
        @Param('tenantId') tenantId: string,
        @Body() body: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.toursService.createPackage(tenantId, schemaName, body);
        return { success: true, data };
    }

    @Get(':tenantId/packages/:packageId')
    @ApiOperation({ summary: 'Get one tour package' })
    async getPackage(
        @Param('tenantId') tenantId: string,
        @Param('packageId') packageId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.toursService.getPackage(schemaName, packageId);
        if (!data) throw new BadRequestException('Package not found');
        return { success: true, data };
    }

    @Put(':tenantId/packages/:packageId')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Update a tour package' })
    async updatePackage(
        @Param('tenantId') tenantId: string,
        @Param('packageId') packageId: string,
        @Body() body: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.toursService.updatePackage(schemaName, packageId, body);
        return { success: true, data };
    }

    @Delete(':tenantId/packages/:packageId')
    @Roles('tenant_admin', 'tenant_supervisor')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Soft-delete a tour package' })
    async deletePackage(
        @Param('tenantId') tenantId: string,
        @Param('packageId') packageId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.toursService.deletePackage(schemaName, packageId);
        return { success: true };
    }

    // ── Inventory ─────────────────────────────────────────────

    @Get(':tenantId/packages/:packageId/inventory')
    @ApiOperation({ summary: 'List inventory rows (per-departure capacity)' })
    async listInventory(
        @Param('tenantId') tenantId: string,
        @Param('packageId') packageId: string,
        @Query('fromDate') fromDate?: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.toursService.listInventory(schemaName, packageId, fromDate);
        return { success: true, data };
    }

    @Post(':tenantId/packages/:packageId/inventory')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Create or update an inventory row for a date' })
    async createInventory(
        @Param('tenantId') tenantId: string,
        @Param('packageId') packageId: string,
        @Body() body: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.toursService.createInventory(schemaName, packageId, body);
        return { success: true, data };
    }

    @Delete(':tenantId/inventory/:inventoryId')
    @Roles('tenant_admin', 'tenant_supervisor')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Soft-delete an inventory row' })
    async deleteInventory(
        @Param('tenantId') tenantId: string,
        @Param('inventoryId') inventoryId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.toursService.deleteInventory(schemaName, inventoryId);
        return { success: true };
    }

    // ── Availability ──────────────────────────────────────────

    @Get(':tenantId/packages/:packageId/availability')
    @ApiOperation({ summary: 'Check availability of a package for a date and party size' })
    async checkAvailability(
        @Param('tenantId') tenantId: string,
        @Param('packageId') packageId: string,
        @Query('date') date: string,
        @Query('partySize') partySize: string,
    ) {
        if (!date) throw new BadRequestException('date is required (YYYY-MM-DD)');
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const size = parseInt(partySize || '1', 10);
        const data = await this.toursService.checkAvailability(schemaName, packageId, date, size);
        return { success: true, data };
    }

    // ── Bookings ──────────────────────────────────────────────

    @Get(':tenantId/bookings')
    @ApiOperation({ summary: 'List all tour bookings' })
    async listBookings(
        @Param('tenantId') tenantId: string,
        @Query('packageId') packageId?: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.toursService.listBookings(schemaName, packageId);
        return { success: true, data };
    }

    @Post(':tenantId/bookings')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    @ApiOperation({ summary: 'Create a tour booking' })
    async createBooking(
        @Param('tenantId') tenantId: string,
        @Body() body: any,
    ) {
        if (!body.packageId || !body.departureDate || !body.partySize) {
            throw new BadRequestException('packageId, departureDate, partySize are required');
        }
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.toursService.createBooking(schemaName, body);
        return { success: true, data };
    }

    @Put(':tenantId/bookings/:bookingId/cancel')
    @Roles('tenant_admin', 'tenant_supervisor')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Cancel a tour booking and restore seat capacity' })
    async cancelBooking(
        @Param('tenantId') tenantId: string,
        @Param('bookingId') bookingId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.toursService.cancelBooking(schemaName, bookingId);
        return { success: true };
    }
}
