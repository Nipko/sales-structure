import { Controller, Get, Post, Put, Body, Query, Req, Res, UseGuards, HttpCode, HttpStatus, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { SamlService, SamlConfig } from './saml.service';
import { AuthService } from './auth.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/tenant.decorator';
import { JwtPayload, UserRole } from '@parallext/shared';

@ApiTags('auth/saml')
@Controller('auth/saml')
export class SamlController {
    constructor(
        private readonly samlService: SamlService,
        private readonly authService: AuthService,
        private readonly configService: ConfigService,
    ) {}

    @Get('check')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Check if SSO is available for an email domain' })
    async checkSso(@Query('email') email: string) {
        if (!email) return { success: true, data: { ssoAvailable: false } };

        const result = await this.samlService.findTenantByEmailDomain(email);
        return {
            success: true,
            data: {
                ssoAvailable: !!result,
                tenantId: result?.tenantId,
                forceSso: result?.config.forceSso || false,
            },
        };
    }

    @Get('login')
    @ApiOperation({ summary: 'Initiate SAML SSO login (redirects to IdP)' })
    @UseGuards(AuthGuard('saml'))
    async login() {
        // Passport handles the redirect
    }

    @Post('acs')
    @ApiOperation({ summary: 'SAML Assertion Consumer Service (ACS) callback' })
    @UseGuards(AuthGuard('saml'))
    async acs(@Req() req: Request, @Res() res: Response) {
        const dashboardUrl = this.configService.get('DASHBOARD_URL', 'https://admin.parallly-chat.cloud');

        try {
            const samlUser = req.user as any;
            const { tenantId, email, firstName, lastName, nameId } = samlUser;

            const config = await this.samlService.getSamlConfig(tenantId);
            if (!config?.enabled) {
                return res.redirect(`${dashboardUrl}/login?error=SSO+not+configured`);
            }

            const user = await this.samlService.provisionOrLinkUser(
                tenantId,
                { email, firstName, lastName, nameId },
                config,
            );

            if (user.twoFactorEnabled) {
                const twoFAToken = (this.authService as any).generate2FAToken(user.id);
                const exchangeCode = await this.authService.createExchangeCode({
                    requires2FA: true,
                    twoFAToken,
                    twoFactorMethod: user.twoFactorMethod || 'totp',
                });
                return res.redirect(`${dashboardUrl}/auth/callback?code=${exchangeCode}`);
            }

            await (this.authService as any).prisma.user.update({
                where: { id: user.id },
                data: { lastLoginAt: new Date() },
            });

            const sid = await (this.authService as any).createSession(user.id, user.tenantId || undefined);
            const payload: JwtPayload = {
                sub: user.id,
                email: user.email,
                role: user.role as UserRole,
                tenantId: user.tenantId || undefined,
            };

            const { accessToken, refreshToken } = await (this.authService as any).generateTokens(payload, { rememberMe: true, sid });
            const effectiveOnboarding = user.role === 'super_admin' || !!user.tenantId || user.onboardingCompleted;

            const exchangeCode = await this.authService.createExchangeCode({
                accessToken,
                refreshToken,
                user: {
                    id: user.id,
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    role: user.role,
                    tenantId: user.tenantId,
                    tenantName: user.tenant?.name,
                    picture: user.picture,
                    hasPassword: !!user.password,
                    emailVerified: user.emailVerified,
                    onboardingCompleted: effectiveOnboarding,
                },
            });

            return res.redirect(`${dashboardUrl}/auth/callback?code=${exchangeCode}`);
        } catch (error: any) {
            return res.redirect(`${dashboardUrl}/login?error=${encodeURIComponent(error.message || 'SSO login failed')}`);
        }
    }

    @Get('metadata/:tenantId')
    @ApiOperation({ summary: 'Download SP metadata XML for a tenant' })
    async metadata(@Param('tenantId') tenantId: string, @Res() res: Response) {
        const config = await this.samlService.getSamlConfig(tenantId);

        const entityId = config?.spEntityId || `https://api.parallly-chat.cloud/api/v1/auth/saml/metadata/${tenantId}`;
        const acsUrl = 'https://api.parallly-chat.cloud/api/v1/auth/saml/acs';

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata"
    entityID="${entityId}">
  <SPSSODescriptor AuthnRequestsSigned="false"
      WantAssertionsSigned="true"
      protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
    <AssertionConsumerService
        Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
        Location="${acsUrl}"
        index="1" isDefault="true"/>
  </SPSSODescriptor>
</EntityDescriptor>`;

        res.setHeader('Content-Type', 'application/xml');
        res.send(xml);
    }

    // ── Tenant admin: SAML config CRUD ─────────────────────────

    @Get('config')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('tenant_admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get SAML/SSO configuration for current tenant' })
    async getConfig(@CurrentUser() user: any) {
        const config = await this.samlService.getSamlConfig(user.tenantId);
        return {
            success: true,
            data: config ? {
                ...config,
                idpCertificate: config.idpCertificate ? '***CONFIGURED***' : '',
            } : null,
        };
    }

    @Put('config')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('tenant_admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Update SAML/SSO configuration for current tenant' })
    async updateConfig(@CurrentUser() user: any, @Body() body: Partial<SamlConfig>) {
        const config = await this.samlService.updateSamlConfig(user.tenantId, body);
        return {
            success: true,
            data: {
                ...config,
                idpCertificate: config.idpCertificate ? '***CONFIGURED***' : '',
            },
        };
    }

    @Get('forced/:tenantId')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Check if SSO is forced for a tenant (public)' })
    async isSsoForced(@Param('tenantId') tenantId: string) {
        const forced = await this.samlService.isSsoForced(tenantId);
        return { success: true, data: { forced } };
    }
}
