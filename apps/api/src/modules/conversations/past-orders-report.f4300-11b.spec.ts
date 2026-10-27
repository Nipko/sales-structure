import { pastOrdersReportText } from './past-orders-report';

/**
 * F4300-11 (production QA 27-oct, store tenant, image 1a719d86): «¿alguno de mis pedidos de la tienda está pagado?» got «Su último
 * pedido es el 20FD6A98: … Estado: cancelado. En total tiene 6 pedidos registrados.» — never the answer. None of the six is paid.
 */
const order = (id: string, createdAt: string, paymentStatus = 'pending') => ({
    id, reference: id.slice(0, 8).toUpperCase(), status: 'cancelled', paymentStatus, totalAmount: 119900, currency: 'COP', createdAt,
    items: [{ productName: 'Audífono QA Aurora', quantity: 1 }],
});
const reads = (paid = 'pending') => [{ name: 'list_my_catalog_orders', result: { success: true, total: 2, hasMore: false, orders: [
    order('20fd6a98-4c1b-4d2e-9f30-0123456789ab', '2026-10-10T02:09:04.923Z'),
    order('2eace76f-4c1b-4d2e-9f30-0123456789ab', '2026-10-08T02:52:27.545Z', paid),
] } }];

describe('F4300-11 · «is any of my orders paid?» is answered', () => {
    it.each([
        ['es', '¿alguno de mis pedidos de la tienda está pagado?', 'Ninguno de sus pedidos consta como pagado.'],
        ['pt', 'algum dos meus pedidos da loja está pago?', 'Nenhum dos seus pedidos consta como pago.'],
        ['en', 'are any of my store orders paid?', 'None of your orders shows a payment.'],
        ['fr', 'une de mes commandes en boutique est-elle payée ?', 'Aucune de vos commandes n’est enregistrée comme payée.'],
    ])('[%s] «%s»', (lang, ask, answer) => {
        expect(pastOrdersReportText(reads(), lang, ask)).toContain(answer);
    });

    it('an order that is paid is never said unpaid', () => {
        expect(pastOrdersReportText(reads('paid'), 'es', '¿alguno de mis pedidos está pagado?')).not.toContain('Ninguno');
    });

    it('a question that is not about payment keeps the plain report', () => {
        expect(pastOrdersReportText(reads(), 'es', '¿qué compré la última vez?')).not.toContain('Ninguno');
    });
});
