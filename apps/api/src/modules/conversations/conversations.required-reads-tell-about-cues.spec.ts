import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { TurnTraceContext } from '../trace/turn-trace-context';
import { REQUIRED_READS_CATALOG_FLAG } from '../throttle/feature-flags.service';
import { isProductQuestion, isTellAboutItem, lexicalRequiredReadsOperation } from './runtime/operation-lexical-cues';
import { requiredReadsGate } from './runtime/required-reads.runner';
import type { OperationShadowVerdict } from './runtime/operation-classifier.service';
import { attachDescriptionAuthority } from './description-authority';

/**
 * F4300-35 follow-up (production 2026-10-24, store QA tenant with `agentRuntime.requiredReads.catalog` on): «tell me about the
 * Audífono QA Aurora» ran ONLY search_faqs, and the reply was «…2 units available. It is a fictional test product and does not
 * correspond to real inventory.» With no catalogue row in the turn, neither the description note nor the output check applied.
 * «tell me about X» had no cue in any pilot (#207 menu, #208 lodging/tours, #209 listings). It is now the item read of each
 * pilot, under the same gate (never over a confident other business operation), and never about the business itself, its
 * hours, policies, payment, shipping, returns, or the customer's own records.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const usage = { model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 };
const STORE_TOOLS = ['search_faqs', 'search_products', 'get_product', 'check_stock', 'place_catalog_order', 'list_my_catalog_orders', 'get_catalog_order'];
const AURORA = { id: '33333333-3333-4333-8333-333333333333', name: 'Audífono QA Aurora', description: 'Producto ficticio de prueba. No corresponde a inventario real.',
    category: 'Audio', price: 119900, currency: 'COP', stock: 2, isAvailable: true, inStock: true };
const OTHER = { id: '44444444-4444-4444-8444-444444444444', name: 'Parlante QA Boreal', description: 'Parlante bluetooth.',
    category: 'Audio', price: 89900, currency: 'COP', stock: 5, isAvailable: true, inStock: true };

const TELL_ABOUT = [
    'tell me about the Audífono QA Aurora',
    'Tell me more about the Audífono QA Aurora',
    'what can you tell me about the Audífono QA Aurora?',
    'describe the Audífono QA Aurora',
    'háblame del Audífono QA Aurora',
    'cuéntame sobre el Audífono QA Aurora',
    'dame detalles del Audífono QA Aurora',
    'me fala sobre o Audífono QA Aurora',
    'me conta mais sobre o Audífono QA Aurora',
    "parlez-moi de l'Audífono QA Aurora",
    'décrivez le Audífono QA Aurora',
];
const NOT_ITEM = [
    'tell me about your company',
    'tell me about yourselves',
    'háblame de ustedes',
    'cuéntame sobre la política de devoluciones',
    'tell me about your shipping policy',
    'me fala sobre as formas de pagamento',
    'parlez-moi de la livraison',
    'tell me about my order',
    'háblame de mi pedido',
    'what are your opening hours?',
    'hola', 'thanks!', 'quiero hablar con una persona',
    'cancel my order',
];

describe('«tell me about X» in the message\'s own words (es/pt/fr/en)', () => {
    it.each(TELL_ABOUT)('«%s» is an item read in every pilot', text => {
        expect(isTellAboutItem(text)).toBe(true);
        expect(isProductQuestion(text)).toBe(true);
        expect(lexicalRequiredReadsOperation(text, 'catalog', STORE_TOOLS)).toBe('product_info');
        expect(lexicalRequiredReadsOperation(text, 'restaurants', ['get_menu'])).toBe('menu_info');
        expect(lexicalRequiredReadsOperation(text, 'properties', ['list_properties'])).toBe('property_info');
        expect(lexicalRequiredReadsOperation(text, 'tours', ['search_packages'])).toBe('package_info');
        expect(lexicalRequiredReadsOperation(text, 'listings', ['search_listings'])).toBe('listing_info');
    });

    it.each(NOT_ITEM)('«%s» is not a store product read', text => {
        expect(isProductQuestion(text)).toBe(false);
        expect(lexicalRequiredReadsOperation(text, 'catalog', STORE_TOOLS)).toBeNull();
    });

    it('only when the turn publishes search_products', () => {
        expect(lexicalRequiredReadsOperation('tell me about the Audífono QA Aurora', 'catalog', ['search_faqs', 'get_product'])).toBeNull();
    });

    it('the gate: over the FAQ intent or a low verdict the cue runs; a confident other business operation keeps the turn', () => {
        const verdict = (operationKey: string, confidence: number): OperationShadowVerdict =>
            ({ version: 1, operationKey, confidence, fallback: null, candidates: ['product_info', 'ask_question'], latencyMs: 5 });
        const faq = requiredReadsGate(verdict('ask_question', 0.9), 'catalog', 'product_info');
        expect(faq).toMatchObject({ run: true, pilot: 'catalog', source: 'lexical_cue' });
        expect(faq.run && faq.operation.key).toBe('product_info');
        expect(requiredReadsGate(verdict('track_catalog_order', 0.95), 'catalog', 'product_info')).toMatchObject({ run: true, operation: expect.objectContaining({ key: 'track_catalog_order' }) });
    });
});

function store(classifier: string, products: any[] = [AURORA, OTHER]) {
    const featureFlags = { isFeatureEnabled: jest.fn().mockResolvedValue(false) };
    const f = agentTurnFixture({ featureFlags });
    f.contract.subtypeProfileId = 'retail/electronica';
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'en', industry: 'retail', tools: {}, rag: { enabled: false }, llm: { temperature: 0 },
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'retail', subType: 'electronica' });
    f.prisma.tenant.findUnique.mockResolvedValue({ settings: { featureFlags: { [REQUIRED_READS_CATALOG_FLAG]: true } } });
    publishTools(f, STORE_TOOLS);
    const results: Record<string, (args: any) => any> = {
        // The FAQ carries the product's description (production: the only read of the turn).
        search_faqs: () => ({ faqs: [{ question: 'Audífono QA Aurora', answer: AURORA.description }] }),
        search_products: () => attachDescriptionAuthority('search_products', { products }),
        get_product: args => {
            const row = products.find(p => p.id === args.productId);
            return row ? attachDescriptionAuthority('get_product', { ...row }) : { error: 'product_not_found' };
        },
    };
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string, args: any) =>
        results[name] ? results[name](args) : { error: `unexpected tool ${name}` });
    // What production said: the stock from somewhere, then the description as the product's state.
    f.llmRouter.execute.mockImplementation(async (req: any) => {
        if (req.task === 'classify') return { content: classifier, routingDecision: { selectedModel: { id: 'cheap' } }, ...usage };
        return { ...usage, content: 'The Audífono QA Aurora costs 119,900 COP and there are 2 units available. It is a fictional test product and does not correspond to real inventory.' };
    });
    const toEvent = jest.spyOn(TurnTraceContext.prototype, 'toEvent');
    const turn = async (message: string) => {
        const result = await f.service.test('tenant', AGENT, { message, channelType: 'telegram' }, { agentSnapshot: undefined });
        const steps = toEvent.mock.results.flatMap(r => r.type === 'return' ? r.value.steps : []);
        return { result, requiredReads: steps.filter((s: any) => s.type === 'decision' && s.label === 'required_reads') };
    };
    const executed = (): Array<{ name: string; args: any }> => f.toolExecutor.execute.mock.calls.map((c: any[]) => ({ name: c[3], args: c[4] }));
    return { f, turn, executed };
}

afterEach(() => jest.restoreAllMocks());

describe('through the turn: store, requiredReads.catalog on, «tell me about the Audífono QA Aurora»', () => {
    it('with the FAQ intent → search_products and get_product (the product named) run before the model; the description is not said as its state', async () => {
        const h = store('{"operationKey":"ask_question","confidence":0.9}');
        const { result, requiredReads } = await h.turn('tell me about the Audífono QA Aurora');
        expect(result.debug.runtimeError).toBeUndefined();
        const names = h.executed().map(c => c.name);
        expect(names).toEqual(expect.arrayContaining(['search_products', 'get_product']));
        expect(h.executed().find(c => c.name === 'get_product')?.args).toEqual({ productId: AURORA.id });
        expect(requiredReads[0].metadata).toMatchObject({
            pilot: 'catalog', operation: 'product_info', source: 'lexical_cue', classifierOperation: 'ask_question',
        });
        expect(result.reply).toBe('The Audífono QA Aurora costs 119,900 COP and there are 2 units available.');
    });

    it.each(['háblame del Audífono QA Aurora', 'me fala sobre o Audífono QA Aurora', "parlez-moi de l'Audífono QA Aurora"])('«%s» under the threshold → the product reads run', async message => {
        const h = store('{"operationKey":"product_info","confidence":0.6}');
        const { requiredReads } = await h.turn(message);
        expect(h.executed().map(c => c.name)).toEqual(expect.arrayContaining(['search_products', 'get_product']));
        expect(requiredReads[0].metadata).toMatchObject({ operation: 'product_info', source: 'lexical_cue' });
    });

    it('«tell me about your return policy» runs no product read', async () => {
        const h = store('{"operationKey":"ask_question","confidence":0.9}');
        const { requiredReads } = await h.turn('tell me about your return policy');
        expect(h.executed().map(c => c.name)).not.toContain('get_product');
        expect(requiredReads[0]?.metadata).not.toMatchObject({ source: 'lexical_cue' });
    });
});
