import { ACCENT_FOLD_FROM, ACCENT_FOLD_TO, foldedSql, foldQueryText } from './sql-accent-fold.util';

describe('accent folding for catalogue lookups', () => {
    it('maps every folded character to exactly one replacement', () => {
        expect([...ACCENT_FOLD_FROM].length).toBe([...ACCENT_FOLD_TO].length);
        expect(new Set([...ACCENT_FOLD_FROM]).size).toBe([...ACCENT_FOLD_FROM].length);
    });

    it('covers the Spanish, Portuguese and French diacritics, lower and upper case', () => {
        for (const ch of 'áéíóúüñçãõâêîôûàèìòùëïÿ' + 'ÁÉÍÓÚÜÑÇÃÕÂÊÎÔÛÀÈÌÒÙËÏŸ')
            expect(ACCENT_FOLD_FROM).toContain(ch);
    });

    it('folds to the plain Latin letter', () => {
        const fold = (text: string) => [...text].map(ch => {
            const at = ACCENT_FOLD_FROM.indexOf(ch);
            return at < 0 ? ch : ACCENT_FOLD_TO[at];
        }).join('');
        expect(fold('Coração Café Cœur')).toBe('Coracao Cafe Cœur');   // œ is handled by replace(), not translate()
        // Upper-case letters fold to the lower-case target; `lower()` in the SQL makes the comparison case-blind anyway.
        expect(fold('ÿ Ÿ ñ Ñ')).toBe('y y n n');
    });

    it('handles the two-letter ligatures in SQL', () => {
        const sql = foldedSql('name');
        expect(sql).toContain(`'œ', 'oe'`);
        expect(sql).toContain(`'æ', 'ae'`);
        expect(sql).toMatch(/^lower\(/);
    });

    it('composes decomposed accents before comparing', () => {
        expect(foldQueryText('Audi\u0301fono ')).toBe('Audífono');
        expect(foldQueryText(null)).toBe('');
    });
});
