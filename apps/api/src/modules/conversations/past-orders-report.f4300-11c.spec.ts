import { allCancelledCountCorrection } from './past-orders-report';

/**
 * F4300-11 (production QA 27-oct, store tenant): «¿cuántos pedidos he hecho en la tienda?» read the six orders, all cancelled, and was
 * answered «Ha hecho un total de 6 pedidos» / «You have made a total of 6 purchases», never saying that none went through.
 */
const order = (n: number, status = 'cancelled') => ({
    id: `0000000${n}-4c1b-4d2e-9f30-0123456789ab`, reference: `REF${n}`, status, paymentStatus: 'pending', total: 119900, currency: 'COP',
    items: [{ productName: 'Audífono QA Aurora', quantity: 1 }], createdAt: `2026-10-0${n}T10:00:00.000Z`,
});
const SIX = [{ name: 'list_my_catalog_orders', result: { success: true, total: 6, hasMore: false, orders: [1, 2, 3, 4, 5, 6].map(n => order(n)) } }];

describe('F4300-11 · a count of orders that are all cancelled says so', () => {
    it.each([
        ['es', 'Ha hecho un total de 6 pedidos en la tienda. ¿Le gustaría saber más detalles sobre alguno de ellos?',
            'Ha hecho un total de 6 pedidos en la tienda. Los 6 están cancelados; ninguno se completó. ¿Le gustaría saber más detalles sobre alguno de ellos?'],
        ['en', 'You have made a total of 6 purchases in the store. Can I help you with anything else?',
            'You have made a total of 6 purchases in the store. All 6 are cancelled; none of them went through. Can I help you with anything else?'],
        ['pt', 'Você fez um total de seis pedidos na loja.', 'Você fez um total de seis pedidos na loja. Os 6 estão cancelados; nenhum foi concluído.'],
        ['fr', 'Vous avez passé un total de 6 commandes dans la boutique. Souhaitez-vous autre chose ?',
            'Vous avez passé un total de 6 commandes dans la boutique. Les 6 sont annulées ; aucune n’a abouti. Souhaitez-vous autre chose ?'],
    ])('[%s]', (lang, reply, expected) => {
        expect(allCancelledCountCorrection(reply, SIX, lang)).toBe(expected);
    });

    it.each([
        ['cancelled said already', 'Tiene 6 pedidos, todos cancelados.', SIX],
        ['no count said', 'Su último pedido es el REF6.', SIX],
        ['another count', 'Ha hecho 4 pedidos.', SIX],
        ['one is not cancelled', 'Ha hecho 6 pedidos.', [{ name: 'list_my_catalog_orders', result: { success: true, total: 6, hasMore: false,
            orders: [1, 2, 3, 4, 5].map(n => order(n)).concat(order(6, 'delivered')) } }]],
        ['the list may be partial', 'Ha hecho 6 pedidos.', [{ name: 'list_my_catalog_orders', result: { success: true, hasMore: true, orders: [1, 2, 3, 4, 5, 6].map(n => order(n)) } }]],
        ['no orders read', 'Ha hecho 6 pedidos.', []],
    ])('stays: %s', (_why, reply, reads) => {
        expect(allCancelledCountCorrection(reply, reads as any, 'es')).toBeNull();
    });
});
