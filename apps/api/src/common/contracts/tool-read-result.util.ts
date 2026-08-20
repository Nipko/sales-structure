/**
 * Helpers that build the read-result contract (`@parallext/shared`).
 *
 * The rule these enforce: a read that threw must never look like a read that
 * found nothing. `readOk`/`readEmpty` describe reality; `readFailed` and its
 * siblings carry `error`, which `conversations.service` already treats as a
 * failed tool call, so the model cannot claim an outcome on top of a broken
 * query.
 */
import {
    TOOL_READ_ERROR_CODES,
    TOOL_SOURCE_FRESHNESS_BUDGET_SECONDS,
    ToolReadFailure,
    ToolReadMeta,
    ToolReadResult,
    ToolSourceHealth,
    ToolSourceKind,
} from '@parallext/shared';

export interface ReadOkOptions {
    source?: ToolSourceKind;
    /** When the underlying data was known true. Defaults to now. */
    asOf?: Date | string;
    health?: ToolSourceHealth;
    /** Force the stale flag regardless of the freshness budget. */
    stale?: boolean;
    /**
     * Customer-safe explanation. Useful on `empty` too — "no configuraron el
     * servicio todavía" and "no hay cupo esa semana" are both empty, and the
     * agent must not conflate them. Never pass raw driver/exception text.
     */
    message?: string;
}

export interface ReadFailureOptions extends ReadOkOptions {
    retryable?: boolean;
}

function toIso(value?: Date | string): string {
    if (!value) return new Date().toISOString();
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

/**
 * A source is stale when its `asOf` is older than the budget for that kind of
 * system. `tenant_db` has a zero budget because it is always read live: if a
 * caller passes an old `asOf` for it, it is genuinely reporting a cached value
 * and must say so.
 */
export function isStale(source: ToolSourceKind, asOfIso: string): boolean {
    const budget = TOOL_SOURCE_FRESHNESS_BUDGET_SECONDS[source];
    if (!budget) return false;
    const ageSeconds = (Date.now() - new Date(asOfIso).getTime()) / 1000;
    return Number.isFinite(ageSeconds) && ageSeconds > budget;
}

function buildMeta(
    status: ToolReadMeta['status'],
    options: ReadFailureOptions = {},
): ToolReadMeta {
    const source = options.source || 'tenant_db';
    const asOf = toIso(options.asOf);
    const stale = options.stale ?? isStale(source, asOf);
    const meta: ToolReadMeta = { status, source, asOf };
    if (stale) meta.stale = true;
    if (options.health) meta.health = options.health;
    if (options.message) meta.message = options.message;
    return meta;
}

/**
 * Successful read. Emptiness is detected from the payload so a caller cannot
 * accidentally report `ok` for zero rows: `empty` is what makes "no encontré
 * nada" an honest answer instead of a guess.
 */
export function readOk<T extends Record<string, unknown>>(
    payload: T,
    options: ReadOkOptions = {},
): ToolReadResult<T> {
    const isEmpty = Object.values(payload).every(value => {
        if (Array.isArray(value)) return value.length === 0;
        if (value === null || value === undefined) return true;
        return false;
    });
    const meta = buildMeta(isEmpty ? 'empty' : 'ok', options);
    if (meta.stale) meta.status = 'stale';
    return { ...payload, ...meta };
}

/** Explicit "the query ran and there is genuinely nothing". */
export function readEmpty<T extends Record<string, unknown>>(
    payload: T,
    options: ReadOkOptions = {},
): ToolReadResult<T> {
    return { ...payload, ...buildMeta('empty', options) };
}

/** The read threw. Carries `error` so the turn cannot claim an outcome. */
export function readFailed(
    errorCode: string = TOOL_READ_ERROR_CODES.READ_FAILED,
    options: ReadFailureOptions = {},
): ToolReadFailure {
    return {
        ...buildMeta('error', {
            ...options,
            message: options.message || 'No pude consultar esa información en este momento.',
        }),
        status: 'error',
        error: errorCode,
        errorCode,
        retryable: options.retryable ?? true,
    };
}

/** An external system of record is unreachable or unhealthy. */
export function readProviderDown(
    source: ToolSourceKind,
    options: ReadFailureOptions = {},
): ToolReadFailure {
    return {
        ...buildMeta('provider_down', {
            ...options,
            source,
            health: options.health || 'down',
            message: options.message || 'El sistema del negocio no está respondiendo en este momento.',
        }),
        status: 'provider_down',
        error: TOOL_READ_ERROR_CODES.PROVIDER_DOWN,
        errorCode: TOOL_READ_ERROR_CODES.PROVIDER_DOWN,
        retryable: options.retryable ?? true,
    };
}

/** The caller may not see this data (ownership/step-up not satisfied). */
export function readUnauthorized(
    options: ReadFailureOptions = {},
): ToolReadFailure {
    return {
        ...buildMeta('unauthorized', {
            ...options,
            message: options.message || 'Necesito verificar la identidad antes de mostrar esta información.',
        }),
        status: 'unauthorized',
        error: TOOL_READ_ERROR_CODES.UNAUTHORIZED,
        errorCode: TOOL_READ_ERROR_CODES.UNAUTHORIZED,
        retryable: false,
    };
}

/** The integration this read depends on is not configured for the tenant. */
export function readNotConfigured(
    source: ToolSourceKind,
    options: ReadFailureOptions = {},
): ToolReadFailure {
    return {
        ...buildMeta('error', {
            ...options,
            source,
            message: options.message || 'Esa consulta necesita una integración que este negocio aún no conectó.',
        }),
        status: 'error',
        error: TOOL_READ_ERROR_CODES.NOT_CONFIGURED,
        errorCode: TOOL_READ_ERROR_CODES.NOT_CONFIGURED,
        retryable: false,
    };
}

/**
 * True when a tool result reports a failed read. Used by the pipeline and by
 * tests to assert that a broken query never backs a customer-facing claim.
 */
export function isFailedRead(result: unknown): boolean {
    if (!result || typeof result !== 'object') return false;
    const status = (result as ToolReadMeta).status;
    return status === 'error' || status === 'provider_down' || status === 'unauthorized';
}
