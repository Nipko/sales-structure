/**
 * Operar no es administrar el catálogo.
 *
 * Cada superficie vertical del panel es una de tres cosas, y de eso depende
 * quién tiene que poder abrirla:
 *
 * - `register` — el objeto que se trabaja todos los días: una estadía, una
 *   salida, una cita, un pedido, una solicitud. Quien atiende conversaciones
 *   tiene que llegar. Si cerró la reserva hablando con el cliente, tiene que
 *   poder verla después.
 * - `catalogue` — lo que **configura** ese objeto: la unidad, el paquete, el
 *   plan, el producto. Es trabajo de supervisión, y restringirlo no le quita
 *   trabajo a nadie.
 * - `mixed` — una pantalla que trae las dos cosas en pestañas. La abre quien
 *   opera —si no, se pierde la mitad operativa entera— y las acciones de
 *   catálogo se gatean **adentro**.
 *
 * El registro existe para que la asignación no se decida pantalla por
 * pantalla: así se llegó a tener las sesiones fotográficas —el registro de un
 * estudio— detrás del permiso de catálogo, y las pólizas y los socios detrás
 * del mismo permiso, con su mitad operativa inalcanzable para quien atiende.
 */

export type NavigationSurfaceKind = 'register' | 'catalogue' | 'mixed';

/**
 * Clave: el `verticalItem` del panel. La lista tiene que cubrirlos a todos —
 * una prueba de contrato lo verifica, así que un ítem nuevo no puede entrar
 * sin que alguien decida qué es.
 */
export const NAVIGATION_SURFACE_KIND: Readonly<Record<string, NavigationSurfaceKind>> = Object.freeze({
    // ── Registros operativos ──────────────────────────────────────────
    appointments: 'register',
    stays: 'register',
    tourBookings: 'register',
    foodOrders: 'register',
    orders: 'register',
    serviceRequests: 'register',
    resourceRentals: 'register',
    classes: 'register',
    pets: 'register',
    // El registro de un estudio de fotos: sesiones pedidas, agendadas y
    // entregadas. Vivía detrás del permiso de catálogo mientras su catálogo
    // real —los paquetes— ni siquiera tenía pantalla.
    photoSessions: 'register',

    // ── Catálogos ─────────────────────────────────────────────────────
    properties: 'catalogue',
    tours: 'catalogue',
    listings: 'catalogue',
    vehicles: 'catalogue',
    menu: 'catalogue',
    courses: 'catalogue',
    treatmentPlans: 'catalogue',
    inventory: 'catalogue',
    serviceCatalog: 'catalogue',

    // ── Mixtas: catálogo y operación en pestañas ──────────────────────
    // Seguros trae planes (catálogo) junto a cotizaciones, pólizas y
    // siniestros (operación pura). Membresías trae planes junto al padrón de
    // socios con congelar/descongelar y renovaciones. Dejarlas en el permiso
    // de catálogo escondía la mitad que se trabaja todos los días.
    insurance: 'mixed',
    memberships: 'mixed',
});

/** La capacidad del panel que cada tipo de superficie exige. */
export const SURFACE_KIND_CAPABILITY: Readonly<Record<NavigationSurfaceKind, string>> = Object.freeze({
    register: 'canHandleConversations',
    catalogue: 'canEditPipeline',
    // Se abre operando; el catálogo se gatea adentro de la pantalla.
    mixed: 'canHandleConversations',
});

export function navigationSurfaceKind(item: unknown): NavigationSurfaceKind | null {
    if (typeof item !== 'string') return null;
    return NAVIGATION_SURFACE_KIND[item] || null;
}

/** La capacidad que corresponde a un ítem, o `null` si no está clasificado. */
export function capabilityForSurface(item: unknown): string | null {
    const kind = navigationSurfaceKind(item);
    return kind ? SURFACE_KIND_CAPABILITY[kind] : null;
}

/** Los ítems clasificados, para las pruebas de contrato. */
export const CLASSIFIED_SURFACE_ITEMS: readonly string[] =
    Object.freeze(Object.keys(NAVIGATION_SURFACE_KIND));
