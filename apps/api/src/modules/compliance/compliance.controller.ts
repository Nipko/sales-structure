import { Controller, Get, Post, Put, Body, Param, Query, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ComplianceService } from './compliance.service';
import { ComplianceService as AnalyticsComplianceService } from '../analytics/compliance.service';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentUser } from '../../common/decorators/tenant.decorator';

@ApiTags('compliance')
@Controller('compliance')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class ComplianceController {
    private readonly logger = new Logger(ComplianceController.name);

    constructor(
        private readonly complianceService: ComplianceService,
        private readonly analyticsCompliance: AnalyticsComplianceService,
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

    // ─── Opt-Outs (with review workflow) ────────────────────────────────────

    @Get('opt-outs/:tenantId')
    @ApiOperation({ summary: 'List opt-out records with status filter' })
    async getOptOuts(
        @Param('tenantId') tenantId: string,
        @Query('status') status?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        const result = await this.analyticsCompliance.getOptOuts(
            tenantId, status, parseInt(page || '1'), parseInt(limit || '50'),
        );
        return { success: true, data: result.data, total: result.total };
    }

    @Get('opt-outs/:tenantId/stats')
    @ApiOperation({ summary: 'Get opt-out statistics' })
    async getOptOutStats(@Param('tenantId') tenantId: string) {
        const stats = await this.analyticsCompliance.getStats(tenantId);
        return { success: true, data: stats };
    }

    @Put('opt-outs/:tenantId/:recordId/confirm')
    @ApiOperation({ summary: 'Confirm opt-out (block the lead)' })
    async confirmOptOut(
        @Param('tenantId') tenantId: string,
        @Param('recordId') recordId: string,
        @CurrentUser() user: any,
        @Body() body: { notes?: string },
    ) {
        await this.analyticsCompliance.confirmOptOut(tenantId, recordId, user.id, body.notes);
        return { success: true };
    }

    @Put('opt-outs/:tenantId/:recordId/reject')
    @ApiOperation({ summary: 'Reject opt-out (false positive, do not block)' })
    async rejectOptOut(
        @Param('tenantId') tenantId: string,
        @Param('recordId') recordId: string,
        @CurrentUser() user: any,
        @Body() body: { notes?: string },
    ) {
        await this.analyticsCompliance.rejectOptOut(tenantId, recordId, user.id, body.notes);
        return { success: true };
    }

    @Post('opt-outs/:tenantId')
    @ApiOperation({ summary: 'Register a manual opt-out' })
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
