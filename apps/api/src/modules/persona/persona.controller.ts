import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PersonaService } from './persona.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { PERSONA_TEMPLATES } from './templates';
import * as yaml from 'js-yaml';
import { getVerticalCatalog } from '../../common/utils/vertical-catalog.util';
import { mutateTenantSettingsAtomic } from '../../common/utils/tenant-settings.util';
import {
    advanceOnboardingStage,
    deriveOnboardingStage,
    isOnboardingStage,
} from '@parallext/shared';
import type { OnboardingStage } from '@parallext/shared';
import { RequiresVerifiedEmail } from '../../common/decorators/requires-verified-email.decorator';

@ApiTags('persona')
@Controller('persona')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
/**
 * OJO con los roles: RolesGuard PERMITE por defecto cuando la ruta no
 * declara @Roles (roles.guard.ts: `if (!requiredRoles) return true`). Todo
 * endpoint que MUTE el agente lleva @Roles('tenant_admin') explicito.
 *
 * El agente no es un recurso mas: es la configuracion del negocio entero —
 * su persona, sus reglas, sus temas prohibidos y sus herramientas— y atiende
 * a TODOS los clientes. Un tenant_agent (un asesor de soporte) no deberia
 * poder reescribirla. El dashboard ya lo trataba como solo-admin
 * (canConfigureAgent === tenant_admin); la API no lo verificaba.
 */
export class PersonaController {
    private readonly logger = new Logger(PersonaController.name);

    constructor(
        private readonly personaService: PersonaService,
        private readonly prisma: PrismaService,
        private readonly throttleService: TenantThrottleService,
    ) {}

    /**
     * Persona configuration is a write boundary: an ineligible tenant must not
     * be able to persist payment tools by bypassing the dashboard. Runtime
     * execution has its own independent entitlement check immediately before
     * provider writes.
     */
    private async rejectUnavailableCustomerPayments(tenantId: string, config: any) {
        if (config?.tools?.payments?.enabled !== true) return null;

        try {
            if (await this.throttleService.isFeatureEnabled(tenantId, 'customerPayments')) {
                return null;
            }
        } catch (error) {
            this.logger.warn(
                `Could not resolve customerPayments entitlement for tenant ${tenantId}; rejecting persona configuration`,
            );
        }

        return {
            success: false,
            message: 'Los cobros a clientes no están disponibles en tu plan actual.',
        };
    }

    /**
     * Marca de tiempo del cliente ("conectar después"). Un valor no parseable
     * se ignora en vez de romper el guardado: la decisión de diferir vale más
     * que su reloj, y el estado (`channel_deferred`) ya la deja registrada.
     */
    private normalizeIsoTimestamp(value: unknown): string | null {
        if (typeof value !== 'string' || !value.trim()) return null;
        const parsed = new Date(value.trim());
        if (Number.isNaN(parsed.getTime())) {
            this.logger.warn(`Ignoring invalid channelConnectSkippedAt: ${value.slice(0, 40)}`);
            return null;
        }
        return parsed.toISOString();
    }

    /**
     * ¿Hay al menos una conexión activa? Fail-closed hacia el recordatorio: si
     * no se puede confirmar, se asume que falta el canal. Perder el
     * recordatorio es peor que mostrarlo de más — sin canal la cuenta no puede
     * recibir un solo mensaje.
     */
    private async tenantHasActiveChannel(tenantId: string): Promise<boolean> {
        try {
            const rows = (await this.prisma.$queryRawUnsafe(
                `SELECT COUNT(*)::int AS c FROM channel_accounts WHERE tenant_id = $1::uuid AND is_active = true`,
                tenantId,
            )) as Array<{ c: number }>;
            return Number(rows?.[0]?.c || 0) > 0;
        } catch (error: any) {
            this.logger.warn(`Could not resolve channel presence for tenant ${tenantId}: ${error?.message || error}`);
            return false;
        }
    }

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

    /**
     * Escribe SOLO el progreso de puesta en marcha del asistente en
     * `tenant.settings`. No mira ni toca al agente.
     *
     * Separar esto del camino de plantilla es el arreglo de fondo: abrir el
     * asistente y salir (Escape, "Salir", o el rebote de un login) mandaba un
     * `applySetupTemplate` con `templateId`, que reconstruía la configuración
     * DESDE LA PLANTILLA y la escribía sobre el agente vivo — reglas de
     * comportamiento, disparadores de traspaso, temas prohibidos, RAG, mensaje
     * de respaldo y horarios se perdían en silencio, y la reasignación de
     * canales se los quitaba a los demás agentes del tenant. Avanzar de etapa
     * no puede costar la configuración del negocio.
     */
    private async persistWizardProgress(
        tenantId: string,
        input: {
            stages: OnboardingStage[];
            markCompleted: boolean;
            channelConnectSkippedAt?: string | null;
            businessHours?: unknown;
            /** Solo se registran cuando el asistente aplicó de verdad una plantilla. */
            templateId?: string | null;
            selectedChannels?: string[] | null;
        },
    ) {
        await mutateTenantSettingsAtomic(this.prisma, tenantId, (current) => {
            let onboardingStage = isOnboardingStage(current.onboardingStage)
                ? current.onboardingStage
                : undefined;
            for (const candidate of input.stages) {
                onboardingStage = advanceOnboardingStage(onboardingStage, candidate);
            }
            return {
                ...current,
                // Los horarios son configuración del tenant, no del wizard: se
                // guardan igual aunque todavía no se haya cerrado el asistente.
                ...(input.businessHours ? { businessHours: input.businessHours } : {}),
                ...(input.channelConnectSkippedAt ? { channelConnectSkippedAt: input.channelConnectSkippedAt } : {}),
                ...(input.markCompleted ? {
                    setupWizardCompleted: true,
                    ...(input.templateId ? { setupWizardTemplate: input.templateId } : {}),
                    ...(input.selectedChannels ? { setupWizardChannels: input.selectedChannels } : {}),
                    setupWizardCompletedAt: new Date().toISOString(),
                } : {}),
                ...(onboardingStage ? { onboardingStage } : {}),
            };
        });
    }

    @Post(':tenantId/setup-wizard')
    @Roles('tenant_admin')
    /**
     * SIN `@RequiresVerifiedEmail`, a propósito.
     *
     * Dejar listo el agente PROPIO no es una capacidad sensible: el correo sin
     * verificar sigue gateando lo que afecta a terceros o al dinero (cobros,
     * difusión, exportación, secretos). Con el gate acá, un alta por
     * email+contraseña —que nace sin verificar— recibía 403 en cada guardado
     * del asistente; `apiPost` lo convierte en `{success:false}` con HTTP 200,
     * nadie lo miraba, y el resultado era un asistente donde NADA se guardaba,
     * la etapa se quedaba en `account_created` y el panel rebotaba de vuelta
     * para siempre. Los demás usos de `activate_agent` en este archivo (guardar
     * persona, crear/actualizar/duplicar agente) se dejan como están.
     */
    @ApiOperation({ summary: 'Advance the setup wizard; applies a persona template only when the wizard actually has edits to save' })
    async applyTemplate(
        @Param('tenantId') tenantId: string,
        @Body() body: {
            templateId?: string;
            customizations?: any;
            selectedChannels?: string[];
            markCompleted?: boolean;
            /** Estado de puesta en marcha que declara el asistente (solo avanza). */
            stage?: string;
            /**
             * Avanzar la puesta en marcha SIN tocar el agente. Lo usa el
             * asistente cuando no hay ninguna edición que guardar (salir,
             * "conectar después", cerrar sin cambios).
             */
            stageOnly?: boolean;
        },
        @Req() req: any,
    ) {
        const requestedStage = isOnboardingStage(body.stage) ? body.stage : null;
        const skippedAt = this.normalizeIsoTimestamp(
            body.customizations?.channelConnectSkippedAt ?? (body as any).channelConnectSkippedAt,
        );

        // Camino solo-estado: ni plantilla, ni configuración, ni canales.
        if (body.stageOnly === true) {
            const stages: OnboardingStage[] = [];
            if (skippedAt) stages.push('channel_deferred');
            if (requestedStage) stages.push(requestedStage);
            await this.persistWizardProgress(tenantId, {
                stages,
                // Un ping de solo-estado no cierra el asistente salvo que lo pida.
                markCompleted: body.markCompleted === true,
                channelConnectSkippedAt: skippedAt,
            });
            this.logger.log(`Setup wizard stage advanced for tenant ${tenantId} (stageOnly, stage=${requestedStage || 'none'})`);
            return { success: true, data: { stageOnly: true } };
        }

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

        // El huso REAL del tenant, elegido en el alta a partir de su país. Las
        // plantillas legacy traen 'America/Bogota' incrustado: un negocio en
        // México quedaba "cerrado" mientras estaba abierto y su agente
        // respondía el mensaje de fuera de horario a plena luz del día.
        const tenantTimezone = typeof settings.timezone === 'string' && settings.timezone.trim()
            ? settings.timezone.trim()
            : null;
        const effectiveTimezone = tenantTimezone || 'America/Bogota';

        const verticalSet = industry ? (this.personaService.getVerticalTemplates(industry, lang) || []) : [];
        const builtinSet = this.personaService.getBuiltinTemplates(lang);

        const newSystemMatch = body.templateId
            ? [...verticalSet, ...builtinSet].find(t => t.id === body.templateId)
            : undefined;
        const legacyMatch = body.templateId
            ? PERSONA_TEMPLATES.find(t => t.id === body.templateId)
            : undefined;
        const sourceConfig = newSystemMatch?.config_json || newSystemMatch?.config || legacyMatch?.config;

        // Una plantilla que se pidió y no existe es un error del emisor. NO
        // pedirla es legítimo: el asistente que solo edita nombre y saludo de
        // un agente que ya existe no tiene ninguna plantilla que aplicar, y
        // obligarlo a inventar una es justamente lo que hacía que el panel
        // eligiera `templates[0]` —una plantilla que el tenant nunca eligió—
        // y la escribiera encima de su agente.
        if (body.templateId && !sourceConfig) {
            return { success: false, error: 'Template not found' };
        }

        // Los agentes se leen ANTES de construir la configuración.
        //
        // Si el tenant YA tiene su agente por defecto, la base es SU
        // configuración vigente y la plantilla queda solo como respaldo para el
        // agente que todavía no existe. Reconstruir siempre desde la plantilla
        // era lo que borraba —en silencio y sin que nadie lo pidiera— las
        // reglas de comportamiento, los disparadores de traspaso, los temas
        // prohibidos, el RAG, el mensaje de respaldo y los horarios de un
        // negocio que solo había entrado al asistente a cambiar un nombre.
        const agents = await this.personaService.listAgents(tenantId);
        const defaultAgent = agents.find((a: any) => a.is_default);
        const liveConfig = defaultAgent?.config_json;
        const baseConfig = liveConfig && typeof liveConfig === 'object' && liveConfig.persona
            ? liveConfig
            : sourceConfig;

        // Sin agente y sin plantilla no hay nada que construir. El progreso se
        // registra igual (para no dejar la etapa clavada) pero se devuelve el
        // fallo: el asistente tiene que poder DECIRLO, no fingir un guardado.
        if (!baseConfig) {
            const fallbackStages: OnboardingStage[] = [];
            if (skippedAt) fallbackStages.push('channel_deferred');
            if (requestedStage) fallbackStages.push(requestedStage);
            await this.persistWizardProgress(tenantId, {
                stages: fallbackStages,
                markCompleted: false,
                channelConnectSkippedAt: skippedAt,
            });
            return { success: false, error: 'Template not found' };
        }

        // Merge the base config with customizations
        const config = JSON.parse(JSON.stringify(baseConfig));
        if (!config.persona || typeof config.persona !== 'object') config.persona = {};
        if (body.customizations) {
            if (body.customizations.agentName) config.persona.name = body.customizations.agentName;
            if (body.customizations.greeting) config.persona.greeting = body.customizations.greeting;
            if (body.customizations.tone) {
                if (!config.persona.personality || typeof config.persona.personality !== 'object') config.persona.personality = {};
                config.persona.personality.tone = body.customizations.tone;
            }
            if (body.customizations.afterHoursMessage) {
                if (!config.hours || typeof config.hours !== 'object') config.hours = { timezone: effectiveTimezone, schedule: {} };
                config.hours.afterHoursMessage = body.customizations.afterHoursMessage;
            }
            if (body.customizations.schedule) {
                if (!config.hours || typeof config.hours !== 'object') config.hours = { timezone: effectiveTimezone, afterHoursMessage: '' };
                config.hours.schedule = body.customizations.schedule;
            }
            if (body.customizations.is247 !== undefined) {
                if (!config.hours) config.hours = { timezone: effectiveTimezone, schedule: {}, afterHoursMessage: '' };
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

        // El huso del tenant manda sobre el de la plantilla.
        if (tenantTimezone && config.hours && typeof config.hours === 'object') {
            config.hours.timezone = tenantTimezone;
        }

        // Replace placeholders. `config` puede venir del agente vivo, donde
        // estos campos ya están sustituidos o directamente no existen: la
        // sustitución solo se aplica a texto real.
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
        const companyName = tenant?.name || '';
        const fillPlaceholders = (value: unknown): unknown => (
            typeof value === 'string'
                ? value.replace('{company}', companyName).replace('{agentName}', config.persona.name || '')
                : value
        );
        config.persona.greeting = fillPlaceholders(config.persona.greeting);
        config.persona.fallbackMessage = fillPlaceholders(config.persona.fallbackMessage);

        // Auto-disable appointments if the prerequisites aren't configured yet. Se
        // chequean LOS DOS (servicios y horarios), que son los mismos que exige el gate
        // de persona.service: mirando solo los horarios, un tenant con horarios pero sin
        // servicios hacía fallar el asistente entero con un 400 en vez de degradar.
        //
        // SOLO cuando este guardado ENCIENDE la agenda. Si el agente ya la tenía
        // encendida, apagarla acá sería el mismo daño silencioso que el resto de
        // este arreglo elimina: un dueño que entra a cambiar un nombre no puede
        // salir con su agenda desactivada porque un COUNT(*) falló. Es la misma
        // regla que ya aplica `persona.service.updateAgent`.
        const appointmentsWereOn = liveConfig?.tools?.appointments?.enabled === true;
        if (config.tools?.appointments?.enabled && !appointmentsWereOn) {
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

        const createdBy = req.user?.sub || 'setup-wizard';

        // Sync to agent_personas (multi-agent system) — the setup wizard must
        // update the actual agent record, not just the legacy persona_config.
        //
        // Ni los canales ni el modo de horario se ENSANCHAN por omisión: el
        // asistente ya no pregunta por ellos, y mandarlos igual escribía los
        // cinco tipos de canal sobre el agente por defecto —quitándoselos a
        // todos los demás agentes del tenant en el bucle de reasignación— y
        // reponía `24_7` sobre el horario comercial que el dueño había puesto.
        // Solo se envían cuando el emisor los pidió de verdad.
        const scheduleMode = body.customizations?.is247 === undefined
            ? undefined
            : (body.customizations.is247 === false ? 'business_hours' : '24_7');
        const selectedChannels = Array.isArray(body.selectedChannels) ? body.selectedChannels : undefined;
        if (defaultAgent) {
            // Deliberadamente NO se escribe `persona_config` (el respaldo
            // legado): con un agente por defecto vivo nadie lo lee —la
            // resolución es canal → agente por defecto → legado— y su gate de
            // agenda es más estricto que el del editor, así que un tenant con
            // la agenda encendida y sin cupos vigentes no podría ni cambiarle
            // el nombre a su agente. El editor de agentes tampoco lo escribe.
            await this.personaService.updateAgent(tenantId, defaultAgent.id, {
                name: config.persona.name,
                configJson: config,
                ...(selectedChannels ? { channels: selectedChannels } : {}),
                ...(scheduleMode ? { scheduleMode } : {}),
                // El asistente persiste el paso del agente antes de que la
                // persona haya visto los demás: se valida lo que ya escribió,
                // no lo que todavía no le preguntamos.
                // El asistente sólo edita nombre y saludo: no muestra reglas ni
                // motivos de escalamiento, así que no puede exigirlos. Un agente
                // heredado al que le falte uno quedaba sin poder terminar la
                // puesta en marcha, sin ninguna pantalla donde arreglarlo. El
                // contrato completo lo hace cumplir el editor del agente, que sí
                // tiene esos campos, y el Centro de calidad, que lleva hasta ellos.
                partialDraft: true,
            });
        } else {
            // Agente NUEVO: acá sí hay que decidir dónde atiende. Los cinco
            // tipos solo se siembran cuando el tenant no tiene ningún otro
            // agente; con otros agentes vivos, quedarse con lo que el emisor
            // eligió evita robarles sus canales.
            const channelsForNewAgent = selectedChannels
                ?? (agents.length === 0
                    ? ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget']
                    : undefined);
            // Sin agente durable, `persona_config` SÍ es lo que lee el runtime.
            const yamlContent = yaml.dump(config, { lineWidth: -1 });
            await this.personaService.savePersonaFromYaml(tenantId, yamlContent, createdBy);
            await this.personaService.createAgent(tenantId, {
                name: config.persona.name,
                templateId: body.templateId,
                configJson: config,
                ...(channelsForNewAgent ? { channels: channelsForNewAgent } : {}),
                scheduleMode: scheduleMode ?? '24_7',
                isDefault: true,
                createdBy,
            });
        }

        // Horarios canónicos a nivel tenant (settings.businessHours) — es lo que lee el
        // pipeline (loadTenantBusinessHours) y el readiness. El wizard envía businessHours;
        // si no, se deriva del toggle is247 para no dejar el horario sin sembrar.
        let businessHours = body.customizations?.businessHours;
        if (businessHours && typeof businessHours === 'object' && !businessHours.timezone) {
            businessHours = { ...businessHours, timezone: effectiveTimezone };
        }
        if (!businessHours && body.customizations?.is247 !== undefined) {
            businessHours = { is247: !!body.customizations.is247, timezone: effectiveTimezone, schedule: {} };
        }

        // `markCompleted: false` guarda el agente SIN cerrar el wizard. Lo usa el paso
        // "Personalizar" para persistir antes de que el usuario llegue a "Pruébalo":
        // hasta ahora la personalización recién se escribía en handleFinish, así que el
        // chat de prueba respondía con el agente viejo y el usuario concluía —con razón—
        // que nada de lo que había escrito se había guardado.
        const markCompleted = body.markCompleted !== false;

        // "Conectar después" no bloquea nada, pero deja memoria: la marca de
        // tiempo + `channel_deferred` son lo que hace que Inicio vuelva a
        // ofrecer el canal en vez de dejar la cuenta muda para siempre.
        const channelConnectSkippedAt = skippedAt;

        // El estado SOLO avanza (`advanceOnboardingStage`), así que un guardado
        // tardío del asistente no puede devolver al wizard a un tenant que ya
        // conectó su canal. Guardar el agente es, por sí mismo, "agent_reviewed".
        const requestedStages: OnboardingStage[] = ['agent_reviewed'];
        if (channelConnectSkippedAt) requestedStages.push('channel_deferred');
        if (requestedStage) requestedStages.push(requestedStage);

        await this.persistWizardProgress(tenantId, {
            stages: requestedStages,
            markCompleted,
            channelConnectSkippedAt,
            businessHours,
            templateId: body.templateId,
            selectedChannels,
        });

        const templateLabel = body.templateId || 'la configuración vigente del agente';
        this.logger.log(
            markCompleted
                ? `Setup wizard completed for tenant ${tenantId} with ${templateLabel}`
                : `Setup wizard draft saved for tenant ${tenantId} with ${templateLabel}`,
        );
        return { success: true };
    }

    @Post(':tenantId/setup-wizard/skip')
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Mark the setup wizard as skipped without applying a template — prevents redirect loop' })
    async skipSetupWizard(@Param('tenantId') tenantId: string) {
        // Saltar el asistente no puede hacer pasar por resuelto lo que no lo
        // está: sin ninguna conexión activa, el estado queda en
        // `channel_deferred` y la puesta en marcha se sigue ofreciendo desde
        // Inicio. Con un canal ya conectado no se toca el estado — ahí manda la
        // realidad, que el resolver deriva de los canales.
        const hasAnyChannel = await this.tenantHasActiveChannel(tenantId);
        await mutateTenantSettingsAtomic(this.prisma, tenantId, (current) => ({
            ...current,
            setupWizardCompleted: true,
            setupWizardSkipped: true,
            setupWizardCompletedAt: new Date().toISOString(),
            ...(hasAnyChannel ? {} : {
                onboardingStage: advanceOnboardingStage(current.onboardingStage, 'channel_deferred'),
            }),
        }));
        this.logger.log(`Setup wizard skipped for tenant ${tenantId} (hasAnyChannel=${hasAnyChannel})`);
        return { success: true };
    }

    @Get(':tenantId/setup-status')
    @ApiOperation({ summary: 'Get setup wizard completion status + onboarding checklist data' })
    async getSetupStatus(@Param('tenantId') tenantId: string) {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true, schemaName: true, industry: true },
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
        // Los tipos de canal con al menos una conexión activa. El asistente lo
        // usa para no ofrecer conectar lo que ya está conectado.
        let connectedChannelTypes: string[] = [];
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
        let verticalCatalogRoute: string | null = null;
        // El alta ya derivó un agente a partir de industria + objetivos
        // (createDefaultAgentFromGoals) y guardó con qué plantilla. Exponerlo permite
        // que el setup-wizard lo CONFIRME en vez de volver a preguntar lo mismo y
        // sobrescribir la respuesta que el usuario ya dio en /onboarding.
        let defaultAgentTemplateId: string | null = null;
        let defaultAgentName: string | null = null;
        // El agente ya existe con nombre y saludo desde el alta. El asistente
        // lo PRESENTA ("Preparamos a Sofía, recepcionista de clínica") en vez
        // de volver a pedir una plantilla y pisar lo que el dueño ya respondió.
        let defaultAgent: { id: string; name: string | null; greeting: string | null } | null = null;

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

                // QUÉ canales están conectados, no solo cuántos. El asistente
                // dibujaba siempre el panel de conexión de WhatsApp porque su
                // único "conectado" era el de un alta hecha en esa misma
                // sesión: un admin con WhatsApp ya en vivo veía el selector de
                // ruta y podía lanzar un segundo Embedded Signup sobre su
                // número en producción.
                if (hasAnyChannel) {
                    const typeRows = (await this.prisma.$queryRawUnsafe(
                        `SELECT DISTINCT channel_type FROM channel_accounts WHERE tenant_id = $1::uuid AND is_active = true`,
                        tenantId,
                    ).catch(() => [])) as Array<{ channel_type?: string | null }>;
                    connectedChannelTypes = typeRows
                        .map((row) => (typeof row?.channel_type === 'string' ? row.channel_type.trim() : ''))
                        .filter((value) => value.length > 0);
                }

                const agentRows = (await this.prisma.$queryRawUnsafe(
                    `SELECT id, name, template_id, config_json FROM "${schema}".agent_personas
                     WHERE is_default = true AND is_active = true
                     ORDER BY created_at ASC LIMIT 1`,
                ).catch(() => [])) as Array<{ id?: string; name?: string; template_id?: string; config_json?: any }>;
                defaultAgentTemplateId = agentRows?.[0]?.template_id ?? null;
                defaultAgentName = agentRows?.[0]?.name ?? null;
                if (agentRows?.[0]?.id) {
                    const agentConfig = agentRows[0].config_json || {};
                    const greeting = agentConfig?.persona?.greeting;
                    defaultAgent = {
                        id: String(agentRows[0].id),
                        name: agentRows[0].name ?? agentConfig?.persona?.name ?? null,
                        greeting: typeof greeting === 'string' && greeting.trim() ? greeting : null,
                    };
                }

                // Tabla del catálogo por industria. Las verticales sin objeto
                // propio (salud, belleza…) no tienen catálogo aparte: para ellas
                // el paso sigue siendo la KB y esto queda en null.
                // Una sola definicion, compartida con el detector de activacion
                // del super admin. Ver vertical-catalog.util.ts.
                const catalog = getVerticalCatalog(
                    settings.verticalConfig?.industry || settings.industry || tenant?.industry,
                    settings.verticalConfig?.subType || settings.subType || null,
                );
                if (catalog) {
                    verticalCatalogRoute = catalog.route;
                    const filter = catalog.activeFilter ? `WHERE ${catalog.activeFilter}` : '';
                    const rows = (await this.prisma.$queryRawUnsafe(
                        `SELECT COUNT(*)::int AS c FROM "${schema}".${catalog.table} ${filter} LIMIT 1`,
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
                connectedChannelTypes,
                hasBusinessAbout,
                hasBusinessHours,
                // null = esta vertical no tiene catálogo propio y el paso sigue
                // siendo la base de conocimiento.
                hasVerticalCatalog,
                verticalCatalogRoute,
                defaultAgentTemplateId,
                defaultAgentName,
                defaultAgent,
                // Estado único de puesta en marcha. Se DERIVA (no se lee crudo)
                // para que los tenants anteriores al campo tengan uno coherente
                // sin backfill, y para que un canal ya conectado gane siempre
                // sobre un estado viejo guardado antes de esa conexión.
                onboardingStage: deriveOnboardingStage({
                    stage: settings.onboardingStage,
                    hasAnyChannel,
                    setupWizardCompleted: settings.setupWizardCompleted === true,
                    setupWizardSkipped: settings.setupWizardSkipped === true,
                    hasAgent: hasPersona,
                    channelConnectSkippedAt: settings.channelConnectSkippedAt ?? null,
                }),
                channelConnectSkippedAt: settings.channelConnectSkippedAt || null,
                // El huso del tenant: el asistente lo muestra como chip y los
                // horarios lo necesitan para no asumir Bogotá.
                timezone: settings.timezone || null,
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
    @Roles('tenant_admin')
    @RequiresVerifiedEmail('activate_agent')
    @ApiOperation({ summary: 'Save persona config (JSON → converts to YAML internally)' })
    async save(
        @Param('tenantId') tenantId: string,
        @Body() body: any,
        @Req() req: any,
    ) {
        const paymentEntitlementError = await this.rejectUnavailableCustomerPayments(tenantId, body);
        if (paymentEntitlementError) return paymentEntitlementError;

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
    @Roles('tenant_admin')
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
    @Roles('tenant_admin')
    @RequiresVerifiedEmail('activate_agent')
    @ApiOperation({ summary: 'Create a new agent persona' })
    async createAgent(@Param('tenantId') tenantId: string, @Body() body: any, @Req() req: any) {
        const paymentEntitlementError = await this.rejectUnavailableCustomerPayments(tenantId, body.configJson);
        if (paymentEntitlementError) return paymentEntitlementError;

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
    @Roles('tenant_admin')
    @RequiresVerifiedEmail('activate_agent')
    @ApiOperation({ summary: 'Update an existing agent persona' })
    async updateAgent(@Param('tenantId') tenantId: string, @Param('agentId') agentId: string, @Body() body: any) {
        const paymentEntitlementError = await this.rejectUnavailableCustomerPayments(tenantId, body.configJson);
        if (paymentEntitlementError) return paymentEntitlementError;

        if (body.configJson?.editorMode === 'prompt' && body.configJson?.customPrompt) {
            const enabled = await this.throttleService.isFeatureEnabled(tenantId, 'customPrompt');
            if (!enabled) return { success: false, message: 'El prompt personalizado no está disponible en tu plan actual.' };
        }
        const agent = await this.personaService.updateAgent(tenantId, agentId, body);
        return { success: true, data: agent };
    }

    @Delete(':tenantId/agents/:agentId')
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Soft-delete an agent persona (set inactive)' })
    async deleteAgent(@Param('tenantId') tenantId: string, @Param('agentId') agentId: string) {
        await this.personaService.deleteAgent(tenantId, agentId);
        return { success: true };
    }

    @Post(':tenantId/agents/:agentId/duplicate')
    @Roles('tenant_admin')
    @RequiresVerifiedEmail('activate_agent')
    @ApiOperation({ summary: 'Duplicate an agent persona' })
    async duplicateAgent(@Param('tenantId') tenantId: string, @Param('agentId') agentId: string, @Req() req: any) {
        // Duplication is another creation path and must not clone an entitled
        // payment capability into a tenant after a downgrade.
        const source = await this.personaService.getAgent(tenantId, agentId);
        const paymentEntitlementError = await this.rejectUnavailableCustomerPayments(
            tenantId,
            source?.config_json,
        );
        if (paymentEntitlementError) return paymentEntitlementError;

        const agent = await this.personaService.duplicateAgent(tenantId, agentId, req.user?.email);
        return { success: true, data: agent };
    }

    @Post(':tenantId/agents/:agentId/save-template')
    @Roles('tenant_admin')
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
