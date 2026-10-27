import { firstOrderCorrection, unpaidOrderCorrection } from './past-orders-report';

/**
 * Production QA 27-oct (store tenant, image 399e594e).
 * F4300-43: «combien ai-je payé mon dernier Audífono QA Aurora ?» was answered «Votre dernier Audífono QA Aurora a été payé 119 900
 * COP»: the passive claims the payment too.
 * F4300-45: «qual foi meu primeiro pedido na loja?» named the oldest order, «feito em 10 de outubro de 2026» — the newest order's
 * date; the oldest is of 8-oct (7-oct in production).
 */
const order = (id: string, createdAt: string) => ({
    id, reference: id.slice(0, 8).toUpperCase(), status: 'cancelled', paymentStatus: 'pending', totalAmount: 119900, currency: 'COP', createdAt,
    items: [{ productName: 'Audífono QA Aurora', quantity: 1 }],
});
const reads = [{ name: 'list_my_catalog_orders', result: { success: true, total: 3, hasMore: false, orders: [
    order('20fd6a98-4c1b-4d2e-9f30-0123456789ab', '2026-10-10T02:09:04.923Z'),
    order('5e6f7081-4c1b-4d2e-9f30-0123456789ab', '2026-10-09T12:05:37.691Z'),
    order('1a2b3c4d-4c1b-4d2e-9f30-0123456789ab', '2026-10-08T07:52:27.545Z'),
] } }];
const spaced = (text: string | null) => String(text).replace(/\s/g, ' ');

describe('F4300-43 · a payment said in the passive is a payment claim', () => {
    it.each([
        ['fr', 'Votre dernier Audífono QA Aurora a été payé 119 900 COP.', 'Aucun paiement n’est enregistré pour cette commande.'],
        ['es', 'Su último Audífono QA Aurora fue pagado con 119.900 COP.', 'No consta ningún pago de este pedido.'],
        ['pt', 'Seu último Audífono QA Aurora foi pago por 119.900 COP.', 'Não consta nenhum pagamento deste pedido.'],
        ['en', 'Your last Audífono QA Aurora was paid 119,900 COP.', 'No payment is recorded for this order.'],
    ])('[%s] «%s» is said from the read', (lang, reply, notPaid) => {
        expect(spaced(unpaidOrderCorrection(reply, reads, lang))).toContain(spaced(notPaid));
    });
});

describe('F4300-45 · the first order is told with its own date', () => {
    it.each([
        ['pt', 'qual foi meu primeiro pedido na loja?', 'Seu primeiro pedido na loja foi o de referência 1A2B3C4D, feito em 10 de outubro de 2026.',
            'Seu primeiro pedido é o 1A2B3C4D, de 8 de outubro de 2026'],
        ['en', 'what was my first order?', 'Your first order was 1A2B3C4D, placed on October 10, 2026.', 'Your first order is 1A2B3C4D, placed on October 8, 2026'],
        ['fr', 'quelle a été ma première commande ?', 'Votre première commande est la 1A2B3C4D, du 9 octobre 2026.', 'Votre première commande est la 1A2B3C4D, du 8 octobre 2026'],
    ])('[%s] the oldest order with another order’s date is corrected', (lang, ask, reply, lead) => {
        expect(spaced(firstOrderCorrection(ask, reply, reads, lang, 'America/Bogota'))).toContain(spaced(lead));
    });

    it.each([
        'Su primer pedido es el 1A2B3C4D, del 8 de octubre de 2026.',
        'Su primer pedido es el 1A2B3C4D.',
    ])('the oldest order told with its own date, or with none, stays: «%s»', reply => {
        expect(firstOrderCorrection('¿cuál fue mi primer pedido?', reply, reads, 'es', 'America/Bogota')).toBeNull();
    });

    it('the date is the tenant’s: 8-oct 02:52 in Bogotá is not 7-oct', () => {
        expect(firstOrderCorrection('¿cuál fue mi primer pedido?', 'Su primer pedido es el 1A2B3C4D, del 7 de octubre de 2026.', reads, 'es', 'America/Bogota'))
            .toContain('del 8 de octubre de 2026');
    });
});
