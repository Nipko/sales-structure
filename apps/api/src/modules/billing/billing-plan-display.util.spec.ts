import { resolveAnnualPlanDisplay } from './billing-plan-display.util';

describe('resolveAnnualPlanDisplay', () => {
    it('publishes an annual cycle only when both amount and provider id exist', () => {
        expect(resolveAnnualPlanDisplay({
            annual: { amountCents: 282_438_000, mpPlanId: ' annual-plan-id ' },
        }, 27_690_000)).toEqual({
            displayPriceAnnualCents: 282_438_000,
            mpPlanIdAnnual: 'annual-plan-id',
            annualDiscountPct: 15,
        });
    });

    it('hides an annual amount while its Mercado Pago plan id is missing', () => {
        expect(resolveAnnualPlanDisplay({
            annual: { amountCents: 282_438_000 },
        }, 27_690_000)).toEqual({
            displayPriceAnnualCents: null,
            mpPlanIdAnnual: null,
            annualDiscountPct: null,
        });
    });

    it('hides a provider id while its annual amount is missing', () => {
        expect(resolveAnnualPlanDisplay({
            annual: { mpPlanId: 'annual-plan-id' },
        }, 27_690_000)).toEqual({
            displayPriceAnnualCents: null,
            mpPlanIdAnnual: 'annual-plan-id',
            annualDiscountPct: null,
        });
    });

    it('rejects zero, fractional and non-object annual configurations', () => {
        expect(resolveAnnualPlanDisplay({ annual: { amountCents: 0, mpPlanId: 'id' } }, 100)).toMatchObject({
            displayPriceAnnualCents: null,
            annualDiscountPct: null,
        });
        expect(resolveAnnualPlanDisplay({ annual: { amountCents: 10.5, mpPlanId: 'id' } }, 100)).toMatchObject({
            displayPriceAnnualCents: null,
            annualDiscountPct: null,
        });
        expect(resolveAnnualPlanDisplay(null, 100)).toEqual({
            displayPriceAnnualCents: null,
            mpPlanIdAnnual: null,
            annualDiscountPct: null,
        });
    });
});
