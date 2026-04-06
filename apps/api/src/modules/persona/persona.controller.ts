import { Controller, Get, Put, Body, Param, Req, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PersonaService } from './persona.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import * as yaml from 'js-yaml';

@ApiTags('persona')
@Controller('persona')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class PersonaController {
    private readonly logger = new Logger(PersonaController.name);

    constructor(private readonly personaService: PersonaService) {}

    @Get(':tenantId/active')
    @ApiOperation({ summary: 'Get active persona config for a tenant' })
    async getActive(@Param('tenantId') tenantId: string) {
        const config = await this.personaService.getActivePersona(tenantId);
        return { success: true, data: config };
    }

    @Get(':tenantId/versions')
    @ApiOperation({ summary: 'Get persona version history' })
    async getVersions(@Param('tenantId') tenantId: string) {
        const versions = await this.personaService.getVersionHistory(tenantId);
        return { success: true, data: versions };
    }

    @Put(':tenantId')
    @ApiOperation({ summary: 'Save persona config (JSON → converts to YAML internally)' })
    async save(
        @Param('tenantId') tenantId: string,
        @Body() body: any,
        @Req() req: any,
    ) {
        const createdBy = req.user?.sub || req.user?.id || 'unknown';
        const yamlContent = yaml.dump(body, { lineWidth: -1 });
        const config = await this.personaService.savePersonaFromYaml(tenantId, yamlContent, createdBy);
        this.logger.log(`Persona config saved for tenant ${tenantId} by ${createdBy}`);
        return { success: true, data: config };
    }
}
