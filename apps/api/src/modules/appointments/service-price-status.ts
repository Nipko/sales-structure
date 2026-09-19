/**
 * D10 (sep-2026): where a service price came from.
 *
 * 'example'   — seeded by the industry recipe; nobody confirmed it.
 * 'confirmed' — the owner typed or confirmed it (0 means free, and since FX1 a
 *               0 is only written as free when the owner says so: `free: true`).
 * 'quote'     — the business quotes case by case; there is no number.
 *
 * Only a confirmed price may be stated to a customer. A NULL status reads as
 * 'confirmed': the column has no default, every writer of this code declares
 * the status, and a NULL is a row written by code that did not know the column
 * (see `tenant-schema.sql` and `verticals/seeded-price-backfill.ts` for the
 * seed rows among them, which each deploy repairs).
 */
export type ServicePriceStatus = 'example' | 'confirmed' | 'quote';

export function servicePriceStatus(row: { price_status?: unknown } | null | undefined): ServicePriceStatus {
    const raw = row?.price_status;
    return raw === 'example' || raw === 'quote' ? raw : 'confirmed';
}

/** The amount a row carries. NULL, '' or a non-number is no amount — never 0. */
export function storedPriceAmount(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === '') return null;
    const amount = Number(raw);
    return Number.isFinite(amount) ? amount : null;
}

/**
 * FX1: what a customer may be told about a row's price — the one reading every
 * customer-facing projection uses.
 *
 * D17 seeds services WITHOUT an amount outside the six countries that have an
 * example, and a service created without a price stores none either. A row
 * like that is "no price yet", whatever its status says: before FX1 the
 * projections coerced the NULL (`Number(s.price || 0)`) and handed the model
 * `price: 0` next to `priceStatus: 'confirmed'`, which is a free service stated
 * as fact. It reads as 'example' — "te confirman el precio" — because that is
 * the truth the model can act on. A confirmed 0 stays 0: that one is free.
 */
export function customerFacingPrice(row: { price?: unknown; price_status?: unknown } | null | undefined): { priceStatus: ServicePriceStatus; price: number | null } {
    const status = servicePriceStatus(row);
    if (status !== 'confirmed') return { priceStatus: status, price: null };
    const amount = storedPriceAmount(row?.price);
    return amount === null ? { priceStatus: 'example', price: null } : { priceStatus: 'confirmed', price: amount };
}

/** The instruction the model gets instead of a number. */
export function servicePriceNote(status: ServicePriceStatus): string | undefined {
    if (status === 'quote') return 'El negocio cotiza este servicio según el caso: no digas ningún monto, ofrece que una persona lo cotice.';
    if (status === 'example') return 'Precio pendiente de confirmar por el negocio: no digas ningún monto ni lo estimes; di que te lo confirman.';
    return undefined;
}

/**
 * The service entry the prompt's <available_services> receives. The number
 * travels only when it is confirmed; the status always travels so the model
 * knows why there is no number.
 */
export function projectAvailableService(service: {
    id: string; name: string; durationMinutes?: number | null; price?: number | null; currency?: string | null; priceStatus?: ServicePriceStatus | null;
}): { id: string; name: string; durationMinutes?: number; price?: number; priceStatus?: ServicePriceStatus; currency?: string } {
    // A service object that says "confirmed" and carries a null price (a cached
    // list from before FX1) has nothing to state: same reading as
    // `customerFacingPrice`. `undefined` is a caller that sent no price at all.
    const declared = service.priceStatus ?? 'confirmed';
    const status: ServicePriceStatus = declared === 'confirmed' && service.price === null ? 'example' : declared;
    return {
        id: service.id,
        name: service.name,
        durationMinutes: service.durationMinutes ?? undefined,
        price: status !== 'confirmed' ? undefined : (service.price ?? undefined),
        priceStatus: status,
        currency: service.currency ?? undefined,
    };
}
