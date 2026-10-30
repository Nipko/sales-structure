import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { ReadinessService } from './readiness.service';

/**
 * Preparación del negocio, de solo lectura (C0 §4.1, rebanada R2). Las escrituras (`business-facts`) llegan en R3.
 * Lectura para el dueño y el supervisor; la foto cruda, solo para la plataforma (QA).
 */
@Controller('readiness')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class ReadinessController {
    constructor(private readonly readiness: ReadinessService) {}

    /** Última evaluación (caché). `?refresh=1` reevalúa ahora. */
    @Get(':tenantId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async current(@Param('tenantId') tenantId: string, @Query('refresh') refresh?: string) {
        return { success: true, data: await this.readiness.getCurrent(tenantId, { refresh: refresh === '1' || refresh === 'true' }) };
    }

    /** Historial: una fila por resultado distinto, la más reciente primero. */
    @Get(':tenantId/history')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async history(@Param('tenantId') tenantId: string, @Query('limit') limit?: string) {
        return { success: true, data: await this.readiness.getHistory(tenantId, Number(limit) || undefined) };
    }

    /** La foto que evalúa el motor (`business-spec/tenant-snapshot@1`), para el arnés QA (`business-spec qa-truth`). */
    @Get(':tenantId/snapshot')
    @Roles('super_admin')
    async snapshot(@Param('tenantId') tenantId: string) {
        return { success: true, data: await this.readiness.readSnapshot(tenantId) };
    }

    /** Definición del requisito y su evaluación actual. */
    @Get(':tenantId/requirements/:requirementId')
    @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
    async requirement(@Param('tenantId') tenantId: string, @Param('requirementId') requirementId: string) {
        return { success: true, data: await this.readiness.getRequirement(tenantId, requirementId) };
    }
}
