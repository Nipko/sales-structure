import {
    Controller, Get, Post, Put, Delete, Param, Body, Query,
    UseGuards, HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { InsuranceService } from './insurance.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('insurance')
@Controller('insurance')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class InsuranceController {
    constructor(
        private readonly service: InsuranceService,
        private readonly prisma: PrismaService,
    ) {}

    // Plans
    @Get(':tenantId/plans')
    async listPlans(@Param('tenantId') tenantId: string, @Query('type') type?: string, @Query('coverageLevel') coverageLevel?: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.listPlans(schemaName, { type, coverageLevel });
        return { success: true, data };
    }

    @Post(':tenantId/plans')
    async createPlan(@Param('tenantId') tenantId: string, @Body() body: any) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.createPlan(schemaName, body);
        return { success: true, data };
    }

    @Put(':tenantId/plans/:id')
    async updatePlan(@Param('tenantId') tenantId: string, @Param('id') id: string, @Body() body: any) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.updatePlan(schemaName, id, body);
        return { success: true, data };
    }

    @Delete(':tenantId/plans/:id')
    @HttpCode(HttpStatus.OK)
    async deletePlan(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.service.deletePlan(schemaName, id);
        return { success: true };
    }

    // Quotes
    @Get(':tenantId/quotes')
    async listQuotes(@Param('tenantId') tenantId: string, @Query('contactId') contactId?: string, @Query('status') status?: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.listQuotes(schemaName, { contactId, status });
        return { success: true, data };
    }

    @Post(':tenantId/quotes')
    async createQuote(@Param('tenantId') tenantId: string, @Body() body: any) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.createQuote(schemaName, body);
        return { success: true, data };
    }

    @Put(':tenantId/quotes/:id/status')
    async updateQuoteStatus(@Param('tenantId') tenantId: string, @Param('id') id: string, @Body() body: { status: string }) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.updateQuoteStatus(schemaName, id, body.status);
        return { success: true, data };
    }

    // Policies
    @Get(':tenantId/policies')
    async listPolicies(@Param('tenantId') tenantId: string, @Query('contactId') contactId?: string, @Query('status') status?: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.listPolicies(schemaName, { contactId, status });
        return { success: true, data };
    }

    @Get(':tenantId/policies/by-number/:policyNumber')
    async getPolicyByNumber(@Param('tenantId') tenantId: string, @Param('policyNumber') policyNumber: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.getPolicyByNumber(schemaName, policyNumber);
        if (!data) throw new BadRequestException('Policy not found');
        return { success: true, data };
    }

    @Post(':tenantId/policies')
    async createPolicy(@Param('tenantId') tenantId: string, @Body() body: any) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.createPolicy(schemaName, body);
        return { success: true, data };
    }

    // Claims
    @Get(':tenantId/claims')
    async listClaims(@Param('tenantId') tenantId: string, @Query('policyId') policyId?: string, @Query('status') status?: string) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.listClaims(schemaName, { policyId, status });
        return { success: true, data };
    }

    @Post(':tenantId/claims')
    async fileClaim(@Param('tenantId') tenantId: string, @Body() body: any) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const data = await this.service.fileClaim(schemaName, body);
        return { success: true, data };
    }
}
