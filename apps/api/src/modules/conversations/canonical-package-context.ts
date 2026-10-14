import type { TurnContext } from '@parallext/shared';

/** Project only bounded canonical reader fields; never FAQ prose, customer
 * input, availability, or arbitrary metadata into monetary authority. */
export function canonicalPackageCatalogue(result: any): NonNullable<TurnContext['catalog']> {
    if (!result || result.error || result.success === false || !Array.isArray(result.packages)) return [];
    return result.packages.slice(0, 20).flatMap((pkg: any) => {
        if (typeof pkg?.id !== 'string' || typeof pkg?.name !== 'string'
            || !pkg.id || !pkg.name || pkg.price === null || pkg.price === undefined || pkg.price === '') return [];
        const price = Number(pkg.price);
        if (!Number.isFinite(price) || price < 0) return [];
        return [{ id: pkg.id, title: pkg.name, price,
            ...(typeof pkg.currency === 'string' && pkg.currency.trim() ? { currency: pkg.currency } : {}) }];
    });
}
