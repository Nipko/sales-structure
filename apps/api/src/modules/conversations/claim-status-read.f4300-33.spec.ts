import { auditTurnClaim, claimsCompletedAction } from '../../common/utils/outcome-claim.util';
import { ConversationsService } from './conversations.service';
import { isBusinessWriteTool } from './tool-policy-registry';
import { knownRecordFacts, toolReadsOfTurnMessages } from './transition-engine';

/**
 * F4300-33 (restaurant, flag agentRuntime.requiredReads.restaurants on): «¿en qué va mi último pedido?». The runtime ran
 * list_my_orders + check_order_status BEFORE the model (required reads), both OK, the order 5603A623 CANCELLED. The reply
 * reported that status and the customer got «No puedo darle esa acción por confirmada…»: the required reads reach the model
 * only as tool messages, so the claim audit saw no record read at all, and a passive «fue cancelado» was a deed whatever
 * was read. A status obtained from a read of this turn is a report; the agent claiming it cancelled is still a claim.
 */
const ORDER_ID = '5603a623-1b2c-4d5e-8f90-123456789abc';
const OTHER_ID = 'c03ebdd7-1b2c-4d5e-8f90-123456789abc';
const isBackingTool = (name: string) => isBusinessWriteTool(name);

const listMyOrders = { orders: [{ id: ORDER_ID, status: 'cancelled', paymentStatus: 'pending', orderType: 'pickup', total: 13500, currency: 'COP', itemCount: 1 }], total: 1 };
const checkOrderStatus = { id: ORDER_ID, status: 'cancelled', paymentStatus: 'pending', orderType: 'pickup', total: 13500, currency: 'COP',
    items: [{ name: 'Spark QA Plato', quantity: 1, unitPrice: 13500 }] };

/** The thread as the model saw it: the customer's message, then the required reads as synthetic tool messages. */
function turnMessages(question: string, reads: Array<{ name: string; result: any }> = [
    { name: 'list_my_orders', result: listMyOrders }, { name: 'check_order_status', result: checkOrderStatus },
]) {
    return [
        { role: 'user', content: 'hola' },
        { role: 'assistant', content: 'Hola, ¿en qué le puedo ayudar?' },
        { role: 'user', content: question },
        ...reads.flatMap((read, index) => [
            { role: 'assistant', content: '', toolCalls: [{ id: `required_read_${index}`, type: 'function', function: { name: read.name, arguments: '{}' } }] },
            { role: 'tool', toolCallId: `required_read_${index}`, content: JSON.stringify(read.result) },
        ]),
    ];
}

const REPORTS: Array<[string, string, string]> = [
    ['es', 'en qué va mi último pedido?', 'Su último pedido 5603A623 fue cancelado.'],
    ['es', 'en qué va mi último pedido?', 'Su último pedido está cancelado.'],
    ['es', 'en qué va mi último pedido?', 'Su pedido de Spark QA Plato fue cancelado, por eso no se preparará.'],
    ['en', 'what is the status of my last order?', 'Your last order was cancelled.'],
    ['en', 'what is the status of my last order?', 'Your order has been cancelled, so it will not be prepared.'],
    ['pt', 'como está meu último pedido?', 'Seu último pedido 5603A623 foi cancelado.'],
    ['pt', 'como está meu último pedido?', 'Seu pedido está cancelado.'],
];

const CLAIMS: Array<[string, string, string]> = [
    ['es', 'cancela mi pedido', 'Ya cancelé su pedido 5603A623.'],
    ['es', 'cancela mi pedido', 'He cancelado su pedido 5603A623.'],
    ['es', 'cancela mi pedido', 'Su pedido 5603A623 quedó cancelado.'],
    ['en', 'cancel my order', "I've cancelled your order 5603A623."],
    ['en', 'cancel my order', 'I cancelled your order 5603A623.'],
    ['pt', 'cancela meu pedido', 'Cancelei o seu pedido 5603A623.'],
    ['pt', 'cancela meu pedido', 'Já cancelei a sua encomenda 5603A623.'],
];

describe('F4300-33: the reads of the turn reach the claim audit', () => {
    it('the required reads handed to the model as tool messages are read back, the earlier turns are not', () => {
        const messages = [
            { role: 'user', content: 'antes' },
            { role: 'assistant', content: '', toolCalls: [{ id: 'old', type: 'function', function: { name: 'list_my_orders', arguments: '{}' } }] },
            { role: 'tool', toolCallId: 'old', content: JSON.stringify({ orders: [{ id: OTHER_ID, status: 'cancelled' }] }) },
            ...turnMessages('en qué va mi último pedido?').slice(2),
        ];
        expect(toolReadsOfTurnMessages(messages).map(read => read.name)).toEqual(['list_my_orders', 'check_order_status']);
        // a failed read is not a record
        expect(toolReadsOfTurnMessages(turnMessages('x', [{ name: 'check_order_status', result: { error: 'read_failed' } }]))).toEqual([]);
    });

    it('check_order_status (the order at the root) is a record with its reference and its products', () => {
        expect(knownRecordFacts([{ name: 'check_order_status', result: checkOrderStatus }]))
            .toEqual([{ status: 'cancelled', tokens: ['5603A623', 'Spark QA Plato'] }]);
    });
});

describe('F4300-33: a status read this turn is a report, in es / en / pt', () => {
    const facts = knownRecordFacts(toolReadsOfTurnMessages(turnMessages('en qué va mi último pedido?')));

    it.each(REPORTS)('[%s] «%s» → «%s» is not a claim', (_lang, _question, reply) => {
        expect(claimsCompletedAction(reply)).toBe(true);
        expect(auditTurnClaim(reply, [], { isBackingTool, recordFacts: facts }).falseClaim).toBe(false);
    });

    it.each(CLAIMS)('[%s] «%s» → «%s» is the agent claiming the deed: still a false claim', (_lang, _question, reply) => {
        expect(auditTurnClaim(reply, [], { isBackingTool, recordFacts: facts }).falseClaim).toBe(true);
        // backed by the cancel receipt it is true
        expect(auditTurnClaim(reply, [{ name: 'cancel_order', result: { success: true, orderId: ORDER_ID } }], { isBackingTool, recordFacts: facts }).falseClaim).toBe(false);
    });

    it('the status is excused only for what was read: another status, another record or nothing read stays a claim', () => {
        const pending = knownRecordFacts([{ name: 'check_order_status', result: { ...checkOrderStatus, status: 'pending' } }]);
        expect(auditTurnClaim('Su último pedido fue cancelado.', [], { isBackingTool, recordFacts: pending }).falseClaim).toBe(true);
        expect(auditTurnClaim('Your order was cancelled.', [], { isBackingTool, recordFacts: [] }).falseClaim).toBe(true);
        // two orders read, one cancelled: a sentence naming no reference may be about either
        const two = knownRecordFacts([{ name: 'list_my_orders', result: { orders: [listMyOrders.orders[0], { id: OTHER_ID, status: 'pending' }] } }]);
        expect(auditTurnClaim('Seu pedido foi cancelado.', [], { isBackingTool, recordFacts: two }).falseClaim).toBe(true);
        expect(auditTurnClaim('Seu pedido 5603A623 foi cancelado.', [], { isBackingTool, recordFacts: two }).falseClaim).toBe(false);
        expect(auditTurnClaim('Seu pedido C03EBDD7 foi cancelado.', [], { isBackingTool, recordFacts: two }).falseClaim).toBe(true);
    });
});

describe('F4300-33: applyOutputGuardrails keeps the status report and still replaces the claim', () => {
    function service() {
        const s: any = Object.create(ConversationsService.prototype);
        s.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
        s.eventEmitter = { emit: jest.fn() };
        s.recordAgentSignal = jest.fn();
        s.alignReplyLanguage = jest.fn(async (reply: string) => reply);
        s.responseValidator = { validatePrices: jest.fn(() => ({ ok: true, hallucinatedPrices: [] })) };
        return s;
    }
    const guard = (s: any, reply: string, question: string, lang: string) => {
        // the corrective rewrite insists, as in production: without the fix the customer gets the fixed fallback
        s.llmRouter = { execute: jest.fn(async () => ({ content: reply, model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 })) };
        return s.applyOutputGuardrails(reply, '', turnMessages(question), [], 'synthetic-tenant', 'synthetic-conversation', [], lang, [], {});
    };
    const FALLBACK = /No puedo darle esa acción por confirmada|I cannot treat that as done|Não posso considerar isso concluído/;

    it.each(REPORTS)('[%s] «%s» → «%s» is sent as written', async (lang, question, reply) => {
        const s = service();
        const out = await guard(s, reply, question, lang);
        expect(out).toBe(reply);
        expect(out).not.toMatch(FALLBACK);
        expect(s.recordAgentSignal).not.toHaveBeenCalledWith('synthetic-tenant', 'claim_unbacked', undefined);
    });

    it.each(CLAIMS)('[%s] «%s» → «%s» without a cancel receipt is replaced', async (lang, question, reply) => {
        const s = service();
        const out = await guard(s, reply, question, lang);
        expect(out).toMatch(FALLBACK);
        expect(s.recordAgentSignal).toHaveBeenCalledWith('synthetic-tenant', 'claim_unbacked', undefined);
    });
});
