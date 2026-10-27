import { isItemAttributeQuestion, lexicalRequiredReadsOperation } from './operation-lexical-cues';

/**
 * F4300-08 (production QA 27-oct, image 5d00fc60): «¿el Audífono QA Aurora es azul?» (es/pt/en/fr) and «¿en qué calle está el
 * Spark QA Inmueble?» (fr/pt) ran only search_faqs and were answered «no tengo información» / «no tengo la dirección». A colour
 * named is the item's colour, and a street is where the listing is: the turn reads them.
 */
describe('F4300-08 · a colour named reads the product', () => {
    it.each([
        '¿el Audífono QA Aurora es azul?', 'o Audífono QA Aurora é azul?', 'is the Audífono QA Aurora blue?', 'l’Audífono QA Aurora est-il bleu ?',
        '¿viene en negro?', 'vem em preto?', 'does it come in white?',
    ])('«%s»', text => {
        expect(isItemAttributeQuestion(text)).toBe(true);
    });

    it.each(['¿el envío es gratis?', 'is it available?', '¿está abierto el domingo?'])('not a colour: «%s»', text => {
        expect(isItemAttributeQuestion(text)).toBe(false);
    });
});

describe('F4300-08 · the street of a listing reads the listing', () => {
    const LISTINGS = ['search_listings', 'get_listing_details'];
    it.each([
        '¿en qué calle está el Spark QA Inmueble?', 'dans quelle rue se trouve le Spark QA Inmueble ?',
        'em que rua fica o Spark QA Inmueble?', 'what street is the Spark QA Inmueble on?',
        // Production QA 27-oct: the typo «fika» read nothing and got «Não tenho a morada exata».
        'onde fika o spark qa inmueble',
    ])('«%s»', text => {
        expect(lexicalRequiredReadsOperation(text, 'listings', LISTINGS)).toBe('listing_info');
    });
});
