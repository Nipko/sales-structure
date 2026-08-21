/**
 * Lo que hay que poder contar para saber si la navegación mejoró.
 *
 * El Gate 4 dice "cero opción visible que termina en 403 o dead end". Las
 * pruebas lo verifican estructuralmente —los mapas, los permisos, las rutas—
 * pero la estructura sólo cubre lo que alguien pensó en declarar. Un tenant con
 * una configuración rara, un enlace guardado de hace tres meses o un rol que
 * cambió a mitad de sesión producen el mismo síntoma sin que ningún mapa esté
 * mal. Contarlos es la única forma de enterarse.
 *
 * Deliberadamente **sólo lo excepcional**. Emitir cada vista de ruta de cada
 * usuario sería un volumen que le cuesta almacenamiento al tenant para medir
 * lo que ya funciona; un 403 y un callejón sin salida son raros por
 * construcción, y si dejan de serlo eso es exactamente el hallazgo.
 */

export const NAVIGATION_TELEMETRY_EVENTS = [
    /** El rol abrió una ruta que su permiso no alcanza y fue redirigido. */
    'navigation.access_denied',
    /** Una opción visible que no lleva a ninguna parte utilizable. */
    'navigation.dead_end',
    /** Clic en una opción que el plan del tenant no incluye. */
    'navigation.plan_locked',
] as const;

export type NavigationTelemetryEvent = typeof NAVIGATION_TELEMETRY_EVENTS[number];

/**
 * Los únicos campos que se guardan.
 *
 * Nada de esto identifica a una persona: no hay nombre, correo, teléfono ni
 * texto libre. Un allowlist y no un denylist, porque un denylist crece cada vez
 * que alguien agrega un campo y el día que se atrasa es el día que se guarda
 * un dato personal en una tabla de analítica.
 */
export const NAVIGATION_TELEMETRY_FIELDS = [
    /** Ruta del panel, sin query ni ids. */
    'route',
    /** Motivo tipado: `role`, `vertical`, `plan`, `unknown_route`. */
    'reason',
    /** Rol efectivo en el momento del evento. */
    'role',
    /** Capacidad o feature de plan que faltó. */
    'requirement',
] as const;

export type NavigationTelemetryField = typeof NAVIGATION_TELEMETRY_FIELDS[number];

export const NAVIGATION_TELEMETRY_REASONS = [
    'role', 'vertical', 'plan', 'unknown_route',
] as const;

export type NavigationTelemetryReason = typeof NAVIGATION_TELEMETRY_REASONS[number];

export interface NavigationTelemetryRecord {
    event: NavigationTelemetryEvent;
    route: string;
    reason: NavigationTelemetryReason;
    role?: string;
    requirement?: string;
}

/** Tope de un lote. Un cliente que manda mil eventos está roto, no midiendo. */
export const NAVIGATION_TELEMETRY_MAX_BATCH = 20;

const EVENTS = new Set<string>(NAVIGATION_TELEMETRY_EVENTS);
const REASONS = new Set<string>(NAVIGATION_TELEMETRY_REASONS);
/** Rutas del panel: sin protocolo, sin host, sin query. */
const ROUTE_RE = /^\/admin(?:\/[a-z0-9-]+)*$/;
/**
 * Un id en la ruta es un dato de negocio, no una ruta.
 *
 * `/admin/contacts/<uuid>` pasa el patrón de arriba —un uuid es válido como
 * segmento— y guardarlo metería el identificador de un contacto en una tabla
 * de analítica. Se rechaza el registro entero: recortarlo dejaría una ruta que
 * no es la que ocurrió.
 */
const ID_SEGMENT_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[0-9a-f]{16,})$/i;
const SHORT_TOKEN_RE = /^[a-zA-Z0-9_]{1,64}$/;

/**
 * Deja pasar sólo lo que el contrato declara.
 *
 * Descarta el registro entero ante cualquier campo desconocido en vez de
 * limpiarlo: un cliente que manda de más está mal, y guardarle la mitad
 * buena esconde el problema hasta que aparezca un dato que no debía estar.
 */
export function sanitizeNavigationTelemetry(input: unknown): NavigationTelemetryRecord | null {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const raw = input as Record<string, unknown>;

    const event = raw.event;
    if (typeof event !== 'string' || !EVENTS.has(event)) return null;

    const allowed = new Set<string>([...NAVIGATION_TELEMETRY_FIELDS, 'event']);
    for (const key of Object.keys(raw)) {
        if (!allowed.has(key)) return null;
    }

    const route = raw.route;
    if (typeof route !== 'string' || !ROUTE_RE.test(route)) return null;
    if (route.split('/').some((segment) => ID_SEGMENT_RE.test(segment))) return null;

    const reason = raw.reason;
    if (typeof reason !== 'string' || !REASONS.has(reason)) return null;

    const record: NavigationTelemetryRecord = {
        event: event as NavigationTelemetryEvent,
        route,
        reason: reason as NavigationTelemetryReason,
    };
    if (raw.role !== undefined) {
        if (typeof raw.role !== 'string' || !SHORT_TOKEN_RE.test(raw.role)) return null;
        record.role = raw.role;
    }
    if (raw.requirement !== undefined) {
        if (typeof raw.requirement !== 'string' || !SHORT_TOKEN_RE.test(raw.requirement)) return null;
        record.requirement = raw.requirement;
    }
    return record;
}

/** Un lote saneado. Los registros inválidos se descartan uno a uno. */
export function sanitizeNavigationTelemetryBatch(input: unknown): NavigationTelemetryRecord[] {
    if (!Array.isArray(input)) return [];
    return input
        .slice(0, NAVIGATION_TELEMETRY_MAX_BATCH)
        .map(sanitizeNavigationTelemetry)
        .filter((record): record is NavigationTelemetryRecord => record !== null);
}
