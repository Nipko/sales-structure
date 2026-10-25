import { auditTurnClaim, mentionsCancellation } from '../../common/utils/outcome-claim.util';
import { ConversationsService } from './conversations.service';
import { isBusinessWriteTool } from './tool-policy-registry';
import { knownRecordFacts, toolReadsOfTurnMessages } from './transition-engine';

/**
 * F4300-33 follow-up (25-oct, after #205; restaurant, flag agentRuntime.requiredReads.restaurants on): «ya llegó mi pedido?» →
 * list_my_orders + check_order_status as required reads, order 5603A623 CANCELLED, and the customer again got «No puedo darle
 * esa acción por confirmada…». The negated / not-yet delivery («no ha llegado», «not delivered yet») never was a claim; what
 * still read as one was the way Spanish says the status: «no ha llegado porque quedó cancelado» — «quedó» was kept as a deed
 * whatever was read. Now:
 *   - a cancelled or delivered status of a record read this turn is a report in its state, passive or settled («quedó»,
 *     «ficou») form, unless the customer asked this turn to cancel (then «quedó cancelado» answers the request as done);
 *   - a delivery stated as done is detected («su pedido fue entregado / ya llegó», «has been delivered», «foi entregue»,
 *     «a été livrée») and excused only by a record read as delivered;
 *   - the agent as the doer («ya le entregamos su pedido», «we delivered your order», «entregamos o seu pedido», «nous avons
 *     livré votre commande») stays a claim whatever was read.
 */
const ORDER_ID = '5603a623-1b2c-4d5e-8f90-123456789abc';
const isBackingTool = (name: string) => isBusinessWriteTool(name);

const order = (status: string) => ({
    list: { orders: [{ id: ORDER_ID, status, paymentStatus: 'pending', orderType: 'delivery', total: 13500, currency: 'COP', itemCount: 1 }], total: 1 },
    check: { id: ORDER_ID, status, paymentStatus: 'pending', orderType: 'delivery', total: 13500, currency: 'COP',
        items: [{ name: 'Spark QA Plato', quantity: 1, unitPrice: 13500 }] },
});

/** The production turn: the customer's question, then the two required reads as synthetic tool messages. */
function turnMessages(question: string, status: string) {
    const { list, check } = order(status);
    return [
        { role: 'user', content: question },
        { role: 'assistant', content: '', toolCalls: [{ id: 'required_read_0', type: 'function', function: { name: 'list_my_orders', arguments: '{}' } }] },
        { role: 'tool', toolCallId: 'required_read_0', content: JSON.stringify(list) },
        { role: 'assistant', content: '', toolCalls: [{ id: 'required_read_1', type: 'function', function: { name: 'check_order_status', arguments: JSON.stringify({ orderId: ORDER_ID }) } }] },
        { role: 'tool', toolCallId: 'required_read_1', content: JSON.stringify(check) },
    ];
}
const factsOf = (question: string, status: string) => knownRecordFacts(toolReadsOfTurnMessages(turnMessages(question, status)));
const audit = (reply: string, question: string, status: string | null) => auditTurnClaim(reply, [], {
    isBackingTool, recordFacts: status ? factsOf(question, status) : [], customerRequestedCancellation: mentionsCancellation(question),
}).falseClaim;

const ARRIVED = { es: 'ya llegó mi pedido?', en: 'has my order arrived?', pt: 'meu pedido já chegou?', fr: 'ma commande est arrivée ?' };

/** Replies reporting the CANCELLED order that was read, with negated / not-yet delivery. */
const CANCELLED_REPORTS: Array<[keyof typeof ARRIVED, string]> = [
    ['es', 'No, su pedido 5603A623 no ha llegado porque quedó cancelado.'],
    ['es', 'Su pedido aún no ha llegado: quedó cancelado.'],
    ['es', 'Su pedido no fue entregado porque fue cancelado.'],
    ['es', 'Su pedido 5603A623 está cancelado, por lo que no será entregado.'],
    ['en', 'Your order 5603A623 has not been delivered yet: it was cancelled.'],
    ['en', 'Your order is not delivered yet because it was cancelled.'],
    ['pt', 'Seu pedido ainda não foi entregue: ele foi cancelado.'],
    ['pt', 'Seu pedido 5603A623 não chegou porque ficou cancelado.'],
    ['fr', "Votre commande n'est pas encore arrivée : elle a été annulée."],
    ['fr', "Votre commande 5603A623 n'a pas été livrée, elle a été annulée."],
];

/** Replies reporting a DELIVERED order that was read. */
const DELIVERED_REPORTS: Array<[keyof typeof ARRIVED, string]> = [
    ['es', 'Sí, su pedido 5603A623 ya fue entregado.'],
    ['es', 'Su pedido ya llegó.'],
    ['en', 'Your order has been delivered.'],
    ['pt', 'Seu pedido já foi entregue.'],
    ['fr', 'Votre commande a été livrée.'],
];

/** The agent as the doer of the delivery: a claim whatever was read. */
const DOER_CLAIMS: Array<[keyof typeof ARRIVED, string]> = [
    ['es', 'Ya le entregamos su pedido.'],
    ['es', 'Hemos entregado su pedido 5603A623.'],
    ['en', 'We delivered your order this afternoon.'],
    ['pt', 'Entregamos o seu pedido hoje.'],
    ['fr', 'Nous avons livré votre commande.'],
];

describe('F4300-33 follow-up: «¿ya llegó mi pedido?» with the order read as cancelled', () => {
    it.each(CANCELLED_REPORTS)('[%s] «%s» reports the status read: not a claim', (lang, reply) => {
        expect(audit(reply, ARRIVED[lang], 'cancelled')).toBe(false);
    });

    it('a not-yet delivery is no claim even with nothing read', () => {
        for (const reply of ['Su pedido aún no ha llegado.', 'Your order has not been delivered yet.', 'Seu pedido ainda não foi entregue.', "Votre commande n'est pas encore arrivée."]) {
            expect(audit(reply, 'ya llegó mi pedido?', null)).toBe(false);
        }
    });

    it.each(DELIVERED_REPORTS)('[%s] «%s» about an order read as CANCELLED is an invented delivery: a claim', (lang, reply) => {
        expect(audit(reply, ARRIVED[lang], 'cancelled')).toBe(true);
    });

    it.each(DOER_CLAIMS)('[%s] «%s» is the agent claiming the delivery: a claim', (lang, reply) => {
        expect(audit(reply, ARRIVED[lang], 'cancelled')).toBe(true);
    });
});

describe('F4300-33 follow-up: a delivered status is a report only of a record read as delivered', () => {
    it.each(DELIVERED_REPORTS)('[%s] «%s» with the order read as delivered: not a claim', (lang, reply) => {
        expect(audit(reply, ARRIVED[lang], 'delivered')).toBe(false);
    });

    it.each(DELIVERED_REPORTS)('[%s] «%s» with the order read as preparing, or nothing read: a claim', (lang, reply) => {
        expect(audit(reply, ARRIVED[lang], 'preparing')).toBe(true);
        expect(audit(reply, ARRIVED[lang], null)).toBe(true);
    });

    it.each(DOER_CLAIMS)('[%s] «%s» stays a claim even with the order read as delivered', (lang, reply) => {
        expect(audit(reply, ARRIVED[lang], 'delivered')).toBe(true);
    });

    it('what the business does is not a claim: «entregamos a domicilio», «entregamos em [zonas]», «ya llegó a la cocina»', () => {
        for (const reply of ['Sí, entregamos a domicilio en toda la ciudad.', 'Sim, entregamos em toda a cidade.', 'Su pedido ya llegó a la cocina y se está preparando.']) {
            expect(audit(reply, 'hacen domicilios?', null)).toBe(false);
        }
    });
});

describe('F4300-33 follow-up: «quedó cancelado» answering a request to cancel stays a claim', () => {
    it.each([
        ['cancela mi pedido', 'Su pedido 5603A623 quedó cancelado.'],
        ['cancel my order please', 'Your order was cancelled.'],
    ])('«%s» → «%s» without a cancel receipt', (question, reply) => {
        // «quedó» answers the request as done; the passive «was cancelled» of a record already read as cancelled is still a report
        expect(audit(reply, question, 'cancelled')).toBe(/quedo|quedó/.test(reply));
        expect(audit(reply, question, 'received')).toBe(true);
    });
});

describe('F4300-33 follow-up: applyOutputGuardrails on the production turn', () => {
    function service() {
        const s: any = Object.create(ConversationsService.prototype);
        s.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
        s.eventEmitter = { emit: jest.fn() };
        s.recordAgentSignal = jest.fn();
        s.alignReplyLanguage = jest.fn(async (reply: string) => reply);
        s.responseValidator = { validatePrices: jest.fn(() => ({ ok: true, hallucinatedPrices: [] })) };
        return s;
    }
    const guard = (s: any, reply: string, question: string, status: string, lang: string, context: any = {}) => {
        // the corrective rewrite insists, as in production: an unbacked claim ends in the fixed fallback
        s.llmRouter = { execute: jest.fn(async () => ({ content: reply, model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 })) };
        return s.applyOutputGuardrails(reply, '', turnMessages(question, status), [], 'synthetic-tenant', 'synthetic-conversation', [], lang, [], context);
    };
    const FALLBACK = /No puedo darle esa acción por confirmada|I cannot treat that as done|Não posso considerar isso concluído|Je ne peux pas considérer cela comme fait/;

    // Production worker log 25-oct 00:33 UTC (image a758ba75, #205 in): «ma commande est-elle arrivée ?» → this exact reply →
    // «[Guardrail] Response claimed completed action without backing tool execution — corrective retry» → the fallback. The turn
    // context carried the cancelled food order AND the lead's open CRM opportunity as active objects: two «records», so a
    // sentence naming none was not about «the only record read».
    const ACTIVE_OBJECTS = { activeObjects: { items: [
        { kind: 'food_order', id: ORDER_ID, source: 'food_orders', status: 'cancelled', statusClass: 'cancelled', amount: 13500, currency: 'COP' },
        { kind: 'crm_opportunity', id: '0e1f2a3b-1b2c-4d5e-8f90-123456789abc', source: 'opportunities', status: 'consulta', statusClass: 'active', label: 'Pedido restaurante' },
    ] } };
    const PRODUCTION: Array<[keyof typeof ARRIVED, string, string]> = [
        ['fr', 'ma commande est-elle arrivée ?', 'Votre commande a été annulée et le paiement est en attente. Si vous souhaitez, je peux vous aider à passer une nouvelle commande.'],
        ['es', 'ya llegó mi pedido?', 'Su pedido fue anulado y el pago está pendiente.'],
        ['pt', 'meu pedido já chegou?', 'Seu pedido foi cancelado e o pagamento está pendente.'],
        ['en', 'has my order arrived?', 'Your order was cancelled and the payment is pending.'],
    ];

    it('an open CRM opportunity among the active objects is not a record a status report is about', () => {
        const facts = knownRecordFacts(toolReadsOfTurnMessages(turnMessages('ma commande est-elle arrivée ?', 'cancelled')), ACTIVE_OBJECTS);
        expect(facts.length).toBeGreaterThan(0);
        expect(facts.every(fact => fact.status === 'cancelled')).toBe(true);
    });

    it.each(PRODUCTION)('[%s] «%s» → «%s» (production reply) is sent as written', async (lang, question, reply) => {
        const s = service();
        const out = await guard(s, reply, question, 'cancelled', lang, ACTIVE_OBJECTS);
        expect(out).toBe(reply);
        expect(s.recordAgentSignal).not.toHaveBeenCalledWith('synthetic-tenant', 'claim_unbacked', undefined);
    });

    it.each([
        ['fr', 'ma commande est-elle arrivée ?', 'Nous avons livré votre commande.'],
        ['es', 'ya llegó mi pedido?', 'Ya cancelé su pedido 5603A623.'],
        ['pt', 'meu pedido já chegou?', 'Entregamos o seu pedido hoje.'],
        ['en', 'has my order arrived?', 'We delivered your order this afternoon.'],
    ])('[%s] «%s» → «%s» in the same production context is still replaced', async (lang, question, reply) => {
        const s = service();
        const out = await guard(s, reply, question, 'cancelled', lang, ACTIVE_OBJECTS);
        expect(out).toMatch(FALLBACK);
    });

    it.each(CANCELLED_REPORTS)('[%s] «%s» is sent as written', async (lang, reply) => {
        const s = service();
        const out = await guard(s, reply, ARRIVED[lang], 'cancelled', lang);
        expect(out).toBe(reply);
        expect(s.recordAgentSignal).not.toHaveBeenCalledWith('synthetic-tenant', 'claim_unbacked', undefined);
    });

    it.each(DOER_CLAIMS)('[%s] «%s» without a receipt is replaced', async (lang, reply) => {
        const s = service();
        const out = await guard(s, reply, ARRIVED[lang], 'cancelled', lang);
        expect(out).toMatch(FALLBACK);
        expect(s.recordAgentSignal).toHaveBeenCalledWith('synthetic-tenant', 'claim_unbacked', undefined);
    });
});
