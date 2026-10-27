import { cancelledPurchaseCorrection, firstOrderCorrection } from './past-orders-report';

/**
 * Production QA 27-oct (store tenant, image c3cf6985 / e96577f4).
 * F4300-45: «when did I place my first order in the store?» → «You placed your first order on October 8, 2026» (no reference) and
 * «qual foi meu primeiro pedido na loja?» → «…referência 2EACE76F, feito em 2026-10-08» (ISO date); 2EACE76F is of 7-oct in Bogotá.
 * F4300-11: «¿qué producto compré en mi último pedido?» → «…Ref. 20FD6A98, compró 1 unidad del producto Audífono QA Aurora» about a
 * cancelled order, never said cancelled.
 */
const order = (id: string, createdAt: string) => ({
    id, reference: id.slice(0, 8).toUpperCase(), status: 'cancelled', paymentStatus: 'pending', totalAmount: 119900, currency: 'COP', createdAt,
    items: [{ productName: 'Audífono QA Aurora', quantity: 1 }],
});
const reads = [{ name: 'list_my_catalog_orders', result: { success: true, total: 3, hasMore: false, orders: [
    order('20fd6a98-4c1b-4d2e-9f30-0123456789ab', '2026-10-10T02:09:04.923Z'),
    order('5e6f7081-4c1b-4d2e-9f30-0123456789ab', '2026-10-09T12:05:37.691Z'),
    order('2eace76f-4c1b-4d2e-9f30-0123456789ab', '2026-10-08T02:52:27.545Z'),
] } }];
const restaurant = [{ name: 'list_my_orders', result: { success: true, total: 1, hasMore: false, orders: [
    { id: '5603a623-4c1b-4d2e-9f30-0123456789ab', status: 'cancelled', paymentStatus: 'pending', total: 13500, currency: 'COP',
        createdAt: '2026-10-24T15:20:00.000Z', items: [{ name: 'Spark QA Plato', quantity: 1 }] },
] } }];
const spaced = (text: string | null) => String(text).replace(/\s/g, ' ');

describe('F4300-45 · the first order told with another day is corrected, whatever names it', () => {
    it.each([
        ['en', 'when did I place my first order in the store?', 'You placed your first order on October 8, 2026. It was for 1 unit of the Audífono QA Aurora.',
            'Your first order is 2EACE76F, placed on October 7, 2026'],
        ['pt', 'qual foi meu primeiro pedido na loja?', 'Seu primeiro pedido na loja foi a referência 2EACE76F, feito em 2026-10-08.',
            'Seu primeiro pedido é o 2EACE76F, de 7 de outubro de 2026'],
        ['fr', 'quelle a été ma première commande en boutique ?', 'Votre première commande en boutique est la référence 2EACE76F, passée le 8 octobre 2026.',
            'Votre première commande est la 2EACE76F, du 7 octobre 2026'],
    ])('[%s] «%s»', (lang, ask, reply, lead) => {
        expect(spaced(firstOrderCorrection(ask, reply, reads, lang, 'America/Bogota'))).toContain(spaced(lead));
    });

    it.each([
        'Seu primeiro pedido é o 2EACE76F, de 7 de outubro de 2026.',
        'Seu primeiro pedido foi feito em 2026-10-07.',
        'Seu primeiro pedido foi de um Audífono QA Aurora.',
    ])('the first order with its own day, or with none, stays: «%s»', reply => {
        expect(firstOrderCorrection('qual foi meu primeiro pedido?', reply, reads, 'pt', 'America/Bogota')).toBeNull();
    });

    it('a reply about another order of the list is not this correction’s', () => {
        expect(firstOrderCorrection('¿cuál fue mi primer pedido?', 'El pedido 5E6F7081 es del 9 de octubre.', reads, 'es', 'America/Bogota')).toBeNull();
    });

    it('the only restaurant order is the first one: its own day stays, another day is corrected', () => {
        expect(firstOrderCorrection('¿cuándo hice mi primer pedido en el restaurante?', 'Su primer pedido en el restaurante fue realizado el 24 de octubre de 2026.',
            restaurant, 'es', 'America/Bogota')).toBeNull();
        expect(firstOrderCorrection('¿cuándo hice mi primer pedido en el restaurante?', 'Su primer pedido fue el 18 de octubre de 2026.',
            restaurant, 'es', 'America/Bogota')).toContain('Su primer pedido es el 5603A623, del 24 de octubre de 2026');
    });
});

describe('F4300-11 · a cancelled order is not told as a purchase', () => {
    it.each([
        ['es', 'En su último pedido de la tienda, Ref. 20FD6A98, compró 1 unidad del producto Audífono QA Aurora por 119.900 COP.', 'Estado: cancelado'],
        ['pt', 'No seu último pedido na loja, referência 20FD6A98, você comprou 1 unidade do produto Audífono QA Aurora por 119.900 COP.', 'Status: cancelado'],
        ['en', 'In your last store order, reference 20FD6A98, you purchased 1 unit of the product Audífono QA Aurora for 119,900 COP.', 'Status: cancelled'],
        ['fr', 'Dans votre dernière commande en boutique, référence 20FD6A98, vous avez acheté 1 unité du produit Audífono QA Aurora pour 119 900 COP.', 'Statut : annulée'],
    ])('[%s] is said from the read', (lang, reply, status) => {
        expect(spaced(cancelledPurchaseCorrection(reply, reads, lang))).toContain(spaced(status));
    });

    it.each([
        'Compró 1 Audífono QA Aurora en el pedido 20FD6A98, que está cancelado.',
        'Su último pedido es el 20FD6A98: 1 × Audífono QA Aurora, por 119.900 COP.',
        '¿Desea comprar otro Audífono QA Aurora?',
    ])('a reply that says it was cancelled, or claims no purchase, stays: «%s»', reply => {
        expect(cancelledPurchaseCorrection(reply, reads, 'es')).toBeNull();
    });

    it('an order that was not cancelled stays a purchase', () => {
        const delivered = [{ name: 'list_my_catalog_orders', result: { success: true, orders: [{ ...order('20fd6a98-4c1b-4d2e-9f30-0123456789ab', '2026-10-10T02:09:04.923Z'), status: 'delivered' }] } }];
        expect(cancelledPurchaseCorrection('Usted compró 1 Audífono QA Aurora (Ref. 20FD6A98).', delivered, 'es')).toBeNull();
    });
});
