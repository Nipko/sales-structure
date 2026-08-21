/**
 * Dónde vive, en el panel, el objeto del que se está hablando.
 *
 * El Inbox mostraba el contacto y el canal, y nada del objeto operativo: quien
 * atendía leía "confirmame la reserva" y tenía que adivinar cuál, salir a
 * buscarla y volver. El agente de IA ya recibe ese objeto en cada turno
 * (`activeObjects`) con una lista de campos acotada; lo que faltaba era
 * dársela también a la persona, y con un lugar al que ir.
 *
 * El enlace no es decorativo: el plan exige que todo objeto que el agente toca
 * tenga **deep link humano**. Un panel que muestra una reserva sin decir dónde
 * está la deja tan lejos como antes.
 */

// SOLO el tipo. `index.ts` re-exporta este archivo desde su línea 41 y define
// `ACTIVE_OBJECT_KINDS` recién en la 700: importar el VALOR lo dejaría
// `undefined` en tiempo de evaluación del módulo, y el fallo aparece al
// arrancar Nest, lejos de acá.
import type { ActiveObjectKind } from './index';

/**
 * Ruta del panel donde se trabaja cada tipo de objeto.
 *
 * `null` es una decisión declarada, no un olvido: ese objeto todavía no tiene
 * pantalla propia y el panel lo muestra sin enlace en vez de mandar a una ruta
 * inventada que termina en 404.
 */
const DEEP_LINKS: Readonly<Record<ActiveObjectKind, string | null>> = Object.freeze({
    // ── Registros operativos con pantalla propia ──────────────────────
    appointment: '/admin/appointments',
    order: '/admin/orders',
    food_order: '/admin/food-orders',
    property_booking: '/admin/stays',
    tour_booking: '/admin/tour-bookings',
    service_request: '/admin/service-requests',
    photo_session: '/admin/photo-sessions',
    class_booking: '/admin/classes',
    membership: '/admin/memberships',
    treatment_plan: '/admin/treatment-plans',
    treatment_session: '/admin/treatment-plans',
    pet: '/admin/pets',
    enrollment: '/admin/courses',

    // ── Catálogo: el sujeto del objeto, no el objeto ──────────────────
    catalog_item: '/admin/inventory',
    real_estate_listing: '/admin/listings',
    vehicle: '/admin/vehicles',
    tour_package: '/admin/tours',
    property: '/admin/properties',
    course: '/admin/courses',

    // ── Seguros: las tres viven en pestañas de una misma pantalla ─────
    // El `?tab=` es parte del enlace: sin él, quien viene del Inbox por un
    // siniestro aterriza en la pestaña de planes y tiene que buscar de nuevo.
    // Llegar a la pantalla no es llegar al objeto.
    insurance_policy: '/admin/insurance?tab=policies',
    insurance_claim: '/admin/insurance?tab=claims',
    insurance_quote: '/admin/insurance?tab=quotes',

    // Sin pantalla propia todavía. Se muestra sin enlace: mandar a una ruta
    // inventada es peor que no ofrecer ninguna.
    professional_case: null,
});

export function deepLinkForActiveObject(kind: unknown): string | null {
    if (typeof kind !== 'string') return null;
    return DEEP_LINKS[kind as ActiveObjectKind] ?? null;
}

/** Sólo la ruta, sin el `?tab=`, para verificarla contra el registro. */
export function deepLinkRouteForActiveObject(kind: unknown): string | null {
    const href = deepLinkForActiveObject(kind);
    return href ? href.split('?')[0] : null;
}

/** Los tipos que hoy tienen dónde abrirse, para pruebas de contrato. */
export const LINKED_ACTIVE_OBJECT_KINDS: readonly ActiveObjectKind[] = Object.freeze(
    (Object.keys(DEEP_LINKS) as ActiveObjectKind[]).filter((kind) => DEEP_LINKS[kind] !== null),
);

export const ACTIVE_OBJECT_DEEP_LINKS: Readonly<Record<ActiveObjectKind, string | null>> = DEEP_LINKS;
