/**
 * Clave del tema, máquina de estados y sentencias de `pending_questions` (C0 §1.5 y §2.6, rebanada R5, ADR 0011).
 *
 * Funciones puras y sin dependencias de Nest ni de @parallext/business-spec a propósito: KnowledgeService registra el
 * hueco de una búsqueda sin resultado con `recordGapStatement` dentro de su propia transacción de analítica, y los
 * scripts de auditoría cargan ese servicio sin el paquete compilado.
 *
 * - Deduplicación: `topic_key` = `req:<requisito>[#<ítem>]` si el hueco es de un requisito de la especificación, o
 *   `q:<hash>` de la pregunta normalizada si no corresponde a ninguno. Diez clientes con la misma pregunta producen
 *   una sola fila abierta (índice único parcial sobre `gap`/`open`) con diez esperas.
 * - Estados: `gap` (solo demanda) → `open` (alguien espera) → `answered` (respuesta puntual) | `stored` (guardada como
 *   dato) → `closed`; `gap`/`open` → `dismissed`.
 */
import { createHash } from 'node:crypto';

export type PendingQuestionStatus = 'gap' | 'open' | 'answered' | 'stored' | 'closed' | 'dismissed';
export type PendingQuestionAction = 'wait' | 'answer_once' | 'store' | 'dismiss' | 'close';
export type PendingQuestionSource = 'agent' | 'retrieval';

/** Estados en los que la fila sigue abierta (los del índice único parcial). */
export const OPEN_STATUSES: readonly PendingQuestionStatus[] = Object.freeze(['gap', 'open']);

const TRANSITIONS: Readonly<Record<PendingQuestionAction, Readonly<Partial<Record<PendingQuestionStatus, PendingQuestionStatus>>>>> = Object.freeze({
    wait: { gap: 'open', open: 'open' },
    answer_once: { gap: 'answered', open: 'answered' },
    // una respuesta puntual se puede guardar después como dato: desde ahí el agente la afirma
    store: { gap: 'stored', open: 'stored', answered: 'stored' },
    dismiss: { gap: 'dismissed', open: 'dismissed' },
    close: { answered: 'closed', stored: 'closed' },
});

/** El estado al que lleva la acción, o null si no se permite desde `from`. */
export function nextStatus(from: PendingQuestionStatus, action: PendingQuestionAction): PendingQuestionStatus | null {
    return TRANSITIONS[action][from] ?? null;
}

/** Desde qué estados se permite la acción (para la sentencia `WHERE status IN (…)`). */
export function statusesAllowing(action: PendingQuestionAction): PendingQuestionStatus[] {
    return Object.keys(TRANSITIONS[action]) as PendingQuestionStatus[];
}

/** Minúsculas, sin acentos, sin signos y con un solo espacio: «¿Tienen PARQUEADERO?» = «tienen parqueadero». */
export function normalizeQuestion(question: string): string {
    return String(question ?? '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const REQUIREMENT_ID = /^[A-Z][A-Z0-9_]*(\.[A-Z0-9_*]+)+$/;
const ITEM_REF = /^[\w:.-]{1,120}$/;

export interface TopicInput {
    question: string;
    requirementId?: string | null;
    itemRef?: string | null;
}

/** `req:<id>[#<ítem>]` o `q:<sha256 de la pregunta normalizada, 16 hex>`. */
export function topicKeyFor(input: TopicInput): string {
    const requirementId = input.requirementId && REQUIREMENT_ID.test(input.requirementId) ? input.requirementId : null;
    if (requirementId) {
        const item = input.itemRef && ITEM_REF.test(input.itemRef) ? `#${input.itemRef}` : '';
        return `req:${requirementId}${item}`;
    }
    return `q:${createHash('sha256').update(normalizeQuestion(input.question)).digest('hex').slice(0, 16)}`;
}

export interface GapInput extends TopicInput {
    intentId?: string | null;
    conversationId?: string | null;
    language?: string | null;
    source: PendingQuestionSource;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Una sentencia: abre el hueco o suma una ocurrencia al abierto del mismo tema. `inserted` dice cuál. Con
 * `countOccurrence: false` solo asegura la fila abierta (la espera cuenta su propia ocurrencia).
 * Se ejecuta en el esquema del tenant (sin prefijo de esquema).
 */
export function recordGapStatement(input: GapInput, options: { countOccurrence?: boolean } = {}): { sql: string; params: unknown[] } {
    const count = options.countOccurrence === false ? '' : 'occurrences = pending_questions.occurrences + 1, ';
    const requirementId = input.requirementId && REQUIREMENT_ID.test(input.requirementId) ? input.requirementId : null;
    const itemRef = requirementId && input.itemRef && ITEM_REF.test(input.itemRef) ? input.itemRef : null;
    const conversationId = input.conversationId && UUID.test(input.conversationId) ? input.conversationId : null;
    return {
        sql: `INSERT INTO pending_questions
                (requirement_id, item_ref, intent_id, topic_key, sample_question, sample_conversation_id, language, source)
              VALUES ($1, $2, $3, $4, $5, $6::uuid, $7, $8)
              ON CONFLICT (topic_key) WHERE status IN ('gap','open')
              DO UPDATE SET ${count}last_seen_at = clock_timestamp(), updated_at = clock_timestamp()
              RETURNING id::text AS id, status, occurrences, (xmax = 0) AS inserted`,
        params: [
            requirementId, itemRef, input.intentId ? String(input.intentId).slice(0, 40) : null,
            topicKeyFor({ question: input.question, requirementId, itemRef }),
            String(input.question ?? '').trim().slice(0, 500) || '(sin texto)',
            conversationId, input.language ? String(input.language).slice(0, 8) : null, input.source,
        ],
    };
}

const UNIT_MS: Readonly<Record<string, number>> = Object.freeze({
    min: 60_000, h: 3_600_000, d: 86_400_000, semanas: 7 * 86_400_000, meses: 30 * 86_400_000,
});
/** D10: sin SLA declarado, 4 h. */
export const DEFAULT_SLA_MS = 4 * 3_600_000;

/** El SLA de `CORE.PENDING.ROUTING.sla` (`{min, unit}`) en milisegundos, o el default de D10. */
export function slaMsFrom(routingValue: unknown): number {
    const sla = (routingValue as { sla?: { min?: unknown; unit?: unknown } } | null)?.sla;
    const amount = Number(sla?.min);
    const unit = UNIT_MS[String(sla?.unit ?? '')];
    return Number.isFinite(amount) && amount > 0 && unit ? amount * unit : DEFAULT_SLA_MS;
}
