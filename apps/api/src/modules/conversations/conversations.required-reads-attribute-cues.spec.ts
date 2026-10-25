import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { TurnTraceContext } from '../trace/turn-trace-context';
import { REQUIRED_READS_CATALOG_FLAG } from '../throttle/feature-flags.service';
import {
    isItemAttributeQuestion, isProductQuestion, lexicalRequiredReadsOperation, needsItemDetailRead,
} from './runtime/operation-lexical-cues';
import { attachDescriptionAuthority } from './description-authority';

/**
 * F4300-08 (production 25-oct, store QA tenant `tienda-qa-electronica`, `agentRuntime.requiredReads.catalog` on, the catalogue
 * tools on, 3 of 3): «de qué color es el Audífono QA Aurora?» (es), «de quelle couleur est l'Audífono QA Aurora ?» (fr), «qual a
 * cor do Audífono QA Aurora?» (pt) ran ONLY search_faqs and were answered «no tengo información específica sobre el color»; the
 * product's record says it is blue. Price, stock and «tell me about» (#219) questions read the product. An attribute question
 * named no cue, and even with the classifier's `product_info` the turn's <catalog> (name, price, stock, category) marked
 * search_products / get_product `projected`. An attribute question (colour, size, material, weight, dimensions, brand, model,
 * warranty, compatibility) is now `product_info` in the catalog pilot and bypasses the projection; a price question still uses it.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const usage = { model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 };
const STORE_TOOLS = ['search_faqs', 'search_products', 'get_product', 'check_stock', 'place_catalog_order', 'list_my_catalog_orders', 'get_catalog_order'];
const AURORA = { id: '33333333-3333-4333-8333-333333333333', name: 'Audífono QA Aurora', description: 'Audífono inalámbrico color azul. Producto ficticio de prueba.',
    category: 'Audio', price: 119900, currency: 'COP', stock: 2, isAvailable: true, inStock: true };
const OTHER = { id: '44444444-4444-4444-8444-444444444444', name: 'Parlante QA Boreal', description: 'Parlante bluetooth negro.',
    category: 'Audio', price: 89900, currency: 'COP', stock: 5, isAvailable: true, inStock: true };
const PRODUCTS = [AURORA, OTHER];

const PRODUCTION = [
    'de qué color es el Audífono QA Aurora?',
    "de quelle couleur est l'Audífono QA Aurora ?",
    'qual a cor do Audífono QA Aurora?',
];
const ATTRIBUTE = [
    ...PRODUCTION,
    'what colour is the Audífono QA Aurora?',
    'what colors does the Audífono QA Aurora come in?',
    '¿qué talla tiene la camiseta Aurora?',
    'what size is the Audífono QA Aurora?',
    'quelle taille fait le casque Aurora ?',
    'qual o tamanho do Audífono QA Aurora?',
    '¿de qué material es el Audífono QA Aurora?',
    'is the Audífono QA Aurora made of plastic?',
    'de que material é feito o Audífono QA Aurora?',
    '¿cuánto pesa el Audífono QA Aurora?',
    'what is the weight of the Audífono QA Aurora?',
    'quel est le poids du Audífono QA Aurora ?',
    '¿cuáles son las medidas del Audífono QA Aurora?',
    'what are the dimensions of the Audífono QA Aurora?',
    '¿de qué marca es el Audífono QA Aurora?',
    'what brand is the Audífono QA Aurora?',
    'quelle est la marque du Audífono QA Aurora ?',
    '¿qué modelo es el Audífono QA Aurora?',
    'which model is the Audífono QA Aurora?',
    '¿tiene garantía el Audífono QA Aurora?',
    'does the Audífono QA Aurora have a warranty?',
    'o Audífono QA Aurora tem garantia?',
    "l'Audífono QA Aurora a-t-il une garantie ?",
    '¿el Audífono QA Aurora es compatible con iPhone?',
    'is the Audífono QA Aurora compatible with Android?',
];
const NOT_ATTRIBUTE = [
    'how much is the Audífono QA Aurora?',
    '¿cuánto cuesta el Audífono QA Aurora en pesos?',
    'is the Audífono QA Aurora in stock?',
    '¿cuál es la política de garantía de la tienda?',
    'what is your warranty policy?',
    'tell me about your brand',
    'quiero cancelar mi pedido del Audífono QA Aurora',
    'can I pay the Audífono QA Aurora with a card?',
    'hola',
];

describe('the attribute cue (pure)', () => {
    it.each(ATTRIBUTE)('«%s» asks about an item attribute → product_info, past the projection', text => {
        expect(isItemAttributeQuestion(text)).toBe(true);
        expect(isProductQuestion(text)).toBe(true);
        expect(needsItemDetailRead(text)).toBe(true);
        expect(lexicalRequiredReadsOperation(text, 'catalog', STORE_TOOLS)).toBe('product_info');
    });

    it.each(NOT_ATTRIBUTE)('«%s» is not an item attribute question', text => {
        expect(isItemAttributeQuestion(text)).toBe(false);
        expect(needsItemDetailRead(text)).toBe(false);
    });

    it('the catalog pilot needs search_products published', () => {
        expect(lexicalRequiredReadsOperation(PRODUCTION[0], 'catalog', ['search_faqs'])).toBeNull();
    });

    it('the detail read of the other pilots', () => {
        expect(lexicalRequiredReadsOperation('¿de qué tamaño es el plato Spark?', 'restaurants', ['get_menu'])).toBe('menu_info');
        expect(lexicalRequiredReadsOperation('what size is the room?', 'properties', ['list_properties'])).toBe('property_info');
        expect(lexicalRequiredReadsOperation('¿cuáles son las medidas del apartamento?', 'listings', ['search_listings'])).toBe('listing_info');
        // No item word of the pilot: the classifier decides.
        expect(lexicalRequiredReadsOperation('¿de qué color es?', 'restaurants', ['get_menu'])).toBeNull();
    });
});

function store(classifier: string, reply: string) {
    const featureFlags = { isFeatureEnabled: jest.fn().mockResolvedValue(false) };
    const f = agentTurnFixture({ featureFlags });
    f.contract.subtypeProfileId = 'retail/electronica';
    // Production: the store's catalogue tools are on, so its own products travel in the turn's <catalog>.
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'es', industry: 'retail', tools: { catalog: { enabled: true } }, rag: { enabled: false }, llm: { temperature: 0 },
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
        search_faqs: () => ({ faqs: [] }),
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

describe('store with its own catalogue in the turn, requiredReads.catalog on (production messages)', () => {
    it.each(PRODUCTION.flatMap(message => [
        [message, '{"operationKey":"ask_question","confidence":0.9}'],
        // The classifier itself names product_info: the projection still does not hold the colour.
        [message, '{"operationKey":"product_info","confidence":0.95}'],
    ]))('«%s» (%s) → search_products and get_product run, not «projected»', async (message, classifier) => {
        const h = store(classifier, 'El Audífono QA Aurora es de color azul.');
        const { result, requiredReads } = await h.turn(message);
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.executed().map(c => c.name)).toEqual(expect.arrayContaining(['search_products', 'get_product']));
        expect(h.executed().find(c => c.name === 'get_product')?.args).toEqual({ productId: AURORA.id });
        expect(requiredReads[0].metadata).toMatchObject({ pilot: 'catalog', operation: 'product_info' });
        const reads = (requiredReads[0]?.metadata as any)?.reads as Array<{ tool: string; status: string }>;
        expect(reads.filter(r => r.status === 'projected')).toEqual([]);
    });

    it.each([
        'how much is the Audífono QA Aurora?',
        '¿cuánto cuesta el Audífono QA Aurora?',
    ])('«%s» is still answered from the projected <catalog> (price and stock are in it)', async message => {
        const h = store('{"operationKey":"product_info","confidence":0.95}', 'El Audífono QA Aurora cuesta 119.900 COP.');
        const { requiredReads } = await h.turn(message);
        expect(h.executed().map(c => c.name)).not.toContain('get_product');
        const reads = (requiredReads[0]?.metadata as any)?.reads as Array<{ tool: string; status: string }>;
        expect(reads.map(r => r.status)).toEqual(['projected', 'projected']);
    });
});
