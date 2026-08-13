import { resolveAnnualPlanDisplay } from './billing-plan-display.util';

describe('resolveAnnualPlanDisplay', () => {
    it('publishes an annual cycle only when both amount and provider id exist', () => {
        expect(resolveAnnualPlanDisplay({
            annual: { amountCents: 282_438_000, mpPlanId: ' annual-plan-id ' },
        }, 27_690_000)).toEqual({
            displayPriceAnnualCents: 282_438_000,
            mpPlanIdAnnual: 'annual-plan-id',
            annualAvailable: true,
            annualDiscountPct: 15,
        });
    });

    it('hides an annual amount while its Mercado Pago plan id is missing', () => {
        expect(resolveAnnualPlanDisplay({
            annual: { amountCents: 282_438_000 },
        }, 27_690_000)).toEqual({
            displayPriceAnnualCents: null,
            mpPlanIdAnnual: null,
            annualAvailable: false,
            annualDiscountPct: null,
        });
    });

    it('hides a provider id while its annual amount is missing', () => {
        expect(resolveAnnualPlanDisplay({
            annual: { mpPlanId: 'annual-plan-id' },
        }, 27_690_000)).toEqual({
            displayPriceAnnualCents: null,
            mpPlanIdAnnual: 'annual-plan-id',
            annualAvailable: false,
            annualDiscountPct: null,
        });
    });

    it('rejects zero, fractional and non-object annual configurations', () => {
        expect(resolveAnnualPlanDisplay({ annual: { amountCents: 0, mpPlanId: 'id' } }, 100)).toMatchObject({
            displayPriceAnnualCents: null,
            annualAvailable: false,
            annualDiscountPct: null,
        });
        expect(resolveAnnualPlanDisplay({ annual: { amountCents: 10.5, mpPlanId: 'id' } }, 100)).toMatchObject({
            displayPriceAnnualCents: null,
            annualAvailable: false,
            annualDiscountPct: null,
        });
        expect(resolveAnnualPlanDisplay(null, 100)).toEqual({
            displayPriceAnnualCents: null,
            mpPlanIdAnnual: null,
            annualAvailable: false,
            annualDiscountPct: null,
        });
    });

    // Providers billed by our own engine have no remote plan catalog: the frozen
    // local amount IS the contract. Demanding an MP plan id there would hide the
    // annual cycle — and its discount — for every one of them, with no error.
    it('publishes the annual cycle without a provider id when the provider has no plan catalog', () => {
        expect(resolveAnnualPlanDisplay({
            annual: { amountCents: 282_438_000 },
        }, 27_690_000, { requiresProviderPlanId: false })).toEqual({
            displayPriceAnnualCents: 282_438_000,
            mpPlanIdAnnual: null,
            annualAvailable: true,
            annualDiscountPct: 15,
        });
    });

    it('still requires a valid amount when the provider has no plan catalog', () => {
        expect(resolveAnnualPlanDisplay({
            annual: { amountCents: 0 },
        }, 27_690_000, { requiresProviderPlanId: false })).toMatchObject({
            displayPriceAnnualCents: null,
            annualAvailable: false,
            annualDiscountPct: null,
        });
    });
});
