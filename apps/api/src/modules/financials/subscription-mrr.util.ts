import { toUsdCents, type FxRateMap } from './fx.util';
/** MRR comes from the subscription's frozen price, not today's USD list price. */
export function subscriptionMrr(sub: any, rates: FxRateMap): number | null {
    if (!Number.isSafeInteger(sub.chargeAmountCents) || sub.chargeAmountCents < 0 || !sub.chargeCurrency) return null;
    const amount = toUsdCents(sub.chargeAmountCents,sub.chargeCurrency,rates);
    return amount === null ? null : Math.round(amount / (sub.metadata?.billingCycle === 'annual' ? 12 : 1));
}
