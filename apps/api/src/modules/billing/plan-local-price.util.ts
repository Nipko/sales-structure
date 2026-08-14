import { normalizeBillingCountry } from './billing-plan-catalog.service';
import type { BillingCycle } from './types/provider-types';

/**
 * El precio local de un plan para un país y ciclo: el importe que el catálogo le
 * mostró al cliente y el único que se le puede cobrar.
 *
 * Vive aparte porque lo necesitan dos flujos que no se conocen entre sí —el alta
 * y el armado del motor al guardar un medio de pago— y duplicarlo garantizaba
 * que se separaran. Ya pasó con la moneda del ciclo anual: la regla estaba en
 * dos lugares y sólo se arregló en uno.
 *
 * La fila anual HEREDA la moneda del país cuando no la repite, que es como la
 * deja el seed. Exigirla dentro de `annual` ataba el ciclo anual a haber
 * sincronizado con MercadoPago, el único que la escribía ahí.
 */
export function resolveLocalPlanPrice(
    priceLocalOverrides: unknown,
    billingCountry: string | null | undefined,
    cycle: BillingCycle,
): { amountCents: number; currency: string } | null {
    const country = normalizeBillingCountry(billingCountry ?? undefined) || 'CO';
    const overrides = priceLocalOverrides && typeof priceLocalOverrides === 'object'
        ? priceLocalOverrides as Record<string, any>
        : {};

    const countryEntry = Object.entries(overrides)
        .find(([key]) => normalizeBillingCountry(key) === country)?.[1];
    if (!countryEntry || typeof countryEntry !== 'object') return null;

    const entry = cycle === 'annual' ? countryEntry.annual : countryEntry;
    if (!entry || typeof entry !== 'object') return null;

    const amountCents = Number(entry.amountCents);
    const currency = String(entry.currency || countryEntry.currency || '').trim().toUpperCase();

    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || !currency) return null;
    return { amountCents, currency };
}
