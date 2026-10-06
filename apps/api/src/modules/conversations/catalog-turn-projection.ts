import type { TurnContext } from '@parallext/shared';

type CatalogItem = NonNullable<TurnContext['catalog']>[number];

/**
 * A row of the tenant's own `products` as the turn's `<catalog>` entry. The quantity travels
 * with the availability flag: with only `in_stock="true"` a compound question (price, stock
 * and warranty in one message) was answered from the catalog without a tool call and the
 * model could say "hay unidades" but not how many. A product that does not track stock
 * (null) states no quantity.
 */
export function projectOwnCatalogRow(row: any): CatalogItem & { priceStatus: 'confirmed' | 'missing' } {
    const price = Number(row.price);
    const priced = Number.isFinite(price) && price > 0;
    const stock = row.stock == null ? null : Number(row.stock);
    return {
        id: String(row.id),
        title: String(row.name),
        ...(priced ? { price } : {}),
        priceStatus: priced ? 'confirmed' as const : 'missing' as const,
        currency: row.currency || undefined,
        inStock: stock == null || stock > 0,
        ...(stock != null && Number.isFinite(stock) ? { stock } : {}),
        category: row.category || undefined,
    };
}

/**
 * A synced store product. Deliberately carries NO quantity: the sync stores untracked stock
 * as 0, reads only the first variant and can hold negative oversell, so the number is not
 * something the model may tell a customer. Only the flag travels; check_stock is the source.
 */
export function projectEcommerceCatalogRow(p: any): CatalogItem {
    return {
        id: String(p.external_id),
        title: p.title,
        price: p.price_cents != null ? Number(p.price_cents) / 100 : undefined,
        currency: p.currency || 'USD',
        inStock: (p.inventory_quantity ?? 0) > 0,
        category: p.product_type || undefined,
    };
}
