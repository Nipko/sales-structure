import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { TurnTraceContext } from '../trace/turn-trace-context';
import { REQUIRED_READS_RESTAURANTS_FLAG } from '../throttle/feature-flags.service';
import { isMenuQuestion, lexicalRequiredReadsOperation } from './runtime/operation-lexical-cues';
import { buildRequiredReadsTrace, REQUIRED_READS_CONFIDENCE_THRESHOLD, requiredReadsGate } from './runtime/required-reads.runner';
import { buildOperationClassifierPrompt, type OperationShadowVerdict } from './runtime/operation-classifier.service';
import { getOperation, operationsForPublishedTools } from '@parallext/shared';

/**
 * Production QA 2026-10-24, restaurant tenant with `agentRuntime.requiredReads.restaurants` on: get_menu ran before the model
 * (automatic) for «cuánto vale el plato Spark?», «quanto custa o prato Spark?», «combien coûte le plat Spark ?», «qual o preço
 * do Spark QA Plato?», and 0 of 3 times for the English «how much is the Spark QA Plato?», «price of the Spark dish?»,
 * «what does the Spark dish cost?»: only search_faqs ran, and the model answered from history or said it had no confirmed
 * price. The reads only run on a classifier verdict for a pilot operation at or above the threshold; the English questions
 * came back as the FAQ intent or under it.
 *
 * Fixed by layer, the threshold untouched: the catalogue's menu_info line and the classifier prompt name these questions in
 * every language, and a menu question in the message's own words (es/pt/fr/en) runs the menu read when the classifier misses.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const usage = { model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 };
const MENU = { count: 1, items: [{ id: 'dish-qa', name: 'Spark QA Plato', price: 13500, priceStatus: 'confirmed', currency: 'COP', allergens: [], dietaryTags: ['vegetarian'] }] };
const OPEN_ORDER = 'aaaaaaaa-0000-4000-8000-000000000452';
const RESTAURANT_TOOLS = ['search_faqs', 'get_menu', 'get_promotions', 'place_order', 'cancel_order', 'list_my_orders', 'check_order_status'];

const ENGLISH_MENU_QUESTIONS = [
    'how much is the Spark QA Plato?',
    'price of the Spark dish?',
    'what does the Spark dish cost?',
    "what's on the menu?",
    'do you have vegetarian dishes?',
];
const OTHER_LANGUAGE_MENU_QUESTIONS = [
    'cuánto vale el plato Spark?',
    'quanto custa o prato Spark?',
    'combien coûte le plat Spark ?',
    'qual o preço do Spark QA Plato?',
];
const ORDER_STATUS = 'what is the status of my order?';

function restaurant(classifier: string) {
    const featureFlags = { isFeatureEnabled: jest.fn().mockResolvedValue(false) };
    const f = agentTurnFixture({ featureFlags });
    f.contract.subtypeProfileId = 'restaurantes/casual_dining';
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'en', industry: 'restaurantes', tools: {}, rag: { enabled: false }, llm: { temperature: 0 },
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'restaurantes', subType: 'casual_dining' });
    f.prisma.tenant.findUnique.mockResolvedValue({ settings: { featureFlags: { [REQUIRED_READS_RESTAURANTS_FLAG]: true } } });
    publishTools(f, RESTAURANT_TOOLS);
    const results: Record<string, (args: any) => any> = {
        search_faqs: () => ({ faqs: [] }),
        get_menu: () => MENU,
        list_my_orders: () => ({ orders: [{ id: OPEN_ORDER, status: 'preparing', paymentStatus: 'paid', orderType: 'delivery', total: 27000, currency: 'COP', itemCount: 2 }] }),
        check_order_status: args => args.orderId === OPEN_ORDER
            ? { id: OPEN_ORDER, status: 'preparing', paymentStatus: 'paid', total: 27000, currency: 'COP', items: [], estimatedDeliveryAt: null }
            : { error: 'Order not found' },
    };
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string, args: any) =>
        results[name] ? results[name](args) : { error: `unexpected tool ${name}` });
    f.llmRouter.execute.mockImplementation(async (req: any) => {
        if (req.task === 'classify') return { content: classifier, routingDecision: { selectedModel: { id: 'cheap' } }, ...usage };
        const bodies = req.messages.filter((m: any) => m.role === 'tool').map((m: any) => JSON.parse(m.content));
        if (bodies.some((b: any) => b?.id === OPEN_ORDER)) return { ...usage, content: 'Your order is being prepared.' };
        if (bodies.some((b: any) => Array.isArray(b?.items) && b.items[0]?.price)) return { ...usage, content: 'The Spark QA Plato costs 13.500 COP.' };
        // What production did without the read.
        return { ...usage, content: "I don't have a confirmed price for that dish." };
    });
    const toEvent = jest.spyOn(TurnTraceContext.prototype, 'toEvent');
    const turn = async (message: string) => {
        const result = await f.service.test('tenant', AGENT, { message, channelType: 'telegram' }, { agentSnapshot: undefined });
        const steps = toEvent.mock.results.flatMap(r => r.type === 'return' ? r.value.steps : []);
        return {
            result,
            requiredReads: steps.filter((s: any) => s.type === 'decision' && s.label === 'required_reads'),
            menuCalls: steps.filter((s: any) => s.type === 'tool_call' && s.label === 'get_menu'),
        };
    };
    const executed = (): string[] => f.toolExecutor.execute.mock.calls.map((c: any[]) => c[3]);
    const firstReplyCall = () => f.llmRouter.execute.mock.calls.map((c: any[]) => c[0]).find((r: any) => r?.task !== 'classify');
    return { turn, executed, firstReplyCall };
}

const verdict = (operationKey: string, confidence: number, fallback: OperationShadowVerdict['fallback'] = null): OperationShadowVerdict =>
    ({ version: 1, operationKey, confidence, fallback, candidates: ['menu_info', 'ask_question', 'track_food_order'], latencyMs: 5 });

afterEach(() => jest.restoreAllMocks());

describe('menu questions in the message\'s own words (es/pt/fr/en)', () => {
    it.each([...ENGLISH_MENU_QUESTIONS, ...OTHER_LANGUAGE_MENU_QUESTIONS, 'me pasas la carta?', 'vocês têm pratos vegetarianos?', 'avez-vous des plats végétariens ?',
        '¿qué ingredientes tiene el plato Spark?', 'how long does the Spark dish take?'])('«%s» is a menu question', text => {
        expect(isMenuQuestion(text)).toBe(true);
        expect(lexicalRequiredReadsOperation(text, 'restaurants', RESTAURANT_TOOLS)).toBe('menu_info');
    });

    it.each([
        ORDER_STATUS, 'cómo va mi pedido?', 'how much was my order?', 'qual o status do meu pedido?', 'où en est ma commande ?',
        'the dish was cold, I want a refund', 'hello!', 'what time do you open?', 'do you accept cards?', 'how much is delivery?',
    ])('«%s» is not', text => {
        expect(isMenuQuestion(text)).toBe(false);
        expect(lexicalRequiredReadsOperation(text, 'restaurants', RESTAURANT_TOOLS)).toBeNull();
    });

    it('only the restaurant pilot, and only when the turn publishes get_menu', () => {
        expect(lexicalRequiredReadsOperation('how much is the Spark dish?', 'catalog', RESTAURANT_TOOLS)).toBeNull();
        expect(lexicalRequiredReadsOperation('how much is the Spark dish?', 'restaurants', ['search_faqs', 'list_my_orders'])).toBeNull();
    });
});

describe('the gate: the cue runs what the classifier missed, the threshold does not move', () => {
    const op = 'menu_info';

    it.each([
        ['the FAQ intent, confident', verdict('ask_question', 0.9)],
        ['menu_info under the threshold', verdict('menu_info', REQUIRED_READS_CONFIDENCE_THRESHOLD - 0.01)],
        ['menu_info under the classifier floor', verdict('menu_info', 0.5, 'low_confidence')],
        ['none', verdict('none', 0.9, 'none')],
        ['a timeout', verdict('none', 0, 'timeout')],
    ])('%s → get_menu runs, marked as the lexical cue', (_label, v) => {
        const gate = requiredReadsGate(v, 'restaurants', op);
        expect(gate).toMatchObject({ run: true, pilot: 'restaurants', source: 'lexical_cue' });
        expect(gate.run && gate.operation.key).toBe('menu_info');
        const trace = buildRequiredReadsTrace({ pilot: 'restaurants', verdict: v, gate, latencyMs: 1 });
        expect(trace).toMatchObject({ operation: 'menu_info', source: 'lexical_cue', classifierOperation: v.operationKey, threshold: REQUIRED_READS_CONFIDENCE_THRESHOLD });
    });

    it('no verdict at all still runs the cue', () => {
        expect(requiredReadsGate(null, 'restaurants', op)).toMatchObject({ run: true, source: 'lexical_cue' });
    });

    it('without a cue the threshold is exactly what it was', () => {
        expect(requiredReadsGate(verdict('menu_info', REQUIRED_READS_CONFIDENCE_THRESHOLD - 0.01), 'restaurants')).toEqual({ run: false, reason: 'below_threshold' });
        expect(requiredReadsGate(verdict('menu_info', REQUIRED_READS_CONFIDENCE_THRESHOLD - 0.01), 'restaurants', null)).toEqual({ run: false, reason: 'below_threshold' });
        expect(requiredReadsGate(verdict('ask_question', 0.95), 'restaurants')).toEqual({ run: false, reason: 'not_pilot_operation' });
    });

    it('a confident classifier verdict keeps the turn: its own pilot operation, or another business operation', () => {
        const status = requiredReadsGate(verdict('track_food_order', 0.92), 'restaurants', op);
        expect(status).toMatchObject({ run: true });
        expect(status.run && status.operation.key).toBe('track_food_order');
        expect(status.run && status.source).toBeUndefined();
        expect(requiredReadsGate(verdict('place_food_order', 0.93), 'restaurants', op)).toEqual({ run: false, reason: 'not_pilot_operation' });
        // A cue of another pilot does nothing here.
        expect(requiredReadsGate(verdict('none', 0.9, 'none'), 'catalog', op)).toEqual({ run: false, reason: 'fallback:none' });
    });
});

describe('the classifier sees the English price question as a menu question', () => {
    it('menu_info names the price, diet and menu questions in every language; ask_question is not for an item\'s price', () => {
        expect(getOperation('menu_info')?.description).toEqual(expect.stringContaining('how much is the X dish?'));
        const prompt = buildOperationClassifierPrompt(operationsForPublishedTools(RESTAURANT_TOOLS));
        expect(prompt).toContain('- menu_info:');
        expect(prompt).toMatch(/what does X cost\?.*cuánto cuesta el plato X.*quanto custa o prato X.*combien coûte le plat X/);
        expect(prompt).toMatch(/vegetarian/);
        expect(prompt).toMatch(/ask_question is only for general questions about the business.*never ask_question, in any language/);
        // A business without FAQs is not told about an operation it does not have.
        expect(buildOperationClassifierPrompt(operationsForPublishedTools(['get_menu', 'list_my_orders']))).not.toContain('ask_question is only');
    });
});

describe('through the turn: restaurant, flag on', () => {
    it.each(ENGLISH_MENU_QUESTIONS)('«%s» with the classifier answering the FAQ intent → get_menu runs before the model', async message => {
        const h = restaurant('{"operationKey":"ask_question","confidence":0.86}');
        const { result, requiredReads, menuCalls } = await h.turn(message);
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.executed()).toContain('get_menu');
        expect(menuCalls).toEqual(expect.arrayContaining([expect.objectContaining({ metadata: expect.objectContaining({ automatic: true, requiredRead: true }) })]));
        const tool = h.firstReplyCall().messages.find((m: any) => m.role === 'tool' && m.toolCallId === 'required_read_0');
        expect(JSON.parse(tool.content).items[0]).toMatchObject({ name: 'Spark QA Plato', price: 13500, currency: 'COP' });
        expect(result.reply).toMatch(/13[.,]500 COP/);
        expect(result.reply).not.toMatch(/don't have a confirmed price/);
        expect(requiredReads[0].metadata).toMatchObject({
            pilot: 'restaurants', operation: 'menu_info', source: 'lexical_cue', classifierOperation: 'ask_question', outcome: 'read',
            reads: [expect.objectContaining({ tool: 'get_menu', status: 'read' })],
        });
    });

    it.each(ENGLISH_MENU_QUESTIONS)('«%s» with menu_info under the threshold → get_menu runs', async message => {
        const h = restaurant('{"operationKey":"menu_info","confidence":0.7}');
        const { requiredReads } = await h.turn(message);
        expect(h.executed()).toContain('get_menu');
        expect(requiredReads[0].metadata).toMatchObject({ operation: 'menu_info', source: 'lexical_cue', outcome: 'read', confidence: 0.7 });
    });

    it.each(OTHER_LANGUAGE_MENU_QUESTIONS)('«%s» (es/pt/fr) keeps running get_menu, whatever the classifier said', async message => {
        const h = restaurant('{"operationKey":"none","confidence":0.9}');
        const { requiredReads } = await h.turn(message);
        expect(h.executed()).toContain('get_menu');
        expect(requiredReads[0].metadata).toMatchObject({ operation: 'menu_info', outcome: 'read' });
    });

    it('a confident menu_info verdict runs as before, without the cue mark', async () => {
        const h = restaurant('{"operationKey":"menu_info","confidence":0.9}');
        const { result, requiredReads } = await h.turn('how much is the Spark QA Plato?');
        expect(h.executed().filter(name => name === 'get_menu')).toHaveLength(1);
        expect(result.reply).toMatch(/13[.,]500 COP/);
        expect(requiredReads[0].metadata).toMatchObject({ operation: 'menu_info', outcome: 'read' });
        expect((requiredReads[0].metadata as any).source).toBeUndefined();
    });

    it(`«${ORDER_STATUS}» still reads the order (track_food_order), not the menu`, async () => {
        const h = restaurant('{"operationKey":"track_food_order","confidence":0.92}');
        const { result, requiredReads } = await h.turn(ORDER_STATUS);
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.executed()).toEqual(expect.arrayContaining(['list_my_orders', 'check_order_status']));
        expect(h.executed()).not.toContain('get_menu');
        expect(result.reply).toBe('Your order is being prepared.');
        expect(requiredReads[0].metadata).toMatchObject({ operation: 'track_food_order', outcome: 'read' });
        expect((requiredReads[0].metadata as any).source).toBeUndefined();
    });

    it(`«${ORDER_STATUS}» with no classifier verdict is never turned into a menu read`, async () => {
        const h = restaurant('{"operationKey":"none","confidence":0.9}');
        const { requiredReads } = await h.turn(ORDER_STATUS);
        expect(h.executed()).not.toContain('get_menu');
        expect(requiredReads[0].metadata).toMatchObject({ outcome: 'skipped', reason: 'fallback:none' });
    });
});
