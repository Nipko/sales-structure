import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PersonaService } from './persona.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
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
        private readonly throttleService: TenantThrottleService,
    ) {}

    // ── Templates for Setup Wizard ──

    @Get('templates')
    @ApiOperation({
        summary: 'Get pre-built persona templates for the setup wizard. When ?tenantId is provided, vertical-specific templates for that tenant\'s industry are returned first.',
    })
    async getTemplates(@Query('tenantId') tenantId?: string) {
        // Setup wizard backward compat: when no tenantId is supplied, return the
        // legacy PERSONA_TEMPLATES so older clients keep working. New flow
        // passes tenantId to get vertical templates first + generic builtins.
        if (!tenantId) {
            return { success: true, data: PERSONA_TEMPLATES };
        }

        // Resolve tenant industry + language. Vertical templates appear first.
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { industry: true, language: true, settings: true },
        });
        const lang = (tenant?.language || 'es-CO').split('-')[0];
        const settings = (tenant?.settings as any) || {};
        const industry = settings?.verticalConfig?.industry || tenant?.industry || undefined;

        const verticals = industry ? (this.personaService.getVerticalTemplates(industry, lang) || []) : [];
        const builtins = this.personaService.getBuiltinTemplates(lang);

        // Normalise to the shape the setup-wizard expects: every entry exposes
        // `config` so the React form can read tmpl.config.persona.* uniformly.
        const normalize = (t: any) => ({
            ...t,
            config: t.config || t.config_json,
            // Setup wizard reads nameKey/descKey for i18n; vertical templates
            // already have plain `name`/`description` strings, so we mirror them
            // into the same field names the wizard already renders.
            nameKey: t.nameKey || undefined,
            descKey: t.descKey || undefined,
        });

        return {
            success: true,
            data: [...verticals.map(normalize), ...builtins.map(normalize)],
        };
    }

    @Post(':tenantId/setup-wizard')
    @ApiOperation({ summary: 'Apply a persona template from the setup wizard; marks the wizard completed unless markCompleted=false' })
    async applyTemplate(
        @Param('tenantId') tenantId: string,
        @Body() body: { templateId: string; customizations?: any; selectedChannels?: string[]; markCompleted?: boolean },
        @Req() req: any,
    ) {
        // Look up the template across all three sources: legacy PERSONA_TEMPLATES
        // (older onboarding wizard), new generic builtins (tpl_sales, tpl_support…)
        // and vertical templates (tpl_salud_*, tpl_turismo_*…). The first hit wins.
        const tenantForLang = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { language: true, industry: true, settings: true },
        });
        const lang = (tenantForLang?.language || 'es-CO').split('-')[0];
        const settings = (tenantForLang?.settings as any) || {};
        const industry = settings?.verticalConfig?.industry || tenantForLang?.industry || undefined;

        const verticalSet = industry ? (this.personaService.getVerticalTemplates(industry, lang) || []) : [];
        const builtinSet = this.personaService.getBuiltinTemplates(lang);

        const newSystemMatch = [...verticalSet, ...builtinSet].find(t => t.id === body.templateId);
        const legacyMatch = PERSONA_TEMPLATES.find(t => t.id === body.templateId);
        const sourceConfig = newSystemMatch?.config_json || newSystemMatch?.config || legacyMatch?.config;

        if (!sourceConfig) {
            return { success: false, error: 'Template not found' };
        }

        // Merge template config with customizations
        const config = JSON.parse(JSON.stringify(sourceConfig));
        if (body.customizations) {
            if (body.customizations.agentName) config.persona.name = body.customizations.agentName;
            if (body.customizations.greeting) config.persona.greeting = body.customizations.greeting;
            if (body.customizations.tone) config.persona.personality.tone = body.customizations.tone;
            if (body.customizations.afterHoursMessage) config.hours.afterHoursMessage = body.customizations.afterHoursMessage;
            if (body.customizations.schedule) config.hours.schedule = body.customizations.schedule;
            if (body.customizations.is247 !== undefined) {
                if (!config.hours) config.hours = { timezone: 'America/Bogota', schedule: {}, afterHoursMessage: '' };
                if (body.customizations.is247) {
                    const allDay = { start: '00:00', end: '23:59' };
                    config.hours.schedule = { lun: allDay, mar: allDay, mie: allDay, jue: allDay, vie: allDay, sab: allDay, dom: allDay };
                    config.hours.afterHoursMessage = '';
                }
            }
            if (Array.isArray(body.customizations.enabledCapabilities)) {
                if (!config.tools) config.tools = {};
                for (const cap of body.customizations.enabledCapabilities) {
                    if (cap === 'appointments') config.tools.appointments = { ...(config.tools.appointments || {}), enabled: true, canBook: true, canCancel: true };
                    else if (cap === 'catalog') config.tools.catalog = { enabled: true };
                    else if (cap === 'crm') config.tools.crm = { enabled: true };
                    else if (cap === 'knowledge') { config.tools.knowledge = { enabled: true }; config.rag = { ...(config.rag || {}), enabled: true }; }
                    else if (cap === 'faqs') config.tools.faqs = { enabled: true };
                    else if (cap === 'offers') config.tools.offers = { enabled: true };
                }
            }
        }

        // Replace placeholders
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
        const companyName = tenant?.name || '';
        config.persona.greeting = config.persona.greeting.replace('{company}', companyName).replace('{agentName}', config.persona.name);
        config.persona.fallbackMessage = config.persona.fallbackMessage.replace('{company}', companyName).replace('{agentName}', config.persona.name);

        // Auto-disable appointments if the prerequisites aren't configured yet. Se
        // chequean LOS DOS (servicios y horarios), que son los mismos que exige el gate
        // de persona.service: mirando solo los horarios, un tenant con horarios pero sin
        // servicios hacía fallar el asistente entero con un 400 en vez de degradar.
        if (config.tools?.appointments?.enabled) {
            try {
                const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { schemaName: true } });
                const sn = t?.schemaName;
                if (sn) {
                    // Una sola sentencia: PgBouncer en modo transacción no admite multi-statement.
                    const [prereqRow] = (await this.prisma.$queryRawUnsafe(
                        `SELECT
                            (SELECT COUNT(*)::int FROM "${sn}".availability_slots WHERE is_active = true) AS slots,
                            (SELECT COUNT(*)::int FROM "${sn}".services WHERE is_active = true) AS services`,
                    )) as any[];
                    const slots = Number(prereqRow?.slots || 0);
                    const services = Number(prereqRow?.services || 0);
                    if (slots === 0 || services === 0) {
                        config.tools.appointments.enabled = false;
                        this.logger.log(`Setup wizard: auto-disabled appointments for tenant ${tenantId} (slots=${slots}, services=${services})`);
                    }
                }
            } catch {
                config.tools.appointments.enabled = false;
            }
        }

        // Save persona
        const createdBy = req.user?.sub || 'setup-wizard';
        const yamlContent = yaml.dump(config, { lineWidth: -1 });
        await this.personaService.savePersonaFromYaml(tenantId, yamlContent, createdBy);

        // Sync to agent_personas (multi-agent system) — the setup wizard must
        // update the actual agent record, not just the legacy persona_config.
        const scheduleMode = body.customizations?.is247 === false ? 'business_hours' : '24_7';
        const agents = await this.personaService.listAgents(tenantId);
        const defaultAgent = agents.find((a: any) => a.is_default);
        if (defaultAgent) {
            await this.personaService.updateAgent(tenantId, defaultAgent.id, {
                name: config.persona.name,
                configJson: config,
                scheduleMode,
            });
        } else {
            await this.personaService.createAgent(tenantId, {
                name: config.persona.name,
                templateId: body.templateId,
                configJson: config,
                channels: body.selectedChannels || ['whatsapp', 'instagram', 'messenger', 'telegram', 'sms'],
                scheduleMode,
                isDefault: true,
                createdBy,
            });
        }

        // Horarios canónicos a nivel tenant (settings.businessHours) — es lo que lee el
        // pipeline (loadTenantBusinessHours) y el readiness. El wizard envía businessHours;
        // si no, se deriva del toggle is247 para no dejar el horario sin sembrar.
        let businessHours = body.customizations?.businessHours;
        if (!businessHours && body.customizations?.is247 !== undefined) {
            businessHours = { is247: !!body.customizations.is247, timezone: 'America/Bogota', schedule: {} };
        }

        // `markCompleted: false` guarda el agente SIN cerrar el wizard. Lo usa el paso
        // "Personalizar" para persistir antes de que el usuario llegue a "Pruébalo":
        // hasta ahora la personalización recién se escribía en handleFinish, así que el
        // chat de prueba respondía con el agente viejo y el usuario concluía —con razón—
        // que nada de lo que había escrito se había guardado.
        const markCompleted = body.markCompleted !== false;
        const currentSettings = (await this.prisma.tenant.findUnique({
            where: { id: tenantId }, select: { settings: true },
        }))?.settings as any || {};

        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                settings: {
                    ...currentSettings,
                    // Los horarios son configuración del tenant, no del wizard: se
                    // guardan igual aunque todavía no se haya cerrado el asistente.
                    ...(businessHours ? { businessHours } : {}),
                    ...(markCompleted ? {
                        setupWizardCompleted: true,
                        setupWizardTemplate: body.templateId,
                        setupWizardChannels: body.selectedChannels || [],
                        setupWizardCompletedAt: new Date().toISOString(),
                    } : {}),
                },
            },
        });

        this.logger.log(
            markCompleted
                ? `Setup wizard completed for tenant ${tenantId} with template ${body.templateId}`
                : `Setup wizard draft saved for tenant ${tenantId} with template ${body.templateId}`,
        );
        return { success: true };
    }

    @Post(':tenantId/setup-wizard/skip')
    @ApiOperation({ summary: 'Mark the setup wizard as skipped without applying a template — prevents redirect loop' })
    async skipSetupWizard(@Param('tenantId') tenantId: string) {
        const existing = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        const settings = (existing?.settings as any) || {};
        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                settings: {
                    ...settings,
                    setupWizardCompleted: true,
                    setupWizardSkipped: true,
                    setupWizardCompletedAt: new Date().toISOString(),
                },
            },
        });
        this.logger.log(`Setup wizard skipped for tenant ${tenantId}`);
        return { success: true };
    }

    @Get(':tenantId/setup-status')
    @ApiOperation({ summary: 'Get setup wizard completion status + onboarding checklist data' })
    async getSetupStatus(@Param('tenantId') tenantId: string) {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true, schemaName: true },
        });
        const settings = (tenant?.settings as any) || {};
        const schema = tenant?.schemaName;

        let hasPersona = false;
        let hasConversations = false;
        let hasKnowledge = false;
        let hasTeam = false;
        let hasAutomation = false;
        let hasTemplates = false;
        let hasAnyChannel = false;
        let hasBusinessAbout = false;
        // El catálogo REAL de la vertical, que no es la base de conocimiento.
        //
        // El checklist relabelaba el paso "base de conocimiento" por industria
        // ("Carga tu menú", "Carga tu portafolio de propiedades", "Carga tus
        // cursos") pero los tres apuntaban al mismo lugar y se daban por hechos
        // con el mismo flag. El dueño de un restaurante leía "Carga tu menú",
        // subía el PDF a la KB, se ponía el tilde verde... y `place_order`
        // seguía sin funcionar, porque lee filas de `menu_items`. El checklist
        // enseñaba lo incorrecto y después lo certificaba como hecho.
        let hasVerticalCatalog: boolean | null = null;
        // El alta ya derivó un agente a partir de industria + objetivos
        // (createDefaultAgentFromGoals) y guardó con qué plantilla. Exponerlo permite
        // que el setup-wizard lo CONFIRME en vez de volver a preguntar lo mismo y
        // sobrescribir la respuesta que el usuario ya dio en /onboarding.
        let defaultAgentTemplateId: string | null = null;
        let defaultAgentName: string | null = null;

        // Readiness del agente: horarios de atención viven en tenant.settings.businessHours
        // (nivel tenant, no requiere query). 24/7 o ≥1 día con horario cuenta como configurado.
        const bh = settings.businessHours;
        const hasBusinessHours = !!(bh && (bh.is247 === true || Object.keys(bh.schedule || {}).length > 0));

        if (schema) {
            try {
                const checks = await Promise.allSettled([
                    this.prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "${schema}".agent_personas WHERE is_active = true`).catch(() => [{ c: 0 }]),
                    this.prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "${schema}".conversations LIMIT 1`).catch(() => [{ c: 0 }]),
                    this.prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "${schema}".knowledge_resources LIMIT 1`)
                        .catch(() => this.prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "${schema}".knowledge_documents WHERE status != 'deleted' LIMIT 1`)
                        .catch(() => [{ c: 0 }])),
                    this.prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM users WHERE tenant_id = $1::uuid AND is_active = true`, tenantId).catch(() => [{ c: 0 }]),
                    this.prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "${schema}".automation_rules WHERE active = true LIMIT 1`).catch(() => [{ c: 0 }]),
                    this.prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "${schema}".email_templates LIMIT 1`).catch(() => [{ c: 0 }]),
                    this.prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM channel_accounts WHERE tenant_id = $1::uuid AND is_active = true`, tenantId).catch(() => [{ c: 0 }]),
                    this.prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "${schema}".companies WHERE is_primary = true AND about IS NOT NULL AND btrim(about) != ''`).catch(() => [{ c: 0 }]),
                ]);

                const val = (r: PromiseSettledResult<any>) => r.status === 'fulfilled' ? Number((r.value as any[])?.[0]?.c || 0) : 0;
                hasPersona = val(checks[0]) > 0;
                hasConversations = val(checks[1]) > 0;
                hasKnowledge = val(checks[2]) > 0;
                hasTeam = val(checks[3]) > 1;
                hasAutomation = val(checks[4]) > 0;
                hasTemplates = val(checks[5]) > 0;
                hasAnyChannel = val(checks[6]) > 0;
                hasBusinessAbout = val(checks[7]) > 0;

                const agentRows = (await this.prisma.$queryRawUnsafe(
                    `SELECT name, template_id FROM "${schema}".agent_personas
                     WHERE is_default = true AND is_active = true
                     ORDER BY created_at ASC LIMIT 1`,
                ).catch(() => [])) as Array<{ name?: string; template_id?: string }>;
                defaultAgentTemplateId = agentRows?.[0]?.template_id ?? null;
                defaultAgentName = agentRows?.[0]?.name ?? null;

                // Tabla del catálogo por industria. Las verticales sin objeto
                // propio (salud, belleza…) no tienen catálogo aparte: para ellas
                // el paso sigue siendo la KB y esto queda en null.
                const CATALOG_TABLE: Record<string, string> = {
                    restaurantes: 'menu_items',
                    inmobiliaria: 'real_estate_listings',
                    automotriz: 'vehicles',
                    education: 'courses',
                    gimnasios: 'membership_plans',
                    turismo: 'tour_packages',
                    seguros: 'insurance_plans',
                    retail: 'products',
                };
                const industry = (settings.verticalConfig?.industry || settings.industry || '').toLowerCase();
                const catalogTable = CATALOG_TABLE[industry];
                if (catalogTable) {
                    const rows = (await this.prisma.$queryRawUnsafe(
                        `SELECT COUNT(*)::int AS c FROM "${schema}".${catalogTable} LIMIT 1`,
                    ).catch(() => [{ c: 0 }])) as any[];
                    hasVerticalCatalog = Number(rows?.[0]?.c || 0) > 0;
                }
            } catch {
                // If schema doesn't exist yet, all default to false
            }
        }

        return {
            success: true,
            data: {
                setupWizardCompleted: settings.setupWizardCompleted || false,
                // "Saltar" también marca completed (para no reabrir el bucle de
                // redirect), así que sin este flag no había forma de distinguir a quien
                // terminó el asistente de quien lo abandonó — y el segundo desaparecía
                // del sistema de guía para siempre.
                setupWizardSkipped: settings.setupWizardSkipped || false,
                setupWizardTemplate: settings.setupWizardTemplate || null,
                setupWizardChannels: settings.setupWizardChannels || [],
                hasPersona,
                hasConversations,
                hasKnowledge,
                hasTeam,
                hasAutomation,
                hasTemplates,
                hasAnyChannel,
                hasBusinessAbout,
                hasBusinessHours,
                // null = esta vertical no tiene catálogo propio y el paso sigue
                // siendo la base de conocimiento.
                hasVerticalCatalog,
                defaultAgentTemplateId,
                defaultAgentName,
            },
        };
    }

    @Get(':tenantId/plan-features')
    @ApiOperation({ summary: 'Get plan feature limits for multi-agent system' })
    async getPlanFeatures(@Param('tenantId') tenantId: string) {
        const features = await this.throttleService.getPlanFeatures(tenantId);
        return { success: true, data: features };
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
        if (body.editorMode === 'prompt' && body.customPrompt) {
            const enabled = await this.throttleService.isFeatureEnabled(tenantId, 'customPrompt');
            if (!enabled) {
                return { success: false, message: 'El prompt personalizado no está disponible en tu plan actual.' };
            }
        }
        const createdBy = req.user?.sub || req.user?.id || 'unknown';
        const yamlContent = yaml.dump(body, { lineWidth: -1 });
        const config = await this.personaService.savePersonaFromYaml(tenantId, yamlContent, createdBy);
        this.logger.log(`Persona config saved for tenant ${tenantId} by ${createdBy}`);
        return { success: true, data: config };
    }

    // ── Multi-Agent CRUD ──────────────────────────────────────

    @Get(':tenantId/agents')
    @ApiOperation({ summary: 'List all agent personas for a tenant' })
    async listAgents(@Param('tenantId') tenantId: string) {
        const agents = await this.personaService.listAgents(tenantId);
        return { success: true, data: agents };
    }

    @Get(':tenantId/agent-templates')
    @ApiOperation({ summary: 'List agent templates (vertical-specific first, then built-in + user-saved). Pass ?industry=salud|restaurantes|inmobiliaria|automotriz|turismo|educacion to prepend vertical templates.' })
    async listTemplates(@Param('tenantId') tenantId: string, @Query('industry') industry?: string) {
        const templates = await this.personaService.listTemplates(tenantId, industry);
        return { success: true, data: templates };
    }

    @Delete(':tenantId/agent-templates/:templateId')
    @ApiOperation({ summary: 'Delete a user-created agent template' })
    async deleteTemplate(@Param('tenantId') tenantId: string, @Param('templateId') templateId: string) {
        await this.personaService.deleteTemplate(tenantId, templateId);
        return { success: true };
    }

    @Get(':tenantId/agents/:agentId')
    @ApiOperation({ summary: 'Get a single agent persona by ID' })
    async getAgent(@Param('tenantId') tenantId: string, @Param('agentId') agentId: string) {
        const agent = await this.personaService.getAgent(tenantId, agentId);
        if (!agent) return { success: false, error: 'Agent not found' };
        return { success: true, data: agent };
    }

    @Post(':tenantId/agents')
    @ApiOperation({ summary: 'Create a new agent persona' })
    async createAgent(@Param('tenantId') tenantId: string, @Body() body: any, @Req() req: any) {
        if (body.configJson?.editorMode === 'prompt' && body.configJson?.customPrompt) {
            const enabled = await this.throttleService.isFeatureEnabled(tenantId, 'customPrompt');
            if (!enabled) return { success: false, message: 'El prompt personalizado no está disponible en tu plan actual.' };
        }
        const agent = await this.personaService.createAgent(tenantId, {
            name: body.name,
            templateId: body.templateId,
            configJson: body.configJson,
            channels: body.channels,
            channelBindings: body.channelBindings,
            scheduleMode: body.scheduleMode,
            isDefault: body.isDefault,
            createdBy: req.user?.email || 'system',
        });
        return { success: true, data: agent };
    }

    @Put(':tenantId/agents/:agentId')
    @ApiOperation({ summary: 'Update an existing agent persona' })
    async updateAgent(@Param('tenantId') tenantId: string, @Param('agentId') agentId: string, @Body() body: any) {
        if (body.configJson?.editorMode === 'prompt' && body.configJson?.customPrompt) {
            const enabled = await this.throttleService.isFeatureEnabled(tenantId, 'customPrompt');
            if (!enabled) return { success: false, message: 'El prompt personalizado no está disponible en tu plan actual.' };
        }
        const agent = await this.personaService.updateAgent(tenantId, agentId, body);
        return { success: true, data: agent };
    }

    @Delete(':tenantId/agents/:agentId')
    @ApiOperation({ summary: 'Soft-delete an agent persona (set inactive)' })
    async deleteAgent(@Param('tenantId') tenantId: string, @Param('agentId') agentId: string) {
        await this.personaService.deleteAgent(tenantId, agentId);
        return { success: true };
    }

    @Post(':tenantId/agents/:agentId/duplicate')
    @ApiOperation({ summary: 'Duplicate an agent persona' })
    async duplicateAgent(@Param('tenantId') tenantId: string, @Param('agentId') agentId: string, @Req() req: any) {
        const agent = await this.personaService.duplicateAgent(tenantId, agentId, req.user?.email);
        return { success: true, data: agent };
    }

    @Post(':tenantId/agents/:agentId/save-template')
    @ApiOperation({ summary: 'Save an agent config as a reusable template' })
    async saveAsTemplate(@Param('tenantId') tenantId: string, @Param('agentId') agentId: string, @Body() body: any, @Req() req: any) {
        const enabled = await this.throttleService.isFeatureEnabled(tenantId, 'customTemplates');
        if (!enabled) {
            return { success: false, message: 'Las plantillas personalizadas no están disponibles en tu plan actual. Mejora tu plan para acceder.' };
        }
        const template = await this.personaService.saveAsTemplate(tenantId, agentId, body.name, body.description, req.user?.email);
        return { success: true, data: template };
    }
}
