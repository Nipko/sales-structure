import { TOOL_AUTHORITY_DENIAL_ERRORS } from '@parallext/shared';
import type { ServiceExecutionContext } from '../../common/types/execution-context';

/**
 * Cómo terminó una llamada a una tool, en las cuatro clases que el panel de
 * superadmin distingue.
 *
 * - `ok`: el handler respondió sin `error` (una lectura vacía también es ok).
 * - `pending`: la acción quedó esperando al cliente o a una persona
 *   (`confirmation_required`, `approval_required`). No es una falla: es el
 *   contrato de escritura funcionando.
 * - `blocked`: la puerta común la frenó antes del handler (autoridad, Agent
 *   Test de solo lectura, borrador sin aprobación, `controlBlocked`).
 * - `error`: el handler devolvió `error` o lanzó una excepción.
 */
export type ToolUsageOutcome = 'ok' | 'error' | 'blocked' | 'pending';

/** Dónde corrió la llamada. Sólo `live` es tráfico real de clientes. */
export type ToolUsageMode = 'live' | 'agent_test' | 'eval' | 'draft';

export const TOOL_USAGE_MODES: readonly ToolUsageMode[] = ['live', 'agent_test', 'eval', 'draft'];
export const TOOL_USAGE_OUTCOMES: readonly ToolUsageOutcome[] = ['ok', 'error', 'blocked', 'pending'];

/** Largo máximo del código de error guardado (columna VARCHAR(80)). */
export const TOOL_USAGE_ERROR_CODE_MAX = 80;

const PENDING_ERRORS: ReadonlySet<string> = new Set([
    'confirmation_required',
    'approval_required',
]);

const BLOCKED_ERRORS: ReadonlySet<string> = new Set([
    ...TOOL_AUTHORITY_DENIAL_ERRORS,
    'agent_test_read_only',
    'draft_action_requires_approval',
    'canonical_sandbox_not_available',
    'agent_operational_authority_required',
]);

export interface ClassifiedToolOutcome {
    outcome: ToolUsageOutcome;
    errorCode: string | null;
}

function errorCodeOf(value: unknown): string | null {
    if (value === undefined || value === null || value === false || value === '') return null;
    const code = typeof value === 'string' ? value : String(value);
    return code.slice(0, TOOL_USAGE_ERROR_CODE_MAX);
}

/**
 * Clasifica el resultado de `AIToolExecutorService.execute`. Pura y total: no
 * lanza con ningún valor de entrada, porque corre en el camino de la tool.
 */
export function classifyToolResult(result: unknown): ClassifiedToolOutcome {
    if (!result || typeof result !== 'object') return { outcome: 'ok', errorCode: null };
    const value = result as Record<string, unknown>;
    const code = errorCodeOf(value.error);
    if ((code && PENDING_ERRORS.has(code)) || value.requiresConfirmation === true) {
        return { outcome: 'pending', errorCode: code };
    }
    if (value.controlBlocked === true || (code && BLOCKED_ERRORS.has(code))) {
        return { outcome: 'blocked', errorCode: code };
    }
    if (code) return { outcome: 'error', errorCode: code };
    return { outcome: 'ok', errorCode: null };
}

/** Una excepción que escapó del ejecutor. El mensaje no se guarda: puede llevar datos. */
export function classifyToolException(): ClassifiedToolOutcome {
    return { outcome: 'error', errorCode: 'exception' };
}

/**
 * El modo de la llamada, derivado SÓLO de las opciones que arma el servidor.
 *
 * Un `executionContext.mode` explícito manda: la búsqueda automática de FAQs
 * corre con persistencia apagada pero es tráfico `live`. Sin contexto, `readOnly`
 * es la marca que usan Agent Test y las vistas previas.
 */
export function toolUsageModeOf(opts: {
    evalMode?: boolean;
    readOnly?: boolean;
    executionContext?: ServiceExecutionContext;
} | undefined): ToolUsageMode {
    if (!opts) return 'live';
    const mode = opts.executionContext?.mode;
    if (opts.evalMode === true || mode === 'evaluation') return 'eval';
    if (mode === 'draft') return 'draft';
    if (mode === 'agent_test') return 'agent_test';
    if (mode === 'live') return 'live';
    if (opts.executionContext?.persistence === 'disabled' || opts.readOnly === true) return 'agent_test';
    return 'live';
}

/** Límites superiores (exclusivos) de los cubos de latencia, en ms. El último cubo es `>= 10000`. */
export const LATENCY_BUCKET_BOUNDS_MS: readonly number[] = [100, 300, 1000, 3000, 10000];
export const LATENCY_BUCKET_COUNT = LATENCY_BUCKET_BOUNDS_MS.length + 1;

export function latencyBucketIndex(ms: number): number {
    const value = Number.isFinite(ms) && ms > 0 ? ms : 0;
    for (let i = 0; i < LATENCY_BUCKET_BOUNDS_MS.length; i++) {
        if (value < LATENCY_BUCKET_BOUNDS_MS[i]) return i;
    }
    return LATENCY_BUCKET_BOUNDS_MS.length;
}

/**
 * Percentil estimado desde los cubos, interpolando linealmente dentro del cubo.
 *
 * Es una estimación: dentro de un cubo se asume distribución uniforme. El
 * último cubo no tiene techo, así que se acota con `maxMs` (la latencia máxima
 * observada) para no inventar un valor más alto que el real.
 */
export function percentileFromBuckets(buckets: readonly number[], p: number, maxMs?: number | null): number | null {
    const counts = buckets.map(value => (Number.isFinite(value) && value > 0 ? value : 0));
    const total = counts.reduce((sum, value) => sum + value, 0);
    if (total <= 0) return null;
    const quantile = Math.min(1, Math.max(0, p));
    const target = quantile * total;
    let cumulative = 0;
    for (let i = 0; i < counts.length; i++) {
        const count = counts[i];
        if (count <= 0) continue;
        if (cumulative + count >= target) {
            const lower = i === 0 ? 0 : LATENCY_BUCKET_BOUNDS_MS[i - 1];
            const rawUpper = i < LATENCY_BUCKET_BOUNDS_MS.length
                ? LATENCY_BUCKET_BOUNDS_MS[i]
                : Math.max(lower, Number(maxMs) || lower);
            const upper = maxMs !== undefined && maxMs !== null && Number.isFinite(Number(maxMs))
                ? Math.max(lower, Math.min(rawUpper, Number(maxMs)))
                : rawUpper;
            const fraction = (target - cumulative) / count;
            return Math.round(lower + (upper - lower) * fraction);
        }
        cumulative += count;
    }
    return maxMs ?? null;
}
