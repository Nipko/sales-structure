import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { TurnTraceContext } from '../trace/turn-trace-context';
import { FACTS_LEDGER_FLAG, RENDERED_FACTS_FLAG } from '../throttle/feature-flags.service';

/**
 * F4300-37 through the real turn (Agent Test runtime session) with `agentRuntime.renderedFacts` and `agentRuntime.factsLedger`
 * on — the QA configuration of image 57da6e58, where the flag was turned off after 28 minutes because 7 of 12 measured
 * cases got worse. Each production reply is replayed with a stand-in model that writes what the production model wrote:
 *   1. hotel EN «what's the nightly rate and max guests?» → «The price of Spark QA Habitacion 20261018T113247Z is 0 COP.»
 *      (get_property_details returns nightPrice 150.000 and cleaningFee 0; the 0 was rendered as the price);
 *   2. restaurant EN «how many orders have I made?» → a Spanish reply with an English menu-price sentence appended;
 *   3. tours FR → «El Spark QA Tour tiene … Le prix de Spark QA Tour 20261018T2140Z est de 125 EUR. ¿Le gustaría…»;
 *   4. real estate PT «qual o preço e a área…» → only the price template (80 m² dropped); salon EN «how much is a haircut and
 *      how long does it take?» → only the price template (45 min dropped);
 *   5. menu ES «si pido dos platos Spark cuánto pago?» → only the unit price, no 27.000 total;
 *   6. the templates named the records with their technical stamp.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const usage = { model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 };
const FLAGS = { [RENDERED_FACTS_FLAG]: true, [FACTS_LEDGER_FLAG]: true };
const REWRITE = /Rewrite it in English|Réécrivez-la en français|Reescreva-a em português|Reescríbela en español/;

interface Scenario {
    industry: string;
    subType: string;
    tools: string[];
    results: Record<string, any>;
    call?: (message: string) => { name: string; args?: any } | null;
    /** What the model writes once it has the tool results. */
    reply: (message: string, toolBodies: any[]) => string;
    /** What the model writes when the language guard asks for a rewrite into the customer's language. */
    rewrite?: string;
}

function fixture(scenario: Scenario) {
    const f = agentTurnFixture();
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'es', industry: scenario.industry, tools: {}, rag: { enabled: false }, llm: { temperature: 0 },
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: scenario.industry, subType: scenario.subType });
    f.prisma.tenant.findUnique.mockResolvedValue({ settings: { featureFlags: FLAGS } });
    publishTools(f, scenario.tools);
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string) =>
        scenario.results[name] ?? { error: `unexpected tool ${name}` });
    let n = 0;
    f.llmRouter.execute.mockImplementation(async (req: any) => {
        if (req.task === 'classify') return { content: '{"operationKey":"none","confidence":0.9}', routingDecision: { selectedModel: { id: 'cheap' } }, ...usage };
        const last = [...req.messages].reverse().find((m: any) => m.role === 'user')?.content;
        if (REWRITE.test(String(last))) return { ...usage, content: scenario.rewrite ?? '' };
        const tools = req.messages.filter((m: any) => m.role === 'tool');
        const call = scenario.call?.(last);
        const calledThisTurn = tools.some((m: any) => m.toolCallId?.startsWith(`rf${n}`));
        if (call && req.tools && !calledThisTurn) {
            n += 1;
            return { ...usage, content: '', toolCalls: [{ id: `rf${n}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) } }] };
        }
        return { ...usage, content: scenario.reply(last, tools.map((m: any) => JSON.parse(m.content))) };
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
    /** The reply as the renderer left it: what the language guard was asked to rewrite. */
    const rewriteSource = () => {
        const call = f.llmRouter.execute.mock.calls.map((c: any[]) => c[0])
            .find((req: any) => REWRITE.test(String([...req.messages].reverse().find((m: any) => m.role === 'user')?.content)));
        return call ? [...call.messages].reverse().find((m: any) => m.role === 'assistant')?.content : undefined;
    };
    return { f, turn, renderedStep, rewriteSource };
}

/** The token a tool result offered for `field` (its `fact_tokens`). */
function tokenFor(bodies: any[], field: string): string | undefined {
    for (const body of bodies) {
        const entry = (body?.fact_tokens || []).find((t: any) => t.field === field);
        if (entry?.fact) return entry.fact;
    }
    return undefined;
}

afterEach(() => jest.restoreAllMocks());

describe('F4300-37 · 1. hotel EN: the nightly price, never the 0 of the cleaning fee', () => {
    const ROOM = { id: '7d3f9a52-1b2c-4d5e-8f90-123456789abc', name: 'Spark QA Habitacion 20261018T113247Z', maxGuests: 2, bedrooms: 1, bathrooms: 1,
        nightPrice: 150000, cleaningFee: 0, priceStatus: 'confirmed', currency: 'COP', amenities: [] };
    const hotel = (reply: string): Scenario => ({
        industry: 'turismo', subType: 'hotel', tools: ['get_property_details'], results: { get_property_details: ROOM },
        call: () => ({ name: 'get_property_details', args: { propertyId: ROOM.id } }), reply: () => reply,
    });

    it('the nightly rate the model typed from the record reaches the customer with the guests', async () => {
        const reply = 'The nightly rate for Spark QA Habitacion is 150,000 COP. It can accommodate up to 2 guests.';
        const h = fixture(hotel(reply));
        const result = await h.turn("what's the nightly rate and max guests?");
        expect(result.debug.runtimeError).toBeUndefined();
        expect(result.reply).toBe(reply);
        expect(h.renderedStep()?.metadata).toMatchObject({ fallbacks: 0 });
    });

    it('a wrong figure is restated from nightPrice — never «0 COP» — with the spoken name, and the guests stay', async () => {
        const h = fixture(hotel('The nightly rate for Spark QA Habitacion is 120,000 COP. It can accommodate up to 2 guests.'));
        const result = await h.turn("what's the nightly rate and max guests?");
        expect(result.reply).toBe('The price of Spark QA Habitacion is 150,000 COP. It can accommodate up to 2 guests.');
        expect(result.reply).not.toMatch(/\b0 COP|20261018T113247Z/);
        expect(h.renderedStep()?.metadata).toMatchObject({ fallbacks: 1, reasons: ['unrendered_amount'] });
    });

    it('a token for the cleaning fee (0) is never rendered as «0 COP»', async () => {
        const h = fixture({ ...hotel(''), reply: (_m, bodies) => `The nightly rate is ${tokenFor(bodies, 'nightPrice')}. Cleaning: ${tokenFor(bodies, 'cleaningFee')}.` });
        const result = await h.turn("what's the nightly rate and max guests?");
        expect(result.reply).toMatch(/^The nightly rate is 150,000 COP\. /);
        expect(result.reply).not.toMatch(/\b0 COP/);
        // F4300-47 (29-oct): the sentence is about the fee, so its 0 is said in words; the night price is never lost with it.
        expect(result.reply).toContain('Cleaning: free of charge.');
        expect(h.renderedStep()?.metadata).toMatchObject({ fallbacks: 0 });
    });
});

describe('F4300-37 · 2. restaurant EN «how many orders have I made?»: no price sentence appended, one language', () => {
    const MENU = { count: 1, items: [{ id: 'dish-spark', name: 'Spark QA Plato 20261018T110518Z', price: 13500, priceStatus: 'confirmed', currency: 'COP', allergens: [] }] };
    const ORDERS = { orders: [{ id: '0b1c2d3e-1111-4111-8111-111111111111', status: 'cancelled', totalAmount: 13500, currency: 'COP' }], total: 1, hasMore: false };
    const restaurant = (reply: string): Scenario => ({
        industry: 'restaurantes', subType: 'restaurante', tools: ['get_menu', 'list_my_orders'], results: { get_menu: MENU, list_my_orders: ORDERS },
        call: message => (/orders/i.test(message) ? { name: 'list_my_orders' } : { name: 'get_menu' }),
        reply: message => (/orders/i.test(message) ? reply : 'We have Spark QA Plato for 13,500 COP.'),
        rewrite: 'You have made one order, which was cancelled. Would you like to place a new order?',
    });

    it('an amount no record backs goes with its sentence; the dish price is not put in its place; the guard rewrites the reply whole', async () => {
        const h = fixture(restaurant('Usted ha realizado un pedido, que fue cancelado. Fue por 9.900 COP. ¿Le gustaría hacer un nuevo pedido?'));
        await h.turn('what dishes do you have?');
        const result = await h.turn('how many orders have I made?');
        expect(result.debug.runtimeError).toBeUndefined();
        // What the renderer left: the model's own Spanish, without an English template and without the menu price.
        expect(h.rewriteSource()).toBe('Usted ha realizado un pedido, que fue cancelado. ¿Le gustaría hacer un nuevo pedido?');
        expect(result.reply).toBe('You have made one order, which was cancelled. Would you like to place a new order?');
        expect(result.reply).not.toMatch(/price|precio|Spark|13[.,]500/i);
    });

    it('the order total the record holds is kept as written', async () => {
        const h = fixture(restaurant('Usted ha realizado un pedido, que fue cancelado. Fue por 13.500 COP. ¿Le gustaría hacer un nuevo pedido?'));
        await h.turn('what dishes do you have?');
        await h.turn('how many orders have I made?');
        expect(h.rewriteSource()).toBe('Usted ha realizado un pedido, que fue cancelado. Fue por 13.500 COP. ¿Le gustaría hacer un nuevo pedido?');
        expect(h.renderedStep()?.metadata).toMatchObject({ fallbacks: 0 });
    });
});

describe('F4300-37 · 3. tours FR: a Spanish reply gets no French template in the middle', () => {
    const TOUR = { id: 'pkg-spark', name: 'Spark QA Tour 20261018T2140Z', price: 125, currency: 'EUR', priceStatus: 'confirmed', maxParticipants: 10 };
    const tours = (reply: string): Scenario => ({
        industry: 'turismo', subType: 'tours', tools: ['get_package_details'], results: { get_package_details: TOUR },
        call: () => ({ name: 'get_package_details', args: { packageId: TOUR.id } }), reply: () => reply,
        rewrite: 'Le Spark QA Tour compte au maximum 10 places par départ. Le prix est de 125 EUR par personne. Souhaitez-vous réserver ?',
    });
    const ASK = 'combien de places pour le Spark QA Tour et quel prix ?';

    it('the backed price stays as written and the language guard rewrites the whole reply in French', async () => {
        const reply = 'El Spark QA Tour tiene un máximo de 10 plazas disponibles para cada salida. El precio es de 125 EUR por persona. ¿Le gustaría reservar?';
        const h = fixture(tours(reply));
        const result = await h.turn(ASK);
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.rewriteSource()).toBe(reply);
        expect(result.reply).toBe('Le Spark QA Tour compte au maximum 10 places par départ. Le prix est de 125 EUR par personne. Souhaitez-vous réserver ?');
    });

    it('an unbacked price is restated in the language of the rest of the reply, without the technical stamp', async () => {
        const h = fixture(tours('El Spark QA Tour tiene un máximo de 10 plazas disponibles para cada salida. El precio es de 130 EUR por persona. ¿Le gustaría reservar?'));
        await h.turn(ASK);
        expect(h.rewriteSource()).toBe('El Spark QA Tour tiene un máximo de 10 plazas disponibles para cada salida. El precio de Spark QA Tour es 125 EUR. ¿Le gustaría reservar?');
        expect(h.rewriteSource()).not.toMatch(/Le prix|20261018T2140Z/);
    });
});

describe('F4300-37 · 4. only the offending figure goes: the area and the duration stay', () => {
    const LISTING = { listing: { id: 'lst-spark', title: 'Spark QA Inmueble 20261018T2220Z', price: 250000, currency: 'EUR', priceStatus: 'confirmed', area: 80, bedrooms: 2, bathrooms: 1 } };
    const realEstate = (reply: string): Scenario => ({
        industry: 'inmobiliaria', subType: 'venta', tools: ['get_listing_details'], results: { get_listing_details: LISTING },
        call: () => ({ name: 'get_listing_details', args: { listingId: 'lst-spark' } }), reply: () => reply,
    });
    const SERVICES = { services: [{ id: 'svc-corte', name: 'Corte y estilo', price: 40000, currency: 'COP', priceStatus: 'confirmed', durationMinutes: 45 }] };
    const salon = (reply: string): Scenario => ({
        industry: 'belleza', subType: 'peluqueria', tools: ['list_services'], results: { list_services: SERVICES },
        call: () => ({ name: 'list_services' }), reply: () => reply,
    });

    it('real estate PT: price and area the record says reach the customer', async () => {
        const reply = 'O preço do Spark QA Inmueble é 250.000 EUR e a área é de 80 m².';
        const h = fixture(realEstate(reply));
        const result = await h.turn('qual o preço e a área do Spark QA Inmueble?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(result.reply).toBe(reply);
    });

    it('real estate PT: a wrong price is restated and the area is said with it', async () => {
        const h = fixture(realEstate('O preço do Spark QA Inmueble é 260.000 EUR e a área é de 80 m².'));
        const result = await h.turn('qual o preço e a área do Spark QA Inmueble?');
        expect(result.reply).toBe('O preço de Spark QA Inmueble é 250.000 EUR. Segundo a ficha, Spark QA Inmueble tem 80 m².');
    });

    it('salon EN: price and duration reach the customer; a wrong price keeps the duration', async () => {
        const reply = 'A Corte y estilo costs 40,000 COP and takes 45 minutes.';
        const ok = fixture(salon(reply));
        expect((await ok.turn('how much is a haircut and how long does it take?')).reply).toBe(reply);
        const wrong = fixture(salon('A Corte y estilo costs 35,000 COP and takes 45 minutes.'));
        expect((await wrong.turn('how much is a haircut and how long does it take?')).reply)
            .toBe('The price of Corte y estilo is 40,000 COP. Corte y estilo takes 45 minutes.');
    });
});

describe('F4300-37 · 5. menu ES «si pido dos platos Spark cuánto pago?»: the computed total reaches the customer', () => {
    const MENU = { count: 1, items: [{ id: 'dish-spark', name: 'Spark QA Plato 20261018T110518Z', price: 13500, priceStatus: 'confirmed', currency: 'COP', allergens: [] }] };
    const menu = (reply: Scenario['reply']): Scenario => ({
        industry: 'restaurantes', subType: 'restaurante', tools: ['get_menu'], results: { get_menu: MENU }, call: () => ({ name: 'get_menu' }), reply,
    });

    it('typed: 2 × 13.500 = 27.000 COP is kept, through the renderer and the price guard', async () => {
        const reply = 'Dos platos Spark QA Plato serían 27.000 COP (13.500 COP cada uno).';
        const h = fixture(menu(() => reply));
        const result = await h.turn('si pido dos platos Spark cuánto pago?');
        expect(result.debug.runtimeError).toBeUndefined();
        expect(result.reply).toBe(reply);
        expect(h.renderedStep()?.metadata).toMatchObject({ fallbacks: 0 });
    });

    it('around a token: the unit price is rendered and the total stays', async () => {
        const h = fixture(menu((_m, bodies) => `Dos platos serían 27.000 COP (${tokenFor(bodies, 'price')} cada uno).`));
        const result = await h.turn('si pido dos platos Spark cuánto pago?');
        expect(result.reply).toBe('Dos platos serían 27.000 COP (13.500 COP cada uno).');
        expect(h.renderedStep()?.metadata).toMatchObject({ tokens: 1, rendered: 1, fallbacks: 0 });
    });
});
