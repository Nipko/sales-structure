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
 * cancelado» report a status the customer asked about. What makes a sentence a status report is a record that was READ this
 * turn (a listing, the active objects) with that very status, named in the sentence, which only repeats it in the PRESENT
 * («el pedido D1D0D14A está cancelado»). Wording alone («el estado de su pedido está …») excuses nothing. A past or reflexive
 * form («quedó cancelado», «fue cancelado», «ya cancelé») is the deed, whatever was read.
 *
 * Only «cancelled» is read this way. «Está confirmada» / «está reservada» are exactly the sentences a model invents to close a
 * booking it never made, so a booking or a payment status is never excused by a record that merely exists.
 */

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
            // A cancelled status of a record that was READ this turn and is only repeated in the present. Nothing else is excused:
            // naming «el estado» does not make «está confirmada» / «está agendada» / «está pagado» a report (that is how a booking
            // that never happened gets announced).
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
    /** Current customer explicitly requested a CRM note; acknowledgement then means persistence. */
    crmNoteRequested?: boolean;
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
    const operationClaimed = claimsCompletedAction(reply, { recordFacts: options.recordFacts });
    const noteClaimed = claimsCrmNoteRecorded(reply, options.crmNoteRequested === true);
    const crmClaims: Array<{ name: string; field: string; claimed: boolean; created?: boolean; recorded?: boolean; idField?: string }> = [
        { name: 'add_contact_note', field: 'recorded', claimed: noteClaimed },
        { name: 'tag_contact', field: 'tag', claimed: claimsOtherCrmFieldRecorded(reply, 'tag') },
        { name: 'record_contact_interest', field: 'interest', claimed: claimsOtherCrmFieldRecorded(reply, 'interest') },
        { name: 'ensure_crm_lead', field: 'leadId', claimed: claimsCrmOperationCompleted(reply, 'lead'), created: true, idField: 'leadId' },
        { name: 'create_crm_opportunity', field: 'opportunityId', claimed: claimsCrmOperationCompleted(reply, 'opportunity'), created: true, idField: 'opportunityId' },
        { name: 'create_follow_up_task', field: 'taskId', claimed: claimsCrmOperationCompleted(reply, 'task'), created: true, idField: 'taskId' },
        { name: 'move_crm_opportunity_stage', field: 'stage', claimed: claimsCrmOperationCompleted(reply, 'stage'), idField: 'opportunityId' },
        { name: 'record_contact_consent', field: 'consentId', claimed: claimsCrmOperationCompleted(reply, 'consent'), recorded: true, idField: 'consentId' },
    ].filter(claim => claim.claimed);
    const claimed = operationClaimed || crmClaims.length > 0;
    const isBacking = options.isBackingTool || ((name: string) => BACKING_TOOL_NAME.test(name));
    const operationBacked = (toolCalls || []).some((call) => (
        typeof call?.name === 'string'
        && isBacking(call.name, call.result)
        // A note cannot also prove a booking/payment in a mixed response.
        && !crmClaims.some(claim => claim.name === call.name)
        && toolResultSucceeded(call.result)
        // Escrita pero NO confirmada: el dueño exige pago y el cupo sigue a la
        // venta. La operación existe —por eso `toolResultSucceeded` es true— y
        // aun asi no respalda un "quedó confirmada": sin esta linea el guardrail
        // avalaba exactamente la mentira que la politica de pago existe para
        // evitar.
        && (call.result as any)?.awaitingPayment !== true
    ));
    const crmBacked = crmClaims.every(claim => (toolCalls || []).some(call => {
        const result = call?.result as Record<string, unknown> | undefined;
        const recorded = result?.[claim.field];
        return call?.name === claim.name && toolResultSucceeded(result)
            && result?.success === true && typeof recorded === 'string'
            && recorded.trim().length > 0 && result.awaitingPayment !== true
            && (!claim.created || result.created === true)
            && (!claim.recorded || result.recorded === true)
            && (!claim.idField || (typeof result[claim.idField] === 'string'
                && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result[claim.idField] as string)));
    }));
    const backed = crmClaims.length ? crmBacked && (!operationClaimed || operationBacked) : operationBacked;
    return { claimed, backed, falseClaim: claimed && !backed };
}

/** Completion words never substitute for the domain receipt or an approval/confirmation. */
function claimsCrmOperationCompleted(reply: unknown, kind: 'lead' | 'opportunity' | 'task' | 'stage' | 'consent'): boolean {
    if (typeof reply !== 'string' || !reply.trim()) return false;
    const terms = {
        lead: ['creado', '(?:lead|ficha comercial)'],
        opportunity: ['creado', 'oportunidad(?: comercial)?'],
        task: ['creado|programado|agendado', 'tarea de seguimiento'],
        stage: ['movido|cambiado|pasado|actualizado', 'oportunidad'],
        consent: ['registrado|guardado', 'consentimiento'],
    }[kind];
    const pattern = new RegExp('\\b(?:he|hemos) (?:' + terms[0] + ')\\s+'
        + '(?:(?:un|una|la|el|su|tu|esta|esa)\\s+)?(?:(?:nuevo|nueva)\\s+)?'
        + terms[1] + '\\b[^.!?;]{0,140}\\b(?:ficha|perfil|registro|crm)\\b', 'g');
    return normalize(reply).split(/(?<=[.!?;])\s+|\n+/).some(sentence => {
        pattern.lastIndex = 0;
        for (let m = pattern.exec(sentence); m; m = pattern.exec(sentence)) {
            const before = sentence.slice(Math.max(0, m.index - 30), m.index);
            if (!NEGATED_BEFORE.test(before) && !NEGATION_INSIDE.test(m[0])
                && !insideQuestion(sentence, m.index, m.index + m[0].length)) return true;
        }
        return false;
    });
}

/** Explicit completed tag/interest writes on an owned CRM record, not present record facts. */
function claimsOtherCrmFieldRecorded(reply: unknown, kind: 'tag' | 'interest'): boolean {
    if (typeof reply !== 'string' || !reply.trim()) return false;
    const pattern = kind === 'tag'
        ? /\b(?:he|hemos) (?:agregado|anadido|asignado|aplicado)\s+(?:(?:una|la|su|tu|esta|esa)\s+)?etiqueta\b[^.!?;]{0,140}\b(?:ficha|perfil|registro|crm)\b/g
        : /\b(?:he|hemos) (?:guardado|registrado|anotado|agregado)\s+(?:(?:el|su|tu|este|ese)\s+)?interes\b[^.!?;]{0,140}\b(?:ficha|perfil|registro|crm)\b/g;
    return normalize(reply).split(/(?<=[.!?;])\s+|\n+/).some(sentence => {
        pattern.lastIndex = 0;
        for (let m = pattern.exec(sentence); m; m = pattern.exec(sentence)) {
            const before = sentence.slice(Math.max(0, m.index - 30), m.index);
            if (!NEGATED_BEFORE.test(before) && !NEGATION_INSIDE.test(m[0])
                && !insideQuestion(sentence, m.index, m.index + m[0].length)) return true;
        }
        return false;
    });
}

/** Spanish first-person completed CRM writes; present record facts are not new writes. */
function claimsCrmNoteRecorded(reply: unknown, requested: boolean): boolean {
    if (typeof reply !== 'string' || !reply.trim()) return false;
    const scoped = /\b(?:he|hemos) (?:guardado|registrado|anotado|agregado)\s+(?:(?:una|la|su|tu|esta|esa)\s+)?(?:nota|preferencia)\b[^.!?;]{0,140}\b(?:ficha|perfil|registro|crm)\b/g;
    const acknowledgement = /\b(?:he|hemos) tomado nota\b/g;
    const requestedPronoun = /\b(?:la|lo) (?:he|hemos) (?:guardado|registrado|anotado|agregado)\b[^.!?;]{0,100}\b(?:ficha|perfil|registro|crm)\b/g;
    return normalize(reply).split(/(?<=[.!?;])\s+|\n+/).some(sentence => {
        for (const pattern of requested ? [scoped, acknowledgement, requestedPronoun] : [scoped]) {
            pattern.lastIndex = 0;
            for (let m = pattern.exec(sentence); m; m = pattern.exec(sentence)) {
                const before = sentence.slice(Math.max(0, m.index - 30), m.index);
                if (!NEGATED_BEFORE.test(before) && !NEGATION_INSIDE.test(m[0])
                    && !insideQuestion(sentence, m.index, m.index + m[0].length)) return true;
            }
        }
        return false;
    });
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
        // A claim that the request was already passed to the team is the same promise in other words.
        const promises = (text: string) => promisesHumanHandoff(text) || claimsTeamRequest(text);
        if (sentence.trim() && promises(sentence)) {
            const withData = sentence.split(/(?<=,)\s+|\s+(?:y|and|e|et)\s+/)
                .filter(clause => !promises(clause) && /\d/.test(clause))
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
 * «He registrado su consulta para que alguien del equipo confirme…», «He solicitado a alguien del equipo que le confirme el
 * precio», «Estoy pasando su solicitud al equipo… Le avisaré en cuanto tenga la respuesta». The reply says the customer's
 * request already reached the team, or that the customer will be called back. In production (Telegram, 3 cases) the customer
 * had just said «Sí, por favor» to the agent's own offer of a person, the only tool of the turn was `ensure_crm_lead`, and
 * nothing opened a handoff or left a task: `promisesHumanHandoff` only knows TRANSFER verbs («le paso con…»), so the honour
 * path never ran, and the action guard is off whenever any business write (the lead) succeeded.
 *
 * Narrow like the other claim detectors: a first-person deed (or the team's announced action) with a human destination; a
 * question, a conditional offer («si quiere, le aviso cuando…») or a negation is not a claim. «Nuestro equipo tiene diez años
 * de experiencia» or «He enviado la foto del equipo» name the team without saying anything was passed to it.
 */
/** Up to four words before the target, elided articles included («de l'équipe», «à l'équipe»). */
const TEAM_WORDS = "(?:[a-z]+\\s+|[a-z]+'\\s*){0,4}";
const TEAM_TARGET = '(?:' + HUMAN_TARGET.slice(1, -1) + "|alguien|someone|staff|person|alguem|quelqu'un|collegue|collegues|responsable)";
const TEAM_DEST = '\\b(?:a|al|ao|aos|au|aux|con|com|para|to|with|avec|vers)\\s+' + TEAM_WORDS + TEAM_TARGET + '\\b';
/** The thing handed over is a document, an order or a payment, not the customer's request: «He enviado su pedido al equipo de cocina». */
const HANDED_OVER_AN_OBJECT = /\b(?:pedido|pedidos|orden|order|orders|commande|encomenda|pago|pagamento|payment|paiement|factura|invoice|fatura|facture|enlace|link|lien|comprobante|receipt|recibo|recu|foto|fotos|photo|photos|menu|catalogo|catalog|catalogue|cardapio)\b/;
const REQUEST_NOUN = '(?:consulta|solicitud|pregunta|caso|peticion|duda|mensaje|requerimiento|solicitacao|pergunta|duvida|demande|question|requete|dossier)';

/** `objectGuard`: the pattern hands something over, so a sentence about an order / a document / a payment is not a team request. */
const TEAM_REQUEST_CLAIM: ReadonlyArray<{ re: RegExp; objectGuard?: boolean }> = [
    // es — «he pasado su consulta al equipo», «ya trasladé su solicitud a un asesor», «estoy pasando su solicitud al equipo»
    { objectGuard: true, re: new RegExp('\\b(?:(?:he|hemos|ya)\\s+(?:pasado|enviado|trasladado|remitido|escalado|derivado|transmitido|transferido|reenviado|elevado)'
        + '|ya (?:pase|envie|traslade|remiti|escale|derive|transmiti|reenvie)'
        + '|estoy (?:pasando|enviando|trasladando|remitiendo|escalando|derivando|transmitiendo|transfiriendo|reenviando))\\b[^.!?;]{0,80}' + TEAM_DEST) },
    // es — «he solicitado a alguien del equipo que…», «ya avisé al equipo», «estoy consultando con el equipo»
    { re: new RegExp('\\b(?:(?:he|hemos)\\s+(?:solicitado|pedido|avisado|notificado|informado|comunicado|alertado)'
        + '|ya (?:solicite|pedi|avise|notifique|informe|alerte)'
        + '|estoy (?:solicitando|avisando|notificando|consultando|comunicando))\\s+(?:(?:le|lo|la)\\s+)?' + TEAM_DEST) },
    // es — «he registrado su consulta para que alguien del equipo confirme», «he dejado anotada su solicitud para el equipo»
    // es — «he tomado nota para que alguien del equipo confirme… y le contacte», «dejé anotado para que el equipo…» (production, store)
    { re: new RegExp('\\b(?:(?:he|hemos)\\s+(?:registrado|anotado|dejado|apuntado|creado|abierto|tomado nota)|ya (?:registre|anote|deje|apunte|tome nota)'
        + '|tome nota|tomamos nota|(?:deje|dejamos) (?:anotad|registrad|apuntad)[oa]s?|(?:deje|dejamos) (?:constancia|nota)'
        + '|estoy (?:registrando|anotando|dejando|tomando nota))\\b[^.!?;]{0,80}\\b(?:para que|para el|para la|para nuestro|para nuestra|al)\\s+' + TEAM_WORDS + TEAM_TARGET + '\\b') },
    // es — «le estoy transfiriendo (con el equipo)»
    { re: /\b(?:le|lo|la|te|los|las) estoy (?:transfiriendo|pasando|comunicando|conectando|derivando)(?:\s*$|\s+(?:con|a|al)\s+(?:[a-z']+\s+){0,3}(?:asesor|asesora|agente|equipo|persona|especialista|humano|alguien)\b)/ },
    // es/pt/fr — «su consulta fue enviada al equipo», «su solicitud quedó registrada para que el equipo…»
    { re: new RegExp('\\b' + REQUEST_NOUN + '\\b[^.!?;]{0,30}\\b(?:fue|ha sido|quedo|esta|foi|ficou|a ete|est) (?:enviad|registrad|pasad|trasladad|remitid|escalad|derivad|transferid|anotad|encaminhad|repassad)[oa]s?\\b[^.!?;]{0,60}'
        + '(?:' + TEAM_DEST + '|\\bpara que\\s+' + TEAM_WORDS + TEAM_TARGET + '\\b)') },
    // es — the team's announced action: «alguien del equipo le confirmará / le escribirá / le responderá»
    { re: new RegExp(TEAM_TARGET + '\\b[^.!?;]{0,40}\\b(?:le|te|les) (?:confirmara|respondera|contestara|escribira|llamara|avisara|informara|contactara)n?\\b') },
    // es — the team, unnamed: «le contactarán», «le llamarán para confirmarlo», «se pondrán en contacto con usted». Not
    // about an order, a payment or a delivery («le avisarán por correo cuando su pedido se envíe» is information).
    { re: /\b(?:(?:le|te|les|lo|la|los|las) (?:contactaran|llamaran|escribiran|confirmaran|responderan|avisaran|informaran|contestaran|recontactaran)|se pondran en contacto con (?:usted|ustedes|contigo))\b(?![^.!?;]*\b(?:pedido|pedidos|envio|despacho|pago|factura|correo|email|paquete|compra|banco)\b)/ },
    // es — the callback: «le avisaré en cuanto tenga la respuesta», «le escribo apenas me confirmen», «le mantendré informado»
    { re: /\b(?:le|te|les) (?:avisare|aviso|avisamos|avisaremos|notificare|notificaremos|informare|informaremos|escribire|escribo|escribiremos|confirmare|confirmo|confirmaremos|contactare|contactaremos|respondere|comunicare)\b(?! que\b)[^.!?;]{0,30}\b(?:cuando|en cuanto|apenas|tan pronto|una vez|ni bien)\b[^.!?;]{0,40}\b(?:tenga|tengamos|tengan|sepa|sepamos|reciba|recibamos|me (?:respondan|confirmen|contesten|digan|avisen|informen)|nos (?:respondan|confirmen|contesten|digan|avisen|informen)|respondan|confirmen|contesten|el equipo|respuesta|confirmacion|novedad|novedades|noticias)\b/ },
    { re: /\b(?:le|te|les) (?:mantendre|mantendremos) (?:informad|al tanto|al corriente)|\b(?:le|te|les) (?:avisare|avisaremos|notificare|informare)\s*$/ },
    // en — «I've passed your request to the team», «I'm forwarding this to our staff»
    { objectGuard: true, re: new RegExp("\\b(?:(?:i(?:'ve| have)|we(?:'ve| have)|i|we)\\s+(?:already\\s+|just\\s+)?(?:passed|forwarded|sent|escalated|referred|relayed|submitted|handed|transferred)"
        + "|(?:i(?:'m| am)|we(?:'re| are))\\s+(?:passing|forwarding|sending|escalating|referring|relaying|handing|transferring))\\b[^.!?;]{0,80}" + TEAM_DEST) },
    // en — «I've asked someone from the team to confirm it», «we have notified our staff»
    { re: new RegExp("\\b(?:i(?:'ve| have)|we(?:'ve| have)|i|we)\\s+(?:already\\s+|just\\s+)?(?:asked|requested|notified|informed|alerted|contacted)\\s+(?!you\\b)" + TEAM_WORDS + TEAM_TARGET + '\\b') },
    { re: new RegExp("\\b(?:i(?:'ve| have)|we(?:'ve| have))\\s+(?:logged|registered|recorded|noted|created|opened|made a note|taken (?:a )?note|left a note|noted (?:it|this|that) down)\\b[^.!?;]{0,80}\\bso (?:that )?" + TEAM_WORDS + TEAM_TARGET + '\\b') },
    { re: new RegExp(TEAM_TARGET + "\\b[^.!?;]{0,40}\\bwill (?:confirm (?:it|this|that|the)|call you|reply to you|respond to you|let you know|be in touch|follow up with you|contact you|reach out to you|get back to you)\\b") },
    { re: /\byou(?:'ll| will) be (?:contacted|called)\b(?![^.!?;]*\b(?:order|payment|delivery|shipping|email|bank)\b)/ },
    // en — the callback: «I'll let you know (as soon as I hear back)», «I'll get back to you»
    { re: /\b(?:i(?:'ll| will)|we(?:'ll| will)) (?:let you know|get back to you|keep you (?:posted|updated|informed)|update you|follow up)(?:\s*$|[^.!?;]{0,6}\b(?:as soon as|once|when|after|the moment)\b)/ },
    // pt — «passei sua solicitação para a equipe», «estou encaminhando para um atendente»
    { objectGuard: true, re: new RegExp('\\b(?:(?:ja\\s+)?(?:passei|encaminhei|enviei|repassei|transferi|escalei|mandei)|estou (?:passando|encaminhando|enviando|repassando|transferindo|escalando))\\b[^.!?;]{0,80}' + TEAM_DEST) },
    // pt — «pedi a alguém da equipe para confirmar», «já avisei a equipe», «acionei um atendente»
    { re: new RegExp('\\b(?:ja\\s+)?(?:solicitei|pedi|avisei|informei|notifiquei|acionei)\\s+(?:(?:a|ao|para|o)\\s+)?' + TEAM_WORDS + TEAM_TARGET + '\\b') },
    { re: new RegExp('\\b(?:registrei|anotei|tomei nota|deixei (?:registrad|anotad)[oa])\\b[^.!?;]{0,80}\\bpara que\\s+' + TEAM_WORDS + TEAM_TARGET + '\\b') },
    { re: new RegExp(TEAM_TARGET + '\\b[^.!?;]{0,40}\\b(?:(?:vai|ira|vao|irao) (?:te |lhe )?(?:confirmar|responder|retornar|ligar|avisar|contatar)|entrara em contato|entrarao em contato|vai entrar em contato|vao entrar em contato|(?:te|lhe) retorna)\\b') },
    { re: /\b(?:voce sera (?:contatad|contactad)[oa]|(?:vao|irao) entrar em contato com (?:voce|o senhor|a senhora)|entrarao em contato com (?:voce|o senhor|a senhora))\b(?![^.!?;]*\b(?:pedido|pagamento|entrega|email|banco)\b)/ },
    // pt — the callback: «vou te avisar assim que tiver a resposta»
    { re: /\b(?:(?:vou|irei) (?:te |lhe )?(?:avisar|informar|notificar|retornar)|(?:te|lhe) (?:aviso|informo|retorno)|avisarei|informarei|retornarei)\b[^.!?;]{0,20}\b(?:assim que|quando|logo que|tao logo)\b[^.!?;]{0,40}\b(?:tiver|tivermos|souber|soubermos|receber|recebermos|responderem|confirmarem|me (?:responderem|confirmarem|avisarem)|resposta|retorno|confirmacao|a equipe|novidades)\b/ },
    // fr — «j'ai transmis votre demande à l'équipe», «je transmets votre question à un conseiller»
    { objectGuard: true, re: new RegExp("\\b(?:(?:j'ai|nous avons)\\s+(?:deja\\s+)?(?:transmis|transfere|envoye|fait suivre|remonte|signale|communique|passe|relaye)"
        + "|je (?:transmets|fais suivre|suis en train de transmettre))\\b[^.!?;]{0,80}" + TEAM_DEST) },
    // fr — «j'ai demandé à quelqu'un de l'équipe de confirmer»
    { re: new RegExp("\\b(?:j'ai|nous avons)\\s+(?:deja\\s+)?(?:demande|prevenu|averti|informe|notifie|contacte|sollicite)\\s+(?:(?:a|au|aux)\\s+)?" + TEAM_WORDS + TEAM_TARGET + '\\b') },
    { re: new RegExp("\\b(?:j'ai|nous avons)\\s+(?:enregistre|note|consigne|cree|ouvert|pris note)\\b[^.!?;]{0,80}\\bpour qu(?:e\\s+|')" + TEAM_WORDS + TEAM_TARGET + '\\b') },
    { re: /\b(?:vous serez (?:contacte|recontacte|rappele)e?s?|on (?:vous|te) (?:contactera|recontactera|rappellera))\b(?![^.!?;]*\b(?:commande|paiement|livraison|email|banque)\b)/ },
    { re: new RegExp(TEAM_TARGET + "\\b[^.!?;]{0,40}\\b(?:vous (?:confirmera|recontactera|contactera|repondra|rappellera|reviendra)|reviendra vers vous)\\b") },
    // fr — the callback: «je vous tiendrai informé», «je reviens vers vous dès que…», «je vous préviendrai dès que…»
    { re: /\bje (?:vous |te )?(?:tiendrai|tiens) (?:au courant|informee?)|\bje (?:reviens|reviendrai) vers (?:vous|toi)\b|\bje vous recontacterai\b|\bje (?:vous |te )?(?:previendrai|informerai|avertirai|notifierai)\b[^.!?;]{0,20}\b(?:des que|une fois que|quand|lorsque)\b/ },
];

/** A team-request / callback claim in one of the four languages (see `TEAM_REQUEST_CLAIM`). */
export function claimsTeamRequest(reply: unknown): boolean {
    if (typeof reply !== 'string' || !reply.trim()) return false;
    return normalize(reply).replace(/[’`]/g, "'")
        .split(/(?<=[.!?;…])\s+|\n+/)
        .some(sentence => {
            if (!sentence.trim() || sentence.includes('?') || sentence.includes('¿') || CONDITIONAL_OFFER.test(sentence)) return false;
            const clause = sentence.replace(/[.!;…\s]+$/, '');
            return TEAM_REQUEST_CLAIM.some(({ re, objectGuard }) => {
                const m = re.exec(clause);
                if (!m) return false;
                if (objectGuard && HANDED_OVER_AN_OBJECT.test(m[0])) return false;
                const before = clause.slice(Math.max(0, m.index - 30), m.index);
                return !NEGATED_BEFORE.test(before) && !NEGATION_INSIDE.test(m[0]) && !OFFER_LEAD_IN.test(before);
            });
        });
}

/**
 * The receipt that makes a team-request claim true IN THIS TURN: a follow-up task this turn CREATED (the same typed receipt
 * the CRM task claim needs: `success`, `created: true`, a task uuid), or a tool result that asked for a person and succeeded
 * (the pipeline opens that handoff right after the reply). A lead (`ensure_crm_lead`), a note on the contact or a read is
 * never a request the team will act on.
 */
export function teamRequestBacked(executedTools: ReadonlyArray<{ name?: string; result?: any }> | undefined): boolean {
    return (executedTools || []).some(tool => {
        const result = tool?.result;
        if (!result || typeof result !== 'object' || !toolResultSucceeded(result) || result.awaitingPayment === true) return false;
        if (tool.name === 'create_follow_up_task') {
            return result.success === true && result.created === true && typeof result.taskId === 'string'
                && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.taskId);
        }
        return tool.name !== 'ensure_crm_lead' && result.shouldHandoff === true && result.verified !== false;
    });
}

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
            || (sentence.includes('?') && OFFER_TRANSFER.test(sentence) && !HANDS_OVER_AN_OBJECT.test(sentence))
            || (FOLLOW_UP_OFFER.test(sentence) && !FOLLOW_UP_OF_A_TRANSACTION.test(sentence)));
}

/**
 * The offer of a person worded as a FOLLOW-UP by the team (F4300-25, production QA 23-oct): to note the question for the
 * team, to remind or tell the customer once the team confirms, to pass the question on («¿Quiere que le recuerde cuando
 * el equipo confirme esa información?», «puedo anotar su consulta para que el equipo confirme…», «want me to let you know
 * once the team confirms?», «posso anotar sua pergunta para a equipe…», «voulez-vous que je note votre question pour
 * l'équipe ?»). Read as a family: an offer lead, a follow-up verb by root, then the person or team who answers. A lead
 * that is negated («no puedo avisar al equipo») offers nothing.
 */
const FOLLOW_UP_LEAD = String.raw`(?<!\b(?:no|not|nao|ne|n) )\b(?:quiere|quieres|desea|deseas|gustaria|prefiere|prefieres|puedo|podemos|le parece`
    + String.raw`|would you|do you want|want me to|shall i|should i|can i|may i|i can|i could|we can`
    + String.raw`|voulez|souhaitez|veux-tu|puis-je|je peux|je pourrais|on peut|quer|deseja|posso)\b`;
const FOLLOW_UP_VERB = String.raw`(?:avis\w*|recuerd\w*|recordar\w*|notifi\w*|anot\w*|apunt\w*|registr\w*|tom(?:e|o|ar|emos) nota|transmit\w*|traslad\w*`
    + String.raw`|let you know|keep you (?:posted|updated|informed)|remind\w*|inform\w*|note|write (?:it |this |that |your \w+ )?down`
    + String.raw`|pass (?:it|this|that|your \w+|the \w+) (?:on|along)|forward\w*`
    + String.raw`|lembr\w*|encaminh\w*|repass\w*|previen\w*|prevenir|rappel\w*|noter|transmet\w*)`;
const FOLLOW_UP_PARTY = '(?:' + HUMAN_TARGET.slice(1, -1) + "|alguien|someone|somebody|alguem|quelqu'un|staff|personal)";
const FOLLOW_UP_OFFER = new RegExp(FOLLOW_UP_LEAD + String.raw`[^?.!]{0,40}\b` + FOLLOW_UP_VERB + String.raw`\b[^?.!]{0,80}\b` + FOLLOW_UP_PARTY + String.raw`\b`);
/** Noting an order, a booking or a purchase for the team is a transaction, not the offer of a person. */
const FOLLOW_UP_OF_A_TRANSACTION =
    /\b(?:pedido|orden|order|cita|reserva\w*|appointment|booking|book|agend\w*|turno|encomenda|commande|rendez|compra|purchase|carrito|cart)\b/;

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
    + '|falar com (?:um|uma) (?:atendente|agente|pessoa|humano|consultor)|parler a (?:un|une) (?:conseiller|agent|personne)'
    // The model's own wording of the offer (production, store and travel: «¿Quiere que le pida a alguien del equipo que lo
    // confirme por usted?»): a colleague, a team member, or the team as the one asked («con el equipo», «al equipo»).
    + '|alguien del personal|un companero|una companera|un colega|someone (?:on|in) (?:our |the )?team|a colleague|a team member'
    + '|a member of (?:our|the) team|alguem do time|alguem da nossa equipe|um colega'
    + "|un collegue|un membre de (?:l'equipe|notre equipe)"
    // The team as the one ASKED («¿Quiere que lo consulte con el equipo?»), never the team as a place to book with
    // («¿Desea agendar con nuestro equipo de estilistas?»): an asking verb comes right before it.
    + '|(?:pida|pidamos|pregunte|preguntemos|consulte|consultemos|confirme|verifique|preguntar|consultar|ask|check with|confirm with'
    + '|peca|pergunte|perguntar|pedir|verificar|demande|demander|verifie|verifier)'
    + '\\b[^?.!]{0,30}\\b(?:equipo|team|equipe))';

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
    '\\b(?:quiere|quieres|desea|deseas|gustaria|prefiere|prefieres|would you|do you want|want me to|shall i|should i|can i|may i'
    + "|voulez|souhaitez|puis-je|dois-je|quer|gostaria|posso|devo)\\b[^?]{0,80}\\b"
    + OFFER_TARGET
    // «¿Le consulto con alguien del equipo?», «¿Le pido a una persona del equipo que lo confirme?»: the offer as a question with no lead verb.
    + '|\\b(?:le|te|les) (?:pido|pregunto|consulto|conecto|comunico|paso)\\b[^?.!]{0,40}' + OFFER_TARGET + '[^?.!]*\\?',
);

// ── Verification codes ─────────────────────────────────────────────────────────────────────────────────────────────
//
// «¿Puede darme el código de 6 dígitos que le fue enviado a su correo o teléfono?» when no code left (F4300-02): the
// customer can never complete it. A reply may say a code was sent only when a provider accepted one (this turn's
// request_identity_code / identity gate said `codeSent`, or a delivered challenge is still live).

/** «¿Desea que le envíe un código?» is an offer, not a claim (accent folding makes «envíe» and «envié» the same word). */
const CODE_SEND_OFFER = /\b(?:quiere|quieres|desea|deseas|prefiere|prefieres|gustaria|puedo|podemos|necesita|necesitas|would you like|do you want|shall i|can i|should i|voulez|souhaitez|quer|gostaria|posso)\b[^.?!]{0,30}\b(?:que (?:le |te |les )?(?:envie|enviemos|mande|mandemos)|(?:me|i|we|je|eu) (?:to )?(?:send|envoie|envie)|enviar(?:le|te)?|mandar(?:le|te)?|envoyer)\b[^.?!]*/g;
const CODE_NEGATED = /\b(?:no|not|nao|pas|ningun|nenhum|aucun|never|nunca|yet to|haven't|hasn't|didn't|wasn't|isn't|couldn't|cannot|can't)\b/;
const CODE_SENT_CLAIMS: readonly RegExp[] = [
    // es / pt: «código … (que le fue) enviado», «código que le envié», «código que recibió»
    /\bcodigo\b[^.?!]{0,60}?\b(?:enviad[oa]|mandad[oa]|envie|enviamos|mande|mandamos|enviei|mandei|que (?:le |te )?(?:llego|ha llegado|recibio|recibiste|recebeu))\b/,
    // es / pt: «le envié / hemos enviado / se le envió … un código»
    /\b(?:envie|enviamos|mande|mandamos|enviei|mandei|(?:he|hemos|ha|han) (?:enviado|mandado)|se (?:le |te )?(?:envio|mando|ha enviado|ha mandado)|foi enviado)\b[^.?!]{0,40}\bcodigo\b/,
    // en: «the code sent to your email», «I sent you a code», «the code you received»
    /\bcode\b[^.?!]{0,60}?\b(?:sent|texted|emailed|that you (?:received|got)|you (?:received|got|just received))\b/,
    /\b(?:i|we|i've|we've|i have|we have)\s+(?:just\s+|already\s+)?(?:sent|texted|emailed)\b[^.?!]{0,40}\bcode\b/,
    // fr: «le code envoyé», «je vous ai envoyé un code», «le code reçu»
    /\bcode\b[^.?!]{0,60}?\b(?:envoye|envoyee|recu)\b/,
    /\b(?:je vous ai|nous vous avons|j'ai|nous avons|on vous a)\s+(?:deja\s+)?envoye\b[^.?!]{0,40}\bcode\b/,
];

/** The reply tells the customer a verification code WAS sent (or asks for the one «sent»/«received»). */
export function claimsIdentityCodeSent(reply: unknown): boolean {
    if (typeof reply !== 'string' || !reply.trim()) return false;
    const text = normalize(reply).replace(/[’`]/g, "'").replace(CODE_SEND_OFFER, ' ');
    return text.split(/(?<=[.?!¿¡;\n])/).some(sentence => {
        if (!/\bcod(?:igo|e)\b/.test(sentence)) return false;
        if (!CODE_SENT_CLAIMS.some(pattern => pattern.test(sentence))) return false;
        return !CODE_NEGATED.test(sentence);
    });
}

/** A result of this turn that proves a provider accepted a verification code. */
export function identityCodeSendBacked(executedTools: ReadonlyArray<{ name?: string; result?: any }> | undefined): boolean {
    return (executedTools || []).some(tool => {
        const result = tool?.result;
        if (!result || typeof result !== 'object') return false;
        if (result.codeSent === true) return true;
        if (tool.name === 'request_identity_code' && result.sent === true) return true;
        return typeof result.sentVia === 'string' && typeof result.sentTo === 'string';
    });
}

