import { Controller, Get, Post, Put, Body, Param, Query, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ComplianceService } from './compliance.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('compliance')
@Controller('compliance')
export class ComplianceController {
    private readonly logger = new Logger(ComplianceController.name);

    constructor(
        private readonly complianceService: ComplianceService,
        private readonly prisma: PrismaService,
    ) {}

    private async schemaFor(tenantId: string) {
        return this.prisma.getTenantSchemaName(tenantId);
    }

    // ─── Legal Texts ──────────────────────────────────────────────────────────

    @Get('legal-texts/:tenantId')
    @ApiOperation({ summary: 'List legal text versions' })
    async getLegalTexts(@Param('tenantId') tenantId: string) {
        return this.complianceService.getLegalTexts(await this.schemaFor(tenantId));
    }

    @Post('legal-texts/:tenantId')
    @ApiOperation({ summary: 'Create a new legal text version' })
    async createLegalText(@Param('tenantId') tenantId: string, @Body() payload: any) {
        return this.complianceService.createLegalText(await this.schemaFor(tenantId), { ...payload, tenant_id: tenantId });
    }

    // ─── Consents ─────────────────────────────────────────────────────────────

    @Get('consents/:tenantId')
    @ApiOperation({ summary: 'List consent records' })
    async getConsents(@Param('tenantId') tenantId: string, @Query('leadId') leadId?: string) {
        return this.complianceService.getConsents(await this.schemaFor(tenantId), leadId);
    }

    @Post('consents/:tenantId')
    @ApiOperation({ summary: 'Record a new consent' })
    async createConsent(@Param('tenantId') tenantId: string, @Body() payload: any) {
        return this.complianceService.createConsent(await this.schemaFor(tenantId), { ...payload, tenant_id: tenantId });
    }

    // ─── Opt-Outs ─────────────────────────────────────────────────────────────

    @Get('opt-outs/:tenantId')
    @ApiOperation({ summary: 'List opt-out records' })
    async getOptOuts(@Param('tenantId') tenantId: string) {
        return this.complianceService.getOptOuts(await this.schemaFor(tenantId));
    }

    @Post('opt-outs/:tenantId')
    @ApiOperation({ summary: 'Register an opt-out' })
    async createOptOut(@Param('tenantId') tenantId: string, @Body() payload: any) {
        return this.complianceService.createOptOut(await this.schemaFor(tenantId), { ...payload, tenant_id: tenantId });
    }

    // ─── Deletion Requests ────────────────────────────────────────────────────

    @Get('deletion-requests/:tenantId')
    @ApiOperation({ summary: 'List deletion requests' })
    async getDeletionRequests(@Param('tenantId') tenantId: string) {
        return this.complianceService.getDeletionRequests(await this.schemaFor(tenantId));
    }

    @Post('deletion-requests/:tenantId')
    @ApiOperation({ summary: 'Create a deletion request' })
    async createDeletionRequest(@Param('tenantId') tenantId: string, @Body() payload: any) {
        return this.complianceService.createDeletionRequest(await this.schemaFor(tenantId), { ...payload, tenant_id: tenantId });
    }

    @Put('deletion-requests/:tenantId/:id/process')
    @ApiOperation({ summary: 'Process a deletion request' })
    async processDeletionRequest(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        return this.complianceService.processDeletionRequest(await this.schemaFor(tenantId), id);
    }
}
