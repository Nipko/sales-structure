import { Controller, Get, Post, Put, Body, Param, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CatalogService } from './catalog.service';

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
    private readonly logger = new Logger(CatalogController.name);

    constructor(private readonly catalogService: CatalogService) {}

    private schemaFor(tenantId: string) {
        return `tenant_${tenantId.replace(/-/g, '_')}`;
    }

    // ─── Courses ──────────────────────────────────────────────────────────────

    @Get('courses/:tenantId')
    @ApiOperation({ summary: 'List all courses for a tenant' })
    async getCourses(@Param('tenantId') tenantId: string) {
        return this.catalogService.getCourses(this.schemaFor(tenantId));
    }

    @Get('courses/:tenantId/:id')
    @ApiOperation({ summary: 'Get a single course by ID' })
    async getCourse(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        return this.catalogService.getCourseById(this.schemaFor(tenantId), id);
    }

    @Post('courses/:tenantId')
    @ApiOperation({ summary: 'Create a new course' })
    async createCourse(@Param('tenantId') tenantId: string, @Body() payload: any) {
        return this.catalogService.createCourse(this.schemaFor(tenantId), payload);
    }

    @Put('courses/:tenantId/:id')
    @ApiOperation({ summary: 'Update a course' })
    async updateCourse(@Param('tenantId') tenantId: string, @Param('id') id: string, @Body() payload: any) {
        return this.catalogService.updateCourse(this.schemaFor(tenantId), id, payload);
    }

    // ─── Campaigns ────────────────────────────────────────────────────────────

    @Get('campaigns/:tenantId')
    @ApiOperation({ summary: 'List all campaigns for a tenant' })
    async getCampaigns(@Param('tenantId') tenantId: string) {
        return this.catalogService.getCampaigns(this.schemaFor(tenantId));
    }

    @Get('campaigns/:tenantId/:id')
    @ApiOperation({ summary: 'Get a single campaign by ID' })
    async getCampaign(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        return this.catalogService.getCampaignById(this.schemaFor(tenantId), id);
    }

    @Post('campaigns/:tenantId')
    @ApiOperation({ summary: 'Create a new campaign' })
    async createCampaign(@Param('tenantId') tenantId: string, @Body() payload: any) {
        return this.catalogService.createCampaign(this.schemaFor(tenantId), payload);
    }

    @Put('campaigns/:tenantId/:id')
    @ApiOperation({ summary: 'Update a campaign' })
    async updateCampaign(@Param('tenantId') tenantId: string, @Param('id') id: string, @Body() payload: any) {
        return this.catalogService.updateCampaign(this.schemaFor(tenantId), id, payload);
    }

    // ─── Offers ───────────────────────────────────────────────────────────────

    @Get('offers/:tenantId')
    @ApiOperation({ summary: 'List commercial offers' })
    async getOffers(@Param('tenantId') tenantId: string) {
        return this.catalogService.getOffers(this.schemaFor(tenantId));
    }

    @Post('offers/:tenantId')
    @ApiOperation({ summary: 'Create a commercial offer' })
    async createOffer(@Param('tenantId') tenantId: string, @Body() payload: any) {
        return this.catalogService.createOffer(this.schemaFor(tenantId), { ...payload, tenant_id: tenantId });
    }
}
