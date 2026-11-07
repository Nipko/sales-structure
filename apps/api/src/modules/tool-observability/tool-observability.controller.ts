import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ToolObservabilityService, parseUsageQuery } from './tool-observability.service';

/**
 * Panel de herramientas del agente para el dueño de la plataforma.
 *
 * Es una ruta de plataforma, no de tenant: responde qué tools existen, qué
 * habilita cada negocio y cuánto se usan, cruzando todos los tenants. Sólo lee;
 * prender o apagar una tool sigue siendo una decisión del tenant en su agente.
 */
@ApiTags('admin-tools')
@ApiBearerAuth()
@Controller('admin/tools')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin')
export class ToolObservabilityController {
    constructor(private readonly tools: ToolObservabilityService) { }

    @Get('catalog')
    @ApiOperation({ summary: 'Every agent tool with its policy, family, profiles, plan/readiness gates and which plans include each family' })
    async getCatalog() {
        // Qué planes incluyen cada familia viaja con el catálogo: es la misma pregunta
        // ("¿quién puede usar esta tool?") vista desde el plan.
        return { success: true, data: { ...this.tools.getCatalog(), planCoverage: await this.tools.getPlanCoverage() } };
    }

    @Get('tenants')
    @ApiOperation({ summary: 'Per-tenant enabled vs used tools (last 30 days of live usage)' })
    async getTenants() {
        return { success: true, data: await this.tools.getTenantMatrix() };
    }

    @Get('usage')
    @ApiOperation({ summary: 'Aggregated tool usage and health (calls, errors, latency) for a period' })
    async getUsage(
        @Query('days') days?: string,
        @Query('tenantId') tenantId?: string,
        @Query('tool') tool?: string,
        @Query('mode') mode?: string,
    ) {
        const query = parseUsageQuery({ days, tenantId, tool, mode });
        return { success: true, data: await this.tools.getUsage(query) };
    }
}
