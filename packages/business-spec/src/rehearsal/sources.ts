/**
 * Qué requisito responde la pregunta del cliente (E1.1, ADR 0014).
 *
 * `answers` de un requisito dice qué intenciones lo NECESITAN (contexto, requisito previo o respuesta). El ensayo, en
 * cambio, necesita el requisito que CONTESTA la pregunta: «¿qué hacen?» se contesta con la descripción, no con el
 * nombre; «¿qué requisitos hay?» con los requisitos del cliente, no con el modo de reserva. E1 midió el agente con esas
 * expectativas cruzadas y el verificador lo castigó por responder bien (15 de 30 fallos revisados).
 *
 * Regla: si la intención declara `answered_by` (intents.yaml), solo esos, en su orden; si no, todos los de `answers`
 * salvo los de higiene o de plataforma, que nunca son fuente de una respuesta.
 */
import type { CompiledRequirement, IntentDef } from '../types';

/**
 * Requisitos de higiene o de plataforma: su «cumple» habla del estado del sistema, no de un dato que el cliente pueda
 * recibir. P. ej. FAQ_HYGIENE confirmado significa «ninguna FAQ sin editar está publicada», no que exista la respuesta.
 */
export const NOT_ANSWER_SOURCES: ReadonlySet<string> = new Set([
    'CORE.KNOWLEDGE.FAQ_HYGIENE',
    'CORE.KNOWLEDGE.AGENT_INSTRUCTIONS',
    'CORE.HANDOFF.TEAM',
]);

/** `OBJ.*.X` casa con la plantilla o el extra `X` de cualquier objeto; cualquier otro patrón, con el ID exacto. */
export function matchesSource(pattern: string, req: Pick<CompiledRequirement, 'id' | 'templateId'>): boolean {
    if (!pattern.startsWith('OBJ.*.')) return req.id === pattern;
    const suffix = pattern.slice('OBJ.*.'.length);
    return req.templateId === pattern || (/^OBJ\.[A-Z0-9_]+\./.test(req.id) && req.id.split('.').slice(2).join('.') === suffix);
}

/** Posición del requisito en `answered_by` (0 = el más directo), o null si no responde la pregunta. */
export function answerRank(intent: Pick<IntentDef, 'answeredBy'>, req: Pick<CompiledRequirement, 'id' | 'templateId'>): number | null {
    if (NOT_ANSWER_SOURCES.has(req.id)) return null;
    if (!intent.answeredBy.length) return 0;
    const i = intent.answeredBy.findIndex(p => matchesSource(p, req));
    return i < 0 ? null : i;
}
