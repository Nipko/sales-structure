import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { VERIFIED_EMAIL_CAPABILITY_KEY } from '@parallext/shared';
import { PersonaController } from './persona.controller';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';

/**
 * El asistente de puesta en marcha no puede costar la configuración del negocio.
 *
 * Lo que estas pruebas fijan (y que en producción no se cumplía):
 *  - avanzar la etapa NO toca al agente (`stageOnly`);
 *  - personalizar parte de la configuración VIVA, no de la plantilla;
 *  - no se ensanchan canales ni modo de horario que nadie pidió;
 *  - guardar el propio agente no exige el correo verificado (sí lo siguen
 *    exigiendo las acciones que ya lo exigían).
 */
describe('PersonaController setup wizard — avanzar sin destruir', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const agentId = '22222222-2222-4222-8222-222222222222';
    const req = { user: { sub: '33333333-3333-4333-8333-333333333333' } };

    /** Lo que un dueño ajustó a lo largo de meses. Nada de esto es del wizard. */
    const LIVE_CONFIG = {
        persona: {
            name: 'Sofía',
            greeting: 'Hola, soy Sofía de Clínica Norte.',
            fallbackMessage: 'Te paso con una persona del equipo.',
            personality: { tone: 'cercano' },
        },
        behaviourRules: ['Nunca confirmes un turno sin verificar la agenda'],
        handoff: { triggers: ['reclamo', 'abogado'], enabled: true },
        forbiddenTopics: ['diagnósticos médicos'],
        rag: { enabled: true, minScore: 0.72 },
        hours: {
            timezone: 'America/Bogota',
            schedule: { lun: { start: '08:00', end: '18:00' } },
            afterHoursMessage: 'Estamos cerrados, te respondemos mañana.',
        },
        tools: { appointments: { enabled: false }, catalog: { enabled: true } },
    };

    const TEMPLATE_CONFIG = {
        persona: {
            name: 'Asesor',
            greeting: '¡Hola! Soy {agentName} de {company}.',
            fallbackMessage: 'No tengo esa información.',
            personality: { tone: 'formal' },
        },
        behaviourRules: [],
        handoff: { triggers: [], enabled: false },
        forbiddenTopics: [],
        rag: { enabled: false },
        hours: { timezone: 'America/Bogota', schedule: {}, afterHoursMessage: '' },
        tools: { appointments: { enabled: false } },
    };

    function makeController(options: { settings?: Record<string, unknown>; agents?: any[] } = {}) {
        const settings = options.settings ?? {
            onboardingStage: 'agent_reviewed',
            businessHours: { is247: false, timezone: 'America/Bogota', schedule: { lun: {} } },
            verticalConfig: { industry: 'salud' },
        };
        const written: Array<Record<string, any>> = [];
        const tx = {
            $queryRawUnsafe: jest.fn().mockResolvedValue([{ settings }]),
            $executeRawUnsafe: jest.fn(async (_sql: string, _id: string, json: string) => {
                written.push(JSON.parse(json));
                return 1;
            }),
        };
        const prisma: any = {
            $transaction: jest.fn(async (fn: any) => fn(tx)),
            tenant: {
                findUnique: jest.fn().mockResolvedValue({
                    id: tenantId,
                    name: 'Clínica Norte',
                    language: 'es-CO',
                    industry: 'salud',
                    schemaName: 'tenant_norte',
                    settings,
                }),
            },
            $queryRawUnsafe: jest.fn().mockResolvedValue([{ c: 0 }]),
        };
        const personaService: any = {
            getVerticalTemplates: jest.fn().mockReturnValue([]),
            getBuiltinTemplates: jest.fn().mockReturnValue([{ id: 'tpl_sales', config_json: TEMPLATE_CONFIG }]),
            savePersonaFromYaml: jest.fn().mockResolvedValue({}),
            listAgents: jest.fn().mockResolvedValue(
                options.agents ?? [{ id: agentId, is_default: true, config_json: LIVE_CONFIG }],
            ),
            updateAgent: jest.fn().mockResolvedValue({ id: agentId }),
            createAgent: jest.fn().mockResolvedValue({ id: agentId }),
        };
        const throttleService: any = { isFeatureEnabled: jest.fn().mockResolvedValue(true) };
        const controller = new PersonaController(personaService, prisma, throttleService);
        return { controller, personaService, prisma, written };
    }

    it('stageOnly avanza la etapa sin escribir una sola línea del agente', async () => {
        const { controller, personaService, written } = makeController();

        const result: any = await controller.applyTemplate(
            tenantId,
            { stageOnly: true, stage: 'agent_reviewed' },
            req,
        );

        expect(result.success).toBe(true);
        expect(personaService.listAgents).not.toHaveBeenCalled();
        expect(personaService.updateAgent).not.toHaveBeenCalled();
        expect(personaService.createAgent).not.toHaveBeenCalled();
        expect(personaService.savePersonaFromYaml).not.toHaveBeenCalled();
        // Y lo que ya estaba en settings sigue estando.
        expect(written[0].businessHours).toEqual({
            is247: false, timezone: 'America/Bogota', schedule: { lun: {} },
        });
        expect(written[0].onboardingStage).toBe('agent_reviewed');
    });

    it('stageOnly no cierra el asistente salvo que se lo pidan', async () => {
        const { controller, written } = makeController({ settings: {} });

        await controller.applyTemplate(tenantId, { stageOnly: true, stage: 'agent_reviewed' }, req);

        expect(written[0].setupWizardCompleted).toBeUndefined();
    });

    it('"conectar después" queda registrado sin tocar al agente', async () => {
        const { controller, personaService, written } = makeController({ settings: {} });

        await controller.applyTemplate(
            tenantId,
            {
                stageOnly: true,
                stage: 'channel_deferred',
                channelConnectSkippedAt: '2026-09-04T12:00:00.000Z',
            } as any,
            req,
        );

        expect(personaService.updateAgent).not.toHaveBeenCalled();
        expect(written[0].onboardingStage).toBe('channel_deferred');
        expect(written[0].channelConnectSkippedAt).toBe('2026-09-04T12:00:00.000Z');
    });

    it.each([
        ['sin plantilla', undefined],
        ['con la plantilla de origen', 'tpl_sales'],
    ])('personaliza sobre la configuración viva (%s)', async (_label, templateId) => {
        const { controller, personaService } = makeController();

        await controller.applyTemplate(
            tenantId,
            { templateId, customizations: { agentName: 'Ana' }, stage: 'agent_reviewed' } as any,
            req,
        );

        expect(personaService.updateAgent).toHaveBeenCalledTimes(1);
        const [, , payload] = personaService.updateAgent.mock.calls[0];
        expect(payload.configJson.behaviourRules).toEqual(LIVE_CONFIG.behaviourRules);
        expect(payload.configJson.handoff).toEqual(LIVE_CONFIG.handoff);
        expect(payload.configJson.forbiddenTopics).toEqual(LIVE_CONFIG.forbiddenTopics);
        expect(payload.configJson.rag).toEqual(LIVE_CONFIG.rag);
        expect(payload.configJson.hours).toEqual(LIVE_CONFIG.hours);
        expect(payload.configJson.persona.fallbackMessage).toBe(LIVE_CONFIG.persona.fallbackMessage);
        expect(payload.configJson.tools.catalog).toEqual({ enabled: true });
        // Lo único que el asistente cambió:
        expect(payload.configJson.persona.name).toBe('Ana');
        // El respaldo legado no se toca: con un agente vivo nadie lo lee, y su
        // gate de agenda bloquearía un simple cambio de nombre.
        expect(personaService.savePersonaFromYaml).not.toHaveBeenCalled();
    });

    it('no apaga una agenda que ya estaba encendida aunque falten cupos', async () => {
        const withAppointments = {
            ...LIVE_CONFIG,
            tools: { ...LIVE_CONFIG.tools, appointments: { enabled: true, canBook: true } },
        };
        const { controller, personaService, prisma } = makeController({
            agents: [{ id: agentId, is_default: true, config_json: withAppointments }],
        });
        // Sin servicios ni cupos activos.
        prisma.$queryRawUnsafe.mockResolvedValue([{ slots: 0, services: 0 }]);

        await controller.applyTemplate(
            tenantId,
            { customizations: { agentName: 'Ana' }, stage: 'agent_reviewed' } as any,
            req,
        );

        const [, , payload] = personaService.updateAgent.mock.calls[0];
        expect(payload.configJson.tools.appointments.enabled).toBe(true);
    });

    it('no ensancha canales ni modo de horario que nadie pidió', async () => {
        const { controller, personaService, written } = makeController();

        await controller.applyTemplate(
            tenantId,
            { templateId: 'tpl_sales', customizations: { agentName: 'Ana' }, markCompleted: true },
            req,
        );

        const [, , payload] = personaService.updateAgent.mock.calls[0];
        expect(payload.channels).toBeUndefined();
        expect(payload.scheduleMode).toBeUndefined();
        expect(written[0].setupWizardChannels).toBeUndefined();
    });

    it('respeta los canales cuando el emisor SÍ los eligió', async () => {
        const { controller, personaService } = makeController();

        await controller.applyTemplate(
            tenantId,
            { templateId: 'tpl_sales', selectedChannels: ['whatsapp'], customizations: { is247: false } },
            req,
        );

        const [, , payload] = personaService.updateAgent.mock.calls[0];
        expect(payload.channels).toEqual(['whatsapp']);
        expect(payload.scheduleMode).toBe('business_hours');
    });

    it('un tenant sin agente sigue estrenando uno desde la plantilla', async () => {
        const { controller, personaService } = makeController({ agents: [] });

        const result: any = await controller.applyTemplate(
            tenantId,
            { templateId: 'tpl_sales', customizations: { agentName: 'Ana' } },
            req,
        );

        expect(result.success).toBe(true);
        expect(personaService.createAgent).toHaveBeenCalledTimes(1);
        // Sin agente durable, el respaldo legado SÍ es lo que lee el runtime.
        expect(personaService.savePersonaFromYaml).toHaveBeenCalledTimes(1);
        const [, payload] = personaService.createAgent.mock.calls[0];
        expect(payload.channels).toEqual(['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget']);
        // El marcador de plantilla se sustituye, nunca se guarda crudo.
        expect(payload.configJson.persona.greeting).toBe('¡Hola! Soy Ana de Clínica Norte.');
    });

    it('sin agente y sin plantilla avisa en vez de fingir que guardó', async () => {
        const { controller, personaService, written } = makeController({ agents: [] });

        const result: any = await controller.applyTemplate(
            tenantId,
            { customizations: { agentName: 'Ana' }, stage: 'agent_reviewed' } as any,
            req,
        );

        expect(result.success).toBe(false);
        expect(personaService.createAgent).not.toHaveBeenCalled();
        expect(personaService.updateAgent).not.toHaveBeenCalled();
        // La etapa igual se registra: el rebote al asistente no puede ser eterno.
        expect(written[0].onboardingStage).toBe('agent_reviewed');
    });

    it('una plantilla pedida que no existe sigue siendo un error', async () => {
        const { controller, personaService } = makeController();

        const result: any = await controller.applyTemplate(
            tenantId,
            { templateId: 'tpl_inexistente', customizations: { agentName: 'Ana' } },
            req,
        );

        expect(result.success).toBe(false);
        expect(personaService.updateAgent).not.toHaveBeenCalled();
    });

    // ── Correo sin verificar (defecto 3) ──────────────────────────────────
    it('preparar el propio agente no exige correo verificado', () => {
        expect(Reflect.getMetadata(VERIFIED_EMAIL_CAPABILITY_KEY, PersonaController.prototype.applyTemplate))
            .toBeUndefined();
        const guards = Reflect.getMetadata(GUARDS_METADATA, PersonaController.prototype.applyTemplate) || [];
        expect(guards).not.toContain(EmailVerifiedGuard);
        expect(Reflect.getMetadata(VERIFIED_EMAIL_CAPABILITY_KEY, PersonaController.prototype.skipSetupWizard))
            .toBeUndefined();
    });

    it.each(['save', 'createAgent', 'updateAgent', 'duplicateAgent'] as const)(
        'la verificación de correo sigue gateando %s',
        (method) => {
            expect(Reflect.getMetadata(VERIFIED_EMAIL_CAPABILITY_KEY, PersonaController.prototype[method]))
                .toBe('activate_agent');
        },
    );
});
