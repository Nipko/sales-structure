import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { auditActor } from '../../common/utils/audit-actor.util';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPaymentsService } from './tenant-payments.service';
import { TenantPaymentsWebhookService } from './tenant-payments-webhook.service';
import { TenantWompiWebhookService } from './tenant-wompi-webhook.service';
import type { TenantPaymentProvider } from './tenant-payment-reference';

@ApiTags('tenant-payments')
@Controller('tenant-payments')
export class TenantPaymentsController {
    constructor(
        private readonly service: TenantPaymentsService,
        private readonly webhook: TenantPaymentsWebhookService,
        private readonly wompiWebhook: TenantWompiWebhookService,
        private readonly prisma: PrismaService,
    ) {}

    /**
     * Durable attribution for every change to a money rail.
     *
     * A super_admin can already reach these routes without impersonating, so
     * without this the record of who replaced a tenant's payment credentials
     * existed nowhere — not a privilege escalation, but a total loss of
     * attribution over the credentials that collect the tenant's revenue. The
     * sibling channels module already audits its credential writes.
     *
     * `auditActor` records the REAL operator during impersonation, where
     * req.user is the impersonated tenant user. Never log a secret: only which
     * fields were touched.
     */
    private async audit(
        req: any,
        tenantId: string,
        action: string,
        details: Record<string, unknown>,
    ): Promise<void> {
        try {
            const actor = auditActor(req?.user);
            await this.prisma.auditLog.create({
                data: {
                    tenantId,
                    userId: actor.userId,
                    action,
                    resource: `tenant-payments/${tenantId}`,
                    details: {
                        ...details,
                        ...(actor.delegation ? { delegation: actor.delegation } : {}),
                    } as any,
                },
            });
        } catch {
            // Audit must never block the owner from fixing their own billing.
        }
    }

    /*
     * Las credenciales de cobro son dinero del negocio: sólo el dueño.
     * tenant_admin, igual que el resto de billing.
     */
    @Get(':tenantId/config')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('tenant_admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get the tenant payment provider config (token masked)' })
    async getConfig(@Param('tenantId') tenantId: string) {
        const data = await this.service.getConfig(tenantId);
        return { success: true, data };
    }

    @Put(':tenantId/config')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('tenant_admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Save MercadoPago credentials (verified against MP before storing)' })
    async setConfig(
        @Param('tenantId') tenantId: string,
        @Body() body: {
            provider?: TenantPaymentProvider;
            activate?: boolean;
            accessToken?: string;
            publicKey?: string;
            webhookSecret?: string;
            privateKey?: string;
            eventsSecret?: string;
            environment?: 'sandbox' | 'production';
        },
        @Req() req?: any,
    ) {
        const data = await this.service.setConfig(tenantId, body || {});
        await this.audit(req, tenantId, 'tenant_payment_credentials_updated', {
            provider: body?.provider || 'mercadopago',
            environment: body?.environment,
            // Which secrets were replaced — never their values.
            fieldsProvided: Object.keys(body || {}).filter((k) => k !== 'provider'),
        });
        return { success: true, data };
    }

    @Put(':tenantId/config/:provider')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('tenant_admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Save one tenant-owned payment provider config' })
    async setProviderConfig(
        @Param('tenantId') tenantId: string,
        @Param('provider') provider: TenantPaymentProvider,
        @Body() body: any,
        @Req() req?: any,
    ) {
        const data = await this.service.setConfig(tenantId, { ...(body || {}), provider });
        await this.audit(req, tenantId, 'tenant_payment_credentials_updated', {
            provider,
            environment: body?.environment,
            fieldsProvided: Object.keys(body || {}).filter((k) => k !== 'provider'),
        });
        return { success: true, data };
    }

    @Put(':tenantId/active-provider')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('tenant_admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Activate a verified tenant-owned payment provider' })
    async activateProvider(
        @Param('tenantId') tenantId: string,
        @Body() body: { provider: TenantPaymentProvider },
        @Req() req?: any,
    ) {
        const data = await this.service.activateProvider(tenantId, body?.provider);
        await this.audit(req, tenantId, 'tenant_payment_provider_activated', { provider: body?.provider });
        return { success: true, data };
    }

    /*
     * Payments the ledger parked in a review state. Before this existed they
     * were invisible and unresolvable: the only way out was hand-written SQL
     * against production.
     */
    @Get(':tenantId/intents/unresolved')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('tenant_admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'List payments parked in requires_review / ambiguous' })
    async listUnresolved(@Param('tenantId') tenantId: string) {
        const data = await this.service.listUnresolvedIntents(tenantId);
        return { success: true, data };
    }

    /*
     * The body carries a REASON, never a target status: the provider decides
     * the outcome. An operator must not be able to declare a payment received.
     */
    @Post(':tenantId/intents/:intentId/resolve')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('tenant_admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Re-check one parked payment against the provider and close it' })
    async resolveUnresolved(
        @Param('tenantId') tenantId: string,
        @Param('intentId', new ParseUUIDPipe()) intentId: string,
        @Body() body: { reason?: string },
        @Req() req?: any,
    ) {
        const data = await this.service.resolveUnresolvedIntent(tenantId, intentId, body?.reason || '');
        await this.audit(req, tenantId, 'tenant_payment_intent_resolved', {
            intentId,
            outcome: data.outcome,
            status: data.status,
            reason: body?.reason,
        });
        return { success: true, data };
    }

    @Delete(':tenantId/config')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('tenant_admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Disconnect the tenant payment account' })
    async disconnect(@Param('tenantId') tenantId: string, @Req() req?: any) {
        await this.service.disconnect(tenantId);
        await this.audit(req, tenantId, 'tenant_payment_disconnected', { scope: 'all' });
        return { success: true };
    }

    @Delete(':tenantId/config/:provider')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('tenant_admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Disconnect one tenant-owned payment provider' })
    async disconnectProvider(
        @Param('tenantId') tenantId: string,
        @Param('provider') provider: TenantPaymentProvider,
        @Req() req?: any,
    ) {
        const data = await this.service.disconnectProvider(tenantId, provider);
        await this.audit(req, tenantId, 'tenant_payment_disconnected', { provider });
        return { success: true, data };
    }

    /**
     * Webhook de MercadoPago para los cobros DEL TENANT.
     *
     * Público a propósito: lo llama MercadoPago, no un usuario. La seguridad
     * viene de la firma HMAC por tenant y de volver a consultar el pago con el
     * token de esa misma cuenta; el cuerpo por sí solo nunca cambia estado.
     */
    @Post('webhook/:tenantId')
    @ApiOperation({ summary: 'MercadoPago webhook for tenant-side payments (public)' })
    async handleWebhook(
        @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
        @Body() body: any,
        @Query() query: any,
        @Headers('x-signature') signature?: string,
        @Headers('x-request-id') requestId?: string,
    ) {
        // Los errores transitorios se dejan propagar como 5xx para que Mercado
        // Pago reintente; las firmas inválidas responden 401.
        await this.webhook.process(tenantId, body, query, signature, requestId);
        return { received: true };
    }

    @Post('webhook/wompi/:tenantId/:callbackToken')
    @ApiOperation({ summary: 'Wompi webhook for tenant-side payments (public, opaque callback token)' })
    async handleWompiWebhook(
        @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
        @Param('callbackToken') callbackToken: string,
        @Body() body: any,
        @Headers('x-event-checksum') checksum?: string,
    ) {
        // A 2xx is returned only after the attempt and any settlement transition
        // have committed. Transient provider/database failures propagate as 5xx.
        await this.wompiWebhook.process(tenantId, callbackToken, body, checksum);
        return { received: true };
    }
}
