import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/tenant.decorator';
import { auditActor } from '../../common/utils/audit-actor.util';
import { RegionalProfileService } from './regional-profile.service';

/**
 * La identidad regional del negocio, y quién la decide.
 *
 * El servicio detectaba conflictos desde hacía un release —país de facturación
 * contra país escrito en Business Info, moneda que no corresponde al país— y
 * los guardaba en `regional_identity_reviews`. Faltaban las dos puntas:
 * `queueConflictsForReview` **no tenía ningún llamador**, así que la tabla
 * estaba permanentemente vacía, y no existía forma de convertir una decisión
 * del dueño en la columna `declared` que el resto del sistema lee. La rama
 * `declared` era inalcanzable: el país siempre llegaba inferido o de fallback,
 * y un fallback es lo que hace que un teléfono no se normalice y que el agente
 * hable en la moneda equivocada.
 */
@ApiTags('regional')
@ApiBearerAuth()
@Controller('tenants/:tenantId/regional')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class RegionalProfileController {
    constructor(private readonly regional: RegionalProfileService) {}

    @Get('profile')
    @Roles('tenant_admin', 'tenant_supervisor', 'super_admin')
    @ApiOperation({ summary: 'Identidad regional resuelta, con la procedencia de cada valor' })
    async getProfile(@Param('tenantId') tenantId: string) {
        // La procedencia viaja entera a propósito: sin ella el dueño ve
        // "Colombia" y no puede distinguir lo que él declaró de lo que el
        // sistema puso para poder seguir.
        return { success: true, data: await this.regional.resolve(tenantId) };
    }

    @Get('reviews')
    @Roles('tenant_admin', 'tenant_supervisor', 'super_admin')
    @ApiOperation({ summary: 'Conflictos regionales pendientes de decisión' })
    async listReviews(
        @Param('tenantId') tenantId: string,
        @Query('status') status?: string,
    ) {
        const filter = status === 'resolved' || status === 'all' ? status : 'pending';
        return { success: true, data: await this.regional.listReviews(tenantId, filter) };
    }

    @Post('reviews/refresh')
    @Roles('tenant_admin', 'super_admin')
    @ApiOperation({ summary: 'Re-detectar conflictos y encolarlos para revisión' })
    async refresh(@Param('tenantId') tenantId: string) {
        const queued = await this.regional.queueConflictsForReview(tenantId);
        return { success: true, data: { queued } };
    }

    @Post('reviews/:reviewId/resolve')
    @Roles('tenant_admin', 'super_admin')
    @ApiOperation({ summary: 'Elegir el valor correcto y declararlo' })
    async resolveReview(
        @Param('tenantId') tenantId: string,
        @Param('reviewId') reviewId: string,
        @Body() body: { value: string },
        @CurrentUser() user: any,
    ) {
        const data = await this.regional.resolveReview(tenantId, reviewId, {
            value: body?.value,
            // El actor REAL: durante una impersonación queda registrado el
            // super_admin, no el usuario impersonado.
            resolvedBy: auditActor(user).userId ?? 'desconocido',
        });
        return { success: true, data };
    }

    @Post('declare')
    @Roles('tenant_admin', 'super_admin')
    @ApiOperation({ summary: 'Declarar un valor regional sin conflicto previo' })
    async declare(
        @Param('tenantId') tenantId: string,
        @Body() body: { field: string; value: string },
        @CurrentUser() user: any,
    ) {
        // El caso más común no produce conflicto: un tenant que nunca declaró
        // nada tiene una sola señal, o ninguna. Sin esta puerta seguiría sin
        // poder decir en qué país opera.
        const data = await this.regional.declare(
            tenantId,
            body?.field,
            body?.value,
            auditActor(user).userId ?? 'desconocido',
        );
        return { success: true, data };
    }
}
