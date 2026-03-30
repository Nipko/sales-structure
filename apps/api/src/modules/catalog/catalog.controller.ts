import { Controller, Get, Post, Put, Body, Param, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { CatalogService } from './catalog.service';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';

@ApiTags('catalog')
@Controller('catalog')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class CatalogController {
    private readonly logger = new Logger(CatalogController.name);

    constructor(
        private readonly catalogService: CatalogService,
        private readonly prisma: PrismaService,
    ) {}

    private async schemaFor(tenantId: string) {
        return this.prisma.getTenantSchemaName(tenantId);
    }

    // ─── Courses ──────────────────────────────────────────────────────────────

    @Get('courses/:tenantId')
    @ApiOperation({ summary: 'List all courses for a tenant' })
    async getCourses(@Param('tenantId') tenantId: string) {
        return this.catalogService.getCourses(await this.schemaFor(tenantId));
    }

    @Get('courses/:tenantId/:id')
    @ApiOperation({ summary: 'Get a single course by ID' })
    async getCourse(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        return this.catalogService.getCourseById(await this.schemaFor(tenantId), id);
    }

    @Post('courses/:tenantId')
    @ApiOperation({ summary: 'Create a new course' })
    async createCourse(@Param('tenantId') tenantId: string, @Body() payload: any) {
        return this.catalogService.createCourse(await this.schemaFor(tenantId), payload);
    }

    @Put('courses/:tenantId/:id')
    @ApiOperation({ summary: 'Update a course' })
    async updateCourse(@Param('tenantId') tenantId: string, @Param('id') id: string, @Body() payload: any) {
        return this.catalogService.updateCourse(await this.schemaFor(tenantId), id, payload);
    }

    // ─── Campaigns ────────────────────────────────────────────────────────────

    @Get('campaigns/:tenantId')
    @ApiOperation({ summary: 'List all campaigns for a tenant' })
    async getCampaigns(@Param('tenantId') tenantId: string) {
        return this.catalogService.getCampaigns(await this.schemaFor(tenantId));
    }

    @Get('campaigns/:tenantId/:id')
    @ApiOperation({ summary: 'Get a single campaign by ID' })
    async getCampaign(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        return this.catalogService.getCampaignById(await this.schemaFor(tenantId), id);
    }

    @Post('campaigns/:tenantId')
    @ApiOperation({ summary: 'Create a new campaign' })
    async createCampaign(@Param('tenantId') tenantId: string, @Body() payload: any) {
        return this.catalogService.createCampaign(await this.schemaFor(tenantId), payload);
    }

    @Put('campaigns/:tenantId/:id')
    @ApiOperation({ summary: 'Update a campaign' })
    async updateCampaign(@Param('tenantId') tenantId: string, @Param('id') id: string, @Body() payload: any) {
        return this.catalogService.updateCampaign(await this.schemaFor(tenantId), id, payload);
    }

    // ─── Offers ───────────────────────────────────────────────────────────────

    @Get('offers/:tenantId')
    @ApiOperation({ summary: 'List commercial offers' })
    async getOffers(@Param('tenantId') tenantId: string) {
        return this.catalogService.getOffers(await this.schemaFor(tenantId));
    }

    @Post('offers/:tenantId')
    @ApiOperation({ summary: 'Create a commercial offer' })
    async createOffer(@Param('tenantId') tenantId: string, @Body() payload: any) {
        return this.catalogService.createOffer(await this.schemaFor(tenantId), { ...payload, tenant_id: tenantId });
    }
}
