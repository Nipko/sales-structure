import { ProviderErrorKind } from './llm-provider-error';

/**
 * Estado de salud de un proveedor LLM (ADR-0026). Funciones puras: el servicio
 * las alimenta con lo que observa (trafico real y sonda) y persiste el
 * resultado en Redis, compartido por la API, el worker y los runners de QA.
 */
export type ProviderStatus =
    /** Sin observaciones todavia. */
    | 'unknown'
    | 'healthy'
    /** Responde, pero con limites de velocidad o fallos sueltos. */
    | 'degraded'
    /** Fallos de disponibilidad seguidos: 5xx, timeouts, red. */
    | 'down'
    | 'no_credits'
    | 'auth_invalid';

/** Estados que exigen que una persona actue y que solo un exito despeja. */
export const SEVERE_STATUSES: ReadonlySet<ProviderStatus> = new Set<ProviderStatus>(['down', 'no_credits', 'auth_invalid']);

export const DOWN_AFTER_CONSECUTIVE_FAILURES = 3;

/**
 * Un proveedor en estado grave solo se da por recuperado con un exito que
 * llegue al menos este tiempo despues del ultimo error.
 */
export const RECOVERY_QUIET_MS = 2 * 60 * 1000;

export type ObservationSource = 'traffic' | 'probe';

export type ProviderObservation =
    | { ok: true; at: number; source: ObservationSource; model?: string }
    | { ok: false; at: number; source: ObservationSource; model?: string; kind: ProviderErrorKind; message: string };

export interface ProviderState {
    status: ProviderStatus;
    /** Desde cuando esta en `status`. */
    since: number | null;
    consecutiveFailures: number;
    /** Primer error de la racha actual (se limpia con un exito). */
    firstErrorAt: number | null;
    lastErrorAt: number | null;
    lastErrorKind: ProviderErrorKind | null;
    lastErrorMessage: string | null;
    lastErrorModel: string | null;
    lastErrorSource: ObservationSource | null;
    lastSuccessAt: number | null;
}

export const INITIAL_PROVIDER_STATE: ProviderState = Object.freeze({
    status: 'unknown',
    since: null,
    consecutiveFailures: 0,
    firstErrorAt: null,
    lastErrorAt: null,
    lastErrorKind: null,
    lastErrorMessage: null,
    lastErrorModel: null,
    lastErrorSource: null,
    lastSuccessAt: null,
}) as ProviderState;

export interface ProviderTransition {
    from: ProviderStatus;
    to: ProviderStatus;
}

function statusAfterFailure(prev: ProviderState, kind: ProviderErrorKind, consecutive: number): ProviderStatus {
    if (kind === 'quota') return 'no_credits';
    if (kind === 'auth') return 'auth_invalid';
    // Un fallo menos especifico no tapa un diagnostico mas grave: una cuenta
    // sin credito que ademas da un timeout sigue estando sin credito.
    if (prev.status === 'no_credits' || prev.status === 'auth_invalid') return prev.status;
    // Errores del modelo o de la peticion no dicen nada de la salud del proveedor.
    if (kind === 'model_not_found' || kind === 'bad_request') {
        return prev.status === 'unknown' ? 'unknown' : prev.status;
    }
    if (kind === 'rate_limit') return prev.status === 'down' ? 'down' : 'degraded';
    // unavailable / unknown
    return consecutive >= DOWN_AFTER_CONSECUTIVE_FAILURES ? 'down' : (prev.status === 'down' ? 'down' : 'degraded');
}

/**
 * Siguiente estado a partir de una observacion. Devuelve la transicion cuando
 * el estado cambia; el aviso se decide sobre la transicion, no sobre cada error.
 */
export function nextProviderState(
    prev: ProviderState,
    obs: ProviderObservation,
): { state: ProviderState; transition: ProviderTransition | null } {
    let state: ProviderState;
    if (obs.ok && SEVERE_STATUSES.has(prev.status) && prev.lastErrorAt !== null
        && obs.at - prev.lastErrorAt < RECOVERY_QUIET_MS) {
        // Histeresis: un exito suelto entre errores recientes no despeja el
        // estado grave. Mientras se agota el credito, o con varias peticiones en
        // vuelo, llegan exitos intercalados con 429; sin esto el incidente se
        // abria y cerraba en cada uno (60 veces en 10 min el 10-nov-2026).
        state = { ...prev, lastSuccessAt: obs.at };
    } else if (obs.ok) {
        state = {
            ...prev,
            status: 'healthy',
            consecutiveFailures: 0,
            firstErrorAt: null,
            lastSuccessAt: obs.at,
            since: prev.status === 'healthy' ? prev.since : obs.at,
        };
    } else {
        const countsAsOutage = obs.kind === 'unavailable' || obs.kind === 'unknown';
        const consecutive = countsAsOutage ? prev.consecutiveFailures + 1 : prev.consecutiveFailures;
        const status = statusAfterFailure(prev, obs.kind, consecutive);
        state = {
            ...prev,
            status,
            consecutiveFailures: consecutive,
            firstErrorAt: prev.firstErrorAt ?? obs.at,
            lastErrorAt: obs.at,
            lastErrorKind: obs.kind,
            lastErrorMessage: obs.message,
            lastErrorModel: obs.model ?? null,
            lastErrorSource: obs.source,
            since: status === prev.status ? prev.since : obs.at,
        };
    }
    const transition = state.status !== prev.status ? { from: prev.status, to: state.status } : null;
    return { state, transition };
}

/**
 * Hay que avisar? Al entrar a un estado grave, y al salir de uno (recuperado).
 * Pasar de grave a grave (p. ej. caido -> sin creditos) tambien avisa, porque
 * cambia lo que hay que hacer.
 */
export function alertForTransition(t: ProviderTransition | null): 'outage' | 'recovery' | null {
    if (!t) return null;
    if (SEVERE_STATUSES.has(t.to)) return 'outage';
    if (SEVERE_STATUSES.has(t.from) && t.to === 'healthy') return 'recovery';
    return null;
}

export interface FallbackWindow {
    total: number;
    fallback: number;
}

export const FALLBACK_ALERT_MIN_TURNS = 10;
export const FALLBACK_ALERT_RATIO = 0.2;

/** El trafico esta cayendo al fallback de forma sostenida? */
export function fallbackIsSignificant(w: FallbackWindow): boolean {
    return w.total >= FALLBACK_ALERT_MIN_TURNS && w.fallback / w.total >= FALLBACK_ALERT_RATIO;
}

export const PROVIDER_STATUS_LABEL_ES: Record<ProviderStatus, string> = {
    unknown: 'sin datos',
    healthy: 'sano',
    degraded: 'degradado',
    down: 'caido',
    no_credits: 'sin creditos',
    auth_invalid: 'clave invalida',
};
