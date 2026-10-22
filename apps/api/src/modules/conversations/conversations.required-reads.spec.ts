import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { TurnTraceContext } from '../trace/turn-trace-context';
import {
    FACTS_LEDGER_FLAG,
    REQUIRED_READS_CATALOG_FLAG,
    REQUIRED_READS_RESTAURANTS_FLAG,
} from '../throttle/feature-flags.service';

/**
 * Operations runtime PR5 through the real turn (Agent Test runtime session): the reads an operation owes run BEFORE the
 * model when `agentRuntime.requiredReads.<pilot>` is on and the classifier is confident.
 *
 * The three production transcripts (QA 2026-10-22, image 7f9826aa, 3/3 every round):
 *   - store «cuántos pedidos tengo y en qué estado están?» → «tres pedidos, todos cancelados» (truth: 6, all cancelled),
 *     no order read at all;
 *   - restaurant «cómo va mi pedido?» → asked for a number, then «no tengo registrado un pedido con ese número» without
 *     list_my_orders / check_order_status (operation track_food_order);
 *   - restaurant «cuánto cuesta el plato que tienen?» → get_menu about 1 time in 3, otherwise the confirmed 13.500 COP
 *     was denied.
 *
 * The model here is a stand-in that answers ONLY from the tool results it was given (and otherwise does what the
 * production model did): what is pinned is that the runtime puts the right, complete evidence in front of it.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const usage = { model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 };
const STORE_QUESTION = 'cuántos pedidos tengo y en qué estado están?';
const ORDER_QUESTION = 'cómo va mi pedido?';
const PRICE_QUESTION = 'cuánto cuesta el plato que tienen?';

const SIX_CANCELLED = Array.from({ length: 6 }, (_, i) => ({
    id: `0000000${i}-1111-4111-8111-111111111111`, status: 'cancelled', paymentStatus: 'pending',
    totalAmount: 119900, currency: 'COP', items: [{ productName: 'Audífono QA Aurora', quantity: 1 }],
}));
const OPEN_ORDER = 'aaaaaaaa-0000-4000-8000-000000000452';
const FOOD_ORDERS = [
    { id: OPEN_ORDER, status: 'preparing', paymentStatus: 'paid', orderType: 'delivery', total: 27000, currency: 'COP', itemCount: 2 },
    { id: 'bbbbbbbb-0000-4000-8000-000000000451', status: 'delivered', paymentStatus: 'paid', orderType: 'delivery', total: 13500, currency: 'COP', itemCount: 1 },
];
const MENU = { count: 1, items: [{ id: 'dish-qa', name: 'Spark QA Plato', price: 13500, priceStatus: 'confirmed', currency: 'COP', allergens: [] }] };

type Vertical = 'store' | 'restaurant';

interface Options {
    vertical: Vertical;
    flags?: Record<string, boolean>;
    classifier?: string;
    tools: string[];
    results: Record<string, (args: any) => any>;
}

function fixture(options: Options) {
    const featureFlags = { isFeatureEnabled: jest.fn().mockResolvedValue(false) };
    const f = agentTurnFixture({ featureFlags });
    if (options.vertical === 'restaurant') {
        f.contract.subtypeProfileId = 'restaurantes/casual_dining';
        f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
            language: 'es', industry: 'restaurantes', tools: {}, rag: { enabled: false }, llm: { temperature: 0 },
        } });
        f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'restaurantes', subType: 'casual_dining' });
    } else {
        f.contract.subtypeProfileId = 'retail/electronica';
        f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'retail', subType: 'electronica' });
    }
    f.prisma.tenant.findUnique.mockResolvedValue({ settings: { featureFlags: options.flags ?? {} } });
    publishTools(f, options.tools);
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string, args: any) =>
        options.results[name] ? options.results[name](args) : { error: `unexpected tool ${name}` });

    f.llmRouter.execute.mockImplementation(async (req: any) => {
        if (req.task === 'classify') {
            return { content: options.classifier ?? '{"operationKey":"none","confidence":0.9}', routingDecision: { selectedModel: { id: 'cheap' } }, ...usage };
        }
        const toolMessages = req.messages.filter((m: any) => m.role === 'tool').map((m: any) => ({ id: m.toolCallId, body: JSON.parse(m.content) }));
        const failed = toolMessages.find((m: any) => m.body?.error);
        if (failed) return { ...usage, content: String(failed.body.message || 'No pude consultar.') };
        const orders = toolMessages.find((m: any) => Array.isArray(m.body?.orders));
        const status = toolMessages.find((m: any) => m.body?.id === OPEN_ORDER);
        const menu = toolMessages.find((m: any) => Array.isArray(m.body?.items) && m.body.items[0]?.price);
        if (status) return { ...usage, content: 'Su pedido está en preparación.' };
        if (orders) {
            const list = orders.body.orders;
            const states = [...new Set(list.map((o: any) => o.status))];
            return { ...usage, content: `Tiene ${orders.body.total ?? list.length} pedidos; estado: ${states.join(', ')}.` };
        }
        if (menu) return { ...usage, content: `El plato ${menu.body.items[0].name} cuesta 13.500 COP.` };
        // What production did without the read.
        if (options.vertical === 'store') return { ...usage, content: 'Actualmente tiene tres pedidos recientes y todos están cancelados.' };
        return { ...usage, content: 'Para ayudarle, indíqueme el número de su pedido.' };
    });

    const toEvent = jest.spyOn(TurnTraceContext.prototype, 'toEvent');
    let sessionId: string | undefined;
    const turn = async (message: string) => {
        const result = await f.service.test('tenant', AGENT, { message, channelType: 'telegram', runtimeSessionId: sessionId }, { agentSnapshot: undefined });
        sessionId = result.debug.runtimeSessionId;
        const steps = toEvent.mock.results.flatMap(r => r.type === 'return' ? r.value.steps : []);
        return { result, steps, requiredReads: steps.filter((s: any) => s.type === 'decision' && s.label === 'required_reads') };
    };
    const executed = (): Array<{ name: string; args: any }> => f.toolExecutor.execute.mock.calls.map((c: any[]) => ({ name: c[3], args: c[4] }));
    const replyCalls = (): any[] => f.llmRouter.execute.mock.calls.filter((c: any[]) => c[0]?.task !== 'classify').map((c: any[]) => c[0]);
    const classifyCalls = () => f.llmRouter.execute.mock.calls.filter((c: any[]) => c[0]?.task === 'classify');
    const session = () => (f.service as any).sessions.sessions.get(sessionId).session;
    return { f, featureFlags, turn, executed, replyCalls, classifyCalls, session };
}

const STORE_TOOLS = ['search_products', 'get_product', 'check_stock', 'place_catalog_order', 'list_my_catalog_orders', 'get_catalog_order', 'cancel_catalog_order'];
const RESTAURANT_TOOLS = ['get_menu', 'get_promotions', 'place_order', 'cancel_order', 'list_my_orders', 'check_order_status'];

function store(flags: Record<string, boolean>, ordersResult: (args: any) => any = args => ({ success: true, orders: SIX_CANCELLED.slice(0, args.limit) }), classifier = '{"operationKey":"track_catalog_order","confidence":0.94}') {
    return fixture({
        vertical: 'store', flags, classifier, tools: STORE_TOOLS,
        results: { list_my_catalog_orders: ordersResult, search_products: () => ({ products: [] }) },
    });
}

function restaurant(flags: Record<string, boolean>, classifier: string) {
    return fixture({
        vertical: 'restaurant', flags, classifier, tools: RESTAURANT_TOOLS,
        results: {
            get_menu: () => MENU,
            list_my_orders: args => ({ orders: FOOD_ORDERS.slice(0, args?.limit ?? 5) }),
            check_order_status: args => args.orderId === OPEN_ORDER
                ? { id: OPEN_ORDER, status: 'preparing', paymentStatus: 'paid', total: 27000, currency: 'COP', items: [], estimatedDeliveryAt: null }
                : { error: 'Order not found' },
        },
    });
}

afterEach(() => jest.restoreAllMocks());

describe('required reads through the turn (PR5)', () => {
    it('store, flag on: «cuántos pedidos tengo?» reads the complete list before the model — 6 of 6, not "tres"', async () => {
        const h = store({ [REQUIRED_READS_CATALOG_FLAG]: true, [FACTS_LEDGER_FLAG]: true });
        const { result, requiredReads } = await h.turn(STORE_QUESTION);
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.executed()).toEqual([{ name: 'list_my_catalog_orders', args: { limit: 50 } }]);
        // The read reached the FIRST model call, as a tool result with its completeness.
        const first = h.replyCalls()[0];
        const tool = first.messages.find((m: any) => m.role === 'tool' && m.toolCallId === 'required_read_0');
        const body = JSON.parse(tool.content);
        expect(body.orders).toHaveLength(6);
        expect(body).toMatchObject({ total: 6, complete: true, hasMore: false });
        // (The reply's status word goes through the existing status localizer: cancelled → anulado.)
        expect(result.reply).toBe('Tiene 6 pedidos; estado: anulado.');
        expect(requiredReads).toHaveLength(1);
        expect(requiredReads[0].metadata).toMatchObject({
            pilot: 'catalog', operation: 'track_catalog_order', outcome: 'read', threshold: 0.8,
            reads: [
                expect.objectContaining({ tool: 'list_my_catalog_orders', status: 'read', rows: 6, complete: true, total: 6 }),
                // Six orders, all closed: no single id for the detail read, the list already answers.
                { tool: 'get_catalog_order', status: 'ambiguous_receipt' },
            ],
        });
        expect(typeof (requiredReads[0].metadata as any).latencyMs).toBe('number');
        // With the facts ledger on, the list is a complete record fact of the conversation.
        expect(h.session().metadata.verifiedFacts).toEqual(expect.arrayContaining([expect.objectContaining({
            kind: 'record_list', complete: true, total: 6, source: expect.objectContaining({ tool: 'list_my_catalog_orders' }),
        })]));
    });

    it('restaurant, flag on: «cómo va mi pedido?» lists the contact\'s orders and reads the open one — no order number asked', async () => {
        const h = restaurant({ [REQUIRED_READS_RESTAURANTS_FLAG]: true }, '{"operationKey":"track_food_order","confidence":0.91}');
        const { result, requiredReads } = await h.turn(ORDER_QUESTION);
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.executed()).toEqual([
            { name: 'list_my_orders', args: { limit: 20 } },
            { name: 'check_order_status', args: { orderId: OPEN_ORDER } },
        ]);
        const first = h.replyCalls()[0];
        expect(first.messages.filter((m: any) => m.role === 'tool').map((m: any) => m.toolCallId)).toEqual(['required_read_0', 'required_read_1']);
        expect(result.reply).toBe('Su pedido está en preparación.');
        expect(result.reply).not.toMatch(/n[uú]mero/i);
        expect(requiredReads[0].metadata).toMatchObject({
            pilot: 'restaurants', operation: 'track_food_order', outcome: 'read',
            reads: [
                expect.objectContaining({ tool: 'list_my_orders', status: 'read', rows: 2, complete: true, total: 2 }),
                expect.objectContaining({ tool: 'check_order_status', status: 'read' }),
            ],
        });
    });

    it('restaurant, flag on: «cuánto cuesta el plato?» is quoted from a get_menu read every time (3 of 3)', async () => {
        for (let round = 0; round < 3; round++) {
            const h = restaurant({ [REQUIRED_READS_RESTAURANTS_FLAG]: true }, '{"operationKey":"menu_info","confidence":0.88}');
            const { result, requiredReads } = await h.turn(PRICE_QUESTION);
            expect(result.debug.runtimeError).toBeUndefined();
            expect(h.executed()).toEqual([{ name: 'get_menu', args: {} }]);
            const first = h.replyCalls()[0];
            expect(JSON.parse(first.messages.find((m: any) => m.toolCallId === 'required_read_0').content).items[0]).toMatchObject({ price: 13500, currency: 'COP' });
            // The amount is backed by this turn's read, so the price guardrail lets it through.
            expect(result.reply).toBe('El plato Spark QA Plato cuesta 13.500 COP.');
            expect(requiredReads[0].metadata).toMatchObject({ operation: 'menu_info', outcome: 'read', reads: [expect.objectContaining({ tool: 'get_menu', status: 'read' })] });
            jest.restoreAllMocks();
        }
    });

    it('flag off: no classification, no read, no trace step — the turn is exactly the previous one', async () => {
        const off = store({});
        const offTurn = await off.turn(STORE_QUESTION);
        expect(off.classifyCalls()).toHaveLength(0);
        expect(off.executed()).toEqual([]);
        expect(offTurn.requiredReads).toEqual([]);
        expect(offTurn.result.reply).toBe('Actualmente tiene tres pedidos recientes y todos están cancelados.');
        jest.restoreAllMocks();

        // The other pilot's flag does nothing for a store: same turn, byte for byte.
        const other = store({ [REQUIRED_READS_RESTAURANTS_FLAG]: true });
        const otherTurn = await other.turn(STORE_QUESTION);
        expect(other.classifyCalls()).toHaveLength(0);
        expect(other.executed()).toEqual(off.executed());
        expect(otherTurn.result.reply).toEqual(offTurn.result.reply);
        expect(other.replyCalls().map(c => c.messages)).toEqual(off.replyCalls().map(c => c.messages));
        expect(other.replyCalls().map(c => (c.tools || []).map((t: any) => t.name ?? t.function?.name)))
            .toEqual(off.replyCalls().map(c => (c.tools || []).map((t: any) => t.name ?? t.function?.name)));
    });

    it('a failed read is an admission ("no pude consultar"), never an empty list', async () => {
        const h = store({ [REQUIRED_READS_CATALOG_FLAG]: true }, () => ({ error: 'catalog_orders_unavailable' }));
        const { result, requiredReads } = await h.turn(STORE_QUESTION);
        expect(result.debug.runtimeError).toBeUndefined();
        const first = h.replyCalls()[0];
        const body = JSON.parse(first.messages.find((m: any) => m.toolCallId === 'required_read_0').content);
        expect(body.error).toBeTruthy();
        expect(body.orders).toBeUndefined();
        expect(body.message).toMatch(/^No pude consultar/);
        expect(result.reply).toMatch(/^No pude consultar/);
        expect(result.reply).not.toMatch(/no (tiene|hay) pedidos|tres pedidos/i);
        expect(requiredReads[0].metadata).toMatchObject({
            outcome: 'admit',
            reads: [expect.objectContaining({ tool: 'list_my_catalog_orders', status: 'failed' }), { tool: 'get_catalog_order', status: 'upstream_failed' }],
        });
    });

    it('Agent Test reads the flag from the sealed snapshot: no tenant query and no flag-service lookup per turn', async () => {
        const h = store({ [REQUIRED_READS_CATALOG_FLAG]: true });
        await h.turn(STORE_QUESTION);
        const tenantReads = h.f.prisma.tenant.findUnique.mock.calls.length;
        const second = await h.turn('y en qué estado están ahora?');
        expect(second.result.debug.runtimeError).toBeUndefined();
        expect(h.f.prisma.tenant.findUnique.mock.calls.length).toBe(tenantReads);
        expect(h.executed().filter(c => c.name === 'list_my_catalog_orders')).toHaveLength(2);
        const flagLookups = h.featureFlags.isFeatureEnabled.mock.calls.map((c: any[]) => c[1]);
        expect(flagLookups).not.toContain(REQUIRED_READS_CATALOG_FLAG);
        expect(flagLookups).not.toContain(REQUIRED_READS_RESTAURANTS_FLAG);
    });

    it.each([
        ['none', '{"operationKey":"none","confidence":0.97}', 'fallback:none'],
        ['low confidence', '{"operationKey":"track_catalog_order","confidence":0.7}', 'below_threshold'],
        ['under the classifier floor', '{"operationKey":"track_catalog_order","confidence":0.4}', 'fallback:low_confidence'],
        ['unparseable', 'not json', 'fallback:invalid_output'],
    ])('classifier %s → no forced reads, the skip is traced', async (_label, classifier, reason) => {
        const h = store({ [REQUIRED_READS_CATALOG_FLAG]: true }, undefined, classifier);
        const { result, requiredReads } = await h.turn(STORE_QUESTION);
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.classifyCalls()).toHaveLength(1);
        expect(h.executed()).toEqual([]);
        expect(h.replyCalls()[0].messages.some((m: any) => m.role === 'tool')).toBe(false);
        expect(requiredReads[0].metadata).toMatchObject({ outcome: 'skipped', reason, reads: [] });
    });
});
