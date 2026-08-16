import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantPaymentsService } from './tenant-payments.service';
import { TenantPaymentsWebhookService } from './tenant-payments-webhook.service';

@ApiTags('tenant-payments')
@Controller('tenant-payments')
export class TenantPaymentsController {
    constructor(
        private readonly service: TenantPaymentsService,
        private readonly webhook: TenantPaymentsWebhookService,
    ) {}

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
        @Body() body: { accessToken?: string; publicKey?: string; webhookSecret?: string },
    ) {
        const data = await this.service.setConfig(tenantId, body || {});
        return { success: true, data };
    }

    @Delete(':tenantId/config')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('tenant_admin')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Disconnect the tenant payment account' })
    async disconnect(@Param('tenantId') tenantId: string) {
        await this.service.disconnect(tenantId);
        return { success: true };
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
}
