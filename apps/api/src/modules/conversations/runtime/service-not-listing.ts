import { normalizeForIntent } from '@parallext/shared';

/**
 * E2z P07-4 (inmobiliaria): «¿Cuántos metros y habitaciones tiene Avalúo comercial?» nombra un SERVICIO del negocio (un avalúo,
 * una asesoría, una visita guiada), no un inmueble. Las palabras de inmueble (metros, habitaciones) forzaban la lectura
 * `search_listings` sin filtros; devolvía el único inmueble del tenant y el modelo le atribuía sus 80 m² al servicio.
 *
 * El servicio de `<available_services>` que el mensaje nombra (nombre completo, plegado, de 4 letras o más), o null. Pura.
 */
export function namedCatalogService(text: unknown, services: ReadonlyArray<{ name?: unknown }> | undefined): string | null {
    const fold = (value: unknown) => normalizeForIntent(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const message = ` ${fold(text)} `;
    if (message.trim().length === 0) return null;
    for (const service of services ?? []) {
        const name = typeof service?.name === 'string' ? fold(service.name) : '';
        if (name.length >= 4 && message.includes(` ${name} `)) return String(service.name);
    }
    return null;
}

/** Operaciones de inmueble que una pregunta por un servicio no debe forzar. */
export const LISTING_READ_OPERATIONS: ReadonlySet<string> = new Set(['listing_info', 'find_listing']);

/** Lo que dice el resultado de `search_listings`: un servicio del negocio no es un inmueble. */
export const LISTING_SUBJECT_NOTE = 'These are the business\'s listings (properties). A service of the business (a valuation, an advisory, a guided visit) is not a listing: never attribute a listing\'s area, rooms, bathrooms or price to a service, and never present a listing as the service the customer named.';
