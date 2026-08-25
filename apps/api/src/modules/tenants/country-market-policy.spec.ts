import {
    COUNTRY_LANGUAGE_PACKS,
    COUNTRY_MARKET_STATE,
    COUNTRY_PACK_STATUS,
    countryMarketPolicyFor,
} from '@parallext/shared';

describe('LOC-01/P34 country language and market policy', () => {
    it('keeps language evidence and commercial state as separate axes', () => {
        expect(countryMarketPolicyFor('CO')).toEqual(expect.objectContaining({
            version: 1,
            country: 'CO',
            state: 'preview',
            onboarding: 'assisted_with_disclosure',
            claimMode: 'preview_only',
        }));
        expect(COUNTRY_PACK_STATUS.CO).toBe('draft');
    });

    it('never promotes an unknown ISO code by accepting it', () => {
        expect(countryMarketPolicyFor('DE')).toEqual(expect.objectContaining({
            country: 'DE',
            state: 'recognized',
            onboarding: 'waitlist_or_assisted',
            claimMode: 'none',
        }));
    });

    it('keeps the pack registry, evidence status and market state aligned', () => {
        for (const pack of Object.values(COUNTRY_LANGUAGE_PACKS)) {
            expect(COUNTRY_PACK_STATUS[pack.country]).toBe(pack.status);
            expect(COUNTRY_MARKET_STATE[pack.country]).toBeDefined();
        }
    });
});
