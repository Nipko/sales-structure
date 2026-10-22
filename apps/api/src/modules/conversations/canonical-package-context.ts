import type { TurnContext } from '@parallext/shared';
import { catalogPriceStatus, type CatalogPriceStatus } from './catalog-price-status';

/** Project only bounded canonical reader fields; never FAQ prose, customer
 * input, availability, or arbitrary metadata into monetary authority. The
 * entry carries the same `priceStatus` the package readers return, so the
 * turn's `<catalog>` tells a confirmed amount from a missing one (a 0). */
export function canonicalPackageCatalogue(result: any): Array<NonNullable<TurnContext['catalog']>[number] & { priceStatus: CatalogPriceStatus }> {
    if (!result || result.error || result.success === false
        || ['failed', 'error', 'unauthorized', 'provider_down', 'not_configured'].includes(result.status)
        || !Array.isArray(result.packages)) return [];
    return result.packages.slice(0, 20).flatMap((pkg: any) => {
        if (typeof pkg?.id !== 'string' || typeof pkg?.name !== 'string'
            || !pkg.id || !pkg.name || !['number', 'string'].includes(typeof pkg.price)
            || (typeof pkg.price === 'string' && !pkg.price.trim())) return [];
        const price = Number(pkg.price);
        if (!Number.isFinite(price) || price < 0) return [];
        return [{ id: pkg.id, title: pkg.name, price, priceStatus: catalogPriceStatus(price),
            ...(typeof pkg.currency === 'string' && pkg.currency.trim() ? { currency: pkg.currency } : {}) }];
    });
}
