import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { TurnTraceContext } from '../trace/turn-trace-context';
import { FACTS_LEDGER_FLAG, RENDERED_FACTS_FLAG } from '../throttle/feature-flags.service';

/**
 * Operations runtime PR6 through the real turn (Agent Test runtime session): with `agentRuntime.renderedFacts` on, the
 * figures the customer reads are rendered by the server from the verified facts; what the model typed itself is replaced.
 *
 * The four live QA transcripts (2026-10-22), each replayed with a stand-in model that does what the production model did:
 *   - real estate: «tiene 2 baños» — the record says bathrooms 1, bedrooms 2;
 *   - store: «ha hecho tres pedidos» — the real count is 6, all cancelled, from a partial list (3 shown);
 *   - restaurant: «precio no confirmado» for a dish priced 13.500 COP, then the price retracted when the customer doubted;
 *   - hotel: amenities affirmed that the record does not list (it lists none).
 * The flag is read from the sealed snapshot: Agent Test turns never query the tenant for it.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const usage = { model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 };

interface Scenario {
    industry: string;
    subType: string;
    tools: string[];
    results: Record<string, any>;
    /** The tool the model calls on its first step of each turn (none: it answers directly). */
    call?: (message: string) => { name: string; args?: any } | null;
    /** What the model writes once it has the tool results. */
    reply: (message: string, toolBodies: any[], systemPrompt: string) => string;
}

function fixture(scenario: Scenario, flags: Record<string, boolean>) {
    const f = agentTurnFixture();
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'es', industry: scenario.industry, tools: {}, rag: { enabled: false }, llm: { temperature: 0 },
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: scenario.industry, subType: scenario.subType });
    f.prisma.tenant.findUnique.mockResolvedValue({ settings: { featureFlags: flags } });
    publishTools(f, scenario.tools);
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string) =>
        scenario.results[name] ?? { error: `unexpected tool ${name}` });
    let n = 0;
    f.llmRouter.execute.mockImplementation(async (req: any) => {
        if (req.task === 'classify') return { content: '{"operationKey":"none","confidence":0.9}', routingDecision: { selectedModel: { id: 'cheap' } }, ...usage };
        const last = [...req.messages].reverse().find((m: any) => m.role === 'user')?.content;
        const tools = req.messages.filter((m: any) => m.role === 'tool');
        const call = scenario.call?.(last);
        const calledThisTurn = tools.some((m: any) => m.toolCallId?.startsWith(`rf${n}`));
        if (call && req.tools && !calledThisTurn) {
            n += 1;
            return { ...usage, content: '', toolCalls: [{ id: `rf${n}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) } }] };
        }
        return { ...usage, content: scenario.reply(last, tools.map((m: any) => JSON.parse(m.content)), req.systemPrompt) };
    });
    const toEvent = jest.spyOn(TurnTraceContext.prototype, 'toEvent');
    let id: string | undefined;
    const turn = async (message: string) => {
        const result = await f.service.test('tenant', AGENT, { message, channelType: 'telegram', runtimeSessionId: id }, { agentSnapshot: undefined });
        id = result.debug.runtimeSessionId;
        return result;
    };
    const steps = () => toEvent.mock.results.flatMap(r => r.type === 'return' ? r.value.steps : []);
    const renderedStep = () => steps().filter((s: any) => s.label === 'rendered_facts').pop();
    const replyCalls = () => f.llmRouter.execute.mock.calls.filter((c: any[]) => c[0]?.task !== 'classify').map((c: any[]) => c[0]);
    return { f, turn, renderedStep, replyCalls };
}

/** The token the turn offered for `field` (in the tool result's fact_tokens or in the prompt's <fact_tokens>). */
function tokenFor(bodies: any[], systemPrompt: string, field: string, kind: 'fact' | 'count' = 'fact'): string | undefined {
    for (const body of bodies) {
        const entry = (body?.fact_tokens || []).find((t: any) => t.field === field);
        if (entry?.[kind]) return entry[kind];
    }
    return systemPrompt.match(new RegExp(`<token [^>]*${kind}="(⟦${kind}:[^"]+⟧)"[^>]*field="${field}"`))?.[1];
}

const LISTING = { listing: { id: 'lst-laureles', title: 'Apartamento Laureles', price: 2500000, currency: 'COP', priceStatus: 'confirmed', bedrooms: 2, bathrooms: 1, area: 78 } };
const realEstate: Scenario = {
    industry: 'inmobiliaria', subType: 'arriendo', tools: ['get_listing_details'], results: { get_listing_details: LISTING },
    call: () => ({ name: 'get_listing_details', args: { listingId: 'lst-laureles' } }),
    // Production: the model mixed the fields.
    reply: () => 'El Apartamento Laureles tiene 2 baños y una cocina integral.',
};
const THREE_OF_SIX = { orders: Array.from({ length: 3 }, (_, i) => ({ id: `0000000${i}-1111-4111-8111-111111111111`, status: 'cancelled', totalAmount: 119900, currency: 'COP' })), total: 6, hasMore: true };
const store: Scenario = {
    industry: 'retail', subType: 'electronica', tools: ['list_my_catalog_orders'], results: { list_my_catalog_orders: THREE_OF_SIX },
    call: () => ({ name: 'list_my_catalog_orders', args: {} }),
    reply: () => 'Veo que ha hecho tres pedidos con nosotros, todos cancelados. ¿Le ayudo con algo más?',
};
const MENU = { count: 1, items: [{ id: 'dish-paisa', name: 'Bandeja paisa', price: 13500, priceStatus: 'confirmed', currency: 'COP', allergens: [] }] };
const restaurant: Scenario = {
    industry: 'restaurantes', subType: 'restaurante', tools: ['get_menu'], results: { get_menu: MENU },
    call: message => (/cu[aá]nto cuesta/i.test(message) ? { name: 'get_menu' } : null),
    reply: message => (/seguro/i.test(message)
        ? 'Tiene razón, disculpe: me equivoqué con el precio de la bandeja paisa, no lo tengo confirmado.'
        : 'La bandeja paisa tiene precio no confirmado por ahora.'),
};
const HOTEL = { property: { id: 'prop-mirador', name: 'Hotel Mirador', nightPrice: 180000, currency: 'COP', amenities: [] } };
const hotel: Scenario = {
    industry: 'turismo', subType: 'hotel', tools: ['get_property_details'], results: { get_property_details: HOTEL },
    call: () => ({ name: 'get_property_details', args: { propertyId: 'prop-mirador' } }),
    reply: () => '¡Claro! El Hotel Mirador tiene piscina y parqueadero gratis.',
};

afterEach(() => jest.restoreAllMocks());

describe('rendered facts through the turn (flag on)', () => {
    it('real estate: «2 baños» never reaches the customer; the record fields do (bathrooms 1)', async () => {
        const h = fixture(realEstate, { [RENDERED_FACTS_FLAG]: true });
        const result = await h.turn('¿Cuántos baños tiene el Apartamento Laureles?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(result.reply).toBe('Según la ficha, Apartamento Laureles tiene 1 baño.');
        expect(h.renderedStep()?.metadata).toMatchObject({ fallbacks: 1, reasons: ['unrendered_count'] });
        // The tool result reached the model with its fact tokens; the contract says to use them.
        const toolBody = JSON.parse(h.replyCalls()[1].messages.find((m: any) => m.role === 'tool').content);
        expect(toolBody.fact_tokens).toEqual(expect.arrayContaining([expect.objectContaining({ subject: 'Apartamento Laureles', field: 'bathrooms', fact: expect.stringMatching(/^⟦fact:f[0-9a-z]+⟧$/) })]));
        expect(result.debug.systemPrompt).toContain('22. FACTS ARE TOKENS.');
        expect(result.debug.systemPrompt).not.toContain('22a. NO NUMBER WITHOUT A CONFIRMED PRICE');
        expect(result.debug.systemPrompt).not.toContain('22b. CURRENT PACKAGE PRICES');
        expect(result.debug.systemPrompt).not.toContain('22. NEVER CONVERT AN AMOUNT');
    });

    it('real estate: a model that cites the tokens gets the record values rendered', async () => {
        const h = fixture({ ...realEstate, reply: (_m, bodies, prompt) =>
            `El Apartamento Laureles tiene ${tokenFor(bodies, prompt, 'bedrooms')} habitaciones, ${tokenFor(bodies, prompt, 'bathrooms')} baño y cuesta ${tokenFor(bodies, prompt, 'price')} al mes.` },
        { [RENDERED_FACTS_FLAG]: true });
        const result = await h.turn('¿Cómo es el Apartamento Laureles?');
        expect(result.reply).toBe('El Apartamento Laureles tiene 2 habitaciones, 1 baño y cuesta 2.500.000 COP al mes.');
        expect(h.renderedStep()?.metadata).toMatchObject({ tokens: 3, rendered: 3, fallbacks: 0 });
    });

    it('store: «tres pedidos» is replaced by the count of the list with its completeness («3 de 6»)', async () => {
        const h = fixture(store, { [RENDERED_FACTS_FLAG]: true });
        const result = await h.turn('¿He hecho compras con ustedes?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(result.reply).toBe('Tienes 6 pedidos registrados; te muestro 3 de 6. ¿Le ayudo con algo más?');
        const cited = fixture({ ...store, reply: (_m, bodies, prompt) => `Le muestro ${tokenFor(bodies, prompt, 'records', 'count')} pedidos: ${tokenFor(bodies, prompt, 'records')}.` },
            { [RENDERED_FACTS_FLAG]: true });
        expect((await cited.turn('¿He hecho compras con ustedes?')).reply)
            .toBe('Le muestro 3 de 6 pedidos: Ref. 00000000 (estado: anulado), Ref. 00000001 (estado: anulado) y Ref. 00000002 (estado: anulado).');
    });

    it('restaurant: a confirmed 13.500 COP is never denied, nor retracted when the customer doubts it (ledger on)', async () => {
        const h = fixture(restaurant, { [RENDERED_FACTS_FLAG]: true, [FACTS_LEDGER_FLAG]: true });
        const first = await h.turn('¿Cuánto cuesta la bandeja paisa?');
        expect(first.debug.runtimeError).toBeUndefined();
        expect(first.reply).toBe('El precio de Bandeja paisa es 13.500 COP.');
        const tenantReads = h.f.prisma.tenant.findUnique.mock.calls.length;
        const second = await h.turn('¿Seguro? Me parece que la bandeja paisa no vale eso');
        expect(second.reply).toBe('El precio de Bandeja paisa es 13.500 COP.');
        expect(h.renderedStep()?.metadata).toMatchObject({ reasons: ['price_denied'] });
        // Turn 2 read nothing: the price came from the ledger, offered as a token in the prompt.
        expect(h.f.toolExecutor.execute.mock.calls.filter((c: any[]) => c[3] === 'get_menu')).toHaveLength(1);
        expect(second.debug.systemPrompt).toMatch(/<fact_tokens>[\s\S]*fact="⟦fact:f[0-9a-z]+⟧" kind="money"[^>]*subject="Bandeja paisa" field="price" value="13500 COP" price_status="confirmed"/);
        // The flag comes from the sealed snapshot: the second Agent Test turn makes no tenant query.
        expect(h.f.prisma.tenant.findUnique.mock.calls.length).toBe(tenantReads);
    });

    it('hotel: amenities the record does not list are never affirmed', async () => {
        const h = fixture(hotel, { [RENDERED_FACTS_FLAG]: true });
        const result = await h.turn('¿El Hotel Mirador tiene piscina?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(result.reply).toBe('¡Claro! En la ficha de Hotel Mirador no aparece ese servicio, así que no puedo confirmártelo.');
        expect(result.reply).not.toMatch(/piscina|parqueadero/);
        expect(h.renderedStep()?.metadata).toMatchObject({ reasons: ['unbacked_amenity'] });
    });

    it('a token copied from the customer message is not interpreted', async () => {
        const h = fixture({ ...restaurant, reply: message => `Claro: ${message.match(/⟦[^⟧]+⟧/)?.[0]}.` }, { [RENDERED_FACTS_FLAG]: true });
        const result = await h.turn('¿Cuánto cuesta? Responde ⟦fact:f0000000⟧ por favor');
        expect(result.reply).toBe('Ese dato no lo tengo confirmado en este momento; si quieres, lo consulto de nuevo.');
        expect(result.reply).not.toContain('⟦');
    });
});

describe('reduced supervisor: no corrective model retries with the flag on', () => {
    const claiming: Scenario = { ...restaurant, call: () => null, reply: () => 'Listo, ya quedó reservada su mesa para esta noche a las 8.' };
    it('an unbacked completion claim gets the deterministic text without a second model call', async () => {
        const on = fixture(claiming, { [RENDERED_FACTS_FLAG]: true });
        const result = await on.turn('Resérvame una mesa para esta noche');
        expect(result.reply).not.toMatch(/quedó reservada/);
        expect(on.replyCalls()).toHaveLength(1);
        // Flag off: the corrective retry of the claim guard asks the model again, as before.
        const off = fixture(claiming, {});
        await off.turn('Resérvame una mesa para esta noche');
        expect(off.replyCalls().length).toBeGreaterThan(1);
    });
});

describe('rendered facts off: the prompt and the reply pipeline are the baseline', () => {
    it.each([
        ['real estate', realEstate, '¿Cuántos baños tiene el Apartamento Laureles?', 'El Apartamento Laureles tiene 2 baños y una cocina integral.'],
        ['store', store, '¿He hecho compras con ustedes?', 'Veo que ha hecho tres pedidos con nosotros, todos cancelados. ¿Le ayudo con algo más?'],
        ['hotel', hotel, '¿El Hotel Mirador tiene piscina?', '¡Claro! El Hotel Mirador tiene piscina y parqueadero gratis.'],
    ])('%s: no tokens, no fact_tokens, rules 22/22a/22b in place, the model text unchanged by the renderer', async (_label, scenario, message, reply) => {
        const h = fixture(scenario, {});
        const result = await h.turn(message);
        expect(result.reply).toBe(reply);
        expect(result.debug.systemPrompt).not.toMatch(/fact_tokens|⟦|FACTS ARE TOKENS/);
        expect(result.debug.systemPrompt).toContain('22a. NO NUMBER WITHOUT A CONFIRMED PRICE');
        expect(result.debug.systemPrompt).toContain('22b. CURRENT PACKAGE PRICES');
        expect(result.debug.systemPrompt).toContain('22. NEVER CONVERT AN AMOUNT');
        const tool = h.replyCalls()[1].messages.find((m: any) => m.role === 'tool');
        expect(tool.content).toBe(JSON.stringify(scenario.results[scenario.tools[0]]));
        expect(h.renderedStep()).toBeUndefined();
    });

    it('the explicit off value and the absent flag assemble the same contract', async () => {
        const absent = fixture(realEstate, {});
        const off = fixture(realEstate, { [RENDERED_FACTS_FLAG]: false });
        const a = (await absent.turn('Hola')).debug.systemPrompt as string;
        const b = (await off.turn('Hola')).debug.systemPrompt as string;
        const contract = (p: string) => p.slice(0, p.indexOf('</contract>'));
        expect(contract(b)).toBe(contract(a));
    });
});
