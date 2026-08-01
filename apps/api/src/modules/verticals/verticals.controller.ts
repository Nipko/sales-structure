import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { VerticalsService } from './verticals.service';
import { VERTICAL_REGISTRY, getVerticalDefinition } from './vertical-definitions';

@ApiTags('verticals')
@Controller('verticals')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@ApiBearerAuth()
export class VerticalsController {
    constructor(private readonly verticalsService: VerticalsService) {}

    @Get(':tenantId')
    @ApiOperation({ summary: 'Get vertical config for a tenant' })
    async getConfig(@Param('tenantId') tenantId: string) {
        const config = await this.verticalsService.getVerticalConfig(tenantId);
        return { success: true, data: config };
    }

    @Get(':tenantId/stages-presets')
    @ApiOperation({ summary: 'Get default stages and transition rules for tenant vertical' })
    async getStagesPresets(@Param('tenantId') tenantId: string) {
        const config = await this.verticalsService.getVerticalConfig(tenantId);
        if (!config || !config.industry) {
            return { success: true, data: [] };
        }
        const definition = getVerticalDefinition(config.industry);
        return { success: true, data: definition.pipeline?.stages || [] };
    }

    /**
     * Trae al tenant el contenido de su vertical que se escribió DESPUÉS de que
     * lo crearon. El bootstrap corre una sola vez, así que cada FAQ o servicio
     * que se agrega al catálogo se lo pierden todos los que ya están adentro.
     *
     * Solo agrega: los inserts son ON CONFLICT DO NOTHING y no toca embudo,
     * persona ni disponibilidad, que son los seeds que sí pisarían lo que el
     * tenant configuró a mano.
     */
    @Post(':tenantId/reseed-content')
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Re-seed vertical FAQs and services (additive only)' })
    async reseedContent(
        @Param('tenantId') tenantId: string,
        @Body() body: { lang?: string },
    ) {
        const data = await this.verticalsService.reseedVerticalContent(tenantId, body?.lang || 'es');
        return { success: true, data };
    }

    @Get('definitions/all')
    @ApiOperation({ summary: 'Get all vertical definitions (for onboarding sub-types)' })
    async getDefinitions() {
        const subtypes: Record<string, any[]> = {};
        for (const [key, def] of Object.entries(VERTICAL_REGISTRY)) {
            if (def.subTypes.length > 0) {
                subtypes[key] = def.subTypes;
            }
        }
        return { success: true, data: subtypes };
    }
}
