/**
 * Lo que el modelo puede leer de una herramienta que falló.
 *
 * Los handlers atrapan y devuelven `{ error: e.message }` — 52 veces —, y ese
 * texto se serializa entero al modelo, que se lo parafrasea al cliente. En la
 * prueba del 19-ago el huésped leyó *"necesito primero obtener el identificador
 * único del apartamento"*: era un mensaje escrito para coachear al modelo.
 *
 * El **código** de error (`unknown_property`, `slot_taken`) sí viaja: es corto,
 * estable y es sobre lo que el modelo tiene que razonar. Lo que se descarta es
 * la prosa técnica, que además ya quedó en nuestros logs — el diagnóstico nunca
 * dependió de que el modelo la viera.
 *
 * Es una lista de exclusión, no un contrato: alcanza para la clase de fuga
 * observada (excepciones en inglés, SQL, nombres de columna y de argumento).
 * El arreglo de fondo es que cada handler declare qué es para el modelo y qué
 * es para el cliente.
 */

/** Marcas de que el texto se escribió para un programador, no para un huésped. */
const INTERNAL_MARKERS = new RegExp([
    // SQL y base de datos
    '\\b(select|insert into|update|delete from|where|relation|column|constraint|schema|postgres|prisma|pgbouncer)\\b',
    // Tipos e identificadores del código
    '\\buuid\\b', '\\b[a-z][a-zA-Z0-9]*Id\\b', '\\b\\w+_id\\b', '\\b\\w+_[a-z]+s\\b',
    // Infraestructura
    '\\b(econnrefused|etimedout|socket hang up|timeout of|status code)\\b',
    // Restos de excepción
    '\\bat\\s+\\w+\\.\\w+', '^Error:', '\\bstack\\b',
    // Inglés técnico típico de una excepción no traducida
    '\\b(not found|must be|is required|failed to|cannot read|invalid)\\b',
].join('|'), 'i');

const NEUTRAL_REASON: Record<string, string> = {
    es: 'La operación no se pudo completar.',
    en: 'The operation could not be completed.',
    pt: 'A operação não pôde ser concluída.',
    fr: "L'opération n'a pas pu être effectuée.",
};

export function looksInternal(message: unknown): boolean {
    return typeof message === 'string' && INTERNAL_MARKERS.test(message);
}

/**
 * Devuelve el resultado tal cual cuando la operación salió bien: ahí el payload
 * ES el dato de negocio que el modelo necesita para responder.
 *
 * También limpia el campo `error` cuando trae prosa técnica. Los ~50 handlers
 * que hacen `return { error: e.message }` ponen el texto crudo del driver ahí,
 * no en `message`, así que el saneo original —que solo miraba `message`— los
 * dejaba pasar enteros: `relation "tenant_x.orders" does not exist` viajaba al
 * modelo, que se lo parafraseaba al cliente. Se reemplaza por un código
 * estable, que es sobre lo que el modelo tiene que razonar, y el detalle queda
 * en los logs, que es donde sirve.
 */
export function sanitizeToolResultForModel(result: any, lang?: string): any {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
    if (!result.error) return result;

    const L = (lang || 'es').slice(0, 2).toLowerCase();
    const neutral = NEUTRAL_REASON[L] || NEUTRAL_REASON.es;
    let sanitized = result;

    if (looksInternal(result.error)) {
        sanitized = {
            ...sanitized,
            error: 'tool_failed',
            message: looksInternal(sanitized.message) || !sanitized.message ? neutral : sanitized.message,
        };
    }
    if (looksInternal(sanitized.message)) {
        sanitized = { ...sanitized, message: neutral };
    }
    return sanitized;
}
