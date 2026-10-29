import { AIToolExecutorService } from './ai-tool-executor.service';
import { guardNotForSaleDenial } from './sold-out-visibility';
import { authorityFor } from './__fixtures__/tool-authority.fixture';
import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { pinClock } from './__fixtures__/pinned-clock';

/**
 * F4300-29, second residual (production 2026-10-24 on eee1d8a9, which includes #204, 5/5). «tienen el QA Agente Stock?», «vocês têm o
 * QA Agente Stock?», «do you have the QA Agente Stock?», «avez-vous le QA Agente Stock ?», «me vendes el QA Agente Stock?» were still
 * answered «No, no tenemos el producto QA Agente Stock… Solo está disponible el Audífono QA Aurora». The trace shows search_products
 * ran only as the AUTOMATIC read before the model (the product name holds «Stock», so the stock pre-read ran with `query: ''`); the
 * model never called it. #204's not-for-sale read only ran for a name query, so the automatic read carried no `notForSale`, and the
 * denial guard had nothing to compare the reply with.
 */
const schemaName = 'tenant_store';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const QA_ID = 'e6ef6f14-7125-4bcf-99f5-72bf10b7abc3';
const AURORA_ID = 'b46c1e0c-c71b-4837-8f30-048e94bba422';
const QA_NAME = 'QA Agente Stock 20261020T1737Z';
const qaRow = { id: QA_ID, name: QA_NAME, description: 'Producto sintético exclusivo de QA', category: null, price: '18777', currency: 'COP', stock: 0, is_available: false };
const auroraRow = { id: AURORA_ID, name: 'Audífono QA Aurora', description: null, category: 'audio', price: '120000', currency: 'COP', stock: 5, is_available: true };
const UNAVAILABLE_SQL = '(is_available IS NOT TRUE OR (stock IS NOT NULL AND stock <= 0))';

/** The five production messages, with the production-shaped denial the model gave to each. */
const PRODUCTION: Array<[string, string, string]> = [
    ['es', 'tienen el QA Agente Stock?', 'No, no tenemos el producto QA Agente Stock en nuestro catálogo. Solo está disponible el Audífono QA Aurora.'],
    ['pt', 'vocês têm o QA Agente Stock?', 'Não, não temos o QA Agente Stock no nosso catálogo. Só está disponível o Audífono QA Aurora.'],
    ['en', 'do you have the QA Agente Stock?', "No, we don't have the QA Agente Stock in our catalog. Only the Audífono QA Aurora is available."],
    ['fr', 'avez-vous le QA Agente Stock ?', "Non, nous n'avons pas le QA Agente Stock dans notre catalogue. Seul l'Audífono QA Aurora est disponible."],
    ['es', 'me vendes el QA Agente Stock?', 'No, no tenemos el producto QA Agente Stock en nuestro catálogo. Solo está disponible el Audífono QA Aurora.'],
];

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
const fold = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** The JavaScript twin of the SQL «mentioned» rule (the PostgreSQL spec runs the SQL itself). */
const mentions = (name: string, message: string) => {
    const words = (fold(name).match(/[a-z0-9]+/g) ?? []).filter(w => w.length >= 3 && !/[0-9]/.test(w));
    const text = ` ${fold(message).replace(/[^a-z0-9]+/g, ' ')} `;
    return words.length > 0 && words.every(w => text.includes(` ${w}`));
};

/** A store whose catalogue is Aurora (for sale) and the QA product (not for sale), answering by the SQL it receives. */
function storeTable(rows: any[] = [auroraRow, qaRow]) {
    return jest.fn(async (sql: string, ...params: any[]) => {
        const strings = params.filter(p => typeof p === 'string');
        if (sql.includes(UNAVAILABLE_SQL) && sql.includes('bool_and')) {
            const message = strings[strings.length - 1];
            const words = strings.slice(0, -1).map(p => p.replace(/%/g, ''));
            return rows.filter(row => (row.is_available !== true || (row.stock != null && row.stock <= 0))
                && (mentions(row.name, message) || (words.length > 0 && words.every(w => fold(row.name).includes(w)))));
        }
        const words = strings.map(p => p.replace(/%/g, ''));
        const matches = rows.filter(row => words.every(w => fold(`${row.name} ${row.description ?? ''} ${row.category ?? ''}`).includes(w)));
        if (sql.includes(UNAVAILABLE_SQL)) return matches.filter(row => row.is_available !== true || (row.stock != null && row.stock <= 0));
        if (sql.includes('is_available = true')) return matches.filter(row => row.is_available === true);
        return matches;
    });
}
const search = (service: AIToolExecutorService, args: Record<string, unknown>, customerText?: string) =>
    service.execute(schemaName, tenantId, contactId, 'search_products', args, conversationId,
        { authority: authorityFor('search_products'), ...(customerText !== undefined ? { customerText } : {}) }) as Promise<any>;

describe('F4300-29 automatic read: the browse the store runs before the model carries the named product not for sale', () => {
    it.each(PRODUCTION)('(%s) «%s»: search_products {query:"", limit:20} with the message returns it under notForSale', async (_lang, message) => {
        const sql = storeTable();
        const result = await search(executor(sql), { query: '', limit: 20 }, message);
        expect(result.status).toBe('ok');
        expect(result.scope).toBe('available_only');
        // What may be offered is unchanged: the for-sale list.
        expect(result.products.map((p: any) => p.id)).toEqual([AURORA_ID]);
        expect(result.notForSale).toEqual([{ id: QA_ID, name: QA_NAME, stock: 0, isAvailable: false, inStock: false, soldOut: true, description: 'Producto sintético exclusivo de QA' }]);
        expect(result.note).toMatch(/notForSale .*DO exist/);
        // The second read: the #200 "unavailable" predicate, the «mentioned» rule, the message as a bound parameter.
        expect(sql).toHaveBeenCalledTimes(2);
        const [second, ...params] = sql.mock.calls[1];
        expect(second).toContain(UNAVAILABLE_SQL);
        expect(second).toContain('regexp_split_to_array');
        expect(second).toContain("word !~ '[0-9]'");
        expect(second).not.toContain(message);
        expect(params).toEqual([message, 5]);
    });

    it('the message is never taken from the model: args.customerText is ignored', async () => {
        const sql = storeTable();
        const result = await search(executor(sql), { query: '', limit: 20, customerText: 'tienen el QA Agente Stock?' });
        expect(sql).toHaveBeenCalledTimes(1);
        expect(result).not.toHaveProperty('notForSale');
    });

    it('a message that names no product not for sale adds nothing (the read stays as before)', async () => {
        for (const message of ['tienen audífonos?', 'hola, buenas tardes', 'tienen el agente?']) {
            const result = await search(executor(storeTable()), { query: '', limit: 20 }, message);
            expect(result).not.toHaveProperty('notForSale');
            expect(result.products.map((p: any) => p.id)).toEqual([AURORA_ID]);
        }
    });

    it('a name query with the message finds the product by either path, once', async () => {
        const result = await search(executor(storeTable()), { query: 'QA Agente Stock' }, 'tienen el QA Agente Stock?');
        expect(result.notForSale.map((p: any) => p.id)).toEqual([QA_ID]);
    });

    it('the sold-out listing (availability "unavailable") is unchanged by the message', async () => {
        const sql = storeTable();
        const result = await search(executor(sql), { query: '', limit: 20, availability: 'unavailable' }, '¿qué productos tienen agotados?');
        expect(sql).toHaveBeenCalledTimes(1);
        expect(result.scope).toBe('unavailable_only');
        expect(result.products.map((p: any) => p.id)).toEqual([QA_ID]);
        expect(result).not.toHaveProperty('notForSale');
    });
});

describe('F4300-29 denial guard: every read of the turn that shows the product not for sale', () => {
    it.each(PRODUCTION)('(%s) «%s»: the production reply is replaced when the automatic read carries notForSale', (lang, _message, reply) => {
        const read = { status: 'ok', scope: 'available_only', products: [{ id: AURORA_ID, name: 'Audífono QA Aurora', isAvailable: true, inStock: true }],
            notForSale: [{ id: QA_ID, name: QA_NAME, stock: 0, isAvailable: false, inStock: false, soldOut: true }] };
        const result = guardNotForSaleDenial({ reply, sources: [JSON.stringify(read)], lang });
        expect(result).toMatchObject({ replaced: true, product: QA_NAME });
        expect(result.text).not.toMatch(/Aurora/);
    });

    it('a sold-out list (scope unavailable_only) or a row marked not for sale backs it too', () => {
        const reply = 'No, no tenemos el producto QA Agente Stock en nuestro catálogo.';
        const soldOutList = { status: 'ok', scope: 'unavailable_only', products: [{ id: QA_ID, name: QA_NAME, isAvailable: false, inStock: false, stock: 0 }] };
        const anyRead = { status: 'ok', scope: 'all', products: [{ id: QA_ID, name: QA_NAME, isAvailable: false, inStock: false }] };
        expect(guardNotForSaleDenial({ reply, sources: [soldOutList], lang: 'es' }).replaced).toBe(true);
        expect(guardNotForSaleDenial({ reply, sources: [anyRead], lang: 'es' }).replaced).toBe(true);
    });

    it('a product for sale in the read does not make a denial of another product a contradiction', () => {
        const read = { status: 'ok', scope: 'available_only', products: [{ id: AURORA_ID, name: 'Audífono QA Aurora', isAvailable: true, inStock: true }] };
        expect(guardNotForSaleDenial({ reply: 'No, no tenemos el producto QA Agente Stock.', sources: [read], lang: 'es' }).replaced).toBe(false);
    });

    it('«nous ne l’avons pas» is a denial too', () => {
        const read = { status: 'ok', products: [], notForSale: [{ id: QA_ID, name: QA_NAME, isAvailable: false, inStock: false, soldOut: true }] };
        expect(guardNotForSaleDenial({ reply: 'Désolé, nous ne l’avons pas, le QA Agente Stock.', sources: [read], lang: 'fr' }).replaced).toBe(true);
    });
});

pinClock();
describe('F4300-29 through ConversationsService: the five production messages, the model calls no tool', () => {
    const usage = { model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 };
    const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    function store(language: string, productionReply: string) {
        const data = executor(storeTable());
        const f = agentTurnFixture();
        f.personaService.getAgent.mockResolvedValue({ version: 5, config_json: { language, industry: 'retail', tools: { catalog: { enabled: true } }, rag: { enabled: false }, llm: {} } });
        publishTools(f, ['search_products', 'check_stock', 'get_product', 'place_catalog_order']);
        // The real search_products over the production rows, with what the server passed in opts.
        f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string, args: any, _id: any, opts: any) => {
            if (name !== 'search_products') return { status: 'empty', product: null };
            return search(data, args, opts?.customerText);
        });
        // As in production: the model answers from what the turn read, without calling a tool.
        f.llmRouter.execute.mockImplementation(async (request: any) => {
            if (!['conversation', 'tool_calling'].includes(request.task)) return { ...usage, content: '{}' };
            return { ...usage, content: productionReply };
        });
        return { f, turn: (message: string) => f.service.test('tenant', AGENT, { message, channelType: 'telegram' }, { agentSnapshot: undefined }) };
    }

    it.each(PRODUCTION)('(%s) «%s»: the automatic read carries notForSale and the denial does not reach the customer', async (language, message, productionReply) => {
        const h = store(language, productionReply);
        const r = await h.turn(message);
        expect(r.debug.runtimeError).toBeUndefined();
        const reads = h.f.toolExecutor.execute.mock.calls.filter((c: any[]) => c[3] === 'search_products');
        expect(reads.length).toBeGreaterThan(0);
        // Every automatic search_products read got the customer's message from the server.
        for (const call of reads) expect(call[6]?.customerText).toBe(message);
        // The model was not the one reading: no tool call came from it.
        const modelMessages = h.f.llmRouter.execute.mock.calls.find((c: any[]) => ['conversation', 'tool_calling'].includes(c[0].task))![0].messages;
        const toolText = modelMessages.filter((m: any) => m?.role === 'tool').map((m: any) => String(m.content)).join('\n');
        expect(toolText).toContain('"notForSale"');
        expect(toolText).toContain(QA_NAME);
        expect(r.reply).toContain(QA_NAME);
        expect(r.reply).not.toMatch(/no tenemos|não temos|don't have|n'avons pas|Aurora/);
    });
});
