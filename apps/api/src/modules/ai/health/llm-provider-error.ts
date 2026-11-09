/**
 * Clasificacion de errores de proveedores LLM (ADR-0026).
 *
 * El router solo distinguia "rompe el breaker" de "no lo rompe", y metia en el
 * mismo saco un limite de velocidad pasajero y una cuenta sin saldo: los dos
 * son 429 en OpenAI. El 8-nov-2026 OpenAI respondio "429 You have no credits
 * remaining" mas de 5.000 veces y no se encendio ninguna alarma, porque un 429 "no es un
 * problema de salud". Una cuenta sin credito no se arregla sola: es la falla
 * mas grave que puede tener un proveedor, y tiene que poder nombrarse.
 */
export type ProviderErrorKind =
    /** Sin creditos / cuota agotada / saldo insuficiente. No se arregla solo. */
    | 'quota'
    /** Clave invalida, revocada o sin permisos. No se arregla sola. */
    | 'auth'
    /** Limite de velocidad: pasajero. */
    | 'rate_limit'
    /** 5xx, sobrecarga, timeouts y errores de red. */
    | 'unavailable'
    /** El modelo no existe o fue retirado para esta cuenta. */
    | 'model_not_found'
    /** Peticion mal formada: culpa nuestra, no del proveedor. */
    | 'bad_request'
    | 'unknown';

const NETWORK_CODES = new Set([
    'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE',
    'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET',
]);
const NETWORK_ERROR_NAMES = new Set([
    'APIConnectionTimeoutError', 'APIConnectionError', 'AbortError', 'TimeoutError', 'FetchError',
]);

/**
 * Frases con las que cada proveedor dice "no hay saldo".
 * - OpenAI: code `insufficient_quota`; "You have no credits remaining",
 *   "You exceeded your current quota, please check your plan and billing details".
 * - Anthropic: 400 "Your credit balance is too low to access the Anthropic API".
 * - DeepSeek: 402 "Insufficient Balance".
 * - xAI: 403/429 "...doesn't have any credits..." / "...used all available
 *   credits or reached its monthly spending limit".
 */
const QUOTA_PATTERN = /insufficient[_ ]quota|no credits|credit balance|insufficient balance|out of credits|any credits|available credits|spending limit|billing hard limit|exceeded your current quota|add credits/i;

const AUTH_PATTERN = /invalid[_ -]?(x-)?api[_ -]?key|incorrect api key|api key not valid|api_key_invalid|invalid authentication|authentication_error|unauthori[sz]ed|permission[_ ]denied|api key not configured|key (was )?revoked/i;

const MODEL_PATTERN = /model[^.]*(not found|does not exist|no longer available|not_found|deprecated)|model_not_found/i;

function statusOf(err: any): number | undefined {
    const raw = err?.status ?? err?.statusCode ?? err?.response?.status ?? err?.error?.code;
    const n = typeof raw === 'string' ? Number(raw) : raw;
    return typeof n === 'number' && Number.isFinite(n) && n >= 100 && n < 600 ? n : undefined;
}

function textOf(err: any): string {
    const parts = [
        err?.message,
        err?.code,
        err?.type,
        err?.error?.message,
        err?.error?.code,
        err?.error?.type,
        err?.error?.status,
        err?.error?.error?.message,
        err?.error?.error?.type,
    ];
    return parts.filter(p => typeof p === 'string').join(' | ');
}

/**
 * Clasifica un error de proveedor. Es una funcion pura: recibe lo que lanzan
 * los SDKs (OpenAI, Anthropic, Google) o el objeto que arma la sonda a partir
 * de una respuesta HTTP (`{ status, code, message }`).
 */
export function classifyProviderError(err: any, provider?: string): ProviderErrorKind {
    if (!err) return 'unknown';
    const code = err?.code || err?.cause?.code;
    if (typeof code === 'string' && NETWORK_CODES.has(code)) return 'unavailable';
    if (NETWORK_ERROR_NAMES.has(err?.name)) return 'unavailable';

    const status = statusOf(err);
    const text = textOf(err);

    // Sin saldo primero: OpenAI y xAI lo devuelven como 429 o 403, Anthropic
    // como 400. Si el mensaje dice "credito", el codigo HTTP no manda.
    // Excepcion: Google responde "You exceeded your current quota" tambien en
    // los limites por minuto, asi que su 429 se queda en rate_limit.
    const googleRateLimit = provider === 'google' && status === 429;
    if (!googleRateLimit && (status === 402 || QUOTA_PATTERN.test(text))) return 'quota';

    if (status === 401 || AUTH_PATTERN.test(text)) return 'auth';
    if (status === 403) return 'auth';
    if (status === 429 || /rate[_ ]limit|too many requests|resource_exhausted/i.test(text)) return 'rate_limit';
    if (status !== undefined && status >= 500) return 'unavailable';
    if (/overloaded|timed? ?out|socket hang up|network/i.test(text)) return 'unavailable';
    if (status === 404 || MODEL_PATTERN.test(text)) return 'model_not_found';
    if (status !== undefined && status >= 400) return 'bad_request';
    return 'unknown';
}

/** Errores que dejan la cuenta inutilizable hasta que una persona actue. */
export function isAccountFailure(kind: ProviderErrorKind): boolean {
    return kind === 'quota' || kind === 'auth';
}

/** Mensaje corto y sin secretos para guardar como "ultimo error". */
export function summarizeProviderError(err: any): string {
    const text = (err?.message || err?.error?.message || String(err ?? 'error')).toString();
    return text
        .replace(/(sk|xai|gsk|AIza)[-_A-Za-z0-9]{8,}/g, '$1-***')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);
}

export const PROVIDER_ERROR_LABEL_ES: Record<ProviderErrorKind, string> = {
    quota: 'sin creditos / cuota agotada',
    auth: 'clave invalida o revocada',
    rate_limit: 'limite de velocidad',
    unavailable: 'caido / timeout',
    model_not_found: 'modelo no disponible',
    bad_request: 'peticion rechazada',
    unknown: 'error desconocido',
};
