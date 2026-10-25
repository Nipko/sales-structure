import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { TurnTraceContext } from '../trace/turn-trace-context';
import { REQUIRED_READS_CATALOG_FLAG } from '../throttle/feature-flags.service';
import { attachDescriptionAuthority } from './description-authority';

/**
 * F4300-35, after #217 (production 03d9fae9, store QA tenant `tienda-qa-electronica`, `agentRuntime.requiredReads.catalog` on,
 * the catalogue tools on): «tell me about the Audífono QA Aurora» (en) and «me fala sobre o Audífono QA Aurora» (pt) still ran
 * only search_faqs. The «tell me about» cue did fire (the gate ran `product_info`), but the store's own catalogue travels in the
 * turn (`<catalog>`: the products the message names, or the whole catalogue when it is small), and search_products / get_product
 * are declared `projected` by it (LIVE_CATALOG): `runRequiredReads` marked both reads `projected` and ran nothing. That
 * projection carries the name, price, stock and category only: what the item IS (its description, features) is not in it, so
 * the model answered from the FAQ / knowledge and repeated the description as the product's state, with no catalogue row for
 * the description note or the output check. The spec of #217 had no own catalogue in the turn (`tools: {}`), so it never saw it.
 *
 * A request to be told about / described an item is not satisfied by the projection: the reads run. A price or stock question
 * («how much is the Audífono QA Aurora?») is still answered from the projection, as before.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const usage = { model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 };
const STORE_TOOLS = ['search_faqs', 'search_products', 'get_product', 'check_stock', 'place_catalog_order', 'list_my_catalog_orders', 'get_catalog_order'];
const AURORA = { id: '33333333-3333-4333-8333-333333333333', name: 'Audífono QA Aurora', description: 'Producto ficticio de prueba. No corresponde a inventario real.',
    category: 'Audio', price: 119900, currency: 'COP', stock: 2, isAvailable: true, inStock: true };
const OTHER = { id: '44444444-4444-4444-8444-444444444444', name: 'Parlante QA Boreal', description: 'Parlante bluetooth.',
    category: 'Audio', price: 89900, currency: 'COP', stock: 5, isAvailable: true, inStock: true };
const PRODUCTS = [AURORA, OTHER];

function store(classifier: string, reply: string) {
    const featureFlags = { isFeatureEnabled: jest.fn().mockResolvedValue(false) };
    const f = agentTurnFixture({ featureFlags });
    f.contract.subtypeProfileId = 'retail/electronica';
    // Production: the store's catalogue tools are on, so its own products travel in the turn's <catalog>.
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'en', industry: 'retail', tools: { catalog: { enabled: true } }, rag: { enabled: false }, llm: { temperature: 0 },
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'retail', subType: 'electronica' });
    f.prisma.tenant.findUnique.mockResolvedValue({ settings: { featureFlags: { [REQUIRED_READS_CATALOG_FLAG]: true } } });
    f.prisma.executeInTenantSchema.mockImplementation(async (_schema: string, sql: string) => {
        if (!/^\s*(SELECT|WITH)\b/i.test(sql)) throw new Error(`unexpected SQL write: ${sql}`);
        // loadOwnCatalogForTurn: a small catalogue, every product for sale is in the turn.
        if (/FROM products/.test(sql) && /mentioned/.test(sql)) {
            return PRODUCTS.map(p => ({ id: p.id, name: p.name, price: p.price, currency: p.currency, stock: p.stock, category: p.category,
                mentioned: p.id === AURORA.id, total: PRODUCTS.length }));
        }
        return [];
    });
    publishTools(f, STORE_TOOLS);
    const results: Record<string, (args: any) => any> = {
        search_faqs: () => ({ faqs: [{ question: 'Audífono QA Aurora', answer: AURORA.description }] }),
        search_products: () => attachDescriptionAuthority('search_products', { products: PRODUCTS }),
        get_product: args => {
            const row = PRODUCTS.find(p => p.id === args.productId);
            return row ? attachDescriptionAuthority('get_product', { ...row }) : { error: 'product_not_found' };
        },
    };
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string, args: any) =>
        results[name] ? results[name](args) : { error: `unexpected tool ${name}` });
    f.llmRouter.execute.mockImplementation(async (req: any) => {
        if (req.task === 'classify') return { content: classifier, routingDecision: { selectedModel: { id: 'cheap' } }, ...usage };
        return { ...usage, content: reply };
    });
    const toEvent = jest.spyOn(TurnTraceContext.prototype, 'toEvent');
    const turn = async (message: string) => {
        const result = await f.service.test('tenant', AGENT, { message, channelType: 'telegram' }, { agentSnapshot: undefined });
        const steps = toEvent.mock.results.flatMap(r => r.type === 'return' ? r.value.steps : []);
        return { result, requiredReads: steps.filter((s: any) => s.type === 'decision' && s.label === 'required_reads') };
    };
    const executed = (): Array<{ name: string; args: any }> => f.toolExecutor.execute.mock.calls.map((c: any[]) => ({ name: c[3], args: c[4] }));
    return { turn, executed };
}

afterEach(() => jest.restoreAllMocks());

const PRODUCTION_REPLY = 'The Audífono QA Aurora costs 119,900 COP and there are 2 units available. It is a fictional test product and does not correspond to real inventory.';

describe('store with its own catalogue in the turn, requiredReads.catalog on', () => {
    it.each([
        ['tell me about the Audífono QA Aurora', '{"operationKey":"ask_question","confidence":0.9}'],
        ['me fala sobre o Audífono QA Aurora', '{"operationKey":"ask_question","confidence":0.9}'],
        // The classifier itself names product_info: the projection still is not what the customer asked for.
        ['tell me about the Audífono QA Aurora', '{"operationKey":"product_info","confidence":0.95}'],
    ])('«%s» (%s) → search_products and get_product run, not «projected»', async (message, classifier) => {
        const h = store(classifier, PRODUCTION_REPLY);
        const { result, requiredReads } = await h.turn(message);
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.executed().map(c => c.name)).toEqual(expect.arrayContaining(['search_products', 'get_product']));
        expect(h.executed().find(c => c.name === 'get_product')?.args).toEqual({ productId: AURORA.id });
        const reads = (requiredReads[0]?.metadata as any)?.reads as Array<{ tool: string; status: string }>;
        expect(reads.filter(r => r.status === 'projected')).toEqual([]);
        expect(requiredReads[0].metadata).toMatchObject({ pilot: 'catalog', operation: 'product_info' });
        // (the pt turn writes the amount the pt way)
        expect(result.reply).toMatch(/^The Audífono QA Aurora costs 119[.,]900 COP and there are 2 units available\.$/);
    });

    it('«how much is the Audífono QA Aurora?» is still answered from the projected <catalog> (price and stock are in it)', async () => {
        const h = store('{"operationKey":"product_info","confidence":0.95}', 'The Audífono QA Aurora costs 119,900 COP.');
        const { requiredReads } = await h.turn('how much is the Audífono QA Aurora?');
        expect(h.executed().map(c => c.name)).not.toContain('get_product');
        const reads = (requiredReads[0]?.metadata as any)?.reads as Array<{ tool: string; status: string }>;
        expect(reads.map(r => r.status)).toEqual(['projected', 'projected']);
    });
});
