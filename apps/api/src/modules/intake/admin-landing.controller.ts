import { Controller, Get, Post, Body, Param, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { IntakeService } from './intake.service';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';

@ApiTags('admin-landings')
@Controller('intake/admin/landings')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
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
