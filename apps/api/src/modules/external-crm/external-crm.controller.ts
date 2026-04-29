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
        return { providers: this.factory.listSupported() };
    }

    @Get(':tenantId/connections')
    @UseGuards(AuthGuard('jwt'), TenantGuard)
    list(@Param('tenantId') tenantId: string) {
        return this.service.listConnections(tenantId);
    }

    @Post(':tenantId/connect/:provider')
    @UseGuards(AuthGuard('jwt'), TenantGuard)
    async connect(
        @Param('tenantId') tenantId: string,
        @Param('provider') provider: string,
    ) {
        const redirectUri = this.redirectUri(provider);
        return this.service.startOAuth(tenantId, provider, redirectUri);
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
    @UseGuards(AuthGuard('jwt'), TenantGuard)
    test(@Param('tenantId') tenantId: string, @Param('connectionId') connectionId: string) {
        return this.service.testConnection(tenantId, connectionId);
    }

    @Delete(':tenantId/connections/:connectionId')
    @UseGuards(AuthGuard('jwt'), TenantGuard)
    disconnect(@Param('tenantId') tenantId: string, @Param('connectionId') connectionId: string) {
        return this.service.disconnect(tenantId, connectionId);
    }

    // ─── Initial import ──────────────────────────────────────────────────────

    @Get(':tenantId/connections/:connectionId/import/preview')
    @UseGuards(AuthGuard('jwt'), TenantGuard)
    previewImport(@Param('tenantId') tenantId: string, @Param('connectionId') connectionId: string) {
        return this.importService.preview(tenantId, connectionId);
    }

    @Post(':tenantId/connections/:connectionId/import/start')
    @UseGuards(AuthGuard('jwt'), TenantGuard)
    startImport(
        @Param('tenantId') tenantId: string,
        @Param('connectionId') connectionId: string,
        @Req() req: any,
    ) {
        return this.importService.start(tenantId, connectionId, req.user.sub);
    }

    @Get(':tenantId/imports/:importId')
    @UseGuards(AuthGuard('jwt'), TenantGuard)
    getImport(@Param('tenantId') tenantId: string, @Param('importId') importId: string) {
        return this.importService.getStatus(tenantId, importId);
    }

    @Get(':tenantId/connections/:connectionId/imports')
    @UseGuards(AuthGuard('jwt'), TenantGuard)
    listImports(@Param('tenantId') tenantId: string, @Param('connectionId') connectionId: string) {
        return this.importService.listImports(tenantId, connectionId);
    }

    private redirectUri(provider: string): string {
        const base = this.config.get<string>('API_PUBLIC_URL', 'https://api.parallly-chat.cloud/api/v1');
        return `${base}/external-crm/callback/${provider}`;
    }
}
