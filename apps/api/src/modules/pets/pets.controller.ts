import {
    Controller, Get, Post, Put, Delete, Param, Body,
    UseGuards, HttpCode, HttpStatus, BadRequestException, Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PetsService } from './pets.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('pets')
@Controller('pets')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class PetsController {
    constructor(
        private readonly service: PetsService,
        private readonly prisma: PrismaService,
    ) {}

    // ── Pets CRUD ────────────────────────────────────────────────

    @Get(':tenantId/contacts/:contactId')
    @ApiOperation({ summary: 'List pets for a contact (tutor)' })
    async listForContact(
        @Param('tenantId') tenantId: string,
        @Param('contactId') contactId: string,
        @Query('includeInactive') includeInactive?: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.listForContact(
            schemaName, contactId, includeInactive === 'true',
        );
        return { success: true, data };
    }

    @Post(':tenantId/pets')
    @ApiOperation({ summary: 'Create a new pet' })
    async create(
        @Param('tenantId') tenantId: string,
        @Body() body: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.create(schemaName, body);
        return { success: true, data };
    }

    @Get(':tenantId/pets/:petId')
    @ApiOperation({ summary: 'Get pet detail with vaccinations' })
    async getPet(
        @Param('tenantId') tenantId: string,
        @Param('petId') petId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const pet = await this.service.getById(schemaName, petId);
        if (!pet) throw new BadRequestException('Pet not found');
        const vaccinations = await this.service.listVaccinations(schemaName, petId);
        return { success: true, data: { ...pet, vaccinations } };
    }

    @Put(':tenantId/pets/:petId')
    @ApiOperation({ summary: 'Update pet' })
    async update(
        @Param('tenantId') tenantId: string,
        @Param('petId') petId: string,
        @Body() body: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.update(schemaName, petId, body);
        return { success: true, data };
    }

    @Delete(':tenantId/pets/:petId')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Soft-delete pet' })
    async delete(
        @Param('tenantId') tenantId: string,
        @Param('petId') petId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.service.delete(schemaName, petId);
        return { success: true };
    }

    // ── Vaccinations ─────────────────────────────────────────────

    @Post(':tenantId/pets/:petId/vaccinations')
    @ApiOperation({ summary: 'Record a vaccination' })
    async addVaccination(
        @Param('tenantId') tenantId: string,
        @Param('petId') petId: string,
        @Body() body: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.addVaccination(schemaName, petId, body);
        return { success: true, data };
    }

    @Delete(':tenantId/vaccinations/:vaccinationId')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Delete a vaccination record' })
    async deleteVaccination(
        @Param('tenantId') tenantId: string,
        @Param('vaccinationId') vaccinationId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.service.deleteVaccination(schemaName, vaccinationId);
        return { success: true };
    }
}
