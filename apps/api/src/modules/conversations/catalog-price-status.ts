import { storedPriceAmount, type ServicePriceStatus } from '../appointments/service-price-status';

/**
 * What a catalogue reader may tell the model about the amount it returns.
 *
 * 'confirmed' — the amount is the business's current price: quote it.
 * 'example' / 'quote' — an explicit `price_status` column says the number is a
 *               seed example or that the business quotes case by case.
 * 'missing'   — there is no amount (NULL, '', a non-number, 0 or less).
 */
export type CatalogPriceStatus = ServicePriceStatus | 'missing';

/**
 * The one reading every catalogue projection uses for its `priceStatus`.
 *
 * Prompt rule 22a lets the model quote an amount only from a catalogue result
 * whose `priceStatus` is "confirmed". Products, listings, properties, packages,
 * menu items, vehicles and courses have no `price_status` column: a positive
 * price the owner typed IS the confirmed price. Before this helper only product
 * readers said so, and the agent told a buyer that the 250.000 a listing carried
 * "no está confirmado" (production 2026-10-22); the hotel, travel and menu
 * agents denied their prices the same way.
 *
 * Where the entity does have the column (services, membership plans) the
 * explicit status wins: 'example' and 'quote' are never quotable, and an
 * explicit 'confirmed' 0 is a price the owner declared free.
 */
export function catalogPriceStatus(price: unknown, explicitStatus?: unknown): CatalogPriceStatus {
    if (explicitStatus === 'example' || explicitStatus === 'quote') return explicitStatus;
    const amount = storedPriceAmount(price);
    if (amount === null || amount < 0) return 'missing';
    if (amount > 0) return 'confirmed';
    return explicitStatus === 'confirmed' ? 'confirmed' : 'missing';
}
