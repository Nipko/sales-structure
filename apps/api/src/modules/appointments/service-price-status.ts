/**
 * D10 (sep-2026): where a service price came from.
 *
 * 'example'   — seeded by the industry recipe; nobody confirmed it.
 * 'confirmed' — the owner typed or confirmed it (0 means free).
 * 'quote'     — the business quotes case by case; there is no number.
 *
 * Only a confirmed price may be stated to a customer. Rows written before the
 * column existed have NULL, and every one of those was typed by a person.
 */
export type ServicePriceStatus = 'example' | 'confirmed' | 'quote';

export function servicePriceStatus(row: { price_status?: unknown } | null | undefined): ServicePriceStatus {
    const raw = row?.price_status;
    return raw === 'example' || raw === 'quote' ? raw : 'confirmed';
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
    const status = service.priceStatus ?? 'confirmed';
    return {
        id: service.id,
        name: service.name,
        durationMinutes: service.durationMinutes ?? undefined,
        price: status !== 'confirmed' ? undefined : (service.price ?? undefined),
        priceStatus: status,
        currency: service.currency ?? undefined,
    };
}
