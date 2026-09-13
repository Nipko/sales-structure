import {
    Controller,
    Get,
    Post,
    Delete,
    Param,
    Body,
    Query,
    Req,
    Res,
    UseGuards,
    BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { ExternalCrmService } from './external-crm.service';
import { CrmImportService } from './crm-import.service';
import { CrmAdapterFactory } from './crm-adapter.factory';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * Binding a business to its CRM is an owner's decision, not an inbox operator's.
 *
 * Every tenant-scoped route below starts an OAuth flow that stores the tenant's
 * credentials, tests them, unbinds them, or copies contacts across. They all
 * carried `TenantGuard` and no `RolesGuard`, which answers "is this your
 * tenant?" and never "may you do this in it" — so a `tenant_agent`, whose whole
 * job is answering messages in the inbox, could disconnect the company's
 * HubSpot or start an import into it.
 */
@Controller('external-crm')
export class ExternalCrmController {
    constructor(
        private readonly service: ExternalCrmService,
        private readonly importService: CrmImportService,
        private readonly factory: CrmAdapterFactory,
        private readonly config: ConfigService,
    ) {}

    @Get('providers')
    @UseGuards(AuthGuard('jwt'))
    listProviders() {
        return { success: true, data: { providers: this.factory.listSupported() } };
    }

    @Get(':tenantId/connections')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin', 'tenant_admin')
    async list(@Param('tenantId') tenantId: string) {
        return { success: true, data: await this.service.listConnections(tenantId) };
    }

    @Post(':tenantId/connect/:provider')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin', 'tenant_admin')
    async connect(
        @Param('tenantId') tenantId: string,
        @Param('provider') provider: string,
    ) {
        const redirectUri = this.redirectUri(provider);
        return { success: true, data: await this.service.startOAuth(tenantId, provider, redirectUri) };
    }

    // OAuth callback — public endpoint (no auth) since the OAuth provider redirects here.
    // Authorization happens via signed `state`.
    @Get('callback/:provider')
    async callback(
        @Param('provider') provider: string,
        @Query('code') code: string,
        @Query('state') state: string,
        @Res() res: Response,
    ) {
        if (!code || !state) throw new BadRequestException('Missing code or state');
        const dashboardUrl = this.config.get<string>('DASHBOARD_URL', 'https://admin.parallly-chat.cloud');
        try {
            const r = await this.service.completeOAuth(state, code, this.redirectUri(provider));
            res.redirect(`${dashboardUrl}/admin/settings/integrations/crm?connected=${provider}&account=${encodeURIComponent(r.externalAccountName ?? '')}`);
        } catch (e: any) {
            res.redirect(
                `${dashboardUrl}/admin/settings/integrations/crm?error=${encodeURIComponent(e.message)}`,
            );
        }
    }

    @Post(':tenantId/connections/:connectionId/test')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin', 'tenant_admin')
    async test(@Param('tenantId') tenantId: string, @Param('connectionId') connectionId: string) {
        return { success: true, data: await this.service.testConnection(tenantId, connectionId) };
    }

    @Delete(':tenantId/connections/:connectionId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin', 'tenant_admin')
    async disconnect(@Param('tenantId') tenantId: string, @Param('connectionId') connectionId: string) {
        return { success: true, data: await this.service.disconnect(tenantId, connectionId) };
    }

    // ─── Initial import ──────────────────────────────────────────────────────

    @Get(':tenantId/connections/:connectionId/import/preview')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin', 'tenant_admin')
    async previewImport(@Param('tenantId') tenantId: string, @Param('connectionId') connectionId: string) {
        return { success: true, data: await this.importService.preview(tenantId, connectionId) };
    }

    @Post(':tenantId/connections/:connectionId/import/start')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin', 'tenant_admin')
    async startImport(
        @Param('tenantId') tenantId: string,
        @Param('connectionId') connectionId: string,
        @Req() req: any,
    ) {
        return { success: true, data: await this.importService.start(tenantId, connectionId, req.user.id) };
    }

    @Get(':tenantId/imports/:importId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin', 'tenant_admin')
    async getImport(@Param('tenantId') tenantId: string, @Param('importId') importId: string) {
        return { success: true, data: await this.importService.getStatus(tenantId, importId) };
    }

    @Get(':tenantId/connections/:connectionId/imports')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin', 'tenant_admin')
    async listImports(@Param('tenantId') tenantId: string, @Param('connectionId') connectionId: string) {
        return { success: true, data: await this.importService.listImports(tenantId, connectionId) };
    }

    private redirectUri(provider: string): string {
        const base = this.config.get<string>('API_PUBLIC_URL', 'https://api.parallly-chat.cloud/api/v1');
        return `${base}/external-crm/callback/${provider}`;
    }
}
