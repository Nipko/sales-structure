import { faqSearchTerms, stripFaqQueryNoise } from './faq-search';

/**
 * Production 2026-10-07: «Prueba QA QA_…_1: Ref 1234567: ¿cuál es el plazo de garantía?» answered «No tengo la
 * información» while a single prefix worked: only the FIRST label was removed, so "Ref" (and the colon) stayed
 * in the search terms of the question.
 */
describe('stripFaqQueryNoise with stacked prefixes', () => {
    it.each([
        ['Prueba QA QA_C1_T01_1: Ref 1234567: ¿cuál es el plazo de garantía?', '¿cuál es el plazo de garantía?'],
        ['Prueba QA QA_C1_T01_1: Ref ABC_2: ¿cuál es el plazo de garantía?', '¿cuál es el plazo de garantía?'],
        ['Prueba QA QA_X_1: Pedido 12345678: Ticket 99887766: ¿cuánto dura?', '¿cuánto dura?'],
        ['Ref 1234567: ¿cuál es el plazo de garantía?', '¿cuál es el plazo de garantía?'],
        ['Prueba QA QA_C1_T01_1: Ref 1234567: Pedido 7654321: ¿cuál es la garantía?', '¿cuál es la garantía?'],
    ])('%s', (input, expected) => {
        expect(stripFaqQueryNoise(input)).toBe(expected);
    });

    it('leaves no label word among the search terms', () => {
        const terms = faqSearchTerms(stripFaqQueryNoise('Prueba QA QA_C1_T01_1: Ref 1234567: ¿cuál es el plazo de garantía?'));
        expect(terms).toEqual(['plazo', 'garantia']);
    });

    it('keeps the topic words and the text around a real label', () => {
        expect(stripFaqQueryNoise('Tour Faro Rojo, reserva RES_77: Ref 1234567: ¿Cuánto dura?')).toBe('Tour Faro Rojo ¿Cuánto dura?');
        expect(stripFaqQueryNoise('Compré el tour Faro Rojo ayer. ¿Cuánto dura?')).toBe('Compré el tour Faro Rojo ayer. ¿Cuánto dura?');
        expect(stripFaqQueryNoise('Referencia de producto: ¿cuál es la garantía?')).toBe('Referencia de producto: ¿cuál es la garantía?');
        expect(stripFaqQueryNoise('¿Cuál es la referencia de garantía del pedido?')).toBe('¿Cuál es la referencia de garantía del pedido?');
    });
});
