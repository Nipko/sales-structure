import { firstOrderCorrection } from './past-orders-report';

/**
 * F4300-45 residual (production QA 26-oct, store tenant, image fc0c6c76): «¿cuál fue mi primer pedido en la tienda?» read the six
 * orders (the list comes newest first) and the reply named the newest one, «el 10 de octubre de 2026, con el número de Ref.
 * 20FD6A98», in es/pt/en/fr. The oldest order is of 8-oct.
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

describe('F4300-45 · the first order is the oldest order read', () => {
    it.each([
        ['es', '¿cuál fue mi primer pedido en la tienda?', 'Su primer pedido en la tienda fue el 10 de octubre de 2026, con el número de Ref. 20FD6A98.',
            'Su primer pedido es el 1A2B3C4D, del 8 de octubre de 2026: 1 × Audífono QA Aurora, por 119.900 COP. Estado: cancelado. No consta ningún pago de este pedido.'],
        ['en', 'what was my first store order?', 'Your first store order was on October 10, 2026, with reference 20FD6A98.',
            'Your first order is 1A2B3C4D, placed on October 8, 2026: 1 × Audífono QA Aurora, for 119,900 COP. Status: cancelled. No payment is recorded for this order.'],
        ['pt', 'qual foi meu primeiro pedido na loja?', 'Seu primeiro pedido na loja foi em 10 de outubro de 2026, com a referência 20FD6A98.',
            'Seu primeiro pedido é o 1A2B3C4D, de 8 de outubro de 2026: 1 × Audífono QA Aurora, no valor de 119.900 COP. Status: cancelado. Não consta nenhum pagamento deste pedido.'],
        ['fr', 'quelle a été ma première commande en boutique ?', 'Votre première commande a été passée le 10 octobre 2026, avec la référence 20FD6A98.',
            'Votre première commande est la 1A2B3C4D, du 8 octobre 2026 : 1 × Audífono QA Aurora, pour 119 900 COP. Statut : annulée. Aucun paiement n’est enregistré pour cette commande.'],
    ])('[%s] «%s»', (lang, ask, reply, expected) => {
        expect(spaced(firstOrderCorrection(ask, reply, reads, lang, 'America/Bogota'))).toBe(spaced(expected));
    });

    it('a reply that already names the oldest order stays', () => {
        expect(firstOrderCorrection('¿cuál fue mi primer pedido?', 'Su primer pedido fue el 1A2B3C4D, del 8 de octubre.', reads, 'es')).toBeNull();
    });

    it('another question about the newest order stays («¿cuál fue mi último pedido?»)', () => {
        expect(firstOrderCorrection('¿cuál fue mi último pedido?', 'Su último pedido es el 20FD6A98.', reads, 'es')).toBeNull();
    });
});
