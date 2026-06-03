import { translations, SUPPORTED_LOCALES } from '../translations';

describe('i18n translations', () => {
    it('los 4 idiomas tienen exactamente las mismas claves (sin faltantes ni sobrantes)', () => {
        const esKeys = Object.keys(translations.es).sort();
        for (const locale of SUPPORTED_LOCALES) {
            expect(Object.keys(translations[locale]).sort()).toEqual(esKeys);
        }
    });

    it('ningún valor de traducción está vacío', () => {
        const empty: string[] = [];
        for (const locale of SUPPORTED_LOCALES) {
            for (const [key, value] of Object.entries(translations[locale])) {
                if (!value.trim()) empty.push(`${locale}.${key}`);
            }
        }
        expect(empty).toEqual([]);
    });
});
