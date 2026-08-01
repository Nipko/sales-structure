import {
    Controller, Get, Post, Put, Delete, Param, Body, Query,
    UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { ListingsService } from './listings.service';
import { PrismaService } from '../prisma/prisma.service';
import { bulkImportRows } from '../../common/utils/bulk-import.util';

@ApiTags('listings')
@Controller('listings')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class ListingsController {
    constructor(
        private readonly service: ListingsService,
        private readonly prisma: PrismaService,
    ) {}

    @Get(':tenantId')
    @ApiOperation({ summary: 'List real-estate listings for a tenant' })
    async list(
        @Param('tenantId') tenantId: string,
        @Query('transactionType') transactionType?: 'sale' | 'rent',
        @Query('status') status?: string,
        @Query('includeInactive') includeInactive?: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.list(schemaName, {
            transactionType,
            status,
            includeInactive: includeInactive === 'true',
        });
        return { success: true, data };
    }

    @Post(':tenantId')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Create a real-estate listing' })
    async create(@Param('tenantId') tenantId: string, @Body() body: any) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.create(schemaName, body);
        return { success: true, data };
    }

    @Get(':tenantId/search')
    @ApiOperation({ summary: 'Search listings with filters (used by AI tool internally too)' })
    async search(
        @Param('tenantId') tenantId: string,
        @Query() query: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.search(schemaName, {
            transactionType: query.transactionType,
            propertyKind: query.propertyKind,
            maxPrice: query.maxPrice ? Number(query.maxPrice) : undefined,
            minPrice: query.minPrice ? Number(query.minPrice) : undefined,
            minBedrooms: query.minBedrooms ? Number(query.minBedrooms) : undefined,
            neighborhood: query.neighborhood,
            city: query.city,
            minAreaM2: query.minAreaM2 ? Number(query.minAreaM2) : undefined,
            limit: query.limit ? Number(query.limit) : undefined,
        });
        return { success: true, data };
    }

    @Get(':tenantId/listings/:listingId')
    @ApiOperation({ summary: 'Get a listing by id' })
    async getOne(@Param('tenantId') tenantId: string, @Param('listingId') listingId: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.getById(schemaName, listingId);
        return { success: true, data };
    }

    @Put(':tenantId/listings/:listingId')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Update a listing' })
    async update(
        @Param('tenantId') tenantId: string,
        @Param('listingId') listingId: string,
        @Body() body: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.update(schemaName, listingId, body);
        return { success: true, data };
    }

    @Delete(':tenantId/listings/:listingId')
    @Roles('tenant_admin', 'tenant_supervisor')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Soft-delete a listing' })
    async delete(@Param('tenantId') tenantId: string, @Param('listingId') listingId: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.service.delete(schemaName, listingId);
        return { success: true };
    }

    // ── Zone agent routing ───────────────────────────────────

    @Get(':tenantId/zones')
    @ApiOperation({ summary: 'List zone → agent mappings' })
    async listZones(@Param('tenantId') tenantId: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.listZoneAgents(schemaName);
        return { success: true, data };
    }

    @Post(':tenantId/zones')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Set agent for a zone' })
    async setZone(
        @Param('tenantId') tenantId: string,
        @Body() body: { neighborhood: string; agentId: string; city?: string },
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.setZoneAgent(schemaName, body.neighborhood, body.agentId, body.city);
        return { success: true, data };
    }

    @Delete(':tenantId/zones/:mappingId')
    @Roles('tenant_admin', 'tenant_supervisor')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Remove a zone → agent mapping' })
    async removeZone(@Param('tenantId') tenantId: string, @Param('mappingId') mappingId: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.service.removeZoneAgent(schemaName, mappingId);
        return { success: true };
    }

    /**
     * Import masivo. Cargar 40 propiedades / 200 miembros / 60 platos de a
     * uno es el punto de abandono documentado del alta; esto lo vuelve un
     * archivo. Reusa el create de siempre fila por fila, asi que la
     * validacion es exactamente la misma que por la UI.
     */
    @Post(":tenantId/bulk-import")
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: "Bulk-import listings from a parsed CSV/XLSX" })
    async bulkImport(@Param('tenantId') tenantId: string, @Body() body: { rows?: any[] }) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await bulkImportRows(body?.rows, row => this.service.create(schemaName, row));
        return { success: true, data };
    }
}
