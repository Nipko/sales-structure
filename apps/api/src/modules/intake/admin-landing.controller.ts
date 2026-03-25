import { Controller, Get, Post, Body, Param, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IntakeService } from './intake.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('admin-landings')
@Controller('intake/admin/landings')
export class AdminLandingController {
    private readonly logger = new Logger(AdminLandingController.name);

    constructor(
        private readonly intakeService: IntakeService,
        private readonly prisma: PrismaService,
    ) {}

    private async schemaFor(tenantId: string) {
        return this.prisma.getTenantSchemaName(tenantId);
    }

    @Get(':tenantId')
    @ApiOperation({ summary: 'List all landing pages for a tenant' })
    async getLandingPages(@Param('tenantId') tenantId: string) {
        return this.intakeService.findLandingPages(await this.schemaFor(tenantId));
    }

    @Post(':tenantId')
    @ApiOperation({ summary: 'Create a new landing page' })
    async createLandingPage(
        @Param('tenantId') tenantId: string,
        @Body() payload: any
    ) {
        return this.intakeService.createLandingPage(await this.schemaFor(tenantId), payload);
    }
}
