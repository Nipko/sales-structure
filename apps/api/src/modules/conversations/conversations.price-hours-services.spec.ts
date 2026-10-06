import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import type { AgentTurnSession } from './agent-turn-session';
import { IntentInterpreterService } from './intent-interpreter.service';
import type { ProcedureDefinition } from '@parallext/shared';
import { randomUUID } from 'crypto';

/**
 * Regression campaign 2026-10-05 (regresion2): service-level replays of
 *  - the intermittent product price (own `products` catalog was never part of the
 *    turn's verified price corpus),
 *  - "a las 4" read as 04:00 (the agenda-derived hours never reached the resolver),
 *  - invented service durations (`<available_services>` only filled on one route).
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SERVICES = [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Corte y estilo', durationMinutes: 120, price: 40000, priceStatus: 'confirmed', currency: 'COP' },
    { id: '33333333-3333-4333-8333-333333333333', name: 'Manicure', durationMinutes: 60, price: 50000, priceStatus: 'confirmed', currency: 'COP' },
];

function fixture(tools: Record<string, any> = { appointments: { enabled: true } }) {
    const f = agentTurnFixture();
    const namespace = { schemaName: 'tenant_eval_11111111_aaaaaaaaaaaaaaaaaaaaaaaa', sourceSchema: 'tenant_test', tenantId: 'tenant',
        token: '11111111-1111-4111-8111-111111111111', expiresAt: new Date(Date.now() + 60_000).toISOString(), tables: [] };
    const conversationId = randomUUID();
    (f.service as any).namespaces = { assertOwned: jest.fn() };
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'es', industry: 'salon', tools, rag: { enabled: false }, llm: {},
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'salon', subType: 'belleza' });
    publishTools(f, ['list_services', 'check_availability', 'create_appointment']);
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string) => {
        if (name === 'list_services') return { services: SERVICES };
        if (name === 'check_availability') return { available: true, slots: [{ time: '16:00', endTime: '18:00' }] };
        throw new Error(`Unexpected business write: ${name}`);
    });
    let id: string | undefined;
    const turn = async (message: string, extra: Record<string, any> = {}) => {
        const result = await f.service.test('tenant', AGENT, { message, channelType: 'telegram', runtimeSessionId: id }, {
            evalMode: true, sandboxContactId: '00000000-0000-4000-8000-00000000eba1', sandboxConversationId: conversationId,
            sandboxNamespace: namespace, sandboxInboundMessageId: randomUUID(), ...extra,
        });
        id = result.debug.runtimeSessionId;
        return result;
    };
    const session = (): AgentTurnSession => (f.service as any).sessions.sessions.get(id).session;
    return { f, turn, session };
}

describe('the own `products` catalog authorises its prices without a tool call', () => {
    const PRODUCT = { id: 'p1', name: 'Audífono QA Aurora', price: '119900', currency: 'COP', stock: 3, mentioned: true, total: '1' };
    const withCatalog = (rows: any[], tools: Record<string, any> = { catalog: { enabled: true } }) => {
        const h = fixture(tools);
        h.f.prisma.executeInTenantSchema.mockImplementation(async (_schema: string, sql: string) => /FROM\s+products/i.test(sql) ? rows : []);
        h.f.llmRouter.execute.mockResolvedValue({ content: 'El Audífono QA Aurora cuesta $119.900 COP.', model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 });
        return h;
    };
    const productsQueries = (h: ReturnType<typeof fixture>) =>
        h.f.prisma.executeInTenantSchema.mock.calls.map((call: any[]) => String(call[1])).filter((sql: string) => /FROM\s+products/i.test(sql));

    it('keeps the price the model states from the catalog although it called no tool', async () => {
        const h = withCatalog([PRODUCT]);
        const result = await h.turn('¿Cuánto cuesta el Audífono QA Aurora?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(result.debug.toolCalls).toHaveLength(0);
        expect(result.reply).toContain('119.900');
        expect(h.session().trace.systemPrompt).toContain('price="119900"');
        expect(h.session().trace.systemPrompt).toContain('<catalog>');
    });

    it('still blocks a figure that is not in the catalog', async () => {
        const h = withCatalog([PRODUCT]);
        h.f.llmRouter.execute.mockResolvedValue({ content: 'El Audífono QA Aurora cuesta $99.900 COP.', model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 });
        const result = await h.turn('¿Cuánto cuesta el Audífono QA Aurora?');
        expect(result.reply).not.toContain('99.900');
    });

    it('only reads products that are for sale, and only when the owner enabled the catalog', async () => {
        const h = withCatalog([PRODUCT]);
        await h.turn('¿Cuánto cuesta el Audífono QA Aurora?');
        expect(productsQueries(h).length).toBeGreaterThan(0);
        expect(productsQueries(h).every((sql: string) => /is_available\s*=\s*true/i.test(sql))).toBe(true);

        const off = withCatalog([PRODUCT], { appointments: { enabled: true } });
        await off.turn('¿Cuánto cuesta el Audífono QA Aurora?');
        expect(productsQueries(off)).toHaveLength(0);
    });

    it('does not surface a product without a price as a number', async () => {
        const h = withCatalog([{ ...PRODUCT, price: '0' }]);
        await h.turn('¿Cuánto cuesta el Audífono QA Aurora?');
        const prompt = h.session().trace.systemPrompt as string;
        expect(prompt).toContain('price_status="missing"');
        expect(prompt).not.toContain('price="0"');
    });

    it('drops catalog rows the customer did not mention when the catalog is large', async () => {
        const rows = [PRODUCT, { ...PRODUCT, id: 'p2', name: 'Otro', price: '5000', mentioned: false, total: '40' }];
        const h = withCatalog(rows);
        await h.turn('¿Cuánto cuesta el Audífono QA Aurora?');
        const prompt = h.session().trace.systemPrompt as string;
        expect(prompt).toContain('price="119900"');
        expect(prompt).not.toContain('price="5000"');
    });

    it('a failed catalog read leaves the turn working', async () => {
        const h = fixture({ catalog: { enabled: true } });
        h.f.prisma.executeInTenantSchema.mockImplementation(async (_schema: string, sql: string) => {
            if (/FROM\s+products/i.test(sql)) throw new Error('relation "products" does not exist');
            return [];
        });
        const result = await h.turn('¿Cuánto cuesta el Audífono QA Aurora?');
        expect(result.debug.runtimeError).toBeUndefined();
    });
});

describe('"a las 4" uses the hours derived from the appointment agenda', () => {
    const agenda = [1, 2, 3, 4, 5, 6].map(day => ({ user_id: 'u', day_of_week: day, start_time: '09:00:00', end_time: '19:00:00' }));
    const harness = (rows: any[]) => {
        const h = fixture();
        (h.f.prisma as any).getTenantSchemaName = async () => 'tenant_test';
        h.f.prisma.executeInTenantSchema.mockImplementation(async (_schema: string, sql: string) => /availability_slots/.test(sql) ? rows : []);
        return h;
    };
    const spy = () => jest.spyOn(IntentInterpreterService.prototype, 'interpret');
    afterEach(() => jest.restoreAllMocks());

    it.each(['¿Tienen cupo el sábado a las 4 para corte?', 'mañana a las 4 hay espacio?'])('reads %s as 16:00 with a 09-19 agenda', async text => {
        const interpret = spy();
        const h = harness(agenda);
        await h.turn(text);
        const resolver = interpret.mock.calls.map(call => call[8]).find(Boolean) as ((date: string) => any) | undefined;
        expect(resolver).toBeDefined();
        expect(resolver!('2026-10-10')).toEqual({ openMin: 540, closeMin: 1140 });
        const parsed = await interpret.mock.results[0].value;
        expect(parsed.timeMentioned).toBe('16:00');
    });

    it('without any agenda the bare hour is left as written', async () => {
        const interpret = spy();
        const h = harness([]);
        await h.turn('¿Tienen cupo el sábado a las 4 para corte?');
        const resolver = interpret.mock.calls.map(call => call[8]).find(Boolean) as ((date: string) => any) | undefined;
        expect(resolver?.('2026-10-10') ?? null).toBeNull();
        expect((await interpret.mock.results[0].value).timeMentioned).toBe('04:00');
    });
});

describe('service durations reach the prompt on every route', () => {
    const definitions: ProcedureDefinition[] = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Return', version: 1, status: 'active',
        trigger: { keywords: ['devolucion'] }, steps: [
            { id: 'email', type: 'ask', config: { field: 'email', fieldType: 'email', question: 'Email?' } },
            { id: 'reason', type: 'ask', config: { field: 'reason', question: 'Reason?' } },
        ] }];

    async function procedureFixture(published?: string[]) {
        const h = fixture();
        if (published) publishTools(h.f, published);
        h.f.revisions.captureProcedures.mockResolvedValue(definitions);
        const snapshot = await h.f.service.captureSnapshot('tenant', AGENT);
        let id: string | undefined;
        const turn = async (message: string) => {
            const result = await h.f.service.test('tenant', AGENT, { message, channelType: 'telegram', runtimeSessionId: id }, { agentSnapshot: snapshot });
            id = result.debug.runtimeSessionId;
            expect(result.debug.runtimeError).toBeUndefined();
            return result;
        };
        const session = (): AgentTurnSession => (h.f.service as any).sessions.sessions.get(id).session;
        return { ...h, turn, session };
    }

    it('with a procedure mission open the prompt still lists the services with their real duration', async () => {
        const h = await procedureFixture();
        await h.turn('Quiero una devolucion');
        await h.turn('customer@example.test');
        const prompt = h.session().trace.systemPrompt as string;
        expect(prompt).toContain('<available_services>');
        expect(prompt).toContain('duration_minutes="120"');
        expect(prompt).toContain('Corte y estilo');
    });

    it('reads the catalog when the cache is cold, and never when booking is not authorised', async () => {
        const h = await procedureFixture();
        await h.turn('Quiero una devolucion');
        await h.session().state.del('booking:services:tenant');
        h.f.toolExecutor.execute.mockClear();
        await h.turn('customer@example.test');
        expect(h.f.toolExecutor.execute.mock.calls.some((call: any[]) => call[3] === 'list_services')).toBe(true);
        expect(h.session().trace.systemPrompt).toContain('duration_minutes="120"');

        const denied = await procedureFixture(['list_services']);
        await denied.turn('Quiero una devolucion');
        denied.f.toolExecutor.execute.mockClear();
        await denied.turn('customer@example.test');
        expect(denied.f.toolExecutor.execute).not.toHaveBeenCalled();
    });
});

describe('the corrective price retry is written in the turn language', () => {
    it('asks the model to rewrite in English for an English turn', async () => {
        const h = fixture({ appointments: { enabled: true } });
        h.f.llmRouter.execute.mockResolvedValue({ content: 'It costs $99.900 COP.', model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 });
        await h.turn('How much does the QA Aurora headphone cost? Please tell me, thank you');
        const retries = h.f.llmRouter.execute.mock.calls
            .map((call: any[]) => call[0].messages?.[call[0].messages.length - 1]?.content)
            .filter((content: unknown) => typeof content === 'string' && /ONLY prices|ÚNICAMENTE precios/.test(content));
        expect(retries.length).toBeGreaterThan(0);
        expect(retries.every((content: string) => content.startsWith('Your previous reply'))).toBe(true);
    });
});
