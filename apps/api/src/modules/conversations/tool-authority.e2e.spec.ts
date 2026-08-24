import { EffectiveCapabilityService } from './effective-capability.service';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { BookingEngineService, type BookingState } from './booking-engine.service';
import { ProcedureEngineService } from './procedure-engine.service';
import { decideToolAuthority, isToolAuthorityDenial, type ToolExecutionAuthority } from '@parallext/shared';
import {
    buildTurnAuthority,
    deniedOperationalIntent,
    engineAuthorityFor,
} from './turn-authority';

/**
 * ═══ LA CADENA COMPLETA, SIN MOCKS ENTRE LAS PIEZAS QUE DECIDEN ═══
 *
 * Las pruebas unitarias de autoridad verifican cada puerta por separado, y ese
 * es justamente su límite: el defecto original **no estaba en ninguna puerta**,
 * estaba en que las puertas no se hablaban. El contrato resolvía bien, el
 * ejecutor preguntaba bien, y entre los dos había cinco llamadores que no
 * pasaban nada — cada pieza en verde y el sistema abierto.
 *
 * Acá corren de verdad `EffectiveCapabilityService` → autoridad del turno →
 * `AIToolExecutorService`, y los dos motores que escriben por fuera del bucle
 * de tools. Lo único simulado es el borde: base, Redis y el modelo. Sin
 * credenciales de terceros y sin tocar ningún sistema externo — lo que se
 * verifica es **nuestro** encadenamiento, que es donde estaba el agujero.
 */

const tenantId = '11111111-1111-4111-8111-111111111111';
const schemaName = 'tenant_authority_e2e';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';

/** El plan más amplio: lo que recorte tiene que ser el contrato, no la cuota. */
function buildCapabilityService(planFeatures: Record<string, unknown> = {}) {
    return new EffectiveCapabilityService(
        {
            getPlanFeatures: jest.fn().mockResolvedValue({
                verticalToolGroups: 'all',
                ...planFeatures,
            }),
            getTenantPlan: jest.fn().mockResolvedValue({ slug: 'enterprise' }),
        } as any,
        undefined,
        undefined,
    );
}

function buildExecutor(overrides: Record<string, any> = {}) {
    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    const executeInTenantSchema = jest.fn().mockResolvedValue([]);
    const stub = () => ({}) as any;
    const control = {
        preflight: jest.fn().mockResolvedValue({ allowed: true }),
        complete: jest.fn(),
        fail: jest.fn(),
    };
    const executor = new AIToolExecutorService(
        { $queryRawUnsafe: queryRawUnsafe, executeInTenantSchema } as any,
        stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(),
        stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(),
        control as any,
        { preparePaymentLink: jest.fn(), confirmationRequiredResult: jest.fn() } as any,
        stub(),
    );
    for (const [k, v] of Object.entries(overrides)) (executor as any)[k] = v;
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
        jest.spyOn((executor as any).logger, level).mockImplementation(() => undefined);
    }
    return { executor, queryRawUnsafe, control };
}

/**
 * La autoridad del turno, armada con **la misma función que corre en
 * producción** — no con una copia.
 *
 * Replicar el armado acá era el riesgo real de este E2E: la prueba y el código
 * empiezan diciendo lo mismo y dejan de hacerlo sin que nada falle.
 */
function turnAuthorityFrom(
    contract: Awaited<ReturnType<EffectiveCapabilityService['resolve']>>,
    deniedTools: readonly string[] = [],
): ToolExecutionAuthority {
    return engineAuthorityFor({
        contract,
        commitmentBlocked: contract.writersBlocked
            ? { reason: 'capability:blocked:profile_blocked' }
            : null,
        deniedTools,
    });
}

// ══════════════════════════════════════════════════════════════════════════

describe('contrato → autoridad → ejecutor, de punta a punta', () => {
    it('una barbería puede agendar y NO puede abrir un siniestro', async () => {
        // El techo del subtipo llega hasta el ejecutor sin que nadie lo repita:
        // `insurance` no está en el manifiesto de belleza, así que `file_claim`
        // no se publica y por lo tanto no se ejecuta.
        const contract = await buildCapabilityService().resolve({
            tenantId, schemaName, industry: 'moda_belleza', subType: 'barberia',
            toolsConfig: { appointments: { enabled: true }, insurance: { enabled: true } },
            role: 'tenant_agent', channelType: 'whatsapp',
        });
        const authority = turnAuthorityFrom(contract);

        expect(decideToolAuthority(authority, 'check_availability', { isNonCommittal: true }))
            .toEqual({ allowed: true });

        const { executor, queryRawUnsafe } = buildExecutor();
        const denied: any = await executor.execute(
            schemaName, tenantId, contactId, 'file_claim', { policyNumber: 'X' },
            conversationId, { authority },
        );

        expect(denied).toMatchObject({ error: 'tool_not_authorised', shouldHandoff: true });
        expect(queryRawUnsafe).not.toHaveBeenCalled();
        // Y la exclusión quedó explicada, no simplemente ausente.
        expect(contract.excluded.map(e => e.subject)).toContain('insurance');
    });

    it('un perfil bloqueado contesta preguntas y no cierra nada', async () => {
        const contract = await buildCapabilityService().resolve({
            tenantId, schemaName, industry: 'finanzas', subType: 'fintech',
            toolsConfig: { faqs: { enabled: true }, appointments: { enabled: true } },
            role: 'tenant_agent', channelType: 'whatsapp',
        });
        expect(contract.writersBlocked).toBe(true);
        const authority = turnAuthorityFrom(contract);

        const { executor } = buildExecutor({
            faqsService: {
                search: jest.fn().mockResolvedValue([{ id: 'f1', question: '¿Horario?', answer: '9 a 18' }]),
                incrementViews: jest.fn(),
            },
        });

        // Preguntar sí. Un perfil bloqueado que además queda mudo es peor que
        // el problema que el bloqueo evita.
        const faq: any = await executor.execute(
            schemaName, tenantId, contactId, 'search_faqs', { query: 'horario' },
            conversationId, { authority },
        );
        expect(isToolAuthorityDenial(faq?.error)).toBe(false);

        // Comprometerse no.
        const booking: any = await executor.execute(
            schemaName, tenantId, contactId, 'create_appointment',
            { serviceId: 's1', date: '2026-09-01', time: '10:00' }, conversationId, { authority },
        );
        expect(booking).toMatchObject({ error: 'capability_blocked', shouldHandoff: true });
    });

    it('un canal que no cierra operaciones bloquea la escritura, con el perfil certificado', async () => {
        // El mismo tenant y el mismo perfil que agenda por WhatsApp. Lo que
        // cambia es por dónde llega la conversación: un canal que no sostiene
        // identidad no puede sostener el mismo compromiso, y hasta que el
        // contrato miró el canal esto no lo decidía nadie.
        const viaWhatsapp = await buildCapabilityService().resolve({
            tenantId, schemaName, industry: 'moda_belleza', subType: 'barberia',
            toolsConfig: { appointments: { enabled: true } },
            role: 'tenant_agent', channelType: 'whatsapp',
        });
        expect(viaWhatsapp.writersBlocked).toBe(false);

        const viaUncertified = await buildCapabilityService().resolve({
            tenantId, schemaName, industry: 'moda_belleza', subType: 'barberia',
            toolsConfig: { appointments: { enabled: true } },
            role: 'tenant_agent', channelType: 'email',
        });
        expect(viaUncertified.writersBlocked).toBe(true);

        const { executor } = buildExecutor();
        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'create_appointment', {},
            conversationId, { authority: turnAuthorityFrom(viaUncertified) },
        );
        expect(result).toMatchObject({ error: 'capability_blocked' });
    });

    it('un rol que no opera cierra las escrituras', async () => {
        // Los cuatro roles del producto SON operativos: el agente de IA, el
        // supervisor, el admin y el super_admin. Lo que esta puerta atrapa es
        // un rol que no reconocemos —una integración nueva, un token viejo, un
        // valor mal escrito—, y ahí desconocido es no.
        const contract = await buildCapabilityService().resolve({
            tenantId, schemaName, industry: 'moda_belleza', subType: 'barberia',
            toolsConfig: { appointments: { enabled: true } },
            role: 'portal_customer', channelType: 'whatsapp',
        });
        expect(contract.writersBlocked).toBe(true);

        const { executor } = buildExecutor();
        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'create_appointment', {},
            conversationId, { authority: turnAuthorityFrom(contract) },
        );
        expect(result).toMatchObject({ error: 'capability_blocked' });
    });
});

describe('el motor de reservas escribe por fuera del bucle, y no se saltea la puerta', () => {
    function buildEngine(executor: AIToolExecutorService) {
        const engine = new BookingEngineService(
            { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any,
            { get: jest.fn().mockResolvedValue(null), set: jest.fn() } as any,
            executor,
        );
        for (const level of ['log', 'warn', 'debug'] as const) {
            jest.spyOn((engine as any).logger, level).mockImplementation(() => undefined);
        }
        return engine;
    }

    /**
     * Lo que NO puede haber pasado: una cita escrita.
     *
     * No sirve pedir "cero consultas": el motor lee el catálogo de servicios
     * legítimamente —`list_services` es una lectura y sobrevive incluso a un
     * perfil bloqueado, que es el punto—, así que exigir cero llamadas mediría
     * otra cosa y pasaría en verde por el motivo equivocado.
     */
    const wroteAnAppointment = (calls: any[]) => calls.some(
        ([sql]) => /INSERT\s+INTO[^;]*appointments/i.test(String(sql)),
    );

    const confirmState = (): BookingState => ({
        step: 'confirm',
        serviceId: 'svc-1',
        serviceName: 'Corte',
        date: '2026-09-01',
        time: '10:00',
        customerName: 'Ada Lovelace',
        customerEmail: 'ada@example.test',
        customerPhone: '+15555550100',
        services: [{
            id: 'svc-1', name: 'Corte', durationMinutes: 30, price: 0, currency: 'COP',
        }],
    } as BookingState);

    it('con un perfil bloqueado el "sí" no produce una cita', async () => {
        const contract = await buildCapabilityService().resolve({
            tenantId, schemaName, industry: 'finanzas', subType: 'fintech',
            toolsConfig: { appointments: { enabled: true } },
            role: 'tenant_agent', channelType: 'whatsapp',
        });
        const { executor, queryRawUnsafe } = buildExecutor();
        const engine = buildEngine(executor);

        const result = await engine.process(
            schemaName, tenantId, contactId,
            { intent: 'confirm', isConfirmation: true } as any,
            'confirm_yes', confirmState(), {}, '2026-08-21', 'es',
            { authority: turnAuthorityFrom(contract), conversationId },
        );

        // Ni la cita ni la ilusión de la cita: el estado no avanza a `booked`.
        expect(result.state.step).not.toBe('booked');
        expect(wroteAnAppointment(queryRawUnsafe.mock.calls)).toBe(false);
    });

    it('con el subpermiso apagado tampoco, aunque el perfil sea certificado', async () => {
        // El dueño destildó "puede reservar". La casilla existía en la pantalla
        // y no apagaba nada: el agente reservaba igual.
        const contract = await buildCapabilityService().resolve({
            tenantId, schemaName, industry: 'moda_belleza', subType: 'barberia',
            toolsConfig: { appointments: { enabled: true } },
            role: 'tenant_agent', channelType: 'whatsapp',
        });
        const { executor, queryRawUnsafe } = buildExecutor();
        const engine = buildEngine(executor);

        const result = await engine.process(
            schemaName, tenantId, contactId,
            { intent: 'confirm', isConfirmation: true } as any,
            'confirm_yes', confirmState(), {}, '2026-08-21', 'es',
            {
                authority: turnAuthorityFrom(contract, ['create_appointment']),
                conversationId,
            },
        );

        expect(result.state.step).not.toBe('booked');
        expect(wroteAnAppointment(queryRawUnsafe.mock.calls)).toBe(false);
    });

    it('no empieza a pedir datos si falta una herramienta requerida y deriva sin filtrar códigos', async () => {
        const { executor } = buildExecutor();
        const execute = jest.spyOn(executor, 'execute');
        const engine = buildEngine(executor);
        const authority: ToolExecutionAuthority = {
            source: 'turn_contract',
            allowedTools: ['search_faqs'],
            resolvedAt: new Date().toISOString(),
        };

        const result = await engine.process(
            schemaName, tenantId, contactId,
            { intent: 'unknown', isConfirmation: false } as any,
            'quiero reservar una cita', { step: 'idle' } as BookingState,
            {}, '2026-08-21', 'es', { authority, conversationId },
        );

        expect(result).toMatchObject({
            handled: true,
            handoff: true,
            state: { step: 'idle' },
        });
        expect(result.text).toMatch(/agenda|equipo/i);
        expect(result.text).not.toMatch(/tool|authori|capability|create_appointment/i);
        expect(execute).not.toHaveBeenCalled();
    });

    it('no deriva un saludo si el agente no tiene capacidad de reservas', async () => {
        const { executor } = buildExecutor();
        const execute = jest.spyOn(executor, 'execute');
        const engine = buildEngine(executor);

        const result = await engine.process(
            schemaName, tenantId, contactId,
            { intent: 'unknown', isConfirmation: false } as any,
            'hola', { step: 'idle' } as BookingState,
            {}, '2026-08-21', 'es', {
                authority: {
                    source: 'turn_contract',
                    allowedTools: ['search_faqs'],
                    resolvedAt: new Date().toISOString(),
                },
                conversationId,
            },
        );

        expect(result).toMatchObject({ handled: false, state: { step: 'idle' } });
        expect(result.handoff).not.toBe(true);
        expect(execute).not.toHaveBeenCalled();
    });
});

describe('intención operativa bloqueada versus conversación informativa', () => {
    it.each([
        ['hola', null],
        ['gracias por la información', null],
        ['¿cuál es la política de cancelación?', null],
        ['¿qué reservas manejan?', null],
        ['¿cómo puedo pagar con tarjeta?', null],
        ['¿cómo cancelo una reserva?', null],
        ['quiero pedir información sobre sus horarios', null],
        ['hola, quiero reservar una cita', 'booking'],
        ['quiero reservar una cita', 'booking'],
        ['voy a comprar este producto', 'purchase'],
        ['necesito pagar y generar un enlace de pago', 'payment'],
        ['quiero cancelar mi reserva', 'change'],
    ])('%s → %s', (message, expected) => {
        expect(deniedOperationalIntent(message)).toBe(expected);
    });
});

describe('el "sí" del cliente se ejecuta contra el contrato de hoy', () => {
    it('lo que se despublicó entre la pregunta y la confirmación ya no corre', async () => {
        // El turno de la PREGUNTA: la familia estaba encendida.
        const asked = await buildCapabilityService().resolve({
            tenantId, schemaName, industry: 'moda_belleza', subType: 'barberia',
            toolsConfig: { appointments: { enabled: true } },
            role: 'tenant_agent', channelType: 'whatsapp',
        });
        expect(asked.publishedTools).toContain('create_appointment');

        // El turno del "SÍ": el dueño apagó la familia mientras tanto. El
        // ticket sigue vigente —su token no venció— y hasta acá eso alcanzaba:
        // el único control era el tiempo.
        const confirmed = await buildCapabilityService().resolve({
            tenantId, schemaName, industry: 'moda_belleza', subType: 'barberia',
            toolsConfig: { appointments: { enabled: false }, faqs: { enabled: true } },
            role: 'tenant_agent', channelType: 'whatsapp',
        });
        expect(confirmed.publishedTools).not.toContain('create_appointment');

        const { executor, queryRawUnsafe, control } = buildExecutor();
        const result: any = await executor.execute(
            schemaName, tenantId, contactId, 'create_appointment',
            { serviceId: 'svc-1', date: '2026-09-01', time: '10:00' },
            conversationId, { authority: turnAuthorityFrom(confirmed) },
        );

        expect(result).toMatchObject({ error: 'tool_not_authorised', shouldHandoff: true });
        expect(isToolAuthorityDenial(result.error)).toBe(true);
        expect(queryRawUnsafe).not.toHaveBeenCalled();
        expect(control.preflight).not.toHaveBeenCalled();
    });
});

describe('Procedures se detiene con el motivo exacto', () => {
    function buildProcedureEngine(executor: AIToolExecutorService, procedure: any, state: any) {
        const engine = new ProcedureEngineService(
            {
                executeInTenantSchema: jest.fn(async (_s: string, sql: string) => (
                    sql.includes('to_regclass') ? [{ reg: 'procedures' }] : [procedure]
                )),
            } as any,
            {
                getJson: jest.fn().mockResolvedValue(state),
                setJson: jest.fn().mockResolvedValue(undefined),
                del: jest.fn().mockResolvedValue(undefined),
            } as any,
            executor,
        );
        for (const level of ['log', 'warn'] as const) {
            jest.spyOn((engine as any).logger, level).mockImplementation(() => undefined);
        }
        return engine;
    }

    const procedure = {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Cierre',
        trigger: { keywords: ['dale'] },
        status: 'active',
        version: 1,
        steps: [{
            id: 'writer', type: 'tool',
            config: { tool: 'create_appointment', args: { serviceId: 'svc-1' } },
        }],
    };
    const state = {
        procedureId: procedure.id, version: 1, currentStepId: 'writer',
        collected: {}, awaitingField: null, startedAt: '2026-08-20T00:00:00.000Z',
    };

    it('un perfil bloqueado detiene el paso ANTES del ejecutor, y dice por qué', async () => {
        const contract = await buildCapabilityService().resolve({
            tenantId, schemaName, industry: 'finanzas', subType: 'fintech',
            toolsConfig: { appointments: { enabled: true } },
            role: 'tenant_agent', channelType: 'whatsapp',
        });
        const { executor, queryRawUnsafe } = buildExecutor();
        const spy = jest.spyOn(executor, 'execute');
        const engine = buildProcedureEngine(executor, procedure, state);

        const result = await engine.process(
            schemaName, tenantId, conversationId, contactId, 'dale',
            { toolsConfig: { appointments: { enabled: true } }, authority: turnAuthorityFrom(contract) },
        );

        expect(result).toMatchObject({
            handoff: true,
            handoffReason: 'procedure_tool_commitment_blocked:create_appointment',
        });
        expect(spy).not.toHaveBeenCalled();
        expect(queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('y el mensaje al cliente no nombra la tool ni la configuración', async () => {
        const contract = await buildCapabilityService().resolve({
            tenantId, schemaName, industry: 'finanzas', subType: 'fintech',
            toolsConfig: { appointments: { enabled: true } },
            role: 'tenant_agent', channelType: 'whatsapp',
        });
        const { executor } = buildExecutor();
        const engine = buildProcedureEngine(executor, procedure, state);

        const result = await engine.process(
            schemaName, tenantId, conversationId, contactId, 'dale',
            { toolsConfig: { appointments: { enabled: true } }, authority: turnAuthorityFrom(contract) },
        );

        expect(String(result.text)).not.toMatch(/create_appointment|toolsConfig|capability/);
    });
});

describe('el armado de la autoridad, ahora probable por sí solo', () => {
    it('un contrato irresoluble produce una autoridad VIEJA, no una vacía', async () => {
        // La diferencia es la que decide el caso: una lista vacía con fecha de
        // hoy se lee como "alguien decidió que no publica nada". Vieja se lee
        // como lo que es — nadie decidió— y el ejecutor la rechaza por
        // `authority_stale`, que es un motivo distinto y se repara en otro lado.
        const authority = engineAuthorityFor({
            contract: undefined, commitmentBlocked: null, deniedTools: [],
        });

        expect(authority.allowedTools).toEqual([]);
        expect(decideToolAuthority(authority, 'search_faqs', { isNonCommittal: true }))
            .toMatchObject({ allowed: false, reason: 'authority_stale' });
    });

    it('la lista del bucle del LLM puede ser más chica que la del contrato', async () => {
        // Los motores ven lo publicado; el bucle ve lo que quedó tras las
        // familias asincrónicas y el paso de identidad. Son dos listas y la
        // misma autoridad.
        const contract = await buildCapabilityService().resolve({
            tenantId, schemaName, industry: 'moda_belleza', subType: 'barberia',
            toolsConfig: { appointments: { enabled: true } },
            role: 'tenant_agent', channelType: 'whatsapp',
        });
        const input = { contract, commitmentBlocked: null, deniedTools: [] };

        const forEngines = engineAuthorityFor(input);
        const forLlm = buildTurnAuthority(input, ['check_availability']);

        expect(forEngines.allowedTools).toContain('create_appointment');
        expect(forLlm.allowedTools).toEqual(['check_availability']);
        // Y las dos comparten el sello temporal del contrato: son el mismo turno.
        expect(forLlm.resolvedAt).toBe(forEngines.resolvedAt);
    });

    it('lo que el dueño apagó viaja en la autoridad, no en un parámetro aparte', async () => {
        const contract = await buildCapabilityService().resolve({
            tenantId, schemaName, industry: 'moda_belleza', subType: 'barberia',
            toolsConfig: { appointments: { enabled: true } },
            role: 'tenant_agent', channelType: 'whatsapp',
        });
        const authority = engineAuthorityFor({
            contract, commitmentBlocked: null, deniedTools: ['cancel_appointment'],
        });

        // Publicada y apagada a la vez: el motivo tiene que ser el del dueño.
        expect(authority.allowedTools).toContain('cancel_appointment');
        expect(decideToolAuthority(authority, 'cancel_appointment', { isNonCommittal: false }))
            .toMatchObject({ allowed: false, reason: 'disabled_by_owner' });
    });
});
