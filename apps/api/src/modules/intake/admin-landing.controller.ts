import { Controller, Get, Post, Body, Param, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IntakeService } from './intake.service';

@ApiTags('admin-landings')
@Controller('intake/admin/landings')
export class AdminLandingController {
    private readonly logger = new Logger(AdminLandingController.name);

    constructor(private readonly intakeService: IntakeService) {}

    @Get(':tenantId')
    @ApiOperation({ summary: 'List all landing pages for a tenant' })
    async getLandingPages(@Param('tenantId') tenantId: string) {
        const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;
        return this.intakeService.findLandingPages(schemaName);
    }

    @Post(':tenantId')
    @ApiOperation({ summary: 'Create a new landing page' })
    async createLandingPage(
        @Param('tenantId') tenantId: string,
        @Body() payload: any
    ) {
        const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;
        return this.intakeService.createLandingPage(schemaName, payload);
    }
}
