import { isPastOrdersQuestion, lexicalRequiredReadsOperation } from './operation-lexical-cues';

/**
 * F4300-45 (production QA 26-oct, store tenant, image 6f1d3bf6): «¿cuándo hice mi primer pedido en la tienda?» (and its Portuguese
 * and English twins) ran only search_faqs and was answered «viernes 2 de octubre de 2026» — the product's creation date. The
 * customer's oldest order is of 8-oct. Their first order is one of their own orders: the turn reads them.
 */
const CATALOG = ['list_my_catalog_orders', 'search_products'];
const RESTAURANT = ['list_my_orders', 'get_menu'];

describe('F4300-45 · the first order is one of the customer’s own orders', () => {
    it.each([
        '¿cuándo hice mi primer pedido en la tienda?', '¿cuál fue mi primera compra?',
        'when did I place my first store order?', 'what was my first order?',
        'quando fiz meu primeiro pedido na loja?', 'qual foi minha primeira compra?',
        'quand ai-je passé ma première commande en boutique ?', 'quel a été mon premier achat ?',
    ])('«%s» reads the orders', text => {
        expect(isPastOrdersQuestion(text)).toBe(true);
        expect(lexicalRequiredReadsOperation(text, 'catalog', CATALOG)).toBe('track_catalog_order');
        expect(lexicalRequiredReadsOperation(text, 'restaurants', RESTAURANT)).toBe('check_my_orders');
    });

    it.each([
        'quiero hacer mi primer pedido', 'I want to place my first order', 'quero fazer meu primeiro pedido', 'je veux passer ma première commande',
    ])('placing a first order is not a question about past ones: «%s»', text => {
        expect(isPastOrdersQuestion(text)).toBe(false);
    });
});
