import { unpaidOrderCorrection } from './past-orders-report';

/**
 * F4300-43 (production QA 26-oct, store tenant, image 994c54a7): «¿cuánto pagué en mi último pedido de la tienda?» read the six
 * orders — all cancelled, payment pending, no payment reference — and the reply said «pagó 119.900 COP» in the four languages.
 */
const order = (id: string, day: number, paymentStatus = 'pending', status = 'cancelled') => ({
    id, reference: id.slice(0, 8).toUpperCase(), status, paymentStatus, totalAmount: 119900, currency: 'COP',
    createdAt: `2026-10-${String(day).padStart(2, '0')}T12:00:00.000Z`,
    items: [{ productName: 'Audífono QA Aurora', quantity: 1 }],
});
const reads = (paymentStatus = 'pending', status = 'cancelled') => [{ name: 'list_my_catalog_orders', result: {
    success: true, orders: [order('20fd6a98-4c1b-4d2e-9f30-0123456789ab', 10, paymentStatus, status), order('1a2b3c4d-4c1b-4d2e-9f30-0123456789ab', 9)],
    total: 2, hasMore: false,
} }];
const spaced = (text: string | null) => String(text).replace(/\s/g, ' ');

describe('F4300-43 · a payment the read does not show is never said', () => {
    it.each([
        ['es', 'En su último pedido en la tienda, pagó 119.900 COP por 1 unidad del Audífono QA Aurora.',
            'Su último pedido es el 20FD6A98: 1 × Audífono QA Aurora, por 119.900 COP. Estado: cancelado. En total tiene 2 pedidos registrados. No consta ningún pago de este pedido.'],
        ['en', 'On your last store order, you paid 119,900 COP for the Audífono QA Aurora.',
            'Your most recent order is 20FD6A98: 1 × Audífono QA Aurora, for 119,900 COP. Status: cancelled. You have 2 orders on record. No payment is recorded for this order.'],
        ['pt', 'No seu último pedido na loja, você pagou 119.900 COP pelo Audífono QA Aurora.',
            'Seu último pedido é o 20FD6A98: 1 × Audífono QA Aurora, no valor de 119.900 COP. Status: cancelado. Ao todo, você tem 2 pedidos registrados. Não consta nenhum pagamento deste pedido.'],
        ['fr', 'Pour votre dernière commande en boutique, vous avez payé 119 900 COP pour l’Audífono QA Aurora.',
            'Votre dernière commande est la 20FD6A98 : 1 × Audífono QA Aurora, pour 119 900 COP. Statut : annulée. Vous avez 2 commandes enregistrées au total. Aucun paiement n’est enregistré pour cette commande.'],
    ])('[%s] «%s» is said from the read', (lang, reply, expected) => {
        expect(spaced(unpaidOrderCorrection(reply, reads(), lang))).toBe(expected);
    });

    it.each([
        'Su pedido está cancelado y el pago está pendiente.',
        'El total de su último pedido fue de 119.900 COP.',
        'Your order is cancelled and the payment is still pending.',
    ])('a reply that claims no payment stays: «%s»', reply => {
        expect(unpaidOrderCorrection(reply, reads(), 'es')).toBeNull();
    });

    it('a paid order may be said paid', () => {
        expect(unpaidOrderCorrection('Usted pagó 119.900 COP.', reads('paid', 'delivered'), 'es')).toBeNull();
    });

    it('with no order read there is nothing to correct from', () => {
        expect(unpaidOrderCorrection('Usted pagó 119.900 COP.', [{ name: 'search_faqs', result: { results: [] } }], 'es')).toBeNull();
    });
});
