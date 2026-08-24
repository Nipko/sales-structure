import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationOutboxService } from './integration-outbox.service';
import { IntegrationOutboxWorker } from './integration-outbox.worker';

/**
 * La superficie de revisión del andamiaje de integraciones.
 *
 * El outbox registraba todo —lo suprimido porque el proveedor no está
 * certificado, lo muerto tras agotar intentos, lo vencido— en una tabla por
 * tenant que **nadie podía consultar**. Una escritura muerta es exactamente lo
 * que necesita ojos humanos, y estaba en el único lugar donde no había ojos.
 *
 * Es `super_admin` y no del tenant a propósito: lo que se ve acá es el estado
 * del riel de integraciones de la plataforma —qué proveedores están
 * certificados, cuáles tienen adapter, qué se acumuló mientras no lo estaban—,
 * y eso es una decisión de operación, no una pantalla de configuración.
 *
 * El payload nunca viaja: puede traer datos del cliente final del tenant.
 */
@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
    constructor(
        private readonly prisma: PrismaService,
        private readonly outbox: IntegrationOutboxService,
        private readonly worker: IntegrationOutboxWorker,
    ) {}

    @Get('rail')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin')
    @ApiOperation({ summary: 'Estado del riel de integraciones (super_admin)' })
    async rail() {
        const certified = String(process.env.INTEGRATION_WRITE_PROVIDERS || '')
            .split(',')
            .map(entry => entry.trim().toLowerCase())
            .filter(Boolean);
        const registered = this.worker.registeredProviders();
        return {
            // Certificado sin adapter significa que el interruptor está
            // encendido y no hay nadie que ejecute: sus entradas mueren con
            // `no_adapter_registered` en vez de acumularse en silencio.
            certified,
            registered,
            certifiedWithoutAdapter: certified.filter(p => !registered.includes(p)),
            adapterWithoutCertification: registered.filter(p => !certified.includes(p)),
        };
    }

    @Get('outbox')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin')
    @ApiOperation({ summary: 'Revisión global del outbox de integraciones (super_admin)' })
    async outboxOverview() {
        const tenants = await this.outbox.trackedTenants('outbox');
        const review = [];

        // Deliberately bounded by the work registry and sequential: opening an
        // Ops page must not fan out an unbounded number of tenant transactions.
        for (const tenant of tenants) {
            const state = await this.outbox.review(tenant.schemaName);
            review.push({
                tenantId: tenant.id,
                tenantName: tenant.name,
                byStatus: state.byStatus,
                attention: state.attention,
            });
        }

        return { tenants: review };
    }

    @Get('outbox/:tenantId')
    @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
    @Roles('super_admin')
    @ApiOperation({ summary: 'Escrituras pendientes y detenidas de un tenant (super_admin)' })
    async outboxReview(@Param('tenantId') tenantId: string) {
        // El schema se resuelve por id: `@CurrentTenant()` devuelve el tenantId
        // y pasarlo como nombre de schema es el error que ya costó cinco
        // funciones muertas con `3F000` en producción.
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        return this.outbox.review(schemaName);
    }
}
