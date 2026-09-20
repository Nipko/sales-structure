import { resolveStripePlanPrice } from './stripe-plan-price.util';

describe('international USD subscription prices', () => {
    const plan = { priceUsdCents: 6900, priceLocalOverrides: {
        CO: { currency: 'COP', amountCents: 29990000, annual: { amountCents: 323892000 } },
        MX: { currency: 'MXN', amountCents: 99999, annual: { amountCents: 999999 } },
    } };
    it.each(['US', 'MX', 'PE', 'ES', 'JP'])('uses the runtime USD price for %s without currency conversion', country => {
        expect(resolveStripePlanPrice(plan, country, 'monthly')).toEqual({ amountCents: 6900, currency: 'USD' });
    });
    it.each(['CO', 'ZZ', '', null])('rejects a missing, unsupported or Colombian country (%s)', country => {
        expect(resolveStripePlanPrice(plan, country, 'monthly')).toBeNull();
    });
    it('does not invent an international annual price from COP or local currency annuals', () => {
        expect(resolveStripePlanPrice(plan, 'US', 'annual')).toBeNull();
        expect(resolveStripePlanPrice(plan, 'MX', 'annual')).toBeNull();
    });
    it('accepts an explicitly configured global USD annual amount', () => {
        expect(resolveStripePlanPrice({ ...plan, priceLocalOverrides: {
            ...plan.priceLocalOverrides, USD: { currency: 'USD', annual: { amountCents: 74520 } },
        } }, 'MX', 'annual')).toEqual({ amountCents: 74520, currency: 'USD' });
    });
    it.each([0, -1, 1.5, 2147483648, NaN])('rejects invalid monetary amounts (%s)', amount => {
        expect(resolveStripePlanPrice({ priceUsdCents: amount }, 'US', 'monthly')).toBeNull();
    });
});
