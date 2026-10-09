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
    // The offer of a person is for a customer who ASKS the price. A customer who is booking is not held back by it: the booking
    // goes ahead with the price pending (production 2026-10-09: «el precio no está confirmado… ¿le pido a alguien del equipo que
    // lo confirme y termine de reservar?» instead of booking).
    const NOT_A_CONDITION = ' Si el cliente solo quiere reservar, la reserva sigue adelante con el precio pendiente: no la condiciones a esa confirmación ni ofrezcas una persona "para confirmar el precio y terminar de reservar".';
    if (status === 'quote') return `El negocio cotiza este servicio según el caso: no digas ningún monto, ofrece que una persona lo cotice.${NOT_A_CONDITION}`;
    if (status === 'example') return `Precio pendiente de confirmar por el negocio: no digas ningún monto ni lo estimes; di que el precio no está confirmado y ofrece que una persona del equipo lo confirme.${NOT_A_CONDITION}`;
    return undefined;
}

/**
 * The service entry the prompt's <available_services> receives. The number
 * travels only when it is confirmed; the status always travels so the model
 * knows why there is no number.
 */
export function projectAvailableService(service: {
    id: string; name: string; description?: string | null; durationMinutes?: number | null; price?: number | null; currency?: string | null; priceStatus?: ServicePriceStatus | null;
}): { id: string; name: string; description?: string; durationMinutes?: number; price?: number; priceStatus?: ServicePriceStatus; currency?: string } {
    // What the service includes, as the owner wrote it: without it "¿qué incluye X?" has no answer in the
    // prompt and the model falls back to a "let me check" it can never keep.
    const description = typeof service.description === 'string' ? service.description.replace(/\s+/g, ' ').trim().slice(0, 280) : '';
    // A service object that says "confirmed" and carries a null price (a cached
    // list from before FX1) has nothing to state: same reading as
    // `customerFacingPrice`. `undefined` is a caller that sent no price at all.
    const declared = service.priceStatus ?? 'confirmed';
    const status: ServicePriceStatus = declared === 'confirmed' && service.price === null ? 'example' : declared;
    return {
        id: service.id,
        name: service.name,
        description: description || undefined,
        durationMinutes: service.durationMinutes ?? undefined,
        price: status !== 'confirmed' ? undefined : (service.price ?? undefined),
        priceStatus: status,
        currency: service.currency ?? undefined,
    };
}

/** Total characters of service descriptions one prompt carries (the catalog can be long; names and prices always travel). */
export const SERVICE_DESCRIPTION_BUDGET = 2048;

/**
 * The whole `<available_services>` list. Descriptions fit in a fixed budget, in the order of relevance:
 * the services the customer's message names first, then the rest in catalog order; a service that no
 * longer fits keeps its name, duration and price but loses its description.
 */
export function projectAvailableServices(
    services: ReadonlyArray<Parameters<typeof projectAvailableService>[0]>,
    userText?: string,
): Array<ReturnType<typeof projectAvailableService>> {
    const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const text = fold(String(userText ?? ''));
    const mentioned = (name: string) => { const n = fold(name).trim(); return n.length >= 3 && text.includes(n); };
    const projected = services.map(projectAvailableService);
    const order = projected.map((_, index) => index)
        .sort((a, b) => Number(mentioned(projected[b].name)) - Number(mentioned(projected[a].name)) || a - b);
    let left = SERVICE_DESCRIPTION_BUDGET;
    const keep = new Set<number>();
    for (const index of order) {
        const length = projected[index].description?.length ?? 0;
        if (length > 0 && length <= left) { keep.add(index); left -= length; }
    }
    return projected.map((service, index) => (service.description && !keep.has(index) ? { ...service, description: undefined } : service));
}
