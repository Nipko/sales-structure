import {
    Controller, Get, Post, Put, Param, Body, Query,
    UseGuards, BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PhotographyService } from './photography.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('photography')
@Controller('photography')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class PhotographyController {
    constructor(
        private readonly service: PhotographyService,
        private readonly prisma: PrismaService,
    ) {}

    @Get(':tenantId/sessions')
    @ApiOperation({ summary: 'List photo sessions with filters and counts' })
    async list(
        @Param('tenantId') tenantId: string,
        @Query('status') status?: string,
        @Query('sessionType') sessionType?: string,
        @Query('search') search?: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const [sessions, counts] = await Promise.all([
            this.service.listSessions(schemaName, { status, sessionType, search }),
            this.service.countsByStatus(schemaName),
        ]);
        return { success: true, data: { sessions, counts } };
    }

    @Get(':tenantId/sessions/:sessionId')
    @ApiOperation({ summary: 'Get a session detail' })
    async getOne(
        @Param('tenantId') tenantId: string,
        @Param('sessionId') sessionId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.getById(schemaName, sessionId);
        if (!data) throw new BadRequestException('Session not found');
        return { success: true, data };
    }

    @Post(':tenantId/sessions')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Create a new photo session booking' })
    async create(
        @Param('tenantId') tenantId: string,
        @Body() body: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.create(schemaName, body);
        return { success: true, data };
    }

    @Put(':tenantId/sessions/:sessionId')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Update a photo session' })
    async update(
        @Param('tenantId') tenantId: string,
        @Param('sessionId') sessionId: string,
        @Body() body: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.update(schemaName, sessionId, body);
        return { success: true, data };
    }

    @Put(':tenantId/sessions/:sessionId/deliver')
    @Roles('tenant_admin', 'tenant_supervisor')
    @ApiOperation({ summary: 'Mark session as delivered with gallery URL' })
    async deliver(
        @Param('tenantId') tenantId: string,
        @Param('sessionId') sessionId: string,
        @Body() body: { galleryUrl: string; galleryPassword?: string },
    ) {
        if (!body.galleryUrl) throw new BadRequestException('galleryUrl is required');
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.markDelivered(schemaName, sessionId, body.galleryUrl, body.galleryPassword);
        return { success: true, data };
    }
}
