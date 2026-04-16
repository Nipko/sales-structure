import { Controller, Get, Post, Put, Body, Param, Req, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PersonaService } from './persona.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import { PERSONA_TEMPLATES } from './templates';
import * as yaml from 'js-yaml';

@ApiTags('persona')
@Controller('persona')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class PersonaController {
    private readonly logger = new Logger(PersonaController.name);

    constructor(
        private readonly personaService: PersonaService,
        private readonly prisma: PrismaService,
    ) {}

    // ── Templates for Setup Wizard ──

    @Get('templates')
    @ApiOperation({ summary: 'Get all pre-built persona templates' })
    async getTemplates() {
        return { success: true, data: PERSONA_TEMPLATES };
    }

    @Post(':tenantId/setup-wizard')
    @ApiOperation({ summary: 'Apply a persona template from setup wizard and mark wizard as completed' })
    async applyTemplate(
        @Param('tenantId') tenantId: string,
        @Body() body: { templateId: string; customizations?: any; selectedChannels?: string[] },
        @Req() req: any,
    ) {
        const template = PERSONA_TEMPLATES.find(t => t.id === body.templateId);
        if (!template) {
            return { success: false, error: 'Template not found' };
        }

        // Merge template config with customizations
        const config = JSON.parse(JSON.stringify(template.config));
        if (body.customizations) {
            if (body.customizations.agentName) config.persona.name = body.customizations.agentName;
            if (body.customizations.greeting) config.persona.greeting = body.customizations.greeting;
            if (body.customizations.tone) config.persona.personality.tone = body.customizations.tone;
            if (body.customizations.afterHoursMessage) config.hours.afterHoursMessage = body.customizations.afterHoursMessage;
            if (body.customizations.schedule) config.hours.schedule = body.customizations.schedule;
        }

        // Replace placeholders
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
        const companyName = tenant?.name || '';
        config.persona.greeting = config.persona.greeting.replace('{company}', companyName).replace('{agentName}', config.persona.name);
        config.persona.fallbackMessage = config.persona.fallbackMessage.replace('{company}', companyName).replace('{agentName}', config.persona.name);

        // Save persona
        const createdBy = req.user?.sub || 'setup-wizard';
        const yamlContent = yaml.dump(config, { lineWidth: -1 });
        const saved = await this.personaService.savePersonaFromYaml(tenantId, yamlContent, createdBy);

        // Mark setup wizard as completed in tenant settings
        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                settings: {
                    ...(await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } }))?.settings as any || {},
                    setupWizardCompleted: true,
                    setupWizardTemplate: body.templateId,
                    setupWizardChannels: body.selectedChannels || [],
                    setupWizardCompletedAt: new Date().toISOString(),
                },
            },
        });

        this.logger.log(`Setup wizard completed for tenant ${tenantId} with template ${body.templateId}`);
        return { success: true, data: saved };
    }

    @Get(':tenantId/setup-status')
    @ApiOperation({ summary: 'Get setup wizard completion status' })
    async getSetupStatus(@Param('tenantId') tenantId: string) {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        const settings = (tenant?.settings as any) || {};
        return {
            success: true,
            data: {
                setupWizardCompleted: settings.setupWizardCompleted || false,
                setupWizardTemplate: settings.setupWizardTemplate || null,
                setupWizardChannels: settings.setupWizardChannels || [],
            },
        };
    }

    // ── Existing endpoints ──

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
