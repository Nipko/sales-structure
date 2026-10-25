import { auditTurnClaim, claimsCompletedAction, mentionsCancellation } from '../../common/utils/outcome-claim.util';
import { ConversationsService } from './conversations.service';
import { pastOrdersReportText } from './past-orders-report';
import { isBusinessWriteTool } from './tool-policy-registry';
import { knownRecordFacts, toolReadsOfTurnMessages } from './transition-engine';

/**
 * F4300-11 (production QA, store Telegram tenant, image 128b1fb4, 25-oct 07:31 UTC): «what did I buy last time?» read
 * list_my_catalog_orders — six orders, all cancelled with the payment pending, the newest 20FD6A98 (Audífono QA Aurora,
 * 119.900 COP) — and the reply sent was «I cannot treat that as done: I have no record that it was completed. Would you like me
 * to ask someone from the team to confirm it?». The customer: «I'm not asking you to confirm anything, I just want to know what
 * I purchased last time.» — the SAME template again. On 22-oct the template had replaced the answer to «¿cuáles son mis
 * pedidos?».
 *
 * Root cause: a status sentence that names no reference («that order has been cancelled», «su último pedido fue cancelado») was
 * a report only when the turn read exactly ONE record; with six orders read it was an unbacked cancellation claim, although all
 * six were cancelled. Now:
 *   (a) describing the customer's past orders from an orders read of this turn is a report: a status true of every record read,
 *       or of the newest one when the sentence says «last / último / dernière», and «you bought / compraste / você comprou /
 *       vous avez acheté» never was a claim;
 *   (b) a draft that says a purchase read as cancelled was completed (confirmed, paid, delivered) is corrected from the read —
 *       the newest order, what it held, its total and «cancelled» — never replaced by the template;
 *   (c) after the template, a customer's clarifying question is answered from the read, and the template never goes out twice
 *       in a row to a question.
 */
const isBackingTool = (name: string) => isBusinessWriteTool(name);

const NEWEST = '20fd6a98-4c1b-4d2e-9f30-0123456789ab';
const OLDER = ['1a2b3c4d', '2b3c4d5e', '3c4d5e6f', '4d5e6f70', '5e6f7081'].map(prefix => `${prefix}-4c1b-4d2e-9f30-0123456789ab`);
const catalogOrder = (id: string, day: number, status = 'cancelled') => ({
    id, reference: id.slice(0, 8).toUpperCase(), version: 2, status, paymentStatus: 'pending', totalAmount: 119900, totalAmountCents: '11990000',
    currency: 'COP', createdAt: `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`,
    items: [{ id: `line-${day}`, productId: '09cddfe4-1421-4ad8-82dd-a252d45fe0ac', productName: 'Audífono QA Aurora', quantity: 1, unitPrice: 119900, totalPrice: 119900 }],
    fulfillmentStatus: 'not_recorded',
});
/** The six production orders, newest first (the reader's order). */
const SIX_CANCELLED = { success: true, orders: [catalogOrder(NEWEST, 24), ...OLDER.map((id, index) => catalogOrder(id, 20 - index))], total: 6, hasMore: false, complete: true };

const EN_TEMPLATE = 'I cannot treat that as done: I have no record that it was completed. Would you like me to ask someone from the team to confirm it?';
const FALLBACK = /No puedo darle esa acción por confirmada|I cannot treat that as done|Não posso considerar isso concluído|Je ne peux pas considérer cela comme fait/;

/** A store turn: (history), the customer's message, then the required read as a synthetic tool message. */
function storeTurn(question: string, history: any[] = [], listing: any = SIX_CANCELLED) {
    return [
        ...history,
        { role: 'user', content: question },
        { role: 'assistant', content: '', toolCalls: [{ id: 'required_read_0', type: 'function', function: { name: 'list_my_catalog_orders', arguments: '{"limit":50}' } }] },
        { role: 'tool', toolCallId: 'required_read_0', content: JSON.stringify(listing) },
    ];
}
const audit = (reply: string, question: string, messages = storeTurn(question)) => auditTurnClaim(reply, [], {
    isBackingTool, recordFacts: knownRecordFacts(toolReadsOfTurnMessages(messages)), customerRequestedCancellation: mentionsCancellation(question),
}).falseClaim;

const ASK = { es: '¿qué compré la última vez?', en: 'what did I buy last time?', pt: 'o que eu comprei da última vez?', fr: "qu'est-ce que j'ai acheté la dernière fois ?" };
type Lang = keyof typeof ASK;

/** Truthful descriptions of the past orders read (all six cancelled): reports. */
const REPORTS: Array<[Lang, string]> = [
    ['en', 'Your last purchase was the Audífono QA Aurora (order 20FD6A98) for 119,900 COP. That order has been cancelled and the payment is pending.'],
    ['en', 'You bought the Audífono QA Aurora last time. Your order was cancelled.'],
    ['en', 'You have 6 orders and all of them have been cancelled.'],
    ['es', 'Su última compra fue el Audífono QA Aurora por 119.900 COP. Su último pedido fue cancelado.'],
    ['es', 'La última vez compraste el Audífono QA Aurora. Ese pedido fue cancelado y el pago está pendiente.'],
    ['es', 'Tiene 6 pedidos y su pedido más reciente está cancelado.'],
    ['pt', 'Da última vez você comprou o Audífono QA Aurora. Seu pedido foi cancelado.'],
    ['pt', 'Sua última compra foi o Audífono QA Aurora; o pedido foi cancelado e o pagamento está pendente.'],
    ['fr', "La dernière fois, vous avez acheté l'Audífono QA Aurora. Votre commande a été annulée."],
    ['fr', 'Votre dernière commande, 20FD6A98, a été annulée.'],
];

/** Drafts that say a purchase read as cancelled was completed: claims, corrected from the read. */
const WRONG: Array<[Lang, string]> = [
    ['en', 'Your last purchase was the Audífono QA Aurora. Your order has been confirmed.'],
    ['en', 'You bought the Audífono QA Aurora for 119,900 COP and your payment was confirmed.'],
    ['es', 'Su última compra fue el Audífono QA Aurora. Su compra fue confirmada y está pagada.'],
    ['es', 'Compraste el Audífono QA Aurora; tu pedido ya fue entregado.'],
    ['pt', 'Sua última compra foi o Audífono QA Aurora, e o pedido foi confirmado.'],
    ['fr', "Vous avez acheté l'Audífono QA Aurora ; votre commande a été confirmée et payée."],
];

describe('F4300-11 (a): describing past orders read this turn is a report', () => {
    it('the newest order of a listing is marked: «su último pedido» is this one', () => {
        const facts = knownRecordFacts(toolReadsOfTurnMessages(storeTurn(ASK.en)));
        expect(facts).toHaveLength(6);
        expect(facts.filter(fact => fact.latest).map(fact => fact.tokens[0])).toEqual(['20FD6A98']);
    });

    it.each(REPORTS)('[%s] «%s» with six cancelled orders read: not a claim', (lang, reply) => {
        expect(audit(reply, ASK[lang])).toBe(false);
    });

    it('«you bought / compraste / você comprou / vous avez acheté» alone never was a claim', () => {
        for (const reply of ['You bought the Audífono QA Aurora.', 'Compraste el Audífono QA Aurora.', 'Você comprou o Audífono QA Aurora.', "Vous avez acheté l'Audífono QA Aurora."]) {
            expect(claimsCompletedAction(reply)).toBe(false);
        }
    });

    it('«last order cancelled» is a report of the newest order read as cancelled, among orders of other statuses', () => {
        const listing = { success: true, orders: [catalogOrder(NEWEST, 24), catalogOrder(OLDER[0], 20, 'delivered')] };
        const messages = storeTurn(ASK.es, [], listing);
        expect(audit('Su último pedido fue cancelado.', ASK.es, messages)).toBe(false);
        // A sentence that does not say which, with records of different statuses, is not excused.
        expect(audit('Su pedido fue cancelado.', ASK.es, messages)).toBe(true);
        // The newest order is delivered: «your last order was cancelled» is not what the read says.
        const delivered = storeTurn(ASK.en, [], { success: true, orders: [catalogOrder(NEWEST, 24, 'delivered'), catalogOrder(OLDER[0], 20)] });
        expect(audit('Your last order was cancelled.', ASK.en, delivered)).toBe(true);
    });

    it.each(WRONG)('[%s] «%s» says a cancelled purchase was completed: still a claim', (lang, reply) => {
        expect(audit(reply, ASK[lang])).toBe(true);
    });

    it('the agent as the doer stays a claim whatever was read', () => {
        expect(audit('I cancelled your last order.', ASK.en)).toBe(true);
        expect(audit('He cancelado su último pedido.', ASK.es)).toBe(true);
    });
});

describe('F4300-11 (b): the deterministic correction from the orders read', () => {
    const reads = toolReadsOfTurnMessages(storeTurn(ASK.en));
    it.each([
        ['es', 'Su último pedido es el 20FD6A98: 1 × Audífono QA Aurora, por 119.900 COP. Estado: cancelado. En total tiene 6 pedidos registrados.'],
        ['en', 'Your most recent order is 20FD6A98: 1 × Audífono QA Aurora, for 119,900 COP. Status: cancelled. You have 6 orders on record.'],
        ['pt', 'Seu último pedido é o 20FD6A98: 1 × Audífono QA Aurora, no valor de 119.900 COP. Status: cancelado. Ao todo, você tem 6 pedidos registrados.'],
        ['fr', 'Votre dernière commande est la 20FD6A98 : 1 × Audífono QA Aurora, pour 119 900 COP. Statut : annulée. Vous avez 6 commandes enregistrées au total.'],
    ])('[%s] %s', (lang, expected) => {
        const text = pastOrdersReportText(reads, lang) as string;
        // the French thousands separator is a (narrow) no-break space
        expect(text.replace(/[  ]/g, ' ')).toBe(expected);
        expect(claimsCompletedAction(text)).toBe(false);
    });

    it('the restaurant list carries no items: the detail read of the newest order fills them in', () => {
        const id = '5603a623-1b2c-4d5e-8f90-123456789abc';
        const text = pastOrdersReportText([
            { name: 'list_my_orders', result: { orders: [{ id, status: 'cancelled', paymentStatus: 'pending', total: 13500, currency: 'COP', itemCount: 1 }], total: 1 } },
            { name: 'check_order_status', result: { id, status: 'cancelled', total: 13500, currency: 'COP', items: [{ name: 'Spark QA Plato', quantity: 1, unitPrice: 13500 }] } },
        ], 'es');
        expect(text).toBe('Su último pedido es el 5603A623: 1 × Spark QA Plato, por 13.500 COP. Estado: cancelado.');
    });

    it('an open order says its payment status; no order read is no text', () => {
        const id = '5603a623-1b2c-4d5e-8f90-123456789abc';
        expect(pastOrdersReportText([{ name: 'check_order_status', result: { id, status: 'preparing', paymentStatus: 'paid', total: 13500, currency: 'COP', items: [] } }], 'en'))
            .toBe('Your most recent order is 5603A623, for 13,500 COP. Status: being prepared; payment: paid.');
        expect(pastOrdersReportText([{ name: 'search_faqs', result: { results: [] } }], 'en')).toBeNull();
        expect(pastOrdersReportText([{ name: 'list_my_orders', result: { error: 'boom' } }], 'en')).toBeNull();
    });
});

describe('F4300-11: applyOutputGuardrails on the production turns', () => {
    function service() {
        const s: any = Object.create(ConversationsService.prototype);
        s.logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
        s.eventEmitter = { emit: jest.fn() };
        s.recordAgentSignal = jest.fn();
        s.alignReplyLanguage = jest.fn(async (reply: string) => reply);
        s.responseValidator = { validatePrices: jest.fn(() => ({ ok: true, hallucinatedPrices: [] })) };
        return s;
    }
    const guard = (s: any, reply: string, messages: any[], lang: string) => {
        // the corrective rewrite insists, as in production: an unbacked claim would end in the fixed fallback
        s.llmRouter = { execute: jest.fn(async () => ({ content: reply, model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 })) };
        return s.applyOutputGuardrails(reply, '', messages, [], 'synthetic-tenant', 'synthetic-conversation', [], lang, [], {});
    };
    const CLARIFY = {
        en: "I'm not asking you to confirm anything, I just want to know what I purchased last time.",
        es: 'No le pido que confirme nada, solo quiero saber qué compré la última vez.',
        pt: 'Não estou pedindo para confirmar nada, só quero saber o que eu comprei da última vez.',
        fr: "Je ne vous demande pas de confirmer quoi que ce soit, je veux juste savoir ce que j'ai acheté la dernière fois.",
    };
    const TEMPLATE = {
        es: 'No puedo darle esa acción por confirmada: no tengo constancia de que se haya completado. ¿Quiere que le pida a una persona del equipo que lo confirme?',
        en: EN_TEMPLATE,
        pt: 'Não posso considerar isso concluído: não tenho registro de que foi finalizado. Quer que eu peça a alguém da equipe para confirmar?',
        fr: "Je ne peux pas considérer cela comme fait : je n'ai aucune trace que l'opération a abouti. Souhaitez-vous que je demande à quelqu'un de l'équipe de la confirmer ?",
    };

    it.each(REPORTS)('[%s] turn 1: «%s» is sent as written', async (lang, reply) => {
        const s = service();
        const out = await guard(s, reply, storeTurn(ASK[lang]), lang);
        expect(out).toBe(reply);
        expect(s.recordAgentSignal).not.toHaveBeenCalledWith('synthetic-tenant', 'claim_unbacked', undefined);
    });

    it.each(WRONG)('[%s] turn 1: «%s» is corrected to the real status, not replaced by the template', async (lang, reply) => {
        const s = service();
        const out: string = await guard(s, reply, storeTurn(ASK[lang]), lang);
        expect(out).not.toMatch(FALLBACK);
        expect(out).toContain('20FD6A98');
        expect(out).toContain('Audífono QA Aurora');
        expect(out).toMatch({ es: /cancelado/, en: /cancelled/, pt: /cancelado/, fr: /annulée/ }[lang]);
        expect(s.llmRouter.execute).not.toHaveBeenCalled();
        expect(s.recordAgentSignal).toHaveBeenCalledWith('synthetic-tenant', 'claim_unbacked', undefined);
    });

    it.each(Object.keys(CLARIFY) as Lang[])('[%s] turn 2: after the template, the clarification is answered from the read', async lang => {
        const history = [{ role: 'user', content: ASK[lang] }, { role: 'assistant', content: TEMPLATE[lang] }];
        const s = service();
        const out: string = await guard(s, WRONG.find(([l]) => l === lang)![1], storeTurn(CLARIFY[lang], history), lang);
        expect(out).not.toMatch(FALLBACK);
        expect(out).toContain('20FD6A98');
    });

    it('turn 2 with no order read: the template is not sent twice; the draft goes without its claim', async () => {
        const history = [{ role: 'user', content: ASK.en }, { role: 'assistant', content: EN_TEMPLATE }];
        const messages = [...history, { role: 'user', content: CLARIFY.en }];
        const s = service();
        const out = await guard(s, 'You bought the Audífono QA Aurora last time. Your order has been confirmed.', messages, 'en');
        expect(out).toBe('You bought the Audífono QA Aurora last time.');
        const nothingLeft = await guard(service(), 'Your order has been confirmed.', messages, 'en');
        expect(nothingLeft).not.toMatch(FALLBACK);
    });

    it('a request to act is not a question: «cancel my last order» answered «it was cancelled» with no receipt keeps the template', async () => {
        const listing = { success: true, orders: [catalogOrder(NEWEST, 24, 'pending')] };
        const s = service();
        const out = await guard(s, 'Your last order has been cancelled.', storeTurn('cancel my last order', [], listing), 'en');
        expect(out).toMatch(FALLBACK);
    });

    it('restaurant «qué pedí la última vez?»: a claim in the draft is corrected with the dish of the detail read', async () => {
        const id = '5603a623-1b2c-4d5e-8f90-123456789abc';
        const messages = [
            { role: 'user', content: 'qué pedí la última vez?' },
            { role: 'assistant', content: '', toolCalls: [{ id: 'required_read_0', type: 'function', function: { name: 'list_my_orders', arguments: '{"limit":20}' } }] },
            { role: 'tool', toolCallId: 'required_read_0', content: JSON.stringify({ orders: [{ id, status: 'cancelled', paymentStatus: 'pending', orderType: 'delivery', total: 13500, currency: 'COP', itemCount: 1 }], total: 1 }) },
            { role: 'assistant', content: '', toolCalls: [{ id: 'required_read_1', type: 'function', function: { name: 'check_order_status', arguments: JSON.stringify({ orderId: id }) } }] },
            { role: 'tool', toolCallId: 'required_read_1', content: JSON.stringify({ id, status: 'cancelled', paymentStatus: 'pending', total: 13500, currency: 'COP', items: [{ name: 'Spark QA Plato', quantity: 1, unitPrice: 13500 }] }) },
        ];
        const s = service();
        // The production reply (a report of the one cancelled order) is sent as written…
        const production = 'La última vez hizo un pedido a domicilio que fue cancelado. El total era de 13.500 COP.';
        expect(await guard(s, production, messages, 'es')).toBe(production);
        // …and a draft that says it was delivered is corrected from the reads.
        const out = await guard(service(), 'La última vez pidió el Spark QA Plato y su pedido ya fue entregado.', messages, 'es');
        expect(out).toBe('Su último pedido es el 5603A623: 1 × Spark QA Plato, por 13.500 COP. Estado: cancelado.');
    });
});
