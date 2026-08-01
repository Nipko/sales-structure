import {
    Controller, Get, Post, Put, Param, Body, Query,
    UseGuards, BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { HomeServicesService } from './home-services.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('home-services')
@Controller('home-services')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class HomeServicesController {
    constructor(
        private readonly service: HomeServicesService,
        private readonly prisma: PrismaService,
    ) {}

    @Get(':tenantId/requests')
    async list(
        @Param('tenantId') tenantId: string,
        @Query('status') status?: string,
        @Query('urgency') urgency?: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.listRequests(schemaName, { status, urgency });
        return { success: true, data };
    }

    @Get(':tenantId/requests/:id')
    async get(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.getRequestById(schemaName, id);
        if (!data) throw new BadRequestException('Request not found');
        return { success: true, data };
    }

    @Post(':tenantId/requests')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async create(@Param('tenantId') tenantId: string, @Body() body: any) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.createRequest(schemaName, body);
        return { success: true, data };
    }

    @Put(':tenantId/requests/:id')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async update(@Param('tenantId') tenantId: string, @Param('id') id: string, @Body() body: any) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.updateRequest(schemaName, id, body);
        return { success: true, data };
    }
}
