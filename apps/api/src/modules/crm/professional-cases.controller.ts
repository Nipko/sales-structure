import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * El objeto primario de un estudio, con su propia pantalla.
 *
 * El manifiesto declara `primaryObject: 'professional_case'` para
 * `servicios_profesionales` y le da **una sola ruta: `/admin/appointments`**.
 * El objeto central del rubro —el caso— no tenía superficie: el equipo abría el
 * embudo de ventas y leía "Oportunidades", "Valor del negocio" y "Probabilidad
 * de cierre" sobre el expediente de un cliente. Y el `professional_case` de un
 * objeto activo llevaba a `null`, sin enlace, porque no había a dónde.
 *
 * Un caso **ES** una oportunidad del embudo: eso ya estaba decidido y la tool
 * `get_case_status` lo usa así. Lo que faltaba no era una tabla nueva —crearla
 * habría partido el dato en dos— sino **leerla con el vocabulario del rubro**:
 * referencia legible, etapa, cuándo se abrió, cuándo se movió por última vez y
 * de quién es.
 *
 * No hay escritura acá a propósito: abrir y mover un caso pasa por el motor de
 * transiciones del embudo, con las reglas que el estudio configuró. Una
 * escritura paralela las volvería decorativas.
 */
@ApiTags('professional-cases')
@ApiBearerAuth()
@Controller('professional-cases')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class ProfessionalCasesController {
    constructor(private readonly prisma: PrismaService) {}

    @Get(':tenantId')
    @Roles('tenant_admin', 'tenant_supervisor', 'tenant_agent', 'super_admin')
    @ApiOperation({ summary: 'List the firm\'s cases, read with the trade\'s vocabulary' })
    async list(
        @Param('tenantId') tenantId: string,
        @Query('status') status?: string,
        @Query('limit') limit?: string,
    ) {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        // Acotado y ordenado por el último movimiento: lo que el equipo mira a
        // la mañana es qué se movió, no qué se abrió primero.
        const max = Math.min(200, Math.max(1, Number(limit) || 100));

        // `open` y `closed` son los dos estados que el equipo distingue. Un
        // filtro por slug de etapa sería del embudo, no del caso.
        const closedFilter = status === 'closed'
            ? 'AND (ps.is_terminal = true OR o.won_at IS NOT NULL OR o.lost_at IS NOT NULL)'
            : status === 'open'
                ? 'AND COALESCE(ps.is_terminal, false) = false AND o.won_at IS NULL AND o.lost_at IS NULL'
                : '';

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT o.id,
                    o.stage,
                    o.assigned_to,
                    o.created_at,
                    o.updated_at,
                    o.won_at,
                    o.lost_at,
                    ps.name        AS stage_name,
                    ps.is_terminal AS stage_is_terminal,
                    l.contact_id,
                    c.name         AS client_name,
                    c.phone        AS client_phone
               FROM opportunities o
               JOIN leads l ON l.id = o.lead_id
               LEFT JOIN contacts c ON c.id = l.contact_id
               LEFT JOIN pipeline_stages ps ON ps.slug = o.stage
              WHERE 1 = 1 ${closedFilter}
              ORDER BY o.updated_at DESC
              LIMIT ${max}`,
        );

        return {
            success: true,
            data: (rows || []).map((row) => ({
                id: String(row.id),
                // El mismo identificador corto que el agente le dice al cliente
                // por chat. Que el equipo vea otro haría imposible cruzarlos.
                reference: String(row.id).slice(0, 8).toUpperCase(),
                stage: row.stage_name || row.stage,
                isClosed: row.stage_is_terminal === true || !!row.won_at || !!row.lost_at,
                openedAt: row.created_at,
                lastUpdate: row.updated_at,
                clientName: row.client_name || null,
                clientPhone: row.client_phone || null,
                contactId: row.contact_id || null,
                assignedTo: row.assigned_to || null,
            })),
        };
    }
}
