/**
 * Did the agent tell the customer something happened that never happened?
 *
 * This is the failure that costs the most and shows the least. In production the
 * guard returned "nothing executed, ask for confirmation" and the agent replied
 * "¡Tu reserva está confirmada! 🎉" — the customer walked away believing they
 * had an apartment for two nights, and the backend had no reservation at all.
 * Nothing in the logs said anything was wrong: the turn looked perfectly healthy.
 *
 * Reserving, paying and cancelling are things the backend does. The agent can
 * only report them. So a reply that asserts one of those in the past tense is
 * only truthful when a tool actually succeeded in that same turn.
 */

/**
 * Past-tense completion claims in the four supported languages, restricted to
 * the operations that touch money or capacity.
 *
 * Deliberately narrow: it must not fire on "puedo reservarte", "¿confirmas?" or
 * "voy a generar el enlace", which are proposals and questions, not claims. Only
 * the shapes that leave a customer believing the deed is done.
 */
const OPERATION_SUBJECT =
    '(reserva|reservas|cita|citas|pago|pagos|pedido|pedidos|cobro|cancelacion|compra|orden|solicitud|booking|reservation|appointment|order|payment|purchase|request|agendamento|pagamento|commande|paiement|rendez-vous)';
// Words between the operation and the verb ("tu reserva en X del 1 al 5 esta confirmada"),
// but never across a data word: "el precio de la cita esta confirmado" is about the price.
const SUBJECT_GAP = '(?:(?!precio|tarifa|valor|price|cost|horario|disponibilidad|prix|preco|tarif)[^.!?;]){0,70}';

/**
 * "Confirmed" alone is a statement about data ("el precio está confirmado"),
 * not a deed: it only counts when an operation (booking, appointment, payment,
 * order...) is the subject. The verbs that carry the operation themselves
 * (reservado, pagado, cancelado, agendado) stay generic.
 */
const BOOKING_SUBJECT = '(cita|citas|reserva|reservas|reservacion|turno|agendamiento|booking|reservation|appointment|agendamento|rendez-vous)';
const COMPLETION_CLAIM = new RegExp(
    [
        // es — "tu reserva está confirmada", "quedó reservado", "ya está pagado"
        'reserva (esta|quedo|fue) (confirmada|hecha|creada|realizada)',
        OPERATION_SUBJECT + ' ' + SUBJECT_GAP + '(esta|quedo|fue) (confirmada|confirmado)',
        '(esta|quedo|fue) (reservada|reservado|pagada|pagado|cancelada|cancelado|agendada|agendado)',
        '(reserve|agende|cancele|cobre) (tu|su|la|el)',
        'ya (esta|quedo) (confirmad|reservad|pagad|cancelad|agendad)',
        // en — "your booking is confirmed", "has been booked"
        '(booking|reservation|appointment|payment|order) (is|has been|was) (confirmed|booked|created|cancelled|canceled|paid)',
        '(has|have) been (booked|cancelled|canceled|paid)',
        OPERATION_SUBJECT + ' ' + SUBJECT_GAP + '(has|have) been confirmed',
        // pt — "sua reserva esta confirmada", "foi reservado"
        'reserva (esta|foi) (confirmada|feita|criada)',
        OPERATION_SUBJECT + ' ' + SUBJECT_GAP + '(foi|esta) (confirmado|confirmada)',
        '(foi|esta) (reservado|reservada|pago|paga|cancelado|cancelada)',
        // fr — "votre reservation est confirmee"
        'reservation est (confirmee|creee|effectuee)',
        'a ete (confirmee|reservee|annulee|payee)',
        // The BOOKING outcome stated in other words: "su cita está lista", "he reservado", "I've booked", "agendei",
        // "j'ai réservé". Booking subjects only: «su pedido está listo para recoger» or «su solicitud está registrada»
        // are order/ticket status, true without a write this turn.
        BOOKING_SUBJECT + ' ' + SUBJECT_GAP + '(esta|quedo|fue) (lista|listo|programada|programado)',
        '\\b(he|hemos) (reservado|agendado|programado|apartado)\\b',
        '\\b(he|hemos) confirmado (tu|su|la|el) ' + BOOKING_SUBJECT,
        '\\bya (te |le )?(reserve|agende|aparte) ',
        "\\b(i've|i have|we've|we have) (booked|scheduled|reserved|confirmed) (your|the) ",
        "\\byou('re|\\s+are) (booked|confirmed)\\b",
        BOOKING_SUBJECT + ' ' + SUBJECT_GAP + '(is|was) (all set|ready)\\b',
        BOOKING_SUBJECT + ' ' + SUBJECT_GAP + '(ficou|foi|esta) (agendado|agendada|marcado|marcada|pronto|pronta)',
        '\\bficou (agendad|reservad|confirmad|marcad)',
        '\\b(agendei|reservei|marquei) (a|o|sua|seu|suas|seus) ',
        "\\bj['’]ai (reserve|programme) ",
        "\\bj['’]ai confirme (votre|le|la) ",
        BOOKING_SUBJECT + ' ' + SUBJECT_GAP + '(est|a ete) (confirme|confirmee|reserve|reservee|pris|prise|valide|validee)\\b',
    ].join('|'),
    'g',
);

/** A negation shortly before the claimed verb: "no", "aún no", "todavía no", "not", "não", "pas". */
const NEGATED_BEFORE = /\b(no|nunca|jamas|ni|not|never|nao|pas|jamais)\b(?: [a-zñ']+){0,2} ?$/;
const NEGATION_INSIDE = /\b(no|not|nao|pas|never|nunca)\b/;
/** "el precio de la cita esta confirmado": the data word governs, the operation is only a complement. */
const DATA_OF_BEFORE = /(precio|tarifa|valor|price|cost|costo|horario|disponibilidad|prix|preco)\s+(de|del|of|do|da|du|des)\b(\s+(la|el|los|las|the|l'))?\s*$/;

/** Same normalisation the confirmation classifier uses: accents and case are noise. */
function normalize(text: string): string {
    return text
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

/**
 * "¿Desea que le reserve la cita?" / "if you want me to book it": the verb is
 * the content of an offer. After accent folding the subjunctive "reserve" is
 * indistinguishable from the preterite "reservé", so the `que (le|te|lo|la)?`
 * lead-in is the only thing that tells them apart.
 */
const OFFER_LEAD_IN = /\b(?:desea|deseas|desean|quiere|quieres|quieren|quisiera|quisieras|gustaria|prefiere|prefieres|necesita|necesitas|para)\b(?:\s+(?:usted|ustedes|tu|vos))?\s+que\s+(?:(?:le|te|lo|la|les|los|las|se|me|nos)\s+)?$/;

/**
 * The calendar itself as the subject: "el sabado a las 16:00 ya esta reservado"
 * says the SLOT is taken; it does not say the customer's appointment was made.
 * Only the "esta" form is read this way: "quedo reservado" keeps meaning a deed.
 */
const AGENDA_SUBJECT = /\b(?:horario|hora|espacio|cupo|turno|hueco|franja|slot|disponibilidad)\b|\ba las? \d|\b\d{1,2}:\d{2}\b/;
/** "ya esta reservado PARA USTED" / "agendada A SU NOMBRE": the slot was taken on the customer's behalf. */
const FOR_THE_CUSTOMER = /\b(?:para (?:usted|ustedes|ti|vos)|a (?:su|tu) nombre)\b/;
const OPERATION_SUBJECT_BEFORE = new RegExp('\\b' + OPERATION_SUBJECT + '\\b');

/** Is the match inside a question: "¿...?" or the clause that ends in "?" with no break in between. */
function insideQuestion(sentence: string, index: number, end: number): boolean {
    const opener = sentence.lastIndexOf('¿', index);
    if (opener >= 0 && !sentence.slice(opener, index).includes('?')) return true;
    // A trailing "?" without an inverted opener (en/pt/fr, or a dash-joined tag question) is NOT
    // presumed to cover the claim: "Your booking is confirmed — anything else?" states a fact.
    return false;
}

/**
 * «¡Cita confirmada!» / «Reserva confirmada.» / «Perfecto, appointment booked»: the outcome as the HEADLINE of a sentence,
 * with no verb. Only at the start of a sentence (so «para dejar su cita confirmada…» and questions are not claims).
 */
const HEADLINE_CLAIM = new RegExp(
    '^\\W*(?:(?:listo|perfecto|genial|excelente|hecho|done|great|perfect|all set|pronto|parfait|voila)\\W+)*'
    + '(?:(?:su|tu|la|el|mi|your|the|votre|sua|seu|a|o)\\s+)?'
    + '(?:cita|reserva|reservacion|appointment|booking|reservation|agendamento|rendez-vous)'
    // not «Reserva confirmada: se requiere un depósito…» / «Cita confirmada: llegue 10 minutos antes»: that is information
    + '\\s+(?:confirmada|confirmado|agendada|agendado|reservada|reservado|confirmed|booked|scheduled|confirmee|confirme|reserve|reservee|pris|prise|marcada|marcado)\\b(?!\\s*:)',
);

/**
 * Saying what STATE a record is in is not claiming an ACTION: «su pedido está cancelado» / «el otro pedido, cuyo estado es
 * cancelado» report a status the customer asked about. Two things make a sentence a status report: it names the status
 * explicitly («estado», «status») BEFORE the participle, or the sentence is about a record that was READ this turn with that
 * very status (a listing, the active objects) and only repeats it in the PRESENT («el pedido D1D0D14A está cancelado»). A past
 * or reflexive form («quedó cancelado», «fue cancelado», «ya cancelé») is the deed, whatever was read.
 *
 * Only «cancelled» is read this way. «Está confirmada» / «está reservada» are exactly the sentences a model invents to close a
 * booking it never made, so a booking or a payment status is never excused by a record that merely exists.
 */
const STATUS_FRAME = /\b(?:estado|status|statut|situacion|estatus)\b(?: [a-z0-9]+){0,5} (?:es|esta|is|est)\b|\b(?:estado|status|statut|situacion|estatus)\s*:/;
const CANCELLED_PARTICIPLE = /\b(?:cancelad[oa]s?|anulad[oa]s?|cancelled|canceled|annulee?s?)\b/;
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled', 'cancelado', 'cancelada', 'anulado', 'anulada', 'voided']);

/** A record the turn read: its status and the words that identify it (its short reference, its product or service name). */
export interface RecordFact { status: string; tokens: readonly string[] }

function reportsReadCancellation(matched: string, sentence: string, facts: readonly RecordFact[]): boolean {
    if (!/\besta\b|\bis\b|\best\b/.test(matched) || /\b(?:quedo|fue|foi|was|a ete|ha sido)\b/.test(matched)) return false;
    if (!CANCELLED_PARTICIPLE.test(matched)) return false;
    return facts.some(fact => CANCELLED_STATUSES.has(String(fact.status).toLowerCase())
        && fact.tokens.some(token => normalize(String(token)).length >= 3 && sentence.includes(normalize(String(token)))));
}

export function claimsCompletedAction(reply: unknown, options: { recordFacts?: readonly RecordFact[] } = {}): boolean {
    if (typeof reply !== 'string' || !reply.trim()) return false;
    // Per sentence: a negation in one clause must not cancel a claim in another.
    return normalize(reply).split(/(?<=[.!?;])\s+|\n+/).some(sentence => {
        if (!/^\W*\u00bf/.test(sentence) && HEADLINE_CLAIM.test(sentence)) return true;
        COMPLETION_CLAIM.lastIndex = 0;
        for (let m = COMPLETION_CLAIM.exec(sentence); m; m = COMPLETION_CLAIM.exec(sentence)) {
            const before = sentence.slice(Math.max(0, m.index - 30), m.index);
            if (NEGATED_BEFORE.test(before) || NEGATION_INSIDE.test(m[0]) || DATA_OF_BEFORE.test(before)) continue;
            // A status the sentence names («cuyo estado es cancelado»), or one that was read this turn and is only repeated.
            if (/\besta\b/.test(m[0]) && STATUS_FRAME.test(sentence.slice(0, m.index + m[0].length))) continue;
            if (reportsReadCancellation(m[0], sentence, options.recordFacts ?? [])) continue;
            if (OFFER_LEAD_IN.test(before) || insideQuestion(sentence, m.index, m.index + m[0].length)) continue;
            if (/\besta\b/.test(m[0])) {
                const subject = sentence.slice(Math.max(0, m.index - 60), m.index);
                if (AGENDA_SUBJECT.test(subject) && !OPERATION_SUBJECT_BEFORE.test(subject)
                    && !FOR_THE_CUSTOMER.test(sentence.slice(m.index))) continue;
            }
            return true;
        }
        return false;
    });
}

/**
 * A tool result counts as success only when it says so. An `error` field, a
 * `success: false`, or the guard asking for confirmation all mean the operation
 * did NOT happen — which is precisely the state the agent kept narrating as done.
 */
export function toolResultSucceeded(result: unknown): boolean {
    if (!result || typeof result !== 'object') return false;
    const row = result as Record<string, unknown>;
    if (row.error || row.isError === true) return false;
    if (row.success === false) return false;
    return true;
}

export interface TurnClaimAudit {
    /** The agent asserted an action was completed. */
    claimed: boolean;
    /** At least one tool actually completed in this turn. */
    backed: boolean;
    /** Claimed something that never happened. */
    falseClaim: boolean;
}

/**
 * Fallback recogniser for tools that commit something, used when the caller does
 * not supply the canonical registry predicate.
 *
 * The original `^(create|cancel|…)_` prefix list silently missed every writer
 * that does not start with one of those verbs — `place_order`, `book_class`,
 * `enroll_student`, `register_pet`, `file_claim`, `apply_discount`,
 * `freeze_membership`, `calculate_quote` — which is most of what the vertical
 * toolsets actually close a sale with. A booking that really happened would then
 * be audited as a lie.
 */
const BACKING_TOOL_NAME = new RegExp(
    '^(create|cancel|reschedule|update|confirm|charge|refund|place|book|enroll'
    + '|register|file|apply|freeze|calculate|request|schedule|submit)_'
    + '|^get_placement_test_link$',
);

export interface TurnClaimAuditOptions {
    /** The records the turn READ (a listing, the active objects): repeating a cancelled one's status in the present is not a claim. */
    recordFacts?: readonly RecordFact[];
    /**
     * Canonical "this tool commits a business change" predicate. Callers inside
     * the API pass the tool-policy registry so the audit tracks the real writer
     * set instead of a name heuristic.
     */
    isBackingTool?: (name: string, result?: unknown) => boolean;
}

/**
 * Audit one turn: what the agent said against what the backend did.
 *
 * Only calls to tools that change something count as backing. A successful
 * availability lookup does not make "your booking is confirmed" true.
 *
 * The asymmetry matters. Denying a booking that DID happen pushes the customer
 * back into confirming something already paid for — the loop the owner reported
 * — while letting one exotic claim through costs a single wrong sentence. So an
 * unknown tool (MCP, opaque) that succeeded counts as backing: we cannot prove
 * it did nothing, and the safe direction here is to believe the backend.
 */
export function auditTurnClaim(
    reply: unknown,
    toolCalls: Array<{ name?: string; result?: unknown }> | undefined,
    options: TurnClaimAuditOptions = {},
): TurnClaimAudit {
    const claimed = claimsCompletedAction(reply, { recordFacts: options.recordFacts });
    const isBacking = options.isBackingTool || ((name: string) => BACKING_TOOL_NAME.test(name));
    const backed = (toolCalls || []).some((call) => (
        typeof call?.name === 'string'
        && isBacking(call.name, call.result)
        && toolResultSucceeded(call.result)
        // Escrita pero NO confirmada: el dueño exige pago y el cupo sigue a la
        // venta. La operación existe —por eso `toolResultSucceeded` es true— y
        // aun asi no respalda un "quedó confirmada": sin esta linea el guardrail
        // avalaba exactamente la mentira que la politica de pago existe para
        // evitar.
        && (call.result as any)?.awaitingPayment !== true
    ));
    return { claimed, backed, falseClaim: claimed && !backed };
}

/**
 * Promesas de entrega futura: "voy a generar el enlace", "un momento", "ya te lo mando".
 *
 * Fuera de contexto son legítimas y por eso `COMPLETION_CLAIM` las excluye a
 * propósito. Pero cuando el backend YA ejecutó la operación antes de llamar al
 * modelo —el camino del "sí" del cliente— el resultado ya está en la mano y
 * diferirlo es un callejón sin salida: cada turno es pregunta→respuesta, no hay
 * nada que mande ese segundo mensaje. En producción el 19-ago el enlace de pago
 * se ejecutó, el agente contestó "Voy a generar el enlace de pago ahora. Un
 * momento..." y la conversación quedó congelada.
 *
 * Se mantiene tan angosta como la de reclamos: sólo las formas que dejan al
 * cliente esperando un mensaje que nunca va a existir.
 */
const DEFERRED_DELIVERY = new RegExp(
    [
        // es
        'voy a (generar|crear|enviar|mandar|procesar|preparar|gestionar|tramitar)',
        'ya (te |le )?(lo |la )?(envio|mando|paso|comparto|genero)',
        // "Ahora te paso el enlace" es de las formas mas comunes y no la
        // cubria: el `ya` inicial no siempre esta.
        '(ahora|enseguida|ya mismo) (te |le )?(lo |la )?(paso|envio|mando|comparto|genero)',
        '(en )?un (momento|segundo|minuto|instante)',
        'dame (un|unos) (momento|segundo|minuto)',
        'enseguida (te|le|lo|la)',
        'permiteme (un|unos)',
        // en
        "i(’|')?ll (generate|create|send|share|prepare|process)",
        'i will (generate|create|send|share)',
        '(one|just a|give me a) (moment|second|minute)',
        // pt
        'vou (gerar|criar|enviar|mandar|preparar)',
        'ja (te |lhe )?(envio|mando)',
        'um (momento|instante|segundo)',
        // fr
        'je vais (generer|creer|envoyer|preparer)',
        "je vous (l(’|')?envoie|envoie)",
        'un (instant|moment)',
    ].join('|'),
    'i',
);

/**
 * ¿La respuesta promete hacer después algo que ya se hizo en este turno?
 *
 * Se normaliza igual que los reclamos (sin acentos, sin puntuación) para que
 * "envío" y "envio" caigan en el mismo patrón.
 */
export function promisesLaterDelivery(text: string | null | undefined): boolean {
    if (!text) return false;
    return DEFERRED_DELIVERY.test(normalize(text));
}

/**
 * Frases de ESPERA: "déjame verificar", "permítame consultar", "un momento",
 * "let me check", "um instante", "je vais vérifier"… Prometen volver con un
 * dato. En este pipeline un turno es pregunta→respuesta y nada manda un segundo
 * mensaje, así que la promesa solo es cierta si en ese mismo turno se llamó a
 * una herramienta (y entonces ya hay dato que decir).
 */
const WAIT_PHRASE = new RegExp(
    [
        // es
        '(dejame|dejeme|permiteme|permitame|permitanme|dame|denme) (un |unos |una )?(momento|segundo|minuto|instante)?\\s*(para )?(verificar|consultar|revisar|confirmar|chequear|checar|comprobar|ver|averiguar|validar)',
        '(dejame|dejeme|permiteme|permitame) (verificar|consultar|revisar|confirmar|chequear|checar|comprobar|averiguar)',
        'voy a (verificar|consultar|revisar|confirmar|chequear|checar|comprobar|averiguar|validar)',
        '(un|unos) (momento|momentito|segundo|segundito|minuto|instante)',
        // en
        "let me (check|verify|confirm|look|see|find out|get)",
        "i(’|')?ll (check|verify|confirm|look into|find out|get back)",
        'i will (check|verify|confirm|look into|find out|get back)',
        '(one|just a|give me a|hold on a|bear with me a) ?(moment|second|minute)',
        'hold on',
        // pt
        '(deixe|deixa)(-| )?(me|eu) (verificar|consultar|checar|confirmar|ver|conferir)',
        'vou (verificar|consultar|checar|confirmar|conferir|ver)',
        'um (momento|instante|segundo|minutinho)',
        'so um (momento|instante|segundo)',
        // fr
        '(laissez|laisse)(-| )?(moi) (verifier|consulter|voir|regarder|confirmer)',
        'je vais (verifier|consulter|regarder|confirmer|voir)',
        'un (instant|moment|petit moment)',
        'un instant',
    ].join('|'),
    'i',
);

/**
 * Words that may remain around a wait phrase without being "content":
 * acknowledgements, courtesy and the object pronouns of the wait itself
 * ("déjame verificar ESO", "let me check THAT for you").
 */
const WAIT_FILLER = new Set([
    'listo', 'claro', 'perfecto', 'ok', 'okay', 'vale', 'sure', 'of', 'course', 'certainly',
    'gracias', 'thanks', 'thank', 'you', 'por', 'favor', 'please', 'eso', 'esto', 'ese', 'esa',
    'dato', 'info', 'informacion', 'que', 'el', 'la', 'lo', 'los', 'las', 'te', 'le', 'me', 'mi',
    'tu', 'su', 'un', 'una', 'y', 'e', 'and', 'para', 'for', 'that', 'this', 'it', 'a', 'the', 'i',
    'ya', 'hola', 'hello', 'hi', 'oi', 'ola', 'bonjour', 'merci', 'svp', 'tudo', 'bem', 'bom',
    'isso', 'ca', 'cela', 'vous', 'pour', 'je', 'de', 'des', 'si', 'yes', 'sim', 'oui', 'pues',
    'be', 'right', 'back', 'soon', 'bien', 'entonces', 'mismo', 'ahora', 'now', 'agora', 'maintenant', 's', 'il', 'plait',
]);

/** A closing "is there anything else I can help with?" in the four languages. */
const IDLE_COURTESY_QUESTION = /[¿]?[^.!?¿]*\b(?:algo m[aá]s|otra cosa|alguna otra|something else|anything else|mais alguma coisa|algo mais|autre chose)\b[^.!?¿]*\?/giu;

/** Fewer words than this after the wait phrase is stripped is "no content". */
const WAIT_MAX_CONTENT_WORDS = 1;

/** Wait-promise messages carry no information; anything longer is content. */
const BARE_WAIT_MAX_WORDS = 18;

/**
 * ¿La respuesta ES SOLO una promesa de espera, sin contenido?
 *
 * Estrecho a propósito: tiene una frase de espera, es corta (<= 18 palabras),
 * no trae cifras (un precio, una hora, una fecha ya es contenido), no le hace
 * una pregunta al cliente (pedir un dato es avanzar el turno) y, quitada la
 * frase de espera y la cortesía, no queda otra cláusula con contenido
 * ("un momento y te comparto el menú" SÍ tiene otra cláusula). Sirve para el
 * caso en que NO se llamó a ninguna herramienta: ahí la espera es una promesa
 * sin entrega posible.
 */
export function isBareWaitPromise(raw: string | null | undefined): boolean {
    if (!raw || !raw.trim()) return false;
    // "Déjame verificar eso. ¿Puedo ayudarte con algo más?" (a persona template's fallback): the closing
    // "anything else?" is courtesy, not a question that advances the turn, so it does not rescue the promise.
    const text = raw.replace(IDLE_COURTESY_QUESTION, ' ').trim();
    if (!text) return false;
    if (/[?¿]/.test(text) || /\d/.test(text)) return false;
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length > BARE_WAIT_MAX_WORDS) return false;
    const n = normalize(text).replace(/[’]/g, "'");
    if (!WAIT_PHRASE.test(n)) return false;
    const rest = n
        .replace(new RegExp(WAIT_PHRASE.source, 'gi'), ' ')
        .match(/[a-z]+/g) || [];
    return rest.filter(w => !WAIT_FILLER.has(w)).length <= WAIT_MAX_CONTENT_WORDS;
}

/**
 * «Estoy gestionando la confirmación de su cita… Le avisaré»: the reply says the booking/order work is under way, or
 * that the customer will be told when it is done. A turn is question → answer and nothing sends a second message, so
 * when no tool ran in it the sentence is false whatever else the reply says.
 *
 * It must stay narrow: «Le aviso que abrimos a las 9:00», «Le avisaremos por correo cuando su pedido se envíe» or
 * «Estoy confirmando que tenemos disponibilidad» are plain information and must never be replaced. So a sentence only
 * counts when it
 *   - says work is under way («estoy gestionando») AND names an operation («la confirmación de su cita», «su reserva»),
 *     and is not «estoy confirmando QUE …»; or
 *   - promises to notify AND ties it to that pending work finishing («le aviso en cuanto esté lista», «once it is
 *     confirmed»), without being about a payment, an order or stock.
 * Each verb stands on a word boundary. Unlike `isBareWaitPromise` this ignores digits, questions and length.
 */
const OPERATION_NOUN = '(?:cita|reserva|reservacion|turno|agendamiento|agenda|confirmacion|solicitud|registro|pedido|orden|pago|compra|'
    + 'appointment|booking|reservation|order|payment|request|'
    + 'agendamento|consulta|marcacao|pagamento|solicitacao|'
    + 'rendez-vous|rendez vous|reservation|commande|paiement|demande)';

const UNDER_WAY = [
    // es
    `\\bestoy (?:gestionando|procesando|confirmando|agendando|reservando|registrando|tramitando|realizando|trabajando en)\\b(?! que\\b)[^.!?]{0,60}\\b${OPERATION_NOUN}\\b`,
    // en
    `\\bi(?:'m| am) (?:processing|booking|confirming|working on|handling|registering|scheduling)\\b(?! that\\b)[^.!?]{0,60}\\b${OPERATION_NOUN}\\b`,
    // pt
    `\\bestou (?:processando|agendando|confirmando|reservando|gerenciando|registrando|tratando)\\b(?! que\\b)[^.!?]{0,60}\\b${OPERATION_NOUN}\\b`,
    // fr
    `\\bje suis en train de (?:confirmer|reserver|traiter|enregistrer)\\b[^.!?]{0,60}\\b${OPERATION_NOUN}\\b`,
].map(source => new RegExp(source));

const NOTIFY_PROMISE = new RegExp([
    '\\b(?:te|le|les) (?:avisare|aviso|avisaremos|notificare|notifico|notificaremos|informare|escribire|escribo)\\b',
    "\\bi(?:'ll| will) (?:let you know|notify you|keep you posted|update you|message you|tell you)\\b",
    '\\b(?:vou|irei) (?:te |lhe )?(?:avisar|notificar|informar)\\b|\\b(?:avisarei|notificarei|informarei)\\b',
    '\\bje (?:vous |te )?(?:previendrai|tiendrai informe|informerai|avertirai|notifierai)\\b',
].join('|'));

const WORK_FINISHED = new RegExp([
    // es: «en cuanto esté lista», «apenas quede registrada», «una vez que se confirme»
    '\\b(?:apenas|en cuanto|tan pronto(?: como)?|una vez(?: que)?|cuando)(?: ya)? (?:(?:este|quede|quedo|sea) (?:lista|listo|confirmada|confirmado|registrada|registrado|agendada|agendado|procesada|procesado|completada|completado|terminada|terminado|hecha|hecho)|se (?:confirme|procese|complete|registre|termine))\\b',
    // en
    "\\b(?:as soon as|once|when|after) (?:it(?:'s| is| has been| was)|this is|that is|everything is) (?:done|confirmed|ready|booked|registered|complete|completed|processed|finished)\\b",
    // pt
    '\\b(?:assim que|logo que|quando) (?:estiver|esteja|for|ficar) (?:pronto|pronta|confirmado|confirmada|registrado|registrada|agendado|agendada|concluido|concluida|processado|processada)\\b',
    // fr
    "\\b(?:des que|une fois que|lorsque|quand) (?:ce sera|c'est|cela sera|il sera|elle sera|tout sera) (?:pret|prete|confirme|confirmee|termine|terminee|enregistre|enregistree|fait)\\b",
].join('|'));

/** The notification is about something that is not the booking being worked on: shipping, a payment, stock, a price. */
const NOT_THE_BOOKING = /\b(?:pago|pagos|pedido|pedidos|envio|despacho|compra|stock|inventario|precio|horario|factura|payment|order|shipping|delivery|price|invoice|pagamento|paiement|commande|livraison)\b/;

export function promisesActionWithoutTool(text: string | null | undefined): boolean {
    if (!text) return false;
    const sentences = normalize(text).replace(/[’]/g, "'").split(/[.!?…\n]+/);
    for (const sentence of sentences) {
        if (!sentence.trim()) continue;
        if (UNDER_WAY.some(pattern => pattern.test(sentence))) return true;
        if (NOTIFY_PROMISE.test(sentence) && WORK_FINISHED.test(sentence) && !NOT_THE_BOOKING.test(sentence)) return true;
    }
    return false;
}

/**
 * Destinatarios humanos. Sin acentos porque `normalize` ya los quitó
 * ("companero", no "compañero").
 */
const HUMAN_TARGET =
    '(asesor|asesores|agente|agentes|agent|equipe|equipo|humano|persona|representante|especialista'
    + '|ejecutivo|operador|companero|colega|supervisor|team|human|advisor|representative'
    + '|colleague|atendente|consultor|conseiller)';

/**
 * ¿La respuesta PROMETE pasar la conversación a un humano?
 *
 * El handoff sólo se dispara desde `shouldHandoff`, que mira el texto DEL
 * CLIENTE (pide un humano, se queja, pide descuento…). Cuando el agente decide
 * escalar por una regla de negocio propia —"para grupos de más de 10 personas
 * lo conecto con el equipo"— no existe ningún camino que ejecute esa decisión:
 * la promesa sale al cliente y la conversación queda en 'active'. Pasó en
 * producción: el cliente confirmó, leyó "le paso con nuestro equipo
 * especializado, espere un momento", y nadie fue notificado nunca.
 *
 * Deliberadamente estrecho, igual que `COMPLETION_CLAIM`: exige un verbo de
 * transferencia Y un destinatario humano cerca. "Puedo ayudarte con el equipo
 * de ventas" no es una promesa de transferencia.
 */
/**
 * The destination of a transfer: a preposition, optional determiners, then the
 * human target — all adjacent. Without it "Vou te passar o cardápio da equipe"
 * (hand you the menu) or "Je vais vous passer les horaires de notre équipe"
 * would read as "I am transferring you to the team" and escalate unasked.
 */
const WORDS3 = "([a-z']+\\s+){0,3}";
const DEST_EN = '\\b(to|with)\\s+' + WORDS3 + HUMAN_TARGET;
const DEST_PT = '\\b(para|com|a|ao)\\s+' + WORDS3 + HUMAN_TARGET;
const DEST_FR = '\\b(a|avec|vers)\\s+' + WORDS3 + HUMAN_TARGET;

const HANDOFF_PROMISE = new RegExp(
    [
        // es — "le paso con un asesor", "lo transfiero con el equipo"
        '(le|lo|la|te|los)\\s+(paso|transfiero|comunico|conecto|derivo|enlazo)\\s+(con|a)\\b[^.!?]{0,40}' + HUMAN_TARGET,
        '(voy a|procedo a|paso a)\\s+(transferir|pasar|comunicar|conectar|derivar)\\b[^.!?]{0,40}' + HUMAN_TARGET,
        // "un asesor se comunicara", "nuestro equipo lo contactara"
        HUMAN_TARGET + '[^.!?]{0,40}(se (comunicara|contactara|pondra en contacto)|lo (contactara|atendera)|le (escribira|atendera)|te (contactara|atendera))',
        // en — the human target must be introduced by "to"/"with" right before it
        '(transferring|connecting) you\\b[^.!?,]{0,12}' + DEST_EN,
        "(i['’]?ll|i will|let me) (transfer|connect|put) you\\b[^.!?,]{0,12}" + DEST_EN,
        HUMAN_TARGET + '[^.!?]{0,40}will (contact|reach out|be with|get back)',
        // pt — "passar você para um atendente"; "passar o cardápio da equipe" is NOT a handoff
        '(vou|estou) (te |lhe |voce )?(transferir|transferindo|conectar|passar)\\b[^.!?,]{0,12}' + DEST_PT,
        // fr — "vous passer à un conseiller"; "vous passer les horaires de notre équipe" is NOT
        'je (vous (transfere|mets en relation|passe)|vais vous (transferer|passer|mettre( en relation)?))\\b[^.!?,]{0,12}' + DEST_FR,
    ].join('|'),
);

/**
 * Se evalúa por ORACIÓN y se saltean las interrogativas: un mismo mensaje suele
 * llevar la oferta y la pregunta juntas ("…lo conecto con el equipo. ¿Desea que
 * le transfiera ahora?"), y una pregunta no es una promesa cumplida.
 */
export function promisesHumanHandoff(reply: unknown): boolean {
    if (typeof reply !== 'string' || !reply.trim()) return false;
    return normalize(reply)
        .split(/(?<=[.!?])\s+|\n+/)
        .some(sentence =>
            !sentence.includes('?')
            && !sentence.includes('\u00bf')
            && !CONDITIONAL_OFFER.test(sentence)
            && HANDOFF_PROMISE.test(sentence));
}

/**
 * The reply without its unsolicited promise-of-transfer sentences. Everything else
 * the agent said (the correct information) is kept, line breaks included (lists
 * stay lists); the caller adds the offer in question form. Same sentence rules as
 * `promisesHumanHandoff`.
 *
 * A promise sentence that also carries a figure ("El kit cuesta 50.000 COP, le paso
 * con nuestro equipo") is not dropped whole: its clauses without the promise are
 * kept when they hold a digit, so an amount, hour or date is never lost.
 */
export function removeHandoffPromiseSentences(reply: string): string {
    // Odd indexes are the separators (spaces after a full stop, or line breaks).
    const parts = reply.split(/((?<=[.!?])[ \t]+|\n+)/);
    let out = '';
    let pendingSeparator = '';
    for (let i = 0; i < parts.length; i += 2) {
        const sentence = parts[i];
        const separator = parts[i + 1] ?? '';
        let kept: string | null = sentence;
        if (sentence.trim() && promisesHumanHandoff(sentence)) {
            const withData = sentence.split(/(?<=,)\s+|\s+(?:y|and|e|et)\s+/)
                .filter(clause => !promisesHumanHandoff(clause) && /\d/.test(clause))
                .join(', ').replace(/[,;:\s]+$/, '');
            kept = withData ? `${withData}.` : null;
        }
        if (kept === null || !kept.trim()) {
            // Its own separator goes with it; a line break that preceded it stays.
            pendingSeparator = pendingSeparator.includes('\n') ? pendingSeparator : separator.includes('\n') ? separator : pendingSeparator;
            continue;
        }
        out += (out ? (pendingSeparator || ' ') : '') + kept;
        pendingSeparator = separator;
    }
    return out.trim();
}

/**
 * "Si quiere, le paso con alguien del equipo" is an OFFER the customer has not
 * accepted, not a promise. Reading it as a promise escalated the conversation
 * (waiting_human, agent muted) on a customer who had asked for nothing.
 */
const CONDITIONAL_OFFER = new RegExp(
    [
        // es
        '\\bsi (lo |le |te )?(quiere|quieres|desea|deseas|gusta|gustas|prefiere|prefieres|quisiera|quisieras|le gustaria|te gustaria)\\b',
        '\\bsi (lo|le|te) (desea|deseas|prefiere|prefieres|quiere|quieres)\\b',
        // en
        "\\bif (you|you'd|you would|youd) ?(like|want|prefer|wish)",
        '\\bif you (would )?(like|want|prefer|wish)\\b',
        // pt
        '\\bse (voce )?(quiser|preferir|desejar|quiseres|preferires|gostar)\\b',
        // fr
        '\\bsi (vous|tu) (voulez|veux|le souhaitez|souhaitez|preferez|prefere|desirez|le desirez)\\b',
    ].join('|'),
);

/**
 * Does the text OFFER (or promise) a person from the team, in any mood? Used on
 * the previous outbound message to tell whether the customer's "s\u00ed" accepts a
 * handoff. Conditional and interrogative sentences count here: they are exactly
 * the offers a "s\u00ed" answers.
 */
export function offersHumanHandoff(reply: unknown): boolean {
    if (typeof reply !== 'string' || !reply.trim()) return false;
    return normalize(reply)
        .split(/(?<=[.!?])\s+|\n+/)
        .some(sentence => HANDOFF_PROMISE.test(sentence) || OFFER_QUESTION.test(sentence)
            || (sentence.includes('?') && OFFER_TRANSFER.test(sentence) && !HANDS_OVER_AN_OBJECT.test(sentence)));
}

/**
 * What a question has to name to be an offer of a PERSON. Deliberately not the
 * bare "equipo"/"especialista": "¿Quiere el kit del equipo de fútbol?" and "¿Desea
 * agendar con el especialista?" are about a product and a booking, and a "sí" to
 * them must not become a handoff.
 */
const OFFER_TARGET =
    '(?:una persona|alguien del equipo|alguien de nuestro equipo|alguien de ventas|alguien mas del equipo|un asesor|una asesora|asesor humano'
    + '|agente humano|un humano|someone from (?:our |the )?team|a person|a human|human agent|an advisor|an agent'
    + '|alguem da equipe|alguem de nossa equipe|uma pessoa|um atendente|um humano|um consultor'
    + "|quelqu'un de l'equipe|quelqu'un de notre equipe|un conseiller|une personne"
    + '|hablar con (?:un|una) (?:agente|asesor|asesora|persona|humano)|(?:speak|talk) (?:to|with) (?:(?:a|an) (?:human|agent|person|advisor|representative)|someone)'
    + '|falar com (?:um|uma) (?:atendente|agente|pessoa|humano|consultor)|parler a (?:un|une) (?:conseiller|agent|personne))';

/** A transfer verb followed by a human destination: "¿Quiere que lo conecte con nuestro equipo?". */
const OFFER_TRANSFER = new RegExp(
    '\\b(?:conecte|conecto|comunique|comunico|pase|paso|transfiera|transfiero|derive|derivo|connect|transfer|put you|pass you'
    + '|transfira|passe|passar|conectar|mette|mets|transfere|transferer|passer)\\b[^?.!]{0,40}\\b' + HUMAN_TARGET + '\\b',
);

/**
 * "¿Le paso el menú del equipo?" hands over a THING, not the person: the verb is
 * followed by an object noun before any destination.
 */
const HANDS_OVER_AN_OBJECT = new RegExp(
    '\\b(?:paso|pase|passo|passe|passar|mets|send|share)\\b\\s+(?:\\S+\\s+){0,2}?'
    + '(?:menu|contacto|contato|carta|enlace|link|numero|telefono|telefone|catalogo|precio|lista|informacion|datos|horario|cotizacion|presupuesto|cuenta|factura|direccion|ubicacion|number|contact|phone|price|list|address|details)\\b',
);

const OFFER_QUESTION = new RegExp(
    '\\b(?:quiere|quieres|desea|deseas|gustaria|prefiere|prefieres|would you|do you want|voulez|souhaitez|quer|gostaria)\\b[^?]{0,80}\\b'
    + OFFER_TARGET,
);

