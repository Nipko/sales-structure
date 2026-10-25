import { getOperation } from '@parallext/shared';
import { isPastOrdersQuestion, lexicalRequiredReadsOperation } from './operation-lexical-cues';
import { pickReceiptId, requiredReadsGate, requiredReadsPlan, runRequiredReads } from './required-reads.runner';

/**
 * F4300-11 (production QA 2026-10-25, restaurant tenant, required reads on): «qué pedí la última vez?» read list_my_orders only
 * and the reply said «No tengo detalles específicos de los ítems que pidió». list_my_orders carries `itemCount`, not the items:
 * the order 5603A623 holds «Spark QA Plato», which only check_order_status returns. A question about the customer's own past
 * orders now reads the newest order's detail too, in Spanish, English, Portuguese and French.
 */
const op = (key: string) => {
    const operation = getOperation(key);
    if (!operation) throw new Error(`missing operation ${key}`);
    return operation;
};

const QUESTIONS: Array<[string, string]> = [
    ['es', 'qué pedí la última vez?'],
    ['es', '¿cuáles son mis pedidos?'],
    ['es', '¿qué compré la última vez?'],
    ['es', 'cuál fue mi último pedido'],
    ['en', 'what did I buy last time?'],
    ['en', "I'm not asking you to confirm anything, I just want to know what I purchased last time."],
    ['en', 'what did I order last time?'],
    ['en', 'show me my orders'],
    ['pt', 'o que eu pedi da última vez?'],
    ['pt', 'o que comprei da última vez?'],
    ['pt', 'quais são meus pedidos?'],
    ['fr', "qu'est-ce que j'ai commandé la dernière fois ?"],
    ['fr', "qu'est-ce que j'ai acheté la dernière fois ?"],
    ['fr', 'quelles sont mes commandes ?'],
];

const NOT_QUESTIONS: string[] = [
    'cancela mi último pedido',
    'cancel my last order',
    'quiero pedir lo mismo otra vez',
    'repeat what I ordered last time',
    'quero pagar meu último pedido',
    'je veux annuler ma dernière commande',
    'cuánto cuesta el plato Spark?',
    'what time do you open?',
];

describe('F4300-11: a question about the customer\'s own past orders', () => {
    it.each(QUESTIONS)('[%s] «%s» is a past-orders question', (_lang, text) => {
        expect(isPastOrdersQuestion(text)).toBe(true);
    });

    it.each(NOT_QUESTIONS)('«%s» is not (an action on the orders, or another topic)', text => {
        expect(isPastOrdersQuestion(text)).toBe(false);
    });

    it.each(QUESTIONS)('[%s] «%s» names the orders operation of the restaurant and of the store', (_lang, text) => {
        expect(lexicalRequiredReadsOperation(text, 'restaurants', ['get_menu', 'list_my_orders', 'check_order_status'])).toBe('check_my_orders');
        expect(lexicalRequiredReadsOperation(text, 'catalog', ['search_products', 'list_my_catalog_orders', 'get_catalog_order'])).toBe('track_catalog_order');
        // Only when the turn publishes the read.
        expect(lexicalRequiredReadsOperation(text, 'restaurants', ['get_menu'])).toBeNull();
    });

    it('the classifier\'s FAQ intent does not keep the turn from its reads', () => {
        const gate = requiredReadsGate({ version: 1, operationKey: 'ask_question', confidence: 0.9, fallback: null, candidates: ['ask_question'], latencyMs: 3 },
            'restaurants', lexicalRequiredReadsOperation('qué pedí la última vez?', 'restaurants', ['list_my_orders', 'check_order_status']));
        expect(gate.run && gate.operation.key).toBe('check_my_orders');
    });
});

describe('F4300-11: «what did I order?» reads what the newest order held', () => {
    it.each(QUESTIONS)('[%s] «%s»: check_my_orders plans list_my_orders and check_order_status', (_lang, text) => {
        expect(requiredReadsPlan(op('check_my_orders'), {}, text).map(read => read.tool)).toEqual(['list_my_orders', 'check_order_status']);
    });

    it('any other orders question keeps the catalogue\'s reads', () => {
        expect(requiredReadsPlan(op('check_my_orders'), {}, '¿cómo va mi pedido?').map(read => read.tool)).toEqual(['list_my_orders']);
        expect(requiredReadsPlan(op('check_my_orders')).map(read => read.tool)).toEqual(['list_my_orders']);
    });

    it('the newest order is the one a past-orders question reads, whatever its status', () => {
        const ref = { tool: 'list_my_orders', container: 'orders', field: 'id' };
        const result = { orders: [
            { id: 'older', status: 'cancelled', createdAt: '2026-10-01T10:00:00Z' },
            { id: 'newest', status: 'cancelled', createdAt: '2026-10-20T10:00:00Z' },
            { id: 'middle', status: 'delivered', createdAt: '2026-10-10T10:00:00Z' },
        ] };
        expect(pickReceiptId(result, ref)).toEqual({ reason: 'ambiguous_receipt' });
        expect(pickReceiptId(result, ref, 'qué pedí la última vez?', { newest: true })).toEqual({ id: 'newest' });
        // without dates: the reader's own order (newest first)
        expect(pickReceiptId({ orders: [{ id: 'a', status: 'cancelled' }, { id: 'b', status: 'cancelled' }] }, ref, '', { newest: true })).toEqual({ id: 'a' });
    });

    const ORDER_ID = '5603a623-1b2c-4d5e-8f90-123456789abc';
    const io = (orders: any[], customerText: string) => {
        const calls: Array<{ name: string; args: any }> = [];
        return {
            calls,
            io: {
                publishedTools: ['list_my_orders', 'check_order_status'],
                alreadyRead: [],
                projectedContexts: [],
                customerText,
                execute: async (name: string, args: any) => {
                    calls.push({ name, args });
                    if (name === 'list_my_orders') return { orders };
                    return { id: args.orderId, status: 'cancelled', total: 13500, currency: 'COP', items: [{ name: 'Spark QA Plato', quantity: 1, unitPrice: 13500 }] };
                },
            },
        };
    };

    it('production: one cancelled order — its detail (the dish) is read before the model', async () => {
        const h = io([{ id: ORDER_ID, status: 'cancelled', paymentStatus: 'pending', total: 13500, currency: 'COP', itemCount: 1, createdAt: '2026-10-20T10:00:00Z' }], 'qué pedí la última vez?');
        const run = await runRequiredReads(op('check_my_orders'), h.io);
        expect(h.calls.map(call => call.name)).toEqual(['list_my_orders', 'check_order_status']);
        expect(h.calls[1].args).toEqual({ orderId: ORDER_ID });
        expect(run.results.find(read => read.name === 'check_order_status')?.result.items[0].name).toBe('Spark QA Plato');
    });

    it.each(QUESTIONS)('[%s] «%s» with three closed orders: the newest one\'s detail is read', async (_lang, text) => {
        const h = io([
            { id: 'newest-0000', status: 'cancelled', createdAt: '2026-10-20T10:00:00Z' },
            { id: 'middle-0000', status: 'delivered', createdAt: '2026-10-10T10:00:00Z' },
            { id: 'oldest-0000', status: 'cancelled', createdAt: '2026-10-01T10:00:00Z' },
        ], text);
        const run = await runRequiredReads(op('check_my_orders'), h.io);
        expect(run.reads.map(read => [read.tool, read.status])).toEqual([['list_my_orders', 'read'], ['check_order_status', 'read']]);
        expect(h.calls[1].args).toEqual({ orderId: 'newest-0000' });
    });

    it('a status question about several closed orders stays ambiguous for track_food_order (no newest guess)', async () => {
        const h = io([
            { id: 'newest-0000', status: 'cancelled', createdAt: '2026-10-20T10:00:00Z' },
            { id: 'oldest-0000', status: 'cancelled', createdAt: '2026-10-01T10:00:00Z' },
        ], '¿en qué va mi pedido?');
        const run = await runRequiredReads(op('track_food_order'), h.io);
        expect(run.reads.find(read => read.tool === 'check_order_status')?.status).toBe('ambiguous_receipt');
    });
});
