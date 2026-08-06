import { Body, Controller, Delete, Get, Logger, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
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
    private readonly logger = new Logger(TenantPaymentsController.name);

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
        @Body() body: { accessToken?: string; publicKey?: string },
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
     * Público a propósito: lo llama MercadoPago, no un usuario. La seguridad no
     * viene de un JWT sino de que nunca se confía en el cuerpo del webhook —
     * sólo trae un id de pago, y el estado real se le vuelve a preguntar a
     * MercadoPago con el token del propio tenant. Un tercero que adivine la URL
     * y mande un id falso no consigue nada: MP no le va a devolver un pago
     * aprobado que no existe.
     */
    @Post('webhook/:tenantId')
    @ApiOperation({ summary: 'MercadoPago webhook for tenant-side payments (public)' })
    async handleWebhook(
        @Param('tenantId') tenantId: string,
        @Body() body: any,
        @Query() query: any,
    ) {
        // Se responde 200 SIEMPRE y se procesa antes de responder. MP reintenta
        // ante un no-2xx, así que un error nuestro no se pierde; pero tampoco
        // queremos que MP marque la URL como caída por un pago que no nos
        // interesa.
        try {
            await this.webhook.process(tenantId, body, query);
        } catch (e: any) {
            this.logger.warn(`[TenantPayments] webhook falló para ${tenantId}: ${e.message}`);
        }
        return { received: true };
    }
}
