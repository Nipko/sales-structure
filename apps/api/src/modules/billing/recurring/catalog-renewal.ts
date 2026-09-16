import { resolveLocalPlanPrice } from '../plan-local-price.util';
import { wompiTransactionLimitViolation } from './renewal-scheduler.service';

/** Los cuatro planes estándar renuevan al catálogo; un contrato custom conserva su precio acordado. */
export const CATALOGUE_PRICED_PLANS = ['emprendedor', 'starter', 'pro', 'enterprise'];

/**
 * El importe del PRÓXIMO período, con la misma regla que usa la renovación.
 *
 * Existe para que el panel del cliente pueda mostrar lo que realmente se le va a
 * cobrar. `billing_subscriptions.chargeAmountCents` es el importe CONGELADO del
 * período que ya pasó, y el repricing ocurre dentro del scheduler, que sólo toma
 * suscripciones a 15 minutos del cobro: entre que cambia el catálogo y ese
 * momento, el cliente veía un importe y se le iba a cobrar otro.
 *
 * Devuelve el congelado cuando el catálogo no puede resolverse o cambiaría de
 * moneda — ahí la renovación se niega, así que prometer el precio nuevo sería
 * otra mentira distinta.
 */
export function resolveNextPeriodPrice(
    plan: { slug?: string; priceLocalOverrides?: any } | null | undefined,
    billingCountry: string | null | undefined,
    cycle: 'monthly' | 'annual',
    frozen: { amountCents?: number | null; currency?: string | null },
): { amountCents?: number | null; currency?: string | null } {
    if (!plan?.slug || !CATALOGUE_PRICED_PLANS.includes(plan.slug)) return frozen;
    const price = resolveLocalPlanPrice(plan.priceLocalOverrides, billingCountry as any, cycle);
    if (!price?.amountCents || !price.currency) return frozen;
    if (price.currency !== frozen.currency) return frozen;
    return price;
}

/** Freeze a catalogue price and its first attempt together; never reprice an existing attempt. */
export async function claimCatalogRenewal(prisma: any, engine: any, input: any) {
    return prisma.$transaction(async (tx: any) => {
        await tx.$queryRawUnsafe('SELECT id FROM public.billing_subscriptions WHERE id::uuid=$1::uuid FOR UPDATE', input.subscriptionId);
        const sub = await tx.billingSubscription.findUnique({
            where: { id: input.subscriptionId }, include: { plan: true, tenant: { select: { billingCountry: true } } },
        });
        if (!sub || !['active','past_due'].includes(sub.status) || sub.cancelAtPeriodEnd
            || sub.pendingUpgradePlanId || sub.engine !== 'internal'
            || (sub.pendingPlanId && sub.pendingPlanChangeAt && sub.pendingPlanChangeAt <= input.periodStart)
            || sub.currentPeriodEnd?.getTime() !== input.periodStart.getTime()) return null;
        const latest = await tx.billingChargeAttempt.findFirst({
            where: { subscriptionId: sub.id, purpose: 'renewal', periodStart: input.periodStart },
            orderBy: { attemptNumber: 'desc' },
        });
        if (latest && !['abandoned','superseded','stale'].includes(latest.status)) return null;
        // Explicit quotes for custom contracts retain their agreed price.
        const standard = ['emprendedor','starter','pro','enterprise'].includes(sub.plan.slug);
        const price = standard && !latest
            ? resolveLocalPlanPrice(sub.plan.priceLocalOverrides, sub.tenant.billingCountry,
                sub.metadata?.billingCycle === 'annual' ? 'annual' : 'monthly')
            : { amountCents: sub.chargeAmountCents, currency: sub.chargeCurrency };
        if (!price?.amountCents || !price.currency) throw new Error('renewal_catalog_price_unavailable');
        // A currency change requires a new payment agreement; never reinterpret a stored mandate.
        if (price.currency !== sub.chargeCurrency) throw new Error('renewal_currency_changed');
        const violation = sub.provider === 'wompi' && wompiTransactionLimitViolation(price.amountCents,price.currency);
        if (violation) throw new Error(violation.error);
        if (price.amountCents !== sub.chargeAmountCents) {
            await tx.billingSubscription.update({ where: { id: sub.id }, data: { chargeAmountCents: price.amountCents } });
            await tx.auditLog.create({ data: {
                tenantId: sub.tenantId, action: 'renewal_catalog_price_frozen', resource: `billing-subscriptions/${sub.id}`,
                details: { previousAmountCents: sub.chargeAmountCents, amountCents: price.amountCents,
                    currency: price.currency, periodStart: input.periodStart.toISOString(), planUpdatedAt: sub.plan.updatedAt },
            } });
        }
        return engine.claimAttempt({ ...input, ...price, provider: sub.provider, paymentSourceId: sub.defaultPaymentSourceId,
            attemptNumber: latest ? latest.attemptNumber + 1 : 1 },tx);
    });
}
