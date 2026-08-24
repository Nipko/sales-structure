import { AIToolExecutorService } from './ai-tool-executor.service';
import { EffectiveCapabilityService } from './effective-capability.service';
import { ProcedureEngineService } from './procedure-engine.service';
import { getToolPolicy, isNonCommittalTool } from './tool-policy-registry';
import {
    listBlockedSubtypeProfiles,
    resolveVerticalCapabilityManifest,
    type ProcedureDefinition,
    type ProcedureRunState,
} from '@parallext/shared';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * Los siete perfiles bloqueados, contra las CINCO puertas por las que se
 * escribe.
 *
 * El bloqueo se cerró tres veces y apareció una cuarta, porque cada vez se
 * cerró donde se había visto el problema: primero la lista de tools que ve el
 * modelo, después el motor determinista de reservas, después Procedures. Cada
 * uno era un llamador distinto del mismo ejecutor y ninguno preguntaba lo
 * mismo. Estas pruebas recorren las cinco puertas —motor de reservas,
 * Procedures, loop del LLM, familias asíncronas (pagos/integraciones/MCP) y
 * fallo del resolutor— para los siete perfiles, de manera que agregar un
 * perfil bloqueado nuevo o un llamador nuevo tenga que pasar por acá.
 *
 * La regla que se verifica NO es "no escribe una fila". Es "no compromete al
 * negocio": buscar en la base de conocimiento, leer una póliza o pedir el
 * código de identidad siguen pasando, porque un negocio bloqueado sigue
 * existiendo y contestando. Lo que no puede es reservar, cobrar, abrir un
 * siniestro ni prometer nada.
 */

const tenantId = '11111111-1111-4111-8111-111111111111';
const schemaName = 'tenant_stop';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';

const BLOCKED = listBlockedSubtypeProfiles();

/** Cada perfil bloqueado, con TODA su superficie encendida a propósito. */
const CASES = BLOCKED.map((profile) => {
    const manifest = resolveVerticalCapabilityManifest(profile.industry, profile.subtype);
    const toolsConfig: Record<string, { enabled: boolean }> = {};
    for (const group of manifest.toolGroups) toolsConfig[group] = { enabled: true };
    return {
        id: `${profile.industry}/${profile.subtype}`,
        industry: profile.industry,
        subType: profile.subtype,
        toolsConfig,
    };
});

function buildCapabilityService() {
    const throttle = {
        getPlanFeatures: jest.fn().mockResolvedValue({
            plan: 'enterprise', customerPayments: true, mcp: true, verticalIntegrations: true,
        }),
    };
    const readiness = {
        evaluate: jest.fn().mockResolvedValue({
            checks: [], unmet: [], evaluatedAt: new Date().toISOString(), degraded: false,
        }),
    };
    const regionalProfile = {
        resolve: jest.fn().mockResolvedValue({
            countryPackId: 'es-CO', operatingCountry: { value: 'CO' },
        }),
    };
    const service = new EffectiveCapabilityService(
        throttle as any, readiness as any, regionalProfile as any,
    );
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    return service;
}

function buildExecutor() {
    const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) };
    const control = {
        preflight: jest.fn().mockResolvedValue({ decision: 'allow' }),
        finish: jest.fn().mockResolvedValue(undefined),
        fail: jest.fn().mockResolvedValue(undefined),
    };
    const paymentOperations = {
        preparePaymentLink: jest.fn(),
        confirmationRequiredResult: jest.fn(),
        createPaymentLink: jest.fn(),
        getPaymentStatus: jest.fn(),
        refundPayment: jest.fn(),
        applyDiscount: jest.fn(),
    };
    const stub = {} as any;
    const executor = new AIToolExecutorService(
        // 1 prisma + 20 servicios de dominio, y recien ahi el control central,
        // los pagos y fotografia: si el constructor crece, esto tiene que
        // crecer con el, no correrse un lugar en silencio.
        prisma as any,
        stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
        stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
        control as any, paymentOperations as any, stub,
    );
    jest.spyOn((executor as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((executor as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((executor as any).logger, 'error').mockImplementation(() => undefined);
    return { executor, prisma, control, paymentOperations };
}

/** Lo que el ejecutor recibe cuando el contrato dijo que no. */
/**
 * Un perfil bloqueado con la tool **publicada**.
 *
 * Que la tool esté en `allowedTools` no es un detalle del fixture: es lo que
 * hace que estas pruebas midan el bloqueo y no la falta de publicación. Si la
 * lista viniera vacía, el ejecutor denegaría por `not_authorised` y el caso
 * pasaría en verde sin haber ejercitado nunca la puerta del perfil `stop`.
 */
const blockedInputFor = (...tools: string[]) => ({
    authority: {
        ...authorityFor(...tools),
        commitmentBlocked: { reason: 'capability:blocked:profile_blocked' },
    },
    commitmentBlocked: { reason: 'capability:blocked:profile_blocked' },
});

describe('los siete perfiles bloqueados no comprometen al negocio', () => {
    it('hay siete y el registro no los perdió por el camino', () => {
        expect(CASES).toHaveLength(7);
        expect(CASES.map(c => c.id).sort()).toEqual([
            'finanzas/fintech',
            'fotografia/wedding_planner',
            'inmobiliaria/construccion',
            'retail/marketplace',
            'seguros/aseguradora',
            'seguros/salud',
            'technology/consultoria_ti',
        ]);
    });

    // ── Puerta 3: el loop del LLM ─────────────────────────────────────────
    describe('loop del LLM: la lista publicada no tiene con qué comprometerse', () => {
        it.each(CASES.map(c => [c.id, c] as const))(
            '%s no publica ninguna tool que comprometa',
            async (_id, testCase) => {
                const service = buildCapabilityService();
                const contract = await service.resolve({
                    tenantId, schemaName,
                    industry: testCase.industry, subType: testCase.subType,
                    toolsConfig: testCase.toolsConfig,
                });

                const committing = contract.publishedTools.filter(
                    (tool: string) => !isNonCommittalTool(tool),
                );
                expect(committing).toEqual([]);
                expect(contract.writersBlocked).toBe(true);
            },
        );

        it.each(CASES.map(c => [c.id, c] as const))(
            '%s conserva las lecturas: el negocio sigue contestando',
            async (_id, testCase) => {
                const service = buildCapabilityService();
                const contract = await service.resolve({
                    tenantId, schemaName,
                    industry: testCase.industry, subType: testCase.subType,
                    toolsConfig: testCase.toolsConfig,
                });

                // Un perfil bloqueado que además se queda mudo es peor que el
                // problema que el bloqueo evita: el cliente pregunta el horario
                // y el agente no tiene con qué buscarlo.
                expect(contract.publishedTools.length).toBeGreaterThan(0);
                for (const tool of contract.publishedTools) {
                    expect(getToolPolicy(tool)).toBeDefined();
                }
            },
        );

        it.each(CASES.map(c => [c.id, c] as const))(
            '%s explica por qué, con motivo legible',
            async (_id, testCase) => {
                const service = buildCapabilityService();
                const contract = await service.resolve({
                    tenantId, schemaName,
                    industry: testCase.industry, subType: testCase.subType,
                    toolsConfig: testCase.toolsConfig,
                });

                const blocked = contract.excluded.find(
                    (e: { reason: string }) => e.reason === 'profile_blocked',
                );
                expect(blocked).toBeDefined();
                expect(blocked!.detail).toEqual(expect.objectContaining({
                    es: expect.any(String), en: expect.any(String),
                    pt: expect.any(String), fr: expect.any(String),
                }));
                expect(blocked!.detail.en.length).toBeGreaterThan(20);
            },
        );
    });

    // ── Puerta 1: el motor determinista de reservas ───────────────────────
    describe('motor de reservas: escribe fuera del loop, y el ejecutor lo frena', () => {
        it('create_appointment cae aunque el motor la haya pedido', async () => {
            const { executor, prisma } = buildExecutor();

            const result = await executor.execute(
                schemaName, tenantId, contactId, 'create_appointment',
                { serviceId: 'svc-1', date: '2026-09-01', time: '10:00' },
                conversationId, blockedInputFor('create_appointment'),
            );

            expect(result).toMatchObject({ error: 'capability_blocked', shouldHandoff: true });
            // Y no tocó la base: no es que falló después de escribir.
            expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
        });

        it('check_availability pasa: consultar no es comprometerse', async () => {
            const { executor } = buildExecutor();

            const result = await executor.execute(
                schemaName, tenantId, contactId, 'check_availability',
                { date: '2026-09-01' }, conversationId, blockedInputFor('check_availability'),
            );

            expect(result?.error).not.toBe('capability_blocked');
        });
    });

    // ── Puerta 2: Procedures ──────────────────────────────────────────────
    describe('Procedures: un paso de tool no puede escribir en un perfil bloqueado', () => {
        it('el paso de tool lleva el bloqueo hasta el ejecutor', async () => {
            // Se ejercita el motor de verdad: un procedimiento parado en un
            // paso `tool` que reanuda. Ese es el camino por el que Procedures
            // puede llegar a escribir sin pasar por la resolución del turno.
            const procedure: ProcedureDefinition = {
                id: '44444444-4444-4444-8444-444444444444',
                name: 'Reembolso',
                trigger: { keywords: ['reembolso'] },
                status: 'active',
                version: 1,
                steps: [
                    {
                        id: 'writer',
                        type: 'tool',
                        config: { tool: 'refund_payment', args: { paymentReference: 'pay-1' } },
                    },
                ],
            };
            const state: ProcedureRunState = {
                procedureId: procedure.id,
                version: 1,
                currentStepId: 'writer',
                collected: {},
                awaitingField: null,
                startedAt: '2026-08-20T00:00:00.000Z',
            };
            const toolExecutor = {
                execute: jest.fn().mockResolvedValue({
                    error: 'capability_blocked', shouldHandoff: true,
                    message: 'Esto no lo puedo cerrar por chat.',
                }),
            };
            const engine = new ProcedureEngineService(
                { executeInTenantSchema: jest.fn().mockResolvedValue([procedure]) } as any,
                {
                    getJson: jest.fn().mockResolvedValue(state),
                    setJson: jest.fn().mockResolvedValue(undefined),
                    del: jest.fn().mockResolvedValue(undefined),
                } as any,
                toolExecutor as any,
            );

            const blocked = await engine.process(
                schemaName, tenantId, conversationId, contactId, 'dale',
                {
                    toolsConfig: { payments: { enabled: true } },
                    authority: {
                        // La tool está PUBLICADA: lo que la frena es el bloqueo
                        // del perfil, no la falta de publicación.
                        ...authorityFor('refund_payment'),
                        commitmentBlocked: { reason: 'capability:blocked:profile_blocked' },
                    },
                    commitmentBlocked: { reason: 'capability:blocked:profile_blocked' },
                },
            );

            // El paso se detiene en el motor, ANTES del ejecutor. Antes llegaba
            // hasta el ejecutor y volvía denegado: el resultado para el cliente
            // era el mismo, pero el reembolso se dejaba pedido y el ledger
            // abría y cerraba un asiento por una operación que nunca podía
            // correr. Ahora el motor toma la misma decisión con los mismos
            // datos y la escalada dice POR QUÉ.
            expect(toolExecutor.execute).not.toHaveBeenCalled();
            expect(blocked).toMatchObject({
                handoff: true,
                completed: false,
                handoffReason: 'procedure_tool_commitment_blocked:refund_payment',
            });
        });

        it('y el ejecutor sigue siendo la puerta si el paso llega igual', async () => {
            // La defensa del motor no reemplaza a la del ejecutor: un llamador
            // futuro que arme el paso por otro camino tiene que chocar con la
            // misma puerta. Por eso se verifica de los dos lados.
            const { executor, prisma } = buildExecutor();

            const result = await executor.execute(
                schemaName, tenantId, contactId, 'refund_payment',
                { paymentReference: 'pay-1' }, conversationId,
                blockedInputFor('refund_payment'),
            );

            expect(result).toMatchObject({ error: 'capability_blocked', shouldHandoff: true });
            expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
        });

        it('un paso no autorizado por el contrato no se ejecuta', () => {
            const engine = new ProcedureEngineService(
                { executeInTenantSchema: jest.fn() } as any,
                { get: jest.fn() } as any,
                { execute: jest.fn() } as any,
            );

            // El contrato publicó SOLO lecturas: el paso que pide un writer no
            // está en la lista y por lo tanto no está autorizado.
            //
            // Los argumentos van (tool, agente). Estaban al revés, y el caso
            // pasaba en verde por eso: el objeto llegaba como nombre de tool y
            // la cadena `'file_claim'` como agente, así que la función salía por
            // `agent.toolsConfig === undefined` sin mirar nunca la lista
            // publicada. Habría dado `false` con cualquier entrada.
            const agent = {
                authority: authorityFor('search_knowledge_base', 'get_insurance_plans'),
                toolsConfig: {},
            };
            expect((engine as any).toolStepAuthorized('file_claim', agent)).toBe(false);
            // Y el contrapunto que faltaba: lo que SÍ publicó, pasa.
            expect((engine as any).toolStepAuthorized('get_insurance_plans', agent)).toBe(true);
        });
    });

    // ── Puerta 4: pagos, integraciones y MCP ──────────────────────────────
    describe('familias asíncronas: pagos, integraciones y MCP tampoco', () => {
        it.each([
            'create_payment_link',
            'apply_discount',
            'refund_payment',
        ])('%s cae en un perfil bloqueado', async (tool) => {
            const { executor, paymentOperations } = buildExecutor();

            const result = await executor.execute(
                schemaName, tenantId, contactId, tool,
                { amount: 1000 }, conversationId, blockedInputFor(tool),
            );

            expect(result).toMatchObject({ error: 'capability_blocked' });
            expect(paymentOperations.preparePaymentLink).not.toHaveBeenCalled();
            expect(paymentOperations.createPaymentLink).not.toHaveBeenCalled();
            expect(paymentOperations.refundPayment).not.toHaveBeenCalled();
            expect(paymentOperations.applyDiscount).not.toHaveBeenCalled();
        });

        it('una tool MCP sin aprobación legible cae: el nombre no dice nada', async () => {
            const { executor } = buildExecutor();

            const result = await executor.execute(
                schemaName, tenantId, contactId, 'mcp__crm__create_deal',
                {}, conversationId, blockedInputFor('mcp__crm__create_deal'),
            );

            // Sin cliente MCP inyectado no hay aprobación que leer, y
            // desconocida no pasa: el servidor es de un tercero.
            expect(result).toMatchObject({ error: 'capability_blocked' });
        });

        it.each([
            ['una escritura aprobada cae', 'write', true],
            ['una tool sin efecto revisado cae', undefined, true],
            ['una LECTURA firmada por una persona pasa', 'read', false],
        ])('%s', async (_case, effect, blocked) => {
            // El nombre de una tool remota no dice nada. Lo único que sabe qué
            // hace es lo que una persona firmó al aprobarla, y esa firma es lo
            // que decide si sobrevive con la escritura bloqueada. Tratarlas a
            // todas como comprometedoras dejaba a un perfil bloqueado sin sus
            // consultas remotas —mudo—, que es peor que el problema evitado.
            const { executor } = buildExecutor();
            (executor as any).mcpClient = {
                getApproval: jest.fn().mockResolvedValue(effect ? { effect } : null),
                callRemoteTool: jest.fn().mockResolvedValue({ ok: true }),
            };

            const result = await executor.execute(
                schemaName, tenantId, contactId, 'mcp__crm__lookup',
                {}, conversationId, blockedInputFor('mcp__crm__lookup'),
            );

            expect(result?.error === 'capability_blocked').toBe(blocked);
        });

        it('las integraciones verticales de lectura siguen pasando', async () => {
            const { executor } = buildExecutor();

            for (const tool of ['get_restaurant_menu', 'get_fitness_schedule', 'list_clinic_services']) {
                const result = await executor.execute(
                    schemaName, tenantId, contactId, tool, {}, conversationId, blockedInputFor(tool),
                );
                expect(result?.error).not.toBe('capability_blocked');
            }
        });
    });

    // ── Puerta 5: el resolutor falla ──────────────────────────────────────
    describe('el resolutor falla: no se conserva el estado anterior', () => {
        it('un contrato irresoluble no publica writers ni deja pasar el ejecutor', async () => {
            const service = buildCapabilityService();

            // Un subtipo que el registro no conoce: el resolutor tira.
            await expect(service.resolve({
                tenantId, schemaName, industry: 'seguros', subType: 'no_existe_2026',
                toolsConfig: { insurance: { enabled: true } },
            })).rejects.toThrow();

            // Y con el estado `unresolved` el ejecutor cierra igual que con
            // `blocked`: la diferencia es el motivo, no el permiso.
            const { executor } = buildExecutor();
            const result = await executor.execute(
                schemaName, tenantId, contactId, 'create_appointment', {}, conversationId,
                {
                    authority: {
                        ...authorityFor('create_appointment'),
                        commitmentBlocked: { reason: 'capability:unresolved:resolver_error' },
                    },
                    commitmentBlocked: { reason: 'capability:unresolved:resolver_error' },
                },
            );
            expect(result).toMatchObject({ error: 'capability_blocked', shouldHandoff: true });
        });

        it('el motivo del turno viaja en el error, para que la escalada lo cuente', async () => {
            const { executor } = buildExecutor();

            const result = await executor.execute(
                schemaName, tenantId, contactId, 'place_order', {}, conversationId,
                {
                    authority: {
                        ...authorityFor('place_order'),
                        commitmentBlocked: { reason: 'capability:unresolved:plan_unreadable' },
                    },
                    commitmentBlocked: { reason: 'capability:unresolved:plan_unreadable' },
                },
            );

            expect(result.reason).toBe('capability:unresolved:plan_unreadable');
            // El mensaje al cliente NO nombra el motivo interno.
            expect(String(result.message)).not.toMatch(/capability|plan_unreadable|unresolved/i);
        });
    });

    // ── La regla que sostiene todo lo anterior ────────────────────────────
    describe('la clasificación es explícita, no inferida del nombre', () => {
        it('toda tool estática declara si compromete al negocio', () => {
            // Sin esto, la puerta decide por `effect === write`, que ya se
            // probó insuficiente: dejaba caer siete lecturas semánticas y una
            // escritura de contacto que no compromete nada.
            const { executor } = buildExecutor();
            expect(typeof (executor as any).execute).toBe('function');

            for (const tool of [
                'search_knowledge_base', 'get_policy', 'search_faqs',
                'create_appointment', 'file_claim', 'place_order',
            ]) {
                const policy = getToolPolicy(tool);
                expect(policy).toBeDefined();
                expect(typeof policy!.commitsBusiness).toBe('boolean');
            }
        });

        it('las lecturas semánticas no se confunden con escrituras', () => {
            for (const tool of [
                'search_faqs', 'get_policy', 'search_knowledge_base',
                'recommend_products', 'request_identity_code', 'verify_identity_code',
            ]) {
                expect(isNonCommittalTool(tool)).toBe(true);
            }
        });

        it('lo que compromete se marca como tal', () => {
            for (const tool of [
                'create_appointment', 'cancel_appointment', 'place_order',
                'create_payment_link', 'file_claim', 'send_booking_link',
            ]) {
                expect(isNonCommittalTool(tool)).toBe(false);
            }
        });
    });
});
