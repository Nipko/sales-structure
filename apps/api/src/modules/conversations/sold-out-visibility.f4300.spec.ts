import { catalogItems, catalogTerms } from '../orders/catalog-order-contract';
import { AIToolExecutorService } from './ai-tool-executor.service';
import { PromptAssemblerService } from './prompt-assembler.service';
import { CATALOG_TOOLS } from './tools/catalog-tools';
import {
    AVAILABLE_ONLY_NOTE, asksAboutSoldOutProducts, claimsNothingSoldOut, guardSoldOutClaim, productAvailabilityScope,
} from './sold-out-visibility';
import { authorityFor } from './__fixtures__/tool-authority.fixture';
import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { pinClock } from './__fixtures__/pinned-clock';

/**
 * F4300-29 (production QA 2026-10-23/24, store tenant, 5/5). «¿qué productos tienen agotados?», «tem algum produto esgotado?»,
 * «is anything sold out right now?», «which products are out of stock?» were answered «No, all the products in our catalog are
 * currently available in stock» / «no tengo un listado de agotados» while the catalogue had a product with stock 0 /
 * is_available = false. search_products always filtered `is_available = true`, and so did the turn's <catalog>.
 */
const schemaName = 'tenant_store';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const SOLD_OUT_ID = 'a36c1e0c-c71b-4837-8f30-048e94bba421';
const ON_SALE_ID = 'b46c1e0c-c71b-4837-8f30-048e94bba422';
const soldOutRow = { id: SOLD_OUT_ID, name: 'Spark QA Gorra', price: '45000', currency: 'COP', stock: 0, is_available: false };
const onSaleRow = { id: ON_SALE_ID, name: 'Spark QA Camiseta', price: '60000', currency: 'COP', stock: 13, is_available: true };

const PRODUCTION_QUESTIONS: Array<[string, string]> = [
    ['es', '¿qué productos tienen agotados?'],
    ['pt', 'tem algum produto esgotado?'],
    ['en', 'is anything sold out right now?'],
    ['en', 'which products are out of stock?'],
];

function executor(query: jest.Mock, ordersService?: any) {
    const control = {
        preflight: jest.fn().mockResolvedValue({ allowed: true, idempotencyKey: 'catalog-call' }),
        complete: jest.fn().mockResolvedValue(undefined),
        fail: jest.fn().mockResolvedValue(undefined),
    };
    const stub = () => ({}) as any;
    const service = new AIToolExecutorService(
        { $queryRawUnsafe: query } as any,
        stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(),
        stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(), stub(),
        control as any,
        { preparePaymentLink: jest.fn(), confirmationRequiredResult: jest.fn() } as any,
        stub(),
        ordersService as any,
    );
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    return service;
}
const search = (service: AIToolExecutorService, args: Record<string, unknown>) =>
    service.execute(schemaName, tenantId, contactId, 'search_products', args, conversationId, { authority: authorityFor('search_products') }) as Promise<any>;

describe('F4300-29 data layer: search_products reads the products a question asks about', () => {
    it('default (no availability): only products for sale, unchanged SQL, and the result says so', async () => {
        const query = jest.fn().mockResolvedValue([onSaleRow]);
        const result = await search(executor(query), { query: '' });
        const [sql] = query.mock.calls[0];
        expect(sql).toContain('is_available = true');
        expect(sql).not.toContain('IS NOT TRUE');
        expect(result.scope).toBe('available_only');
        expect(result.note).toBe(AVAILABLE_ONLY_NOTE);
        expect(result.note).toMatch(/not included/);
        expect(result.products[0]).toMatchObject({ id: ON_SALE_ID, isAvailable: true, inStock: true, stock: 13 });
    });

    it('an empty default read stays `empty` (the note does not turn it into `ok`)', async () => {
        const result = await search(executor(jest.fn().mockResolvedValue([])), { query: 'gorra' });
        expect(result.status).toBe('empty');
        expect(result.scope).toBe('available_only');
        expect(result.products).toEqual([]);
    });

    it('"available" is the default spelled out', async () => {
        const query = jest.fn().mockResolvedValue([]);
        await search(executor(query), { query: '', availability: 'available' });
        expect(query.mock.calls[0][0]).toContain('is_available = true');
    });

    it('"unavailable" lists the sold-out or withdrawn products, with isAvailable / stock / inStock', async () => {
        const query = jest.fn().mockResolvedValue([soldOutRow, { ...onSaleRow, id: 'c', name: 'Spark QA Taza', stock: 0 }]);
        const result = await search(executor(query), { query: '', limit: 20, availability: 'unavailable' });
        const [sql, ...params] = query.mock.calls[0];
        expect(sql).toContain('(is_available IS NOT TRUE OR (stock IS NOT NULL AND stock <= 0))');
        expect(sql).not.toContain('is_available = true');
        expect(params[params.length - 1]).toBe(20);
        expect(result.status).toBe('ok');
        expect(result.scope).toBe('unavailable_only');
        expect(result.note).toBeUndefined();
        expect(result.products).toEqual([
            expect.objectContaining({ id: SOLD_OUT_ID, name: 'Spark QA Gorra', isAvailable: false, inStock: false, stock: 0 }),
            expect.objectContaining({ name: 'Spark QA Taza', isAvailable: true, inStock: false, stock: 0 }),
        ]);
    });

    it('"unavailable" with nothing sold out is an honest `empty`', async () => {
        const result = await search(executor(jest.fn().mockResolvedValue([])), { query: '', availability: 'unavailable' });
        expect(result.status).toBe('empty');
        expect(result.scope).toBe('unavailable_only');
    });

    it('"any" lists both, with no availability predicate', async () => {
        const query = jest.fn().mockResolvedValue([soldOutRow, onSaleRow]);
        const result = await search(executor(query), { query: '', availability: 'any' });
        expect(query.mock.calls[0][0]).not.toMatch(/is_available (=|IS)/);
        expect(result.scope).toBe('all');
        expect(result.products.map((p: any) => [p.name, p.inStock])).toEqual([['Spark QA Gorra', false], ['Spark QA Camiseta', true]]);
    });

    it('an unknown availability value is the default', () => {
        expect(productAvailabilityScope('everything')).toMatchObject({ availability: 'available', label: 'available_only', where: 'is_available = true' });
        expect(productAvailabilityScope(undefined).label).toBe('available_only');
    });

    it('the tool schema advertises exactly the values the executor reads', () => {
        const tool = CATALOG_TOOLS.find(t => t.name === 'search_products')!;
        const property = (tool.parameters as any).properties.availability;
        expect(property.enum).toEqual(['available', 'unavailable', 'any']);
        for (const value of property.enum) expect(productAvailabilityScope(value).availability).toBe(value);
        expect((tool.parameters as any).required).toEqual(['query']);
        expect(tool.description).toContain('availability "unavailable"');
        expect(tool.description).toContain('available_only');
    });
});

describe('F4300-29 ordering still never takes a product that is not for sale', () => {
    const operationalScope = { kind: 'agent' as const, tenantId, schemaName, agentId: '55555555-5555-4555-8555-555555555555', version: 1, operationalHash: 'a'.repeat(64) };
    function writer(rows: any[]) {
        const quote = jest.fn(async (_schema: string, data: any) => catalogTerms(rows, catalogItems(data.items), '', 'agent'));
        const create = jest.fn();
        return { create, service: executor(jest.fn(), { catalogCommands: () => ({ quote, create }) }) };
    }
    const order = (service: AIToolExecutorService, productId: string) => service.execute(schemaName, tenantId, contactId, 'place_catalog_order',
        { items: [{ productId, quantity: 1 }] }, conversationId, { authority: authorityFor('place_catalog_order'), operationalScope }) as Promise<any>;

    it('a product found through availability "unavailable" (is_available = false) is rejected without writing', async () => {
        const { service, create } = writer([soldOutRow]);
        expect(await order(service, SOLD_OUT_ID)).toMatchObject({ error: 'catalog_product_unavailable', productId: SOLD_OUT_ID, persisted: false });
        expect(create).not.toHaveBeenCalled();
    });

    it('a product for sale with stock 0 is rejected for insufficient stock', async () => {
        const { service, create } = writer([{ ...onSaleRow, stock: 0 }]);
        expect(await order(service, ON_SALE_ID)).toMatchObject({ error: 'catalog_stock_insufficient', available: 0, requested: 1 });
        expect(create).not.toHaveBeenCalled();
    });
});

describe('F4300-29 the turn <catalog> says it lists only products for sale', () => {
    const assembler = new PromptAssemblerService({ buildSystemPrompt: () => '' } as any);
    const render = (turn: Record<string, unknown>) => (assembler as any).buildTurnLayer({ language: 'es', timezone: 'America/Bogota', ...turn }) as string;
    const catalog = [{ id: ON_SALE_ID, title: 'Spark QA Camiseta', price: 60000, currency: 'COP', inStock: true, stock: 13 }];

    it('renders the available_only scope inside <catalog>', () => {
        const xml = render({ catalog, catalogScope: 'available_only' });
        expect(xml).toContain('<catalog>');
        expect(xml).toMatch(/<scope>available_only: .*sold-out or withdrawn products are not.*availability "unavailable"/);
    });

    it('a catalogue without the scope (synced store products) renders as before', () => {
        expect(render({ catalog })).not.toContain('<scope>');
    });
});

describe('F4300-29 recognising the question and the claim', () => {
    it.each(PRODUCTION_QUESTIONS)('production question (%s) «%s» asks about sold-out products', (_lang, question) => {
        expect(asksAboutSoldOutProducts(question)).toBe(true);
    });
    it.each([
        '¿Qué productos no están disponibles?', 'Which products are unavailable?', '¿La gorra está agotada?', 'Quels produits sont en rupture de stock ?',
        'Algum produto está sem estoque?', '¿Hay algo sin stock?',
    ])('«%s» asks about sold-out products', question => expect(asksAboutSoldOutProducts(question)).toBe(true));
    it.each([
        '¿Cuánto cuesta la camiseta?', 'Quiero comprar dos camisetas', 'The technician is unavailable tomorrow?', 'Hola, buenas tardes', '¿Hay stock de la camiseta?',
    ])('«%s» does not', question => expect(asksAboutSoldOutProducts(question)).toBe(false));

    it.each([
        'No, all the products in our catalog are currently available in stock.',
        'Lo siento, no tengo un listado de agotados.',
        'En este momento no hay productos agotados.',
        'Todos nuestros productos están disponibles.',
        'Nothing is sold out right now.',
        'Não, nenhum produto está esgotado.',
        'Todos os produtos estão disponíveis no momento.',
        'Aucun produit n’est épuisé pour le moment.',
        'Tous nos produits sont disponibles.',
    ])('«%s» claims nothing is sold out', reply => expect(claimsNothingSoldOut(reply)).toBe(true));
    it.each([
        'No, el producto Spark QA Gorra está agotado.',
        'Sí: la Spark QA Gorra está agotada.',
        'No le puedo vender la gorra porque está agotada.',
        'The Spark QA Gorra is sold out, sorry.',
    ])('«%s» is an answer, not the claim', reply => expect(claimsNothingSoldOut(reply)).toBe(false));
});

describe('F4300-29 output check: «nothing is sold out» needs an availability-scoped read', () => {
    const availableOnly = { status: 'ok', scope: 'available_only', note: AVAILABLE_ONLY_NOTE, products: [{ id: ON_SALE_ID, name: 'Spark QA Camiseta', isAvailable: true, inStock: true }] };
    const soldOutRead = { status: 'ok', scope: 'unavailable_only', products: [{ id: SOLD_OUT_ID, name: 'Spark QA Gorra', isAvailable: false, inStock: false, stock: 0 }] };
    const noneSoldOut = { status: 'empty', scope: 'unavailable_only', products: [] };

    const PRODUCTION: Array<[string, string, string]> = [
        ['en', 'is anything sold out right now?', 'No, all the products in our catalog are currently available in stock.'],
        ['en', 'which products are out of stock?', 'No, all the products in our catalog are currently available in stock.'],
        ['es', '¿qué productos tienen agotados?', 'Lo siento, no tengo un listado de agotados.'],
        ['pt', 'tem algum produto esgotado?', 'Não, todos os produtos estão disponíveis em estoque.'],
    ];

    it.each(PRODUCTION)('production regression (%s) «%s» with only the available list: replaced by the unconfirmed text', (lang, question, reply) => {
        const result = guardSoldOutClaim({ customerText: question, reply, sources: [availableOnly], lang });
        expect(result).toMatchObject({ replaced: true, situation: 'unscoped' });
        expect(result.text).not.toBe(reply);
    });

    it.each(PRODUCTION)('production regression (%s) «%s» with the sold-out read: replaced by the sold-out list', (lang, question, reply) => {
        const result = guardSoldOutClaim({ customerText: question, reply, sources: [availableOnly, JSON.stringify(soldOutRead)], lang });
        expect(result).toMatchObject({ replaced: true, situation: 'contradicted' });
        expect(result.text).toContain('Spark QA Gorra');
    });

    it('localized fixed texts (es/en/pt/fr), usted in Spanish', () => {
        const text = (lang: string, sources: unknown[]) => guardSoldOutClaim({ customerText: 'is anything sold out?', reply: 'Nothing is sold out.', sources, lang }).text;
        expect(text('es', [])).toBe('En este momento no tengo confirmado qué productos están agotados, así que no puedo asegurarle que todo esté disponible. Si me indica el producto que le interesa, le confirmo su disponibilidad.');
        expect(text('en', [])).toMatch(/^I cannot confirm right now which products are sold out/);
        expect(text('pt', [])).toMatch(/^No momento não tenho confirmado quais produtos estão esgotados/);
        expect(text('fr', [])).toMatch(/^Je ne peux pas confirmer pour le moment quels produits sont épuisés/);
        expect(text('es', [soldOutRead])).toBe('Según el catálogo, en este momento estos productos no están disponibles (agotados o fuera de venta): Spark QA Gorra.');
        expect(text('fr', [soldOutRead])).toMatch(/^D’après le catalogue.*: Spark QA Gorra\.$/);
    });

    it('a sold-out read that found nothing backs «no hay productos agotados»', () => {
        const reply = 'En este momento no hay productos agotados.';
        expect(guardSoldOutClaim({ customerText: '¿qué productos tienen agotados?', reply, sources: [noneSoldOut], lang: 'es' })).toEqual({ text: reply, replaced: false });
    });

    it('a reply that names every sold-out product stands', () => {
        const reply = 'La Spark QA Gorra está agotada; todo lo demás está disponible.';
        expect(guardSoldOutClaim({ customerText: '¿qué productos tienen agotados?', reply, sources: [soldOutRead], lang: 'es' }).replaced).toBe(false);
    });

    it('a failed or stale sold-out read backs nothing', () => {
        for (const read of [{ ...noneSoldOut, status: 'error', error: 'read_failed' }, { ...noneSoldOut, stale: true }]) {
            expect(guardSoldOutClaim({ customerText: 'is anything sold out?', reply: 'Nothing is sold out.', sources: [read], lang: 'en' }).situation).toBe('unscoped');
        }
    });

    it('the same claim to a question that is not about sold-out products is left alone', () => {
        const reply = 'Todos nuestros productos están disponibles para envío.';
        expect(guardSoldOutClaim({ customerText: '¿Hacen envíos a Medellín?', reply, sources: [], lang: 'es' }).replaced).toBe(false);
    });
});

pinClock();
describe('F4300-29 through ConversationsService: a store asked what is sold out', () => {
    const answer = (content: string) => ({ content, model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 });
    function store(language: 'es' | 'en' | 'pt', reply: (messages: any[]) => string, soldOut: any[] = [{ id: SOLD_OUT_ID, name: 'Spark QA Gorra', isAvailable: false, inStock: false, stock: 0 }]) {
        const f = agentTurnFixture();
        f.personaService.getAgent.mockResolvedValue({ version: 5, config_json: { language, industry: 'retail', tools: { catalog: { enabled: true } }, rag: { enabled: false }, llm: {} } });
        publishTools(f, ['search_products', 'check_stock', 'get_product']);
        f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string, args: any) => {
            if (name !== 'search_products') throw new Error(`unexpected tool ${name}`);
            if (args?.availability === 'unavailable') return { status: soldOut.length ? 'ok' : 'empty', source: 'tenant_db', scope: 'unavailable_only', products: soldOut };
            return { status: 'ok', source: 'tenant_db', scope: 'available_only', note: AVAILABLE_ONLY_NOTE, products: [{ id: ON_SALE_ID, name: 'Spark QA Camiseta', isAvailable: true, inStock: true, stock: 13 }] };
        });
        f.llmRouter.execute.mockImplementation(async (request: any) => {
            if (!['conversation', 'tool_calling'].includes(request.task)) return answer('{}');
            return answer(reply(request.messages ?? []));
        });
        const turn = (message: string) => f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message, channelType: 'telegram' }, { agentSnapshot: undefined });
        return { f, turn };
    }
    const toolText = (messages: any[]) => messages.filter((m: any) => m?.role === 'tool').map((m: any) => String(m.content)).join('\n');

    it.each(PRODUCTION_QUESTIONS)('(%s) «%s»: the sold-out products are read before the model answers', async (language, question) => {
        const h = store(language as any, () => 'Spark QA Gorra.');
        const r = await h.turn(question);
        expect(r.debug.runtimeError).toBeUndefined();
        const reads = h.f.toolExecutor.execute.mock.calls.filter((c: any[]) => c[3] === 'search_products').map((c: any[]) => c[4]);
        expect(reads).toContainEqual({ query: '', limit: 20, availability: 'unavailable' });
        const messages = h.f.llmRouter.execute.mock.calls.find((c: any[]) => ['conversation', 'tool_calling'].includes(c[0].task))![0].messages;
        expect(toolText(messages)).toContain('"scope":"unavailable_only"');
        expect(toolText(messages)).toContain('Spark QA Gorra');
    });

    it('«is anything sold out right now?» → «all the products … are currently available» is replaced by the sold-out list', async () => {
        const h = store('en', () => 'No, all the products in our catalog are currently available in stock.');
        const r = await h.turn('is anything sold out right now?');
        expect(r.debug.runtimeError).toBeUndefined();
        expect(r.reply).not.toMatch(/all the products/);
        expect(r.reply).toContain('Spark QA Gorra');
        expect(r.reply).toMatch(/not available right now/);
    });

    it('a reply naming the sold-out product stands', async () => {
        const h = store('es', () => 'En este momento la Spark QA Gorra está agotada.');
        const r = await h.turn('¿qué productos tienen agotados?');
        expect(r.reply).toContain('la Spark QA Gorra está agotada');
    });

    it('nothing sold out: «no hay productos agotados» stands', async () => {
        const h = store('es', () => 'En este momento no hay productos agotados.', []);
        const r = await h.turn('¿qué productos tienen agotados?');
        expect(r.reply).toContain('no hay productos agotados');
    });

    it('a question about one product\'s price makes no sold-out read', async () => {
        const h = store('es', () => 'La camiseta cuesta 60.000 COP.');
        await h.turn('¿Cuánto cuesta la Spark QA Camiseta?');
        const reads = h.f.toolExecutor.execute.mock.calls.filter((c: any[]) => c[4]?.availability === 'unavailable');
        expect(reads).toEqual([]);
    });
});
