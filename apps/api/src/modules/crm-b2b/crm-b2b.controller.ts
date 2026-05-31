import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OrganizationsService } from './organizations.service';
import { ForecastingService } from './forecasting.service';

/**
 * CRM B2B (T3.21): organizations, weighted-pipeline forecast, deal rotting.
 */
@Controller('crm-b2b')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class CrmB2bController {
    constructor(
        private readonly organizations: OrganizationsService,
        private readonly forecasting: ForecastingService,
    ) {}

    // ── Organizations ────────────────────────────────────────
    @Get(':tenantId/organizations')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async list(@Param('tenantId') tenantId: string, @Query('search') search?: string) {
        return { success: true, data: await this.organizations.list(tenantId, search) };
    }

    @Get(':tenantId/organizations/:id')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor', 'tenant_agent')
    async get(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        return { success: true, data: await this.organizations.get(tenantId, id) };
    }

    @Post(':tenantId/organizations')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async create(@Param('tenantId') tenantId: string, @Body() body: any) {
        return { success: true, data: await this.organizations.create(tenantId, body) };
    }

    @Put(':tenantId/organizations/:id')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async update(@Param('tenantId') tenantId: string, @Param('id') id: string, @Body() body: any) {
        return { success: true, data: await this.organizations.update(tenantId, id, body) };
    }

    @Delete(':tenantId/organizations/:id')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async remove(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        await this.organizations.remove(tenantId, id);
        return { success: true };
    }

    @Put(':tenantId/leads/:leadId/organization')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async assign(@Param('tenantId') tenantId: string, @Param('leadId') leadId: string, @Body() body: { organizationId: string | null }) {
        await this.organizations.assignLead(tenantId, leadId, body.organizationId || null);
        return { success: true };
    }

    // ── Forecast + rotting ───────────────────────────────────
    @Get(':tenantId/forecast')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async forecast(@Param('tenantId') tenantId: string) {
        return { success: true, data: await this.forecasting.getForecast(tenantId) };
    }

    @Get(':tenantId/rotting')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async rotting(@Param('tenantId') tenantId: string, @Query('days') days?: string) {
        const rottingDays = Math.min(Math.max(parseInt(days || '14') || 14, 1), 365);
        return { success: true, data: await this.forecasting.getRotting(tenantId, rottingDays) };
    }
}
