import { subscriptionMrr } from './subscription-mrr.util';
describe('subscription MRR', () => {
    const rates = new Map([['COP',1/4200],['USD',1]]);
    it('normalizes the actual annual price instead of monthly list USD', () => {
        expect(subscriptionMrr({chargeAmountCents:323892000,chargeCurrency:'COP',metadata:{billingCycle:'annual'},plan:{priceUsdCents:1}},rates)).toBe(6426);
    });
    it('does not turn missing currency or frozen amount into a fictional price', () => {
        expect(subscriptionMrr({plan:{priceUsdCents:6900}},rates)).toBeNull();
        expect(subscriptionMrr({chargeAmountCents:5000,chargeCurrency:'EUR'},rates)).toBeNull();
    });
});
