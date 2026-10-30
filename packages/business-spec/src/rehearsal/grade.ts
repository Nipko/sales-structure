/**
 * Calificación del ensayo (C0 §1.4 paso 4, rebanada R7, ADR 0013), en dos pasos:
 *
 * 1. **Chequeos deterministas**, contra lo que dijo `qaTruth` del caso: cifras prohibidas (precio de ejemplo, valor
 *    sembrado o en conflicto), ninguna cifra de dinero en COTIZA, al menos una cifra del dato confirmado en AFIRMA,
 *    calificador «desde», y el evento esperado («lo averiguo» registrado tras el «sí»). Un fallo aquí es **decisivo**.
 * 2. **Juez de paráfrasis (LLM)**, solo cuando los deterministas no tienen evidencia positiva (una AFIRMA de texto sin
 *    cifras, una negación, un «no consta» dicho con otras palabras). Queda marcado (`decidedBy: 'judge'`) y **nunca**
 *    anula un fallo determinista.
 *
 * Resultado para el dueño (C0 §1.4 paso 5): `answered` («responde bien»), `missing_data` («no lo sabe porque falta X»:
 * el agente hizo lo correcto con un dato ausente; clase **dato**, con enlace al formulario) o `wrong` («respondió mal»:
 * clase **producto**, va a la cola de la plataforma y no se le carga al dueño). Sin evidencia ni juez: `inconclusive`.
 */
import type { RehearsalCase } from './generate';
import { figureLabel, figuresOfText, hasMoneyFigure } from './figures';

export const PENDING_TOOL = 'register_pending_question';

export interface RehearsalToolCall { turn: number; name: string; result?: unknown }

export interface RehearsalObservation {
    /** Respuesta del agente a cada turno del caso, en orden. */
    replies: string[];
    toolCalls: RehearsalToolCall[];
    /** Error del turno (cuota, fallo del modelo): el caso no se califica. */
    error?: string | null;
}

export type RehearsalOutcome = 'answered' | 'missing_data' | 'wrong' | 'inconclusive' | 'error';
export type RehearsalCheckId = 'forbidden_figures' | 'no_money' | 'figures' | 'qualifier' | 'event' | 'unknown_marker' | 'handoff_marker' | 'question' | 'judge';

export interface RehearsalCheck {
    id: RehearsalCheckId;
    ok: boolean;
    /** Un fallo decisivo hace el caso `wrong` sin importar el juez. */
    decisive: boolean;
    detail: string;
}

export interface JudgeVerdict { pass: boolean; reason: string; model?: string | null }

export interface RehearsalGrade {
    outcome: RehearsalOutcome;
    /** Clase del fallo (aceptación R7 #2): `dato` (falta X) o `producto` (respondió mal); null si respondió bien. */
    missClass: 'dato' | 'producto' | null;
    decidedBy: 'deterministic' | 'judge' | null;
    /** No hubo evidencia determinista suficiente: hace falta el juez de paráfrasis. */
    needsJudge: boolean;
    checks: RehearsalCheck[];
    reason: string;
}

const norm = (s: string) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’`]/g, "'");

/** «No consta», «por confirmar», «lo averiguo» en ES/EN/PT/FR (evidencia de NC+AV o GAP). */
const UNKNOWN_MARKER = new RegExp([
    "no (lo |la )?(tengo|tenemos|cuento|contamos|consta|aparece|figura|veo|encuentro|dispongo)",
    'no (esta|estan) (confirmad|disponible|registrad|cargad|publicad|definid)', 'por confirmar', 'sin (ese |esa )?(dato|informacion)',
    'lo (averiguo|consulto|confirmo)', '(consultar|confirmar|verificar)(lo|la)? con (el|nuestro) equipo',
    "(don't|do not|doesn't) have", 'not (on record|available|listed|confirmed|sure)', 'no information', "i('ll| will) (check|find out|ask|confirm)", 'to be confirmed',
    'nao (tenho|temos|consta|encontrei|esta confirmad)', 'a confirmar', 'vou (verificar|confirmar|consultar)',
    "je n'ai pas", "nous n'avons pas", "pas d'information", 'a confirmer', 'je (vais|me) (verifier|renseigner)',
].join('|'));

/** Traspaso a una persona en ES/EN/PT/FR (evidencia de HUM). */
const HANDOFF_MARKER = new RegExp([
    'una persona', 'persona del equipo', '(un|una) (asesor|asesora|agente humano|especialista)', 'te (comunico|paso|conecto)', '(transferir|derivar|escalar)',
    'nuestro equipo (te|lo|la) (contacta|atiende|escribe|llama)', 'alguien del equipo',
    'someone from (the|our) team', 'a (person|human|team member|colleague)', '(transfer|connect|hand) (you|over)',
    'uma pessoa', 'atendente', 'alguem da equipe', 'une personne', 'conseiller', "quelqu'un de (l'|notre )equipe",
].join('|'));

const QUALIFIER = /\b(desde|a partir de|a partir|from|starting at|starts at)\b/;

/** Lo esperado era un dato del negocio y lo tiene: «responde bien». Con dato ausente, hacer lo correcto es «falta X». */
const answersWithData = (c: RehearsalCase): boolean => c.expectation.answerable;

export function gradeCase(c: RehearsalCase, obs: RehearsalObservation, judge?: JudgeVerdict | null): RehearsalGrade {
    if (obs.error) {
        return { outcome: 'error', missClass: null, decidedBy: null, needsJudge: false, checks: [], reason: `el turno falló: ${obs.error}` };
    }
    const e = c.expectation;
    const replies = obs.replies.map(r => String(r ?? ''));
    const first = replies[0] ?? '';
    const all = replies.join('\n');
    const said = new Set(figuresOfText(all));
    const checks: RehearsalCheck[] = [];
    let positive = false;

    const forbidden = e.forbiddenFigures.filter(f => said.has(f));
    if (e.forbiddenFigures.length) {
        checks.push({ id: 'forbidden_figures', ok: !forbidden.length, decisive: true,
            detail: forbidden.length ? `dijo una cifra que no es un hecho (ejemplo, sembrada o en conflicto): ${forbidden.map(figureLabel).join(', ')}` : 'ninguna cifra prohibida' });
    }
    if (e.noMoney) {
        const money = hasMoneyFigure(first);
        checks.push({ id: 'no_money', ok: !money, decisive: true, detail: money ? 'dio una cifra en un ítem «a cotizar»' : 'sin cifras de dinero' });
    }
    if (e.figuresAnyOf.length) {
        const hit = e.figuresAnyOf.filter(f => said.has(f));
        checks.push({ id: 'figures', ok: hit.length > 0, decisive: true,
            detail: hit.length ? `dijo el dato: ${hit.map(figureLabel).join(', ')}` : `no dijo el dato confirmado (${e.figuresAnyOf.slice(0, 6).map(figureLabel).join(', ')})` });
        if (hit.length) positive = true;
        if (hit.length && e.qualifier === 'desde') {
            const ok = QUALIFIER.test(norm(first));
            checks.push({ id: 'qualifier', ok, decisive: true, detail: ok ? 'usó el calificador «desde»' : 'dio el precio sin el calificador «desde»' });
        }
    }
    if (e.event?.kind === 'pending_question') {
        const called = obs.toolCalls.some(t => t.turn === e.event!.turn && t.name === PENDING_TOOL);
        checks.push({ id: 'event', ok: called, decisive: true,
            detail: called ? '«lo averiguo» quedó registrado tras el «sí»' : `el cliente aceptó «lo averiguo» y no se llamó ${PENDING_TOOL}` });
        if (called) positive = true;
    }
    if (e.unknownMarker && !positive) {
        const ok = UNKNOWN_MARKER.test(norm(first));
        checks.push({ id: 'unknown_marker', ok, decisive: false, detail: ok ? 'dijo que no consta o que lo averigua' : 'no se ve un «no consta» literal: lo decide el juez' });
        if (ok) positive = true;
    }
    if (c.expected === 'HUM') {
        const ok = HANDOFF_MARKER.test(norm(first)) || obs.toolCalls.some(t => (t.result as { shouldHandoff?: unknown } | undefined)?.shouldHandoff === true);
        checks.push({ id: 'handoff_marker', ok, decisive: false, detail: ok ? 'ofreció o hizo el traspaso a una persona' : 'no se ve el traspaso literal: lo decide el juez' });
        if (ok) positive = true;
    }
    if (c.expected === 'PREG') {
        const ok = /[?¿]/.test(first);
        checks.push({ id: 'question', ok, decisive: false, detail: ok ? 'hizo una pregunta' : 'no se ve una pregunta: lo decide el juez' });
        if (ok) positive = true;
    }

    const failed = checks.filter(k => k.decisive && !k.ok);
    if (failed.length) {
        // el juez nunca anula un fallo determinista: se registra, pero no cambia el resultado
        if (judge) checks.push({ id: 'judge', ok: judge.pass, decisive: false, detail: `juez (no decide: hay un fallo determinista): ${judge.reason}` });
        return { outcome: 'wrong', missClass: 'producto', decidedBy: 'deterministic', needsJudge: false, checks, reason: failed.map(f => f.detail).join(' · ') };
    }
    const ok = (decidedBy: 'deterministic' | 'judge', reason: string): RehearsalGrade => answersWithData(c)
        ? { outcome: 'answered', missClass: null, decidedBy, needsJudge: decidedBy === 'judge', checks, reason }
        : { outcome: 'missing_data', missClass: 'dato', decidedBy, needsJudge: decidedBy === 'judge', checks,
            reason: `no lo sabe porque falta ${c.requirementIds.join(', ')} (${c.valueState ?? 'sin estado'}): ${reason}` };
    if (positive) return ok('deterministic', checks.filter(k => k.ok).map(k => k.detail).join(' · ') || 'chequeos deterministas superados');
    if (!judge) {
        return { outcome: 'inconclusive', missClass: null, decidedBy: null, needsJudge: true, checks, reason: 'sin evidencia determinista y sin juez de paráfrasis' };
    }
    checks.push({ id: 'judge', ok: judge.pass, decisive: false, detail: `juez de paráfrasis${judge.model ? ` (${judge.model})` : ''}: ${judge.reason}` });
    return judge.pass ? ok('judge', judge.reason) : { outcome: 'wrong', missClass: 'producto', decidedBy: 'judge', needsJudge: true, checks, reason: `juez: ${judge.reason}` };
}

/** ¿Hace falta el juez para este caso? (sin llamar al modelo cuando los deterministas ya deciden) */
export const needsJudge = (c: RehearsalCase, obs: RehearsalObservation): boolean => gradeCase(c, obs, null).needsJudge;

// ─────────────────────────── resumen y pass^k ───────────────────────────

export interface RehearsalSummary {
    total: number;
    answered: number;
    missingData: number;
    wrong: number;
    inconclusive: number;
    errors: number;
    /** Siguió la especificación: (responde bien + falta X) / calificados. Null si no hay calificados. */
    passRate: number | null;
    /** Respondió con el dato: responde bien / calificados. */
    answeredRate: number | null;
}

export function summarize(grades: readonly Pick<RehearsalGrade, 'outcome'>[]): RehearsalSummary {
    const n = (o: RehearsalOutcome) => grades.filter(g => g.outcome === o).length;
    const answered = n('answered'), missingData = n('missing_data'), wrong = n('wrong');
    const graded = answered + missingData + wrong;
    const rate = (x: number) => (graded ? Math.round((x / graded) * 10_000) / 10_000 : null);
    return { total: grades.length, answered, missingData, wrong, inconclusive: n('inconclusive'), errors: n('error'), passRate: rate(answered + missingData), answeredRate: rate(answered) };
}

/** Un caso pasa si siguió la especificación (responde bien o «falta X» bien dicho). */
export const isPass = (outcome: RehearsalOutcome): boolean => outcome === 'answered' || outcome === 'missing_data';

/**
 * pass^k (fase E): fracción de casos del banco congelado que pasan en sus k intentos. Solo cuentan los casos con al
 * menos k intentos calificados (`inconclusive` y `error` no son intentos).
 */
export function passHatK(attempts: readonly { caseKey: string; outcome: RehearsalOutcome }[], k: number): { k: number; cases: number; passAll: number; rate: number | null } {
    const by = new Map<string, boolean[]>();
    for (const a of attempts) {
        if (a.outcome === 'inconclusive' || a.outcome === 'error') continue;
        by.set(a.caseKey, [...(by.get(a.caseKey) ?? []), isPass(a.outcome)]);
    }
    const eligible = [...by.values()].filter(xs => xs.length >= k);
    const passAll = eligible.filter(xs => xs.slice(0, k).every(Boolean)).length;
    return { k, cases: eligible.length, passAll, rate: eligible.length ? Math.round((passAll / eligible.length) * 10_000) / 10_000 : null };
}
