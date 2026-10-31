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
 * E1.1 (ADR 0014): los marcadores salen de las respuestas reales de E1 (es/en/pt/fr) y tienen dos guardas contra la
 * aprobación falsa: un marcador **no rescata** una respuesta que además niega sin dato («no tenemos promociones») o que,
 * sin dato confirmado en el caso, afirma algo antes del marcador («tratamos sus datos conforme a la ley… ¿le paso con
 * alguien?»). Esas van al juez. Negarse a pasar con una persona cuando el cliente la pide (C30) es un fallo decisivo.
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
export type RehearsalCheckId =
    | 'forbidden_figures' | 'no_money' | 'figures' | 'qualifier' | 'event' | 'unknown_marker' | 'handoff_marker' | 'question'
    | 'handoff_refused' | 'unbacked_claim' | 'affirm_yes' | 'names' | 'judge';

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

export const normalizeReply = (s: string) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’`´]/g, "'");
const norm = normalizeReply;
const rx = (parts: string[]) => new RegExp(parts.join('|'));

/**
 * «No consta», «por confirmar», «lo averiguo» en ES/EN/PT/FR (evidencia de NC+AV o GAP). Exige hablar de la
 * INFORMACIÓN («no tengo ese dato registrado»), no de la cosa: «no tenemos promociones» es una negación, no un «no consta».
 */
export const UNKNOWN_MARKER = rx([
    // es: «No tengo información…», «No tengo registrada…», «No manejo información…», «No tenemos registrado el barrio»
    "\\bno (lo |la |los |las )?(tengo|tenemos|tiene|tienen|cuento con|contamos con|dispongo de|disponemos de|manejo|manejamos|encuentro|encontre|veo)\\b[^.,;:?!\\n]{0,40}?\\b(informacion|datos?|detalles?|confirmacion|conversion|tasa de cambio|equivalencia|registrad[oa]s?|confirmad[oa]s?|cargad[oa]s?|publicad[oa]s?|configurad[oa]s?)",
    '\\bno (consta|constan|figura|figuran|aparece|aparecen)\\b',
    '\\bno (esta|estan) (confirmad|registrad|cargad|publicad|definid|especificad|indicad)',
    '\\bno se (especifica|especifican|indica|indican|menciona|mencionan|registra|registran|detalla|detallan|ha (registrado|especificado|indicado)|han (registrado|especificado))\\b',
    '\\bno (hay|existe) (informacion|datos?|detalles?|registros?)\\b',
    '\\bsin (ese |esa |el |la )?(dato|informacion)\\b', '\\bpor confirmar\\b', '\\bpendiente de confirma',
    '\\b(es|esta|son|estan) (un |una )?(valor(es)? |precio(s)? )?de ejemplo\\b', '\\bestado de ejemplo\\b', '\\bno (puedo|podemos) confirmar',
    '\\blo (averiguo|consulto|confirmo|verifico|reviso)\\b', '\\b(consultar|confirmar|verificar)(lo|la|selo|sela)? con (el|nuestro|un|una) (equipo|asesor|asesora)',
    '\\b(lo mejor es|le recomiendo|te recomiendo|es mejor|conviene) (que )?(alguien del equipo|un asesor|confirmar|consultar)',
    '\\b(alguien del equipo|un asesor|una asesora|el equipo) (le|te|se lo|se la) (confirm|averig)',
    // en
    "\\b(don't|do not|doesn't|does not) have (that |the |this |any )?(information|info|details?|data)\\b",
    "\\b(i|we) (don't|do not) have [^.,;:?!\\n]{0,40}?(on record|confirmed|registered|listed)",
    '\\bnot (on record|confirmed|registered|specified|listed)\\b', '\\bno (information|details|data) (on|about|available|registered|on record)\\b',
    '\\bto be confirmed\\b', "\\bi('ll| will) (check|find out|ask|confirm)\\b", '\\b(is|are) (an |a )?(example|placeholder)\\b',
    // pt
    '\\bnao (tenho|temos|encontrei|disponho de|dispomos de)\\b[^.,;:?!\\n]{0,40}?(informac|dados?|registrad|confirmad)',
    '\\bnao (consta|constam|esta confirmad|esta registrad)', '\\ba confirmar\\b', '\\bvou (verificar|confirmar|consultar)\\b', '\\bsem (essa |esta )?informacao\\b',
    // fr
    "\\b(je|nous) n'(ai|avons) pas (cette |l'|d'|les )?(information|info|donnee|detail|precision)", "\\bpas d'information", '\\ba confirmer\\b',
    '\\bje (vais|me) (verifier|renseigner)\\b', "\\bn'est pas (confirme|indique|precise|enregistre|renseigne)", '\\bne (figure|figurent) pas\\b',
]);

/** Traspaso a una persona en ES/EN/PT/FR (evidencia de HUM). Nombrar «una persona» no es traspasar. */
export const HANDOFF_MARKER = rx([
    '\\b(dejeme|dejame|permitame|permiteme|voy a) (conectarle|conectarte|comunicarle|comunicarte|pasarle|pasarte|transferirle|transferirte|derivarle|derivarte)\\b',
    '\\b(le|te) (comunico|paso|conecto|transfiero|derivo|pongo en contacto)\\b', '\\b(ponerle|ponerte|ponerlo|ponerla) en contacto\\b',
    '\\b(pase|pasemos|comunique|conecte|transfiera) con\\b', '\\b(pasarle|pasarte|comunicarle|comunicarte|conectarle|conectarte|transferirle) con\\b',
    '\\balguien del equipo\\b', '\\b(un|una) (miembro|integrante) del equipo\\b', '\\b(un|una|el|la|nuestro|nuestra) (asesor|asesora|agente humano|especialista|ejecutivo|ejecutiva)\\b',
    '\\bpersona del equipo\\b', '\\bnuestro equipo (le|te|lo|la) (contacta|contactara|atiende|atendera|escribe|escribira|llama|llamara)\\b',
    '\\b(transferir|derivar|escalar) (su|tu) (caso|consulta|solicitud)\\b',
    "\\b(let me|i('ll| will)|i can) (connect|transfer|put) you\\b", '\\bsomeone from (the|our) team\\b', '\\ba (team member|member of (the|our) team|human (agent|colleague))\\b', '\\bhand (you )?over\\b',
    '\\b(vou|posso) (te |lhe )?(transferir|encaminhar|passar)\\b', '\\b(um|uma) atendente\\b', '\\balguem da (nossa )?equipe\\b',
    '\\bje (vous )?(transfere|mets en relation|passe)\\b', '\\bun conseiller\\b', "\\bquelqu'un de (l'|notre )equipe\\b",
]);

/** El traspaso queda condicionado («si es necesario, le comunico…»): no es un traspaso. */
const CONDITIONAL = rx(['\\bsi (es|fuera|resulta) necesario\\b', '\\bsi hace falta\\b', '\\ben caso de ser necesario\\b', '\\bif (needed|necessary)\\b', '\\bse (for )?necessario\\b', '\\bsi necessaire\\b']);

/** Negarse a pasar con una persona (E1: «No soy una persona, pero puedo ayudarle», «estoy aquí para ayudarle»). */
export const HANDOFF_REFUSAL = rx([
    '\\bno soy una persona\\b', '\\bestoy aqui para ayudar(le|te)?\\b', '\\byo (puedo|le puedo|te puedo) ayudar',
    "\\bi('m| am) not a (person|human)\\b", "\\bi('m| am) here to help\\b", '\\bnao sou uma pessoa\\b', '\\bestou aqui para (te |lhe )?ajudar\\b',
    '\\bje ne suis pas une personne\\b', '\\bje suis (la|ici) pour vous aider\\b',
]);

/**
 * Niega sin dato: «no tenemos promociones», «no hay disponibilidad el sábado», «no gestionamos devoluciones». Solo es
 * correcto con el vacío confirmado (NIEGA); en cualquier otro caso un marcador no la rescata y decide el juez.
 */
export const DENIAL = rx([
    '\\bno (tenemos|ofrecemos|hacemos|vendemos|aceptamos|gestionamos|manejamos|realizamos|cobramos|contamos con|disponemos de|incluye|incluyen|excluye|cobra|tiene|tienen|cuenta con|cuentan con)\\b',
    '\\bno se (manejan|aceptan|ofrecen|hacen|incluye|incluyen|cobra|cobran|requiere)\\b', '\\b(no|ni) (incluye|excluye)\\b',
    '\\bno hay (disponibilidad|horarios|cupos?|espacios|promociones|descuentos|cargos|costos|salidas|reembolsos|devoluciones)\\b',
    '\\b(esta|estamos) contratando\\b', '\\b(esta|estamos) cerrad', '\\bningun(a|o)? (promocion|descuento|cargo|costo)\\b', '\\b(no|sin) (cargos?|costos?) (adicional|extra)',
    "\\b(we|it) (don't|do not|doesn't|does not) (have|offer|accept|include|sell)\\b", '\\bthere (is|are) no\\b', "\\bwe('re| are) closed\\b",
    '\\bnao (temos|oferecemos|aceitamos|fazemos|vendemos|inclui|ha)\\b',
    "\\bnous n'(avons|offrons|acceptons|proposons|faisons) pas\\b", "\\bil n'y a pas\\b", "\\bn'inclut pas\\b",
]);

/** Afirmación sobre el negocio (antes del marcador, sin dato confirmado en el caso, la respuesta es mixta). */
const ASSERTIVE = rx([
    '\\d', '^\\W*si\\b', '\\b(aceptamos|ofrecemos|tenemos|hacemos|vendemos|manejamos|gestionamos|tratamos|usamos|utilizamos|atendemos|trabajamos|incluye|incluyen|cuesta|cuestan|abrimos|abre|cerramos|estamos|hay|son|cumpliendo|conforme)\\b',
    '\\bes (un|una|el|la|de|a)\\b', '\\besta (ubicad|disponible|abiert|cerrad)', '\\bse (requiere|necesita|cobra|paga|usa|utiliza|comparte|guarda)\\b',
    '\\b(we (have|offer|accept|are)|it (is|costs|includes)|temos|oferecemos|aceitamos|nous (avons|proposons|acceptons)|c\'est)\\b',
]);

/** Pregunta o pedido de datos (PREG): «¿…?» o «por favor indíqueme…». */
const REQUEST = rx([
    '[?¿]', '\\b(indiqueme|indicame|digame|dime|proporcioneme|proporcioname|compartame|envieme|confirmeme|facilitame|facilitenos)\\b',
    '\\b(por favor,? )?(proporcione|indique|confirme|comparta|envie)\\b', '\\bnecesito (que me (confirme|indique|de|diga|proporcione|comparta)|saber|su (nombre|telefono|numero|correo))\\b',
    '\\bplease (provide|share|tell|send|confirm)\\b', '\\b(me (informe|indique|diga|passe|envie)|poderia (me )?(informar|dizer|passar))\\b', '\\b(pourriez-vous|merci de (me )?(indiquer|donner|preciser))\\b',
]);

/** «Sí, tenemos X» (C07): evidencia de AFIRMA de existencia. */
const AFFIRM_YES = rx([
    '^\\W*(si|claro|por supuesto|yes|sure|of course|sim|oui|bien sur)\\b',
    '\\b(tenemos|ofrecemos|vendemos|hacemos|contamos con|disponemos de|we (have|offer|sell)|temos|oferecemos|nous (avons|proposons|vendons))\\b',
]);

const QUALIFIER = /\b(desde|a partir de|a partir|from|starting at|starts at)\b/;

/** E1.1: intenciones en que el cliente pide una persona: negarse es un fallo decisivo. */
const HUMAN_REQUEST_INTENTS = new Set(['C30']);

/**
 * E1.1: en una PREG, de qué tiene que tratar la pregunta (una pregunta cualquiera, «¿cuál desea continuar?», no basta).
 * Requisitos sin entrada: cualquier pregunta o pedido de datos.
 */
const PREG_TOPIC: Record<string, RegExp> = {
    'CORE.ACCOUNT.IDENTITY_DEFAULT': /\b(nombre|telefono|celular|correo|email|e-mail|documento|cedula|numero|referencia|codigo|reserva|pedido|cita|compra|name|phone|booking|order|nome|telefone|reservation|commande)(s|es)?\b/,
    'CORE.SERVICE_AREA': /\b(barrio|zona|direccion|ciudad|ubicacion|sector|codigo postal|address|area|city|bairro|endereco|cidade|quartier|adresse|ville)(s|es)?\b/,
};

/** Lo esperado era un dato del negocio y lo tiene: «responde bien». Con dato ausente, hacer lo correcto es «falta X». */
const answersWithData = (c: RehearsalCase): boolean => c.expectation.answerable;

/** El caso trae algún dato confirmado afirmable (además del nombre): entonces afirmar antes del marcador puede ser correcto. */
const hasConfirmedData = (c: RehearsalCase): boolean => {
    if (c.expectation.answerable) return true;
    const a = c.focus ? c.focus.affirm : c.truth.affirm;
    return !!a && typeof a === 'object' && Object.keys(a as Record<string, unknown>).some(k => k !== 'name' && k !== 'unit_name');
};

/** Un ítem se nombra completo o sin su sufijo técnico («Spark QA Tour 20261018T2140Z» → «spark qa tour»). */
const nameVariants = (name: string): string[] => {
    const full = norm(name).trim();
    const short = full.replace(/\s+[\w-]*\d{6,}[\w-]*$/, '').trim();
    return [...new Set([full, short])].filter(v => v.length >= 6);
};

/** Oraciones de la respuesta (para ubicar el marcador y lo que lo rodea). */
const sentences = (text: string): string[] => text.split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);

/** Negación sin dato en alguna oración, descontando las frases-marcador («no tengo información…» no es negar). */
const deniesWithoutData = (text: string, marker: RegExp): string | null => {
    for (const s of sentences(text)) {
        const rest = s.replace(new RegExp(marker.source, 'g'), ' ');
        const m = rest.match(DENIAL);
        if (m) return m[0].trim();
    }
    return null;
};

/** Lo que se dice antes del marcador, si afirma algo del negocio (solo cuando el caso no trae dato confirmado). */
const claimBefore = (text: string, marker: RegExp, c: RehearsalCase): string | null => {
    if (hasConfirmedData(c)) return null;
    const m = marker.exec(text);
    if (!m) return null;
    const prefix = text.slice(0, m.index);
    const hit = prefix.match(ASSERTIVE);
    return hit ? prefix.trim().slice(0, 80) : null;
};

/**
 * Evidencia de un marcador con sus guardas: `ok` solo si aparece el marcador y no hay negación sin dato ni afirmación
 * previa sin respaldo. Devuelve el chequeo y, si la respuesta es mixta, el chequeo `unbacked_claim` (no decisivo).
 */
function markerCheck(id: 'unknown_marker' | 'handoff_marker', text: string, marker: RegExp, c: RehearsalCase, labels: { ok: string; none: string }, extra?: boolean): RehearsalCheck[] {
    const found = marker.test(text) || extra === true;
    if (!found) return [{ id, ok: false, decisive: false, detail: labels.none }];
    if (c.expected === 'NIEGA') return [{ id, ok: true, decisive: false, detail: labels.ok }];
    const denial = deniesWithoutData(text, marker);
    const claim = denial ? null : claimBefore(text, marker, c);
    if (!denial && !claim) return [{ id, ok: true, decisive: false, detail: labels.ok }];
    return [
        { id, ok: false, decisive: false, detail: `${labels.ok}, pero la respuesta es mixta: lo decide el juez` },
        { id: 'unbacked_claim', ok: false, decisive: false, detail: denial ? `niega sin vacío confirmado («${denial}»)` : `afirma sin dato confirmado antes del marcador («${claim}»)` },
    ];
}

export function gradeCase(c: RehearsalCase, obs: RehearsalObservation, judge?: JudgeVerdict | null): RehearsalGrade {
    if (obs.error) {
        return { outcome: 'error', missClass: null, decidedBy: null, needsJudge: false, checks: [], reason: `el turno falló: ${obs.error}` };
    }
    const e = c.expectation;
    const replies = obs.replies.map(r => String(r ?? ''));
    const first = replies[0] ?? '';
    const nfirst = norm(first);
    const all = replies.join('\n');
    const said = new Set(figuresOfText(all));
    const checks: RehearsalCheck[] = [];
    let positive = false;
    const push = (list: RehearsalCheck[]) => { checks.push(...list); if (list[0]?.ok) positive = true; };

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
            const ok = QUALIFIER.test(nfirst);
            checks.push({ id: 'qualifier', ok, decisive: true, detail: ok ? 'usó el calificador «desde»' : 'dio el precio sin el calificador «desde»' });
        }
    }
    if (e.event?.kind === 'pending_question') {
        const called = obs.toolCalls.some(t => t.turn === e.event!.turn && t.name === PENDING_TOOL);
        checks.push({ id: 'event', ok: called, decisive: true,
            detail: called ? '«lo averiguo» quedó registrado tras el «sí»' : `el cliente aceptó «lo averiguo» y no se llamó ${PENDING_TOOL}` });
        if (called) positive = true;
    }
    if (!positive && e.affirmYes) {
        // solo la primera oración: «sí, tenemos X; no tiene costo de limpieza» confirma X (el resto lo cubren las cifras)
        const lead = sentences(nfirst)[0] ?? '';
        const ok = AFFIRM_YES.test(lead) && !DENIAL.test(lead);
        checks.push({ id: 'affirm_yes', ok, decisive: false, detail: ok ? 'confirmó que lo tienen' : 'no se ve un «sí, lo tenemos» sin negación: lo decide el juez' });
        if (ok) positive = true;
    }
    if (!positive && e.namesAnyOf?.length) {
        const hit = e.namesAnyOf.filter(n => nameVariants(n).some(v => nfirst.includes(v)));
        checks.push({ id: 'names', ok: hit.length > 0, decisive: false, detail: hit.length ? `nombró ítems del catálogo: ${hit.slice(0, 3).join(', ')}` : 'no nombró ningún ítem activo: lo decide el juez' });
        if (hit.length) positive = true;
    }
    if (e.unknownMarker && !positive) {
        push(markerCheck('unknown_marker', nfirst, UNKNOWN_MARKER, c, { ok: 'dijo que no consta o que lo averigua', none: 'no se ve un «no consta»: lo decide el juez' }));
    }
    if (c.expected === 'HUM') {
        const handoffSentence = sentences(nfirst).find(s => HANDOFF_MARKER.test(s));
        const conditional = !!handoffSentence && CONDITIONAL.test(handoffSentence);
        const viaTool = obs.toolCalls.some(t => (t.result as { shouldHandoff?: unknown } | undefined)?.shouldHandoff === true);
        if (HUMAN_REQUEST_INTENTS.has(c.intentId) && !viaTool && (!handoffSentence || conditional) && HANDOFF_REFUSAL.test(nfirst)) {
            checks.push({ id: 'handoff_refused', ok: false, decisive: true, detail: 'el cliente pidió una persona y el agente se negó o lo retuvo' });
        } else if (conditional && !viaTool) {
            checks.push({ id: 'handoff_marker', ok: false, decisive: false, detail: 'el traspaso queda condicionado («si es necesario»): lo decide el juez' });
        } else {
            push(markerCheck('handoff_marker', handoffSentence ? nfirst : '', HANDOFF_MARKER, c,
                { ok: 'ofreció o hizo el traspaso a una persona', none: 'no se ve el traspaso: lo decide el juez' }, viaTool));
        }
    }
    if (c.expected === 'PREG') {
        const topic = PREG_TOPIC[c.requirementIds[0]];
        const asks = (REQUEST.test(first) || REQUEST.test(nfirst)) && (!topic || topic.test(nfirst));
        const denial = asks ? deniesWithoutData(nfirst, UNKNOWN_MARKER) : null;
        checks.push({ id: 'question', ok: asks && !denial, decisive: false,
            detail: !asks ? 'no se ve la pregunta esperada: lo decide el juez' : denial ? `pregunta, pero niega sin dato («${denial}»): lo decide el juez` : 'hizo la pregunta esperada' });
        if (asks && !denial) positive = true;
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
