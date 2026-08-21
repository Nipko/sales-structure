import type { ProcedureDefinition, ProcedureRunState } from '@parallext/shared';
import { ProcedureEngineService } from './procedure-engine.service';
import { interpolateProcedureArgs } from './procedure-slot-interpolation';
import {
    enabledToolFamilies,
    procedureAuthorizedToolNames,
    staticToolsForAgentConfig,
} from './agent-tool-registry';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * Procedures combinaba dos defectos opuestos: podía saltarse el gating del
 * agente y, al mismo tiempo, no le pasaba a la tool los datos que acababa de
 * recoger.
 *
 * Cargaba todos los procedimientos activos del tenant sin mirar el campo
 * `vertical` que ya guardaba, aceptaba cualquier string como nombre de tool y
 * lo mandaba al executor tal cual, y pasaba `step.config.args` literal — así
 * que un paso que preguntaba el número de orden llamaba a `get_order_status`
 * con `{}`, o peor, con el literal `"{{ numero_orden }}"`.
 */

const schemaName = 'tenant_proc';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const procedureId = '44444444-4444-4444-8444-444444444444';

function buildProcedure(overrides: Partial<ProcedureDefinition> = {}): ProcedureDefinition {
    return {
        id: procedureId,
        name: 'Estado del pedido',
        trigger: { keywords: ['estado'] },
        status: 'active',
        version: 1,
        steps: [
            {
                id: 'lookup',
                type: 'tool',
                config: {
                    tool: 'get_order_status',
                    args: { orderId: '{{ numero_orden }}' },
                    saveAs: 'order',
                },
            },
            { id: 'done', type: 'message', config: { text: 'Listo.' } },
        ],
        ...overrides,
    } as ProcedureDefinition;
}

function createHarness(options: {
    procedure?: ProcedureDefinition;
    state?: ProcedureRunState | null;
    toolResult?: Record<string, unknown>;
    rows?: any[];
} = {}) {
    const procedure = options.procedure ?? buildProcedure();
    const state = options.state === undefined
        ? {
            procedureId,
            version: 1,
            currentStepId: 'lookup',
            collected: { numero_orden: '1024' },
            awaitingField: null,
            startedAt: '2026-08-20T00:00:00.000Z',
        } as ProcedureRunState
        : options.state;

    let saved: ProcedureRunState | null = null;
    const redis = {
        getJson: jest.fn().mockResolvedValue(state),
        setJson: jest.fn(async (_k: string, v: ProcedureRunState) => { saved = structuredClone(v); }),
        del: jest.fn().mockResolvedValue(undefined),
    };
    const rows = options.rows ?? [{ ...procedure, steps: procedure.steps, vertical: (procedure as any).vertical }];
    const prisma = {
        executeInTenantSchema: jest.fn().mockImplementation(async (_schema: string, sql: string) => {
            if (sql.includes('to_regclass')) return [{ reg: 'procedures' }];
            return rows;
        }),
    };
    const toolExecutor = { execute: jest.fn().mockResolvedValue(options.toolResult ?? { ok: true }) };
    const service = new ProcedureEngineService(prisma as any, redis as any, toolExecutor as any);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    return { service, redis, toolExecutor, prisma, getSaved: () => saved };
}

/**
 * `get_order_status` vive en la familia e-commerce, no en catálogo.
 *
 * La config de familias sigue acá porque describe qué encendió el dueño, pero
 * ya no es lo que autoriza: la autoridad del turno es lo que decide, y sin ella
 * ningún paso de tool corre. Antes, cuando el contrato no llegaba, la
 * autorización *caía* a esta config — el camino más degradado era el más
 * permisivo.
 */
const CATALOG_AGENT = {
    toolsConfig: { catalog: { enabled: true }, orders: { enabled: true }, ecommerce: { enabled: true } },
    authority: authorityFor('get_order_status'),
};

/**
 * Para los casos de arranque en frío el paso lleva un argumento literal: sin
 * estado previo `collected` está vacío, y un placeholder frenaría el paso
 * legítimamente — lo que taparía justo lo que estos tests miran, que es el
 * filtro por vertical.
 */
function literalProcedure(overrides: Partial<ProcedureDefinition> = {}): ProcedureDefinition {
    const base = buildProcedure(overrides);
    return {
        ...base,
        steps: [
            { id: 'lookup', type: 'tool', config: { tool: 'get_order_status', args: { orderId: 'fijo' } } },
            { id: 'done', type: 'message', config: { text: 'Listo.' } },
        ],
    } as ProcedureDefinition;
}

describe('un paso de tool se compila contra el agente', () => {
    it('ejecuta la tool cuando el agente tiene la familia habilitada', async () => {
        const { service, toolExecutor } = createHarness();

        const result = await service.process(
            schemaName, tenantId, conversationId, contactId, 'estado', CATALOG_AGENT as any,
        );

        expect(toolExecutor.execute).toHaveBeenCalled();
        expect(result.handled).toBe(true);
    });

    it('rechaza y escala una tool fuera de las familias del agente', async () => {
        const { service, toolExecutor } = createHarness();

        const result = await service.process(
            schemaName, tenantId, conversationId, contactId, 'estado',
            { toolsConfig: { faqs: { enabled: true } }, authority: authorityFor('search_faqs') } as any,
        );

        expect(toolExecutor.execute).not.toHaveBeenCalled();
        expect(result).toMatchObject({ handoff: true, completed: false });
        // El motivo es tipado: "no está publicada" no es lo mismo que "el dueño
        // la apagó" ni que "el perfil está bloqueado", y las tres se arreglan en
        // lugares distintos.
        expect(result.handoffReason).toBe('procedure_tool_not_authorised:get_order_status');
    });

    it('sin contrato del agente no ejecuta nada: falla cerrado', async () => {
        const { service, toolExecutor } = createHarness();

        const result = await service.process(
            schemaName, tenantId, conversationId, contactId, 'estado',
        );

        expect(toolExecutor.execute).not.toHaveBeenCalled();
        expect(result.handoff).toBe(true);
    });

    it('el mensaje al escalar no nombra la tool ni la configuración', async () => {
        const { service } = createHarness();
        const result = await service.process(
            schemaName, tenantId, conversationId, contactId, 'estado',
            { toolsConfig: {}, authority: authorityFor() } as any,
        );
        expect(result.text).not.toMatch(/get_order_status|toolsConfig|catalog/);
    });
});

describe('el procedimiento respeta la vertical con la que fue escrito', () => {
    const tagged = literalProcedure({ vertical: 'restaurantes' } as any);

    it('no se dispara en una conversación de otra vertical', async () => {
        const { service, toolExecutor } = createHarness({ procedure: tagged, state: null });

        const result = await service.process(
            schemaName, tenantId, conversationId, contactId, 'estado',
            { ...CATALOG_AGENT, industry: 'gimnasios' } as any,
        );

        expect(result.handled).toBe(false);
        expect(toolExecutor.execute).not.toHaveBeenCalled();
    });

    it('sí se dispara en su propia vertical', async () => {
        const { service, toolExecutor } = createHarness({ procedure: tagged, state: null });

        await service.process(
            schemaName, tenantId, conversationId, contactId, 'estado',
            { ...CATALOG_AGENT, industry: 'restaurantes' } as any,
        );

        expect(toolExecutor.execute).toHaveBeenCalled();
    });

    it('también matchea contra el subtipo, que es como muchos autores etiquetan', async () => {
        const { service, toolExecutor } = createHarness({
            procedure: literalProcedure({ vertical: 'comida_rapida' } as any),
            state: null,
        });

        await service.process(
            schemaName, tenantId, conversationId, contactId, 'estado',
            { ...CATALOG_AGENT, industry: 'restaurantes', subType: 'comida_rapida' } as any,
        );

        expect(toolExecutor.execute).toHaveBeenCalled();
    });

    it('un procedimiento sin vertical es horizontal y aplica siempre', async () => {
        const { service, toolExecutor } = createHarness({ procedure: literalProcedure(), state: null });

        await service.process(
            schemaName, tenantId, conversationId, contactId, 'estado',
            { ...CATALOG_AGENT, industry: 'gimnasios' } as any,
        );

        expect(toolExecutor.execute).toHaveBeenCalled();
    });

    it('un procedimiento en curso re-etiquetado a otra vertical se abandona limpio', async () => {
        const { service, redis } = createHarness({ procedure: tagged });

        const result = await service.process(
            schemaName, tenantId, conversationId, contactId, 'lo que sea',
            { ...CATALOG_AGENT, industry: 'gimnasios' } as any,
        );

        expect(result.handled).toBe(false);
        expect(redis.del).toHaveBeenCalled();
    });
});

describe('los datos recogidos llegan a la tool', () => {
    it('interpola la respuesta del cliente en los argumentos', async () => {
        const { service, toolExecutor } = createHarness();

        await service.process(
            schemaName, tenantId, conversationId, contactId, 'estado', CATALOG_AGENT as any,
        );

        expect(toolExecutor.execute).toHaveBeenCalledWith(
            schemaName, tenantId, contactId, 'get_order_status',
            { orderId: '1024' }, conversationId,
            {
                authority: CATALOG_AGENT.authority,
                channelType: undefined,
                commitmentBlocked: null,
                deniedTools: undefined,
            },
        );
    });

    it('un placeholder sin resolver frena el paso en vez de llamar con el literal', async () => {
        const { service, toolExecutor } = createHarness({
            state: {
                procedureId, version: 1, currentStepId: 'lookup',
                collected: {}, awaitingField: null, startedAt: '2026-08-20T00:00:00.000Z',
            },
        });

        const result = await service.process(
            schemaName, tenantId, conversationId, contactId, 'estado', CATALOG_AGENT as any,
        );

        expect(toolExecutor.execute).not.toHaveBeenCalled();
        expect(result).toMatchObject({ handled: true, completed: false });
    });
});

describe('interpolación tipada de slots', () => {
    it('un placeholder completo conserva el tipo del valor', () => {
        const out = interpolateProcedureArgs(
            { qty: '{{ cantidad }}', meta: '{{ extra }}' },
            { cantidad: 3, extra: { a: 1 } },
        );
        expect(out.ok).toBe(true);
        expect(out.args).toEqual({ qty: 3, meta: { a: 1 } });
    });

    it('un placeholder dentro de texto interpola como string', () => {
        const out = interpolateProcedureArgs(
            { note: 'Pedido {{ numero }} del cliente' },
            { numero: 42 },
        );
        expect(out.args.note).toBe('Pedido 42 del cliente');
    });

    it('coacciona el tipo declarado', () => {
        const out = interpolateProcedureArgs(
            { qty: '{{ cantidad }}', desde: '{{ fecha }}', ok: '{{ acepta }}' },
            { cantidad: '4', fecha: '2026-09-01', acepta: 'sí' },
            { qty: { type: 'integer' }, desde: { type: 'date' }, ok: { type: 'boolean' } },
        );
        expect(out.ok).toBe(true);
        expect(out.args).toEqual({ qty: 4, desde: '2026-09-01', ok: true });
    });

    it('un valor que no cumple el tipo se reporta, no se manda como NaN', () => {
        const out = interpolateProcedureArgs(
            { qty: '{{ cantidad }}' },
            { cantidad: 'tres' },
            { qty: { type: 'integer' } },
        );
        expect(out.ok).toBe(false);
        expect(out.invalid).toEqual([{ arg: 'qty', expected: 'integer', received: 'tres' }]);
        expect(out.args).toEqual({});
    });

    it('una fecha inválida no pasa aunque tenga forma de fecha', () => {
        const out = interpolateProcedureArgs(
            { d: '{{ f }}' }, { f: '2026-02-31' }, { d: { type: 'date' } },
        );
        expect(out.ok).toBe(false);
    });

    it('un slot requerido sin argumento se reporta como faltante', () => {
        const out = interpolateProcedureArgs({}, {}, { orderId: { required: true } });
        expect(out.ok).toBe(false);
        expect(out.missing).toContain('orderId');
    });

    it('un literal sin placeholder pasa intacto', () => {
        const out = interpolateProcedureArgs({ fixed: 'valor', n: 7 }, {});
        expect(out.ok).toBe(true);
        expect(out.args).toEqual({ fixed: 'valor', n: 7 });
    });

    it('resuelve rutas con punto dentro de un resultado guardado', () => {
        const out = interpolateProcedureArgs(
            { id: '{{ order.booking.id }}' },
            { order: { booking: { id: 'abc' } } },
        );
        expect(out.args).toEqual({ id: 'abc' });
    });
});

describe('el registro único de tools', () => {
    it('un agente sin nada habilitado no autoriza ninguna tool', () => {
        expect(staticToolsForAgentConfig({})).toEqual([]);
        expect(staticToolsForAgentConfig(undefined)).toEqual([]);
        expect(procedureAuthorizedToolNames({}).size).toBe(0);
    });

    it('solo cuenta el flag explícito `enabled: true`', () => {
        expect(staticToolsForAgentConfig({ catalog: { enabled: 'true' } })).toEqual([]);
        expect(staticToolsForAgentConfig({ catalog: {} })).toEqual([]);
        expect(staticToolsForAgentConfig({ catalog: { enabled: true } }).length).toBeGreaterThan(0);
    });

    it('las tools de dinero se autorizan a Procedures solo con pagos habilitados', () => {
        expect(procedureAuthorizedToolNames({ catalog: { enabled: true } }).has('create_payment_link')).toBe(false);
        const withPayments = procedureAuthorizedToolNames({ payments: { enabled: true } });
        expect(withPayments.has('create_payment_link')).toBe(true);
        expect(withPayments.has('get_payment_status')).toBe(true);
        // Nunca se le ofrece al modelo, pero un SOP escrito a mano sí puede
        // nombrarla: el guard central le exige A4, confirmación y aprobación
        // humana antes de mover un peso.
        expect(withPayments.has('refund_payment')).toBe(true);
    });

    it('enumera las familias activas para diagnóstico', () => {
        expect(enabledToolFamilies({ catalog: { enabled: true }, faqs: { enabled: true } }))
            .toEqual(['catalog', 'faqs']);
    });

    it('no publica dos veces la misma tool cuando hay familias solapadas', () => {
        const tools = staticToolsForAgentConfig({
            catalog: { enabled: true }, offers: { enabled: true }, ecommerce: { enabled: true },
        });
        const names = tools.map(t => t.name);
        expect(new Set(names).size).toBe(names.length);
    });
});
