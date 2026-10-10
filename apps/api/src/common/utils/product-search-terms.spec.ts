import { productSearchTerms, stemForSearch, textMatchesTerms, likePatternForTerm } from './product-search-terms';

/**
 * Production 2026-10-10, Tienda QA Electrónica: «quisiera comprar audífonos aurora» was answered «no hay audífonos Aurora disponibles en
 * nuestro catálogo» about the «Audífono QA Aurora» on sale. A name is found by its significant words, not by the whole text.
 */
describe('the words of a product search', () => {
    it('plural, singular, case and accent do not matter', () => {
        for (const said of ['audífonos aurora', 'Audifono Aurora', 'AUDÍFONOS AURORA', 'audifonos Aurora']) {
            expect(textMatchesTerms('Audífono QA Aurora', productSearchTerms(said))).toBe(true);
        }
    });

    it('a word missing from the middle of the name does not hide the product, whatever its length', () => {
        expect(textMatchesTerms('Audífono QA Aurora', productSearchTerms('audífonos aurora'))).toBe(true);
        expect(textMatchesTerms('Audífono Inalámbrico Aurora', productSearchTerms('audifonos aurora'))).toBe(true);
        expect(textMatchesTerms('Aurora Audífono', productSearchTerms('audífono aurora'))).toBe(true);
    });

    it('the plural of a long word and of a short one find the singular name, and the other way round', () => {
        expect(textMatchesTerms('Cargador QA Nova', productSearchTerms('cargadores nova'))).toBe(true);
        expect(textMatchesTerms('Pantalones de lino', productSearchTerms('pantalón'))).toBe(true);
        expect(textMatchesTerms('Mesas plegables', productSearchTerms('mesa plegable'))).toBe(true);
        expect(textMatchesTerms('Lentes de sol', productSearchTerms('lente'))).toBe(true);
    });

    it('every significant word must be found: another product is not an answer', () => {
        expect(textMatchesTerms('Audífono QA Aurora', productSearchTerms('cargadores aurora'))).toBe(false);
        expect(textMatchesTerms('Cargador QA Nova', productSearchTerms('audífonos aurora'))).toBe(false);
    });

    it('joining words and one-letter noise are not terms; nothing significant gives no terms', () => {
        expect(productSearchTerms('el audífono de la aurora')).toEqual(['audifono', 'aurora']);
        expect(productSearchTerms('de la')).toEqual([]);
        expect(productSearchTerms('')).toEqual([]);
        expect(productSearchTerms(undefined)).toEqual([]);
    });

    it('a stem is contained in both spellings and is never shorter than a real word needs', () => {
        expect(stemForSearch('audifonos')).toBe('audifono');
        expect(stemForSearch('cargadores')).toBe('cargador');
        expect(stemForSearch('azules')).toBe('azul');
        expect(stemForSearch('canoes')).toBe('canoe');
        expect(stemForSearch('mesas')).toBe('mesa');
        expect(stemForSearch('gas')).toBe('gas');
        expect(stemForSearch('aurora')).toBe('aurora');
    });

    it('the customer\'s % and _ are text in a pattern, not wildcards', () => {
        expect(likePatternForTerm('50%_off')).toBe('%50\\%\\_off%');
    });
});
