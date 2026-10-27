import { isOrderCountQuestion, isPastOrdersQuestion, lexicalRequiredReadsOperation } from './operation-lexical-cues';

/**
 * F4300-43 (production QA 27-oct, store tenant, image 399e594e): «¿cuánto pagué por mi último Audífono QA Aurora?» and «combien
 * ai-je payé mon dernier Audífono QA Aurora ?» ran only search_faqs and were answered «pagó 119.900 COP» / «a été payé 119 900
 * COP»; no order of that customer shows a payment. How much the customer paid is asked of their own orders: the turn reads them.
 */
const CATALOG = ['list_my_catalog_orders', 'search_products'];
const RESTAURANT = ['list_my_orders', 'get_menu'];

describe('F4300-43 · how much the customer paid is read from their orders', () => {
    it.each([
        '¿cuánto pagué por mi último Audífono QA Aurora?', '¿cuánto le pagué en mi último pedido?',
        'how much did I pay for my last Audífono QA Aurora?', 'how much have I paid for the headphones?',
        'quanto paguei pelo meu último Audífono QA Aurora?', 'quanto eu paguei no último pedido?',
        'combien ai-je payé mon dernier Audífono QA Aurora ?', 'j’ai payé combien pour le casque ?',
    ])('«%s» reads the orders', text => {
        expect(isPastOrdersQuestion(text)).toBe(true);
        expect(lexicalRequiredReadsOperation(text, 'catalog', CATALOG)).toBe('track_catalog_order');
        expect(lexicalRequiredReadsOperation(text, 'restaurants', RESTAURANT)).toBe('check_my_orders');
    });

    it.each([
        'quiero pagar mi último pedido', 'I want to pay my last order', 'quero pagar meu último pedido', 'je veux payer ma dernière commande',
        '¿cuánto pagué? quiero un reembolso', 'how much did I pay? cancel it',
    ])('a payment to make, or a write, is not a question about past orders: «%s»', text => {
        expect(isPastOrdersQuestion(text)).toBe(false);
    });

    it('a payment to make is still not an order count («how many orders do I have to pay?»)', () => {
        expect(isOrderCountQuestion('how many orders do I have to pay?')).toBe(false);
    });
});
