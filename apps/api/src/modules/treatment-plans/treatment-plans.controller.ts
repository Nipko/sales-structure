import {
    Controller, Get, Post, Put, Delete, Param, Body,
    UseGuards, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { TreatmentPlansService } from './treatment-plans.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('treatment-plans')
@Controller('treatment-plans')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class TreatmentPlansController {
    constructor(
        private readonly service: TreatmentPlansService,
        private readonly prisma: PrismaService,
    ) {}

    @Get(':tenantId/contacts/:contactId')
    @ApiOperation({ summary: 'List treatment plans for a contact' })
    async listForContact(
        @Param('tenantId') tenantId: string,
        @Param('contactId') contactId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.listForContact(schemaName, contactId);
        return { success: true, data };
    }

    @Post(':tenantId/plans')
    @ApiOperation({ summary: 'Create a treatment plan' })
    async createPlan(
        @Param('tenantId') tenantId: string,
        @Body() body: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.create(schemaName, body);
        return { success: true, data };
    }

    @Get(':tenantId/plans/:planId')
    @ApiOperation({ summary: 'Get a treatment plan with its sessions' })
    async getPlan(
        @Param('tenantId') tenantId: string,
        @Param('planId') planId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const plan = await this.service.getById(schemaName, planId);
        if (!plan) throw new BadRequestException('Plan not found');
        const sessions = await this.service.listSessions(schemaName, planId);
        return { success: true, data: { ...plan, sessions } };
    }

    @Put(':tenantId/plans/:planId')
    @ApiOperation({ summary: 'Update a treatment plan' })
    async updatePlan(
        @Param('tenantId') tenantId: string,
        @Param('planId') planId: string,
        @Body() body: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.update(schemaName, planId, body);
        return { success: true, data };
    }

    @Delete(':tenantId/plans/:planId')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Cancel a treatment plan' })
    async deletePlan(
        @Param('tenantId') tenantId: string,
        @Param('planId') planId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.service.delete(schemaName, planId);
        return { success: true };
    }

    @Post(':tenantId/plans/:planId/sessions')
    @ApiOperation({ summary: 'Add a session to a plan' })
    async addSession(
        @Param('tenantId') tenantId: string,
        @Param('planId') planId: string,
        @Body() body: any,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.addSession(schemaName, planId, body);
        return { success: true, data };
    }

    @Put(':tenantId/sessions/:sessionId/complete')
    @ApiOperation({ summary: 'Mark a session as completed' })
    async completeSession(
        @Param('tenantId') tenantId: string,
        @Param('sessionId') sessionId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.completeSession(schemaName, sessionId);
        return { success: true, data };
    }

    @Put(':tenantId/sessions/:sessionId/cancel')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Cancel a session' })
    async cancelSession(
        @Param('tenantId') tenantId: string,
        @Param('sessionId') sessionId: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.service.cancelSession(schemaName, sessionId);
        return { success: true };
    }
}
