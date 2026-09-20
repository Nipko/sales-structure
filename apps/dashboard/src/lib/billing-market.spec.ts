import { normalizeBillingCountry, selectBillingCountry } from './billing-market';

describe('billing country selection', () => {
    it('carries countries beyond the old Latin America catalog through signup', () => {
        expect(normalizeBillingCountry(' fr ')).toBe('FR');
        expect(normalizeBillingCountry('es-CO')).toBeUndefined();
    });
    it('respects an explicit supported billing country over detected location', () => {
        expect(selectBillingCountry('US', 'CO', ['CO', 'US'])).toBe('US');
    });
    it('requires a choice when geo is unknown and never assumes Colombia', () => {
        expect(selectBillingCountry(undefined, null, ['CO', 'US'])).toBeUndefined();
        expect(selectBillingCountry('ZZ', null, ['CO', 'US'])).toBeUndefined();
    });
    it('uses the detected country only when supported', () => {
        expect(selectBillingCountry(undefined, 'FR', ['CO', 'FR'])).toBe('FR');
        expect(selectBillingCountry(undefined, 'ZZ', ['CO', 'FR'])).toBeUndefined();
    });
});
