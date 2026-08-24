import {
    CAPABILITY_EXCLUSION_TEXT,
    localizeCapabilityText,
} from '@parallext/shared';

describe('capability exclusion localization contract', () => {
    it('ships every backend exclusion in exactly the four supported locales', () => {
        for (const detail of Object.values(CAPABILITY_EXCLUSION_TEXT)) {
            expect(typeof detail).toBe('object');
            expect(Object.keys(detail).sort()).toEqual(['en', 'es', 'fr', 'pt']);
            for (const value of Object.values(detail)) {
                expect(value.trim().length).toBeGreaterThan(12);
            }
            expect(detail.en).not.toBe(detail.es);
            expect(detail.pt).not.toBe(detail.es);
            expect(detail.fr).not.toBe(detail.es);
        }
    });

    it('resolves BCP-47 locales and falls back to English without Spanish leakage', () => {
        const detail = CAPABILITY_EXCLUSION_TEXT.channel_not_certified;
        expect(localizeCapabilityText(detail, 'es-CO')).toBe(detail.es);
        expect(localizeCapabilityText(detail, 'en-US')).toBe(detail.en);
        expect(localizeCapabilityText(detail, 'pt-BR')).toBe(detail.pt);
        expect(localizeCapabilityText(detail, 'fr-FR')).toBe(detail.fr);
        expect(localizeCapabilityText(detail, 'de-DE')).toBe(detail.en);

        for (const locale of ['en', 'pt', 'fr'] as const) {
            expect(detail[locale]).not.toMatch(/[¿¡]|\btodavía\b|\basí que\b|\bpor acá\b/i);
        }
    });
});
