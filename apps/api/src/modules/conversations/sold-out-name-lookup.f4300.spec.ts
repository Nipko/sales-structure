import { AIToolExecutorService } from './ai-tool-executor.service';
import { PromptAssemblerService } from './prompt-assembler.service';
import { CATALOG_TOOLS } from './tools/catalog-tools';
import { AVAILABLE_ONLY_NOTE, guardNotForSaleDenial, NOT_FOR_SALE_MATCHES_NOTE } from './sold-out-visibility';
import { authorityFor } from './__fixtures__/tool-authority.fixture';
import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { pinClock } from './__fixtures__/pinned-clock';

/**
 * F4300-29 residual (production 2026-10-24, image 14f066a5, which includes #200). The listing was fixed: «¿qué productos tienen
 * agotados?» names «QA Agente Stock». Asked for that product BY NAME («tienen el QA Agente Stock?», «vocês têm o QA Agente
 * Stock?»), the agent called search_products and answered «No, no tenemos el producto QA Agente Stock en nuestro catálogo. Solo está
 * disponible el Audífono QA Aurora.» The product exists (is_available = false, stock 0): the default search_products read
 * (`is_available = true`) left it out of a name query, so the only read the model had said it did not exist.
 */
const schemaName = 'tenant_store';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const QA_ID = 'e6ef6f14-7125-4bcf-99f5-72bf10b7abc3';
const AURORA_ID = 'b46c1e0c-c71b-4837-8f30-048e94bba422';
const TAZA_ID = 'c46c1e0c-c71b-4837-8f30-048e94bba423';
const QA_NAME = 'QA Agente Stock 20261020T1737Z';
/** The production row (report CONV4300-COV2-CHECK-STOCK). */
const qaRow = { id: QA_ID, name: QA_NAME, description: 'Producto sintético exclusivo de QA', category: null, price: '18777', currency: 'COP', stock: 0, is_available: false };
const auroraRow = { id: AURORA_ID, name: 'Audífono QA Aurora', description: null, category: 'audio', price: '120000', currency: 'COP', stock: 5, is_available: true };
const UNAVAILABLE_SQL = '(is_available IS NOT TRUE OR (stock IS NOT NULL AND stock <= 0))';

function executor(query: jest.Mock) {
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
        undefined as any,
    );
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    return service;
}
const search = (service: AIToolExecutorService, args: Record<string, unknown>) =>
    service.execute(schemaName, tenantId, contactId, 'search_products', args, conversationId, { authority: authorityFor('search_products') }) as Promise<any>;

/** A store whose catalogue is Aurora (for sale) and the QA product (not for sale), answering by the SQL predicate it receives. */
function storeTable(rows: any[] = [auroraRow, qaRow]) {
    return jest.fn(async (sql: string, ...params: any[]) => {
        const words = params.filter(p => typeof p === 'string').map(p => p.replace(/%/g, ''));
        const fold = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        const matches = rows.filter(row => words.every(w => fold(`${row.name} ${row.description ?? ''} ${row.category ?? ''}`).includes(w)));
        if (sql.includes(UNAVAILABLE_SQL)) return matches.filter(row => row.is_available !== true || (row.stock != null && row.stock <= 0));
        if (sql.includes('is_available = true')) return matches.filter(row => row.is_available === true);
        return matches;
    });
}

describe('F4300-29 residual data layer: a name query finds the product that exists but is sold out', () => {
    it.each([
        ['es', 'QA Agente Stock'],
        ['pt', 'o QA Agente Stock'],
        ['en', 'qa agente stock'],
    ])('(%s) search_products «%s»: the stock-0 product comes back under notForSale, marked sold out', async (_lang, query) => {
        const sql = storeTable();
        const result = await search(executor(sql), { query });
        expect(result.status).toBe('ok');
        expect(result.scope).toBe('available_only');
        // What may be offered or ordered is unchanged: nothing for sale matches.
        expect(result.products).toEqual([]);
        expect(result.notForSale).toEqual([{ id: QA_ID, name: QA_NAME, stock: 0, isAvailable: false, inStock: false, soldOut: true }]);
        // Never priced: a sold-out product is not quoted.
        expect(result.notForSale[0]).not.toHaveProperty('price');
        expect(result.note).toContain(AVAILABLE_ONLY_NOTE);
        expect(result.note).toContain(NOT_FOR_SALE_MATCHES_NOTE);
        // Same words, the #200 "unavailable" predicate, a bounded read.
        expect(sql).toHaveBeenCalledTimes(2);
        const [first, ...firstParams] = sql.mock.calls[0];
        const [second, ...secondParams] = sql.mock.calls[1];
        expect(first).toContain('is_available = true');
        expect(second).toContain(UNAVAILABLE_SQL);
        expect(second).not.toContain('is_available = true');
        expect(secondParams.slice(0, -1)).toEqual(firstParams.slice(0, -1));
        expect(secondParams[secondParams.length - 1]).toBe(5);
    });

    it('a product for sale with stock 0 stays in products (inStock false) and is not repeated under notForSale', async () => {
        const taza = { id: TAZA_ID, name: 'Taza QA Agente', description: null, category: null, price: '9000', currency: 'COP', stock: 0, is_available: true };
        const result = await search(executor(storeTable([auroraRow, qaRow, taza])), { query: 'agente' });
        expect(result.products).toEqual([expect.objectContaining({ id: TAZA_ID, isAvailable: true, inStock: false, stock: 0 })]);
        expect(result.notForSale.map((p: any) => p.id)).toEqual([QA_ID]);
    });

    it('a name query for a product on sale is unchanged (no notForSale, the #200 note only)', async () => {
        const result = await search(executor(storeTable()), { query: 'audífono aurora' });
        expect(result.products).toEqual([expect.objectContaining({ id: AURORA_ID, isAvailable: true, inStock: true })]);
        expect(result).not.toHaveProperty('notForSale');
        expect(result.note).toBe(AVAILABLE_ONLY_NOTE);
    });

    it('a name that matches nothing at all is still an honest `empty`', async () => {
        const result = await search(executor(storeTable()), { query: 'cargador nova' });
        expect(result.status).toBe('empty');
        expect(result).not.toHaveProperty('notForSale');
    });

    it('a failed not-for-sale read costs only the hint, never the read', async () => {
        const sql = jest.fn().mockResolvedValueOnce([auroraRow]).mockRejectedValueOnce(new Error('boom'));
        const result = await search(executor(sql), { query: 'aurora' });
        expect(result.status).toBe('ok');
        expect(result.products).toHaveLength(1);
        expect(result).not.toHaveProperty('notForSale');
    });

    describe('#200 listing behaviour unchanged', () => {
        it('the whole catalogue (query "") reads once, products for sale only, no notForSale', async () => {
            const sql = storeTable();
            const result = await search(executor(sql), { query: '', limit: 20 });
            expect(sql).toHaveBeenCalledTimes(1);
            expect(result.products.map((p: any) => p.id)).toEqual([AURORA_ID]);
            expect(result).not.toHaveProperty('notForSale');
            expect(result.note).toBe(AVAILABLE_ONLY_NOTE);
        });

        it('availability "unavailable" (¿qué productos tienen agotados?) lists the QA product in products, once', async () => {
            const sql = storeTable();
            const result = await search(executor(sql), { query: '', limit: 20, availability: 'unavailable' });
            expect(sql).toHaveBeenCalledTimes(1);
            expect(result.scope).toBe('unavailable_only');
            expect(result.products).toEqual([expect.objectContaining({ id: QA_ID, isAvailable: false, inStock: false, stock: 0 })]);
            expect(result).not.toHaveProperty('notForSale');
        });

        it('availability "any" with a name reads once and lists the product with inStock false', async () => {
            const sql = storeTable();
            const result = await search(executor(sql), { query: 'QA Agente Stock', availability: 'any' });
            expect(sql).toHaveBeenCalledTimes(1);
            expect(result.products).toEqual([expect.objectContaining({ id: QA_ID, inStock: false })]);
            expect(result).not.toHaveProperty('notForSale');
        });
    });

    it('the tool description tells the model what notForSale means and that it is never offered', () => {
        const tool = CATALOG_TOOLS.find(t => t.name === 'search_products')!;
        expect(tool.description).toContain('notForSale');
        expect(tool.description).toMatch(/sold out \(never that it is not in the catalogue\)/);
        expect(tool.description).toMatch(/nor one listed under notForSale/);
    });

    it('the turn <catalog> scope line keeps the #200 text and points a named product to search_products', () => {
        const assembler = new PromptAssemblerService({ buildSystemPrompt: () => '' } as any);
        const xml = (assembler as any).buildTurnLayer({
            language: 'es', timezone: 'America/Bogota', catalogScope: 'available_only',
            catalog: [{ id: AURORA_ID, title: 'Audífono QA Aurora', price: 120000, currency: 'COP', inStock: true, stock: 5 }],
        }) as string;
        expect(xml).toMatch(/<scope>available_only: .*sold-out or withdrawn products are not.*availability "unavailable"/);
        expect(xml).toMatch(/A product the customer names that is not listed here may exist and be sold out: search_products by its name returns it under notForSale\.<\/scope>/);
    });
});

describe('F4300-29 residual output check: a product found under notForSale is not denied', () => {
    const read = { status: 'ok', scope: 'available_only', products: [], notForSale: [{ id: QA_ID, name: QA_NAME, stock: 0, isAvailable: false, inStock: false, soldOut: true }] };

    it.each([
        ['es', 'No, no tenemos el producto QA Agente Stock en nuestro catálogo. Solo está disponible el Audífono QA Aurora.', `Sí, ${QA_NAME} está en nuestro catálogo, pero en este momento está agotado y no está disponible para la venta.`],
        ['pt', 'Não, não temos o QA Agente Stock no nosso catálogo. Só temos o Audífono QA Aurora.', `Sim, ${QA_NAME} está no nosso catálogo, mas no momento está esgotado e não está disponível para venda.`],
        ['en', "Sorry, we don't have QA Agente Stock. Only the Audífono QA Aurora is available.", `Yes, ${QA_NAME} is in our catalogue, but it is sold out right now and not available for sale.`],
        ['es', 'El QA Agente Stock no está en nuestro catálogo.', `Sí, ${QA_NAME} está en nuestro catálogo, pero en este momento está agotado y no está disponible para la venta.`],
    ])('production-shaped denial (%s) is replaced by «exists, sold out»', (lang, reply, expected) => {
        const result = guardNotForSaleDenial({ reply, sources: [JSON.stringify(read)], lang });
        expect(result).toMatchObject({ replaced: true, product: QA_NAME });
        expect(result.text).toBe(expected);
        expect(result.text).not.toMatch(/Aurora/);
    });

    it.each([
        'Sí, el QA Agente Stock está en el catálogo, pero en este momento está agotado.',
        'Lo siento, el QA Agente Stock está agotado. ¿Le interesa el Audífono QA Aurora?',
        'No tenemos cargadores, pero el QA Agente Stock está agotado.',
    ])('a reply that says it is sold out stands: «%s»', reply => {
        expect(guardNotForSaleDenial({ reply, sources: [read], lang: 'es' })).toEqual({ text: reply, replaced: false });
    });

    it('a denial with no notForSale read in the turn is left to the other checks', () => {
        const reply = 'No, no tenemos el producto QA Agente Stock en nuestro catálogo.';
        const empty = { status: 'empty', scope: 'available_only', products: [] };
        expect(guardNotForSaleDenial({ reply, sources: [empty], lang: 'es' }).replaced).toBe(false);
        expect(guardNotForSaleDenial({ reply, sources: [{ ...read, stale: true }], lang: 'es' }).replaced).toBe(false);
    });
});

pinClock();
describe('F4300-29 residual through ConversationsService: a store asked for the sold-out product by name', () => {
    const usage = { model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 };
    const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    async function store(language: 'es' | 'pt', productionReply: string) {
        const data = executor(storeTable());
        const f = agentTurnFixture();
        f.personaService.getAgent.mockResolvedValue({ version: 5, config_json: { language, industry: 'retail', tools: { catalog: { enabled: true } }, rag: { enabled: false }, llm: {} } });
        publishTools(f, ['search_products', 'check_stock', 'get_product']);
        // The real search_products over the production rows.
        f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string, args: any) => {
            if (name !== 'search_products') return { error: `unexpected tool ${name}` };
            return search(data, args);
        });
        let n = 0;
        // The model searches by the name, then gives the production reply.
        f.llmRouter.execute.mockImplementation(async (request: any) => {
            if (!['conversation', 'tool_calling'].includes(request.task)) return { ...usage, content: '{}' };
            const messages = request.messages ?? [];
            if (request.tools && !messages.some((m: any) => m.role === 'tool' && String(m.content).includes('notForSale'))) {
                return { ...usage, content: '', toolCalls: [{ id: `c${++n}`, type: 'function', function: { name: 'search_products', arguments: JSON.stringify({ query: 'QA Agente Stock' }) } }] };
            }
            return { ...usage, content: productionReply };
        });
        return { f, turn: (message: string) => f.service.test('tenant', AGENT, { message, channelType: 'telegram' }, { agentSnapshot: undefined }) };
    }
    const toolMessages = (f: any) => f.llmRouter.execute.mock.calls
        .flatMap((c: any[]) => (c[0].messages ?? []).filter((m: any) => m?.role === 'tool').map((m: any) => String(m.content))).join('\n');

    it.each([
        ['es', 'tienen el QA Agente Stock?', 'No, no tenemos el producto QA Agente Stock en nuestro catálogo. Solo está disponible el Audífono QA Aurora.', /está agotado/],
        ['pt', 'vocês têm o QA Agente Stock?', 'Não, não temos o QA Agente Stock no nosso catálogo. Só está disponível o Audífono QA Aurora.', /está esgotado/],
    ])('(%s) «%s»: the model sees the product marked sold out, and the denial does not reach the customer', async (language, question, productionReply, soldOut) => {
        const h = await store(language as 'es' | 'pt', productionReply);
        const r = await h.turn(question);
        expect(r.debug.runtimeError).toBeUndefined();
        const tools = toolMessages(h.f);
        expect(tools).toContain('"notForSale"');
        expect(tools).toContain('"soldOut":true');
        expect(tools).toContain(QA_NAME);
        expect(r.reply).toContain(QA_NAME);
        expect(r.reply).toMatch(soldOut);
        expect(r.reply).not.toMatch(/no tenemos|não temos|Aurora/);
    });

    it('a reply that already says it is sold out stands', async () => {
        const reply = 'El QA Agente Stock está en nuestro catálogo, pero en este momento está agotado.';
        const h = await store('es', reply);
        const r = await h.turn('tienen el QA Agente Stock?');
        expect(r.reply).toContain('en este momento está agotado');
        expect(r.reply).not.toMatch(/^Sí, QA Agente Stock 2026/);
    });
});
