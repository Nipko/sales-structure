import { isToolAuthorityDenial, normalizeForIntent, type PendingIdentityRequestV1 } from '@parallext/shared';
import { isInformationSeekingMessage } from '../../common/conversation/intent-normalizer';
import { appointmentChangeRequest, foldKeepingPunctuation, negatedAt, REPORTED_OR_PAST } from './appointment-transition';
import { policyPersonOfferText } from './human-offer';
import { readDateReference, weekdayMentions, WEEKDAY_NAMES_ES } from './date-reference';
import type { RecordFact } from '../../common/utils/outcome-claim.util';

/**
 * Deterministic proposal step for the changes a customer makes to something that ALREADY EXISTS: cancel an appointment,
 * move it, cancel an order, and the question «¿qué citas tengo?».
 *
 * Why it exists. Every write behind a confirmation needs a pending ledger row before the customer's «sí» can execute it
 * (the server executes the «sí», not the model). That row only exists if the model calls the writer on the REQUEST turn.
 * A model asks «¿Desea cancelar la cita del martes?» in prose, calls nothing, and then the «sí» has nothing to confirm:
 * the model (whose history carries no tool calls and no appointment ids) improvises «no puedo, alguien del equipo». The
 * booking engine never had the problem because it does not wait for the model. This does the same for the transitions:
 * the server reads the customer's own records, resolves WHICH one, calls the writer itself (the central guard returns the
 * confirmation challenge and records the pending row), and the reply states the exact terms in the customer's register.
 *
 * Nothing here executes a write: the writers are still reached only through the executor and the central guard.
 */

export type TransitionDomain = 'appointment' | 'order';
export type TransitionVerb = 'cancel' | 'reschedule' | 'list';

export interface TransitionRequest {
    verb: TransitionVerb;
    domain: TransitionDomain;
}

export const TRANSITION_WRITER: Readonly<Record<string, string>> = Object.freeze({
    'cancel:appointment': 'cancel_appointment',
    'reschedule:appointment': 'reschedule_appointment',
    'cancel:order': 'cancel_catalog_order',
});
export const TRANSITION_TOOLS: ReadonlySet<string> = new Set(Object.values(TRANSITION_WRITER));

export function transitionRequestForTool(toolName: unknown): TransitionRequest | null {
    for (const [key, tool] of Object.entries(TRANSITION_WRITER)) {
        if (tool === toolName) {
            const [verb, domain] = key.split(':') as [TransitionVerb, TransitionDomain];
            return { verb, domain };
        }
    }
    return null;
}

/** The short readable reference of a record: the first 8 hex characters, uppercase (the same one the booked text shows). */
export function shortReference(id: unknown): string {
    return String(id ?? '').replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** A row of a tool result with its short, uppercase, quotable `reference` (the same one the proposal and the booked text show). */
export function withShortReference<T>(row: T): T {
    const id = (row as any)?.id;
    return row && typeof row === 'object' && typeof id === 'string' && !(row as any).reference ? { ...row, reference: shortReference(id) } : row;
}

// Not inside a URL or a path (…/orders/<uuid>, ?id=<uuid>): those stay whole.
// Nor inside an e-mail address (<uuid>@pay.example.com, user@<uuid>.example.com).
const UUID_G = /(?<![\w/=.:@-])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\w/@-])/gi;
// A bare 8-hex prefix, with the label the model puts in front of it («ID d1d0d14a», «ref. d1d0d14a», «#d1d0d14a»).
const SHORT_ID_G = /(?:\b(?:id|ref\.?|referencia|n[uú]mero|c[oó]digo)\s*:?\s*|#)?(?<![\w/=.@-])([0-9a-f]{8})(?![\w@-])/gi;
/**
 * A raw UUID never reaches the customer: it is shown as the short reference. A bare 8-hex prefix the model wrote («ID d1d0d14a»)
 * is also put in the shown form («Ref. D1D0D14A») — but only when it is the prefix of a record this turn actually knew about;
 * arbitrary hexadecimal (a color, a hash, a phone fragment) is never touched.
 */
export function humanizeReferences(text: string, knownIds: readonly string[] = []): string {
    let out = text.replace(UUID_G, match => shortReference(match));
    if (!knownIds.length) return out;
    const known = new Set(knownIds.map(id => String(id).replace(/-/g, '').slice(0, 8).toLowerCase()).filter(prefix => /^[0-9a-f]{8}$/.test(prefix)));
    out = out.replace(SHORT_ID_G, (match, token: string) => {
        if (!known.has(token.toLowerCase())) return match;
        // An 8-digit number is not a reference: a prefix needs at least one letter to be told apart from a phone fragment or an amount.
        if (/^\d{8}$/.test(token)) return match;
        return match.length > token.length ? `Ref. ${token.toUpperCase()}` : token.toUpperCase();
    });
    return out;
}

// ── Detection ───────────────────────────────────────────────────────────────
//
// Conservative on purpose. This engine ACTS on what the customer wrote (it reads their records and opens a confirmation), so a
// sentence that merely contains «cancelar» and «cita» is not a request: «no cancelen mi cita, voy en camino», «me cancelaron la
// cita», «cancelé el pedido por Nequi» (in Latin America «cancelar» is also «to pay») and «tengo una cita mañana, ¿dónde queda?»
// all belong to the model. A request is an infinitive / imperative / desire form, with no negator in its clause, no payment
// context and no past or third-person form.

const CANCEL_REQUEST = /\b(?:cancelar(?:la|lo|las|los|me)?|cancel(?:a|e|en|ame|ala|alo|ela|elo)|cancelame|anular(?:la|lo|me)?|anul(?:a|e|en|ala|alo|ame|ela|elo)|anulame|cancel it|cancel|annuler|annulez|annule|cancelar)\b/;
/** «cancelar» as «to pay», and the means of payment around it. */
const PAYMENT_CONTEXT = /\b(?:pag\w*|tarjeta|nequi|daviplata|pse|efectivo|transferencia|saldo|cuenta|abono|abonar|cuota|cuotas|factura\w*|contra entrega|contraentrega|link de pago|enlace de pago|credito|debito|banco|plata|dinero|cobro|cobr\w*|payment|paid|invoice)\b/;
const APPOINTMENT_NOUN = /\b(?:cita|citas|turno|turnos|consulta|reserva|appointment|booking|agendamento|rendez vous)\b/;
const ORDER_NOUN = /\b(?:pedido|pedidos|orden|ordenes|compra|order|orders|commande|encomenda)\b/;
const POLICY_WORDS = /\b(?:politica|politicas|policy|cuanto|costo|cobran|penalizacion|multa|reembolso|devolucion|plazo|horas antes|antes de)\b/;
const ASKING_ABOUT = /\b(?:saber si|quiero saber|quisiera saber|necesito saber|me gustaria saber|duda|pregunta|puedo cancelar|puedo anular|se puede cancelar|se puede anular|es posible|puedo reprogramar|se puede reprogramar|puedo cambiar|se puede cambiar|can i cancel|is it possible)\b/;
const REQUEST_OPENER = /\b(?:quiero|necesito|quisiera|deseo|me gustaria|quisiera|favor|por favor|puedes|podrias|podria|ayudame a|me ayuda a|me ayudas a|me puede ayudar a|me podria ayudar a|me ayudan a|me podrian ayudar a|i want to|i need to|i would like to|please|je veux|je voudrais|quero|preciso|gostaria de)\b/;
const YES_OPENER = /^\W*(?:si|sí|ok|dale|claro|vale|listo|perfecto|de acuerdo|yes|sim|oui)\b/;
/** The whole message is the list question; «tengo una cita mañana, ¿dónde queda?» is not. */
const LIST_WHOLE = /^(?:(?:hola|buenas?(?: dias| tardes| noches)?)\s+)?(?:(?:por favor|dime|digame|muestrame|me puedes decir|me podrias decir|quiero ver|quiero saber|necesito saber)\s+)*(?:(?:que|cuales|cuantas) (?:citas|turnos)(?: (?:tengo|hay|tiene|tengo agendadas|tengo programadas|tengo pendientes|agendadas|programadas))?(?: agendad\w+| programad\w+| pendientes)?|(?:cuales|que) son mis (?:citas|turnos)(?: proxim\w+)?|mis (?:proximas )?(?:citas|turnos)|(?:tengo|hay) (?:alguna|algun) (?:cita|turno)(?: agendad\w+| programad\w+| pendiente)?|ver mis (?:proximas )?(?:citas|turnos)|what appointments do i have|my appointments)(?:\s+(?:por favor|gracias))?$/;
/** The whole message asks for the customer's orders («¿qué pedidos tengo?») or where one stands («¿cuál es el estado de mi pedido?»). */
const ORDER_LIST_WHOLE = /^(?:(?:hola|buenas?(?: dias| tardes| noches)?)\s+)?(?:(?:por favor|dime|digame|muestrame|me puedes decir|me podrias decir|quiero ver|quiero saber|necesito saber)\s+)*(?:(?:que|cuales|cuantos) pedidos(?: (?:tengo|hay|tiene|tengo hechos|tengo realizados|he hecho|tengo activos|tengo pendientes))?|(?:cuales|que) son mis pedidos|mis pedidos|ver mis pedidos|(?:cual es )?el estado de mi pedido|(?:como|en que estado) (?:va|esta) mi pedido|what orders do i have|my orders)(?:\s+(?:por favor|gracias))?$/;
const CHOICE_REF = /\b[0-9a-f]{8}\b/;
const CHOICE_DATE = /\b(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|\d{1,2} de (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)|dia \d{1,2}|\d{1,2}:\d{2}|(?:a )?las \d{1,2}|dia siguiente|siguiente dia|misma hora|manana|hoy|pasado manana|next day|same time|tomorrow)\b/;
const CHOICE_ORDINAL = /^(?:(?:cancela|cancelar|cancelala|cancelalo|mueve|mover|muevela|reprograma|esa|ese|la que sea|quiero)\s+)?(?:(?:la|el|opcion|numero|la opcion|el numero)\s+)?(?:primer[ao]?|segund[ao]|tercer[ao]?|ultim[ao]|[123])(?:\s+(?:por favor|gracias))?$/;
const NOT_A_CHOICE = /\b(?:abren|abre|abrir|cierran|horario|horarios|cuesta|cuestan|precio|precios|cuanto|donde|como|cuando|que hora|puedo|pueden|se puede|hay|tienen|atienden|direccion)\b/;
/** Courtesy around an answer («hola, la del martes», «la segunda, gracias») is not part of the answer. */
const COURTESY = /\b(?:hola|buenos dias|buenas tardes|buenas noches|buenas|buen dia|muchas gracias|gracias|por favor|porfa|porfavor|please|thanks)\b/g;
/** A bare yes to the question the engine asked («¿Se trata de su pedido?», «¿Es esa la que desea?»). */
const NEGATOR_WORD = /\b(?:no|tampoco|nunca|jamas|ni|ninguna?|not|nao|non)\b/;
/** A verb that moves something: «mejor muévela», «pásala al viernes», «reprográmala». */
const MOVE_VERB = /\b(?:mover\w*|muev\w*|mueva\w*|pasar\w*|pas(?:a|e|amos|emos)(?:la|lo)?|cambi\w*|reprogram\w*|reagend\w*|remarc\w*|mudar\w*|mude\w*|move|reschedule|deplac\w*|aplaz\w*|posponer\w*|adelant\w*)\b/;
const BARE_YES = /^(?:si|ok|okay|dale|claro|correcto|exacto|asi es|esa|esa misma|esa es|yes|sim|oui)$/;

export interface DetectContext {
    /** The customer's text. */
    text: string;
    /** The writers this turn may call (the published, owner-enabled set). */
    available: ReadonlySet<string>;
    /** Domain of the current tool mission, when one is selected. */
    missionDomain?: string;
    /** The writer the current mission is about. Only a cancel / reschedule writer lets «cancélalo» inherit the mission's object. */
    missionToolName?: string;
    /** Writer of a request whose target is still being chosen (set by an earlier turn of this engine). */
    awaitingWriter?: string;
    /** The choice is the answer to the question asked on the PREVIOUS message, recently; false → the choice has lapsed. */
    awaitingFresh?: boolean;
    /** A confirmation is pending: a yes belongs to it, not to this engine. */
    pendingConfirmation: boolean;
}

export type Detected =
    // `restate`: the message repeats the request the pending proposal already answers («quiero cancelar mi pedido» over the
    // proposal to annul it). It re-shows that proposal; it never opens another one nor answers it.
    | { kind: 'request'; request: TransitionRequest; continuation: boolean; restate?: boolean }
    | { kind: 'ambiguous'; verb: 'cancel'; options: TransitionDomain[] }
    | null;

/** The words of a message with accents folded and punctuation kept as clause breaks (`,` and `.`). */
function clauseText(raw: string): string {
    return foldKeepingPunctuation(raw).replace(/[^\p{L}\p{N}\s,.;!?¿¡']/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** «Cancelar» / «anular» used as a request: not negated, not payment, not past tense, not someone else's act. */
function cancelRequested(raw: string): boolean {
    const lower = raw.toLowerCase().normalize('NFC');
    if (REPORTED_OR_PAST.test(lower)) return false;
    const clauses = clauseText(raw);
    const match = CANCEL_REQUEST.exec(clauses);
    if (!match) return false;
    if (negatedAt(clauses, match.index)) return false;
    // «cancele» without its accent is the same word as «cancelé» («ya cancele el pedido»): a «ya» before it is the past.
    if (/\bya\b/.test(clauses.slice(0, match.index)) || /\b(?:ayer|anoche|acabo de)\b/.test(clauses)) return false;
    return !PAYMENT_CONTEXT.test(clauses.replace(/[,.;!?¿¡]/g, ' '));
}

/** Does the message carry a word that could pick one of several records (a ref, a date, a time, a whole-message ordinal)? */
export function hasChoiceSignal(raw: string): boolean {
    const text = clauseText(raw).replace(/[,.;!?¿¡]/g, ' ').replace(COURTESY, ' ').replace(/\s+/g, ' ').trim();
    if (!text || NOT_A_CHOICE.test(text)) return false;
    const clauses = clauseText(raw).split(/[,.;!?¿¡]/).map(clause => clause.replace(COURTESY, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const named = (clause: string) => (CHOICE_REF.test(clause) && /\d/.test(clause.match(CHOICE_REF)![0])) || CHOICE_DATE.test(clause);
    // «el martes no», «tampoco la del lunes»: the clause rules the record OUT; it is not the choice.
    if (clauses.some(clause => named(clause) && !NEGATOR_WORD.test(clause))) return true;
    return CHOICE_ORDINAL.test(text);
}

/**
 * The arbiter clarifies («¿cuál?») when several saved tasks match the words. With fewer than two things to choose between,
 * and a message that plainly names ONE object to cancel / move / list, that is not a question to ask: the request goes to
 * this engine as a new task of that object.
 */
export function namedRequestOverridesClarify(clarifyOptions: readonly string[] | undefined, detected: Detected, answersPending = false): detected is Extract<NonNullable<Detected>, { kind: 'request' }> {
    if (detected?.kind !== 'request' || detected.continuation) return false;
    // «sí, cancela el pedido» over a pending appointment cancellation IS the question «¿cuál de las dos?»: it stays.
    if (answersPending) return false;
    const options = clarifyOptions || [];
    // Fewer than two things to choose between, or a message that names exactly one of them (paused missions made it two).
    return options.length < 2 || options.includes(detected.request.domain);
}

/**
 * The message repeats, in so many words, the request the pending proposal is already about: the same verb on the same kind
 * of object, naming the object («quiero cancelar mi pedido», «cancela mi cita»), and not a yes. A bare «cancélala» names no
 * object and ANSWERS the proposal; a message that changes the action or picks another record is a different request.
 */
export function restatesPendingProposal(raw: string, pending: TransitionRequest): boolean {
    if (pending.verb === 'list') return false;
    const text = clauseText(raw);
    if (!text || raw.length > 400 || YES_OPENER.test(text)) return false;
    const plain = text.replace(/[,.;!?¿¡]/g, ' ').replace(/\s+/g, ' ').trim();
    const names = pending.domain === 'appointment' ? APPOINTMENT_NOUN.test(plain) : ORDER_NOUN.test(plain);
    const other = pending.domain === 'appointment' ? ORDER_NOUN.test(plain) : APPOINTMENT_NOUN.test(plain);
    if (!names || other || isInformationSeekingMessage(raw)) return false;
    if (pending.verb === 'cancel') return cancelRequested(raw) && !appointmentChangeRequest(raw) && !hasChoiceSignal(raw);
    // A pending reschedule is restated by the move verb alone; naming a day or a time proposes a different move.
    return !!appointmentChangeRequest(raw) && !cancelRequested(raw) && !hasChoiceSignal(raw);
}

/** Does the message open with a yes? (an answer to a pending proposal, not a new request) */
export function opensWithYes(raw: string): boolean {
    return YES_OPENER.test(clauseText(raw));
}

export function detectTransition(ctx: DetectContext): Detected {
    const raw = String(ctx.text ?? '');
    if (!raw.trim() || raw.length > 400) return null;
    const text = clauseText(raw);
    if (!text) return null;
    const can = (verb: TransitionVerb, domain: TransitionDomain) => verb === 'list'
        ? ctx.available.has(domain === 'order' ? 'list_my_catalog_orders' : 'list_customer_appointments')
        : ctx.available.has(TRANSITION_WRITER[`${verb}:${domain}`]);

    // The target of a request this engine opened is being chosen: the very next message, recently, if it picks something.
    const awaiting = transitionRequestForTool(ctx.awaitingWriter);
    if (awaiting && !ctx.pendingConfirmation && can(awaiting.verb, awaiting.domain)) {
        const fresh = detectFresh(text, raw, ctx, can);
        if (fresh && fresh.kind === 'request' && fresh.request.verb !== 'list') return fresh;
        if (!fresh && ctx.awaitingFresh !== false && !isInformationSeekingMessage(raw)
            && (hasChoiceSignal(raw) || BARE_YES.test(text.replace(/[,.;!?¿¡]/g, ' ').replace(COURTESY, ' ').replace(/\s+/g, ' ').trim()))) {
            return { kind: 'request', request: awaiting, continuation: true };
        }
        return null;
    }
    if (ctx.pendingConfirmation && YES_OPENER.test(text)) return null;
    // A cancel / reschedule proposal is waiting for its answer. «Cancélala», «cancélela por favor» ANSWER it (the server executes it
    // after this step); only a message that names a DIFFERENT target («mejor la del martes», a reference) re-opens the choice.
    const pendingTransition = ctx.pendingConfirmation ? transitionRequestForTool(ctx.missionToolName) : null;
    const plainText = text.replace(/[,.;!?¿¡]/g, ' ').replace(/\s+/g, ' ').trim();
    // A message that names the OTHER kind of object («quiero cancelar mi pedido» over a pending appointment) is a new request.
    const namesOtherObject = !!pendingTransition && (pendingTransition.domain === 'appointment' ? ORDER_NOUN.test(plainText) : APPOINTMENT_NOUN.test(plainText));
    // «no, mejor reprográmala para el viernes» over a pending CANCELLATION (or «mejor cancélela» over a pending reschedule) changes the
    // action: it is a new request, never an answer and never a different target for the same action.
    let changesAction = false;
    if (pendingTransition) {
        const moveAt = MOVE_VERB.exec(text);
        if (pendingTransition.verb === 'cancel') {
            // «cancélala, cambié de opinión» is not a request to move it
            const idiom = /\b(?:de opinion|de idea|de parecer|de planes)\b/.test(text) || REPORTED_OR_PAST.test(raw.toLowerCase().normalize('NFC'));
            const moves = !idiom && ((!!moveAt && !negatedAt(text, moveAt.index)) || !!appointmentChangeRequest(raw));
            if (moves && can('reschedule', pendingTransition.domain) && pendingTransition.domain === 'appointment' && !isInformationSeekingMessage(raw)) {
                return { kind: 'request', request: { verb: 'reschedule', domain: 'appointment' }, continuation: false };
            }
        } else {
            changesAction = cancelRequested(raw);
        }
    }
    if (pendingTransition && !namesOtherObject && !changesAction) {
        if (!can(pendingTransition.verb, pendingTransition.domain) || isInformationSeekingMessage(raw)) return null;
        // «quiero cancelar mi pedido» over the proposal that annuls it: the proposal is shown again, never dropped.
        if (restatesPendingProposal(raw, pendingTransition)) {
            return { kind: 'request', request: pendingTransition, continuation: false, restate: true };
        }
        const differentTarget = pendingTransition.verb === 'cancel' ? hasChoiceSignal(raw) : /\b[0-9a-f]{8}\b/.test(text) && /\d/.test(text.match(/\b[0-9a-f]{8}\b/)![0]);
        return differentTarget ? { kind: 'request', request: pendingTransition, continuation: true } : null;
    }
    const pendingCreate = ctx.pendingConfirmation && !!ctx.missionToolName && !TRANSITION_TOOLS.has(ctx.missionToolName);
    const fresh = detectFresh(text, raw, ctx, can);
    if (pendingCreate && fresh && (fresh.kind === 'ambiguous' || fresh.request.verb === 'cancel')) return null;
    return fresh;
}

function detectFresh(text: string, raw: string, ctx: DetectContext, can: (v: TransitionVerb, d: TransitionDomain) => boolean): Detected {
    const plain = text.replace(/[,.;!?¿¡]/g, ' ').replace(/\s+/g, ' ').trim();
    if (LIST_WHOLE.test(plain) && can('list', 'appointment')) {
        return { kind: 'request', request: { verb: 'list', domain: 'appointment' }, continuation: false };
    }
    if (ORDER_LIST_WHOLE.test(plain) && can('list', 'order')) {
        return { kind: 'request', request: { verb: 'list', domain: 'order' }, continuation: false };
    }
    if (ASKING_ABOUT.test(plain) || POLICY_WORDS.test(plain)) return null;
    const asking = isInformationSeekingMessage(raw) && !REQUEST_OPENER.test(plain);
    if (asking) return null;

    // «¿A qué hora abren mañana? Y quiero cancelar mi cita del viernes»: two intents. The model answers both; the engine would
    // drop the question.
    const sentences = raw.split(/(?<=[?!.])\s+/).filter(part => part.trim());
    if (sentences.length > 1 && sentences.some(part => /[?¿]/.test(part) && !cancelRequested(part) && !appointmentChangeRequest(part))) return null;

    const change = appointmentChangeRequest(raw);
    if (change && can('reschedule', 'appointment')) {
        return { kind: 'request', request: { verb: 'reschedule', domain: 'appointment' }, continuation: false };
    }
    if (cancelRequested(raw)) {
        const wantsAppointment = APPOINTMENT_NOUN.test(plain);
        const wantsOrder = ORDER_NOUN.test(plain);
        const options = (['appointment', 'order'] as TransitionDomain[]).filter(domain => can('cancel', domain));
        if (wantsAppointment && wantsOrder) return { kind: 'ambiguous', verb: 'cancel', options: ['appointment', 'order'] };
        if (wantsAppointment) return can('cancel', 'appointment') ? { kind: 'request', request: { verb: 'cancel', domain: 'appointment' }, continuation: false } : null;
        if (wantsOrder) return can('cancel', 'order') ? { kind: 'request', request: { verb: 'cancel', domain: 'order' }, continuation: false } : null;
        // «cancélalo» names nothing. Only a mission that is itself about cancelling / moving something may lend its object:
        // after a proposal to CREATE an order, «no, cancélalo» refers to that proposal and never to an earlier order.
        const byMission = transitionRequestForTool(ctx.missionToolName);
        if (byMission && (ctx.missionDomain === 'appointment' || ctx.missionDomain === 'order') && can('cancel', ctx.missionDomain)) {
            return { kind: 'request', request: { verb: 'cancel', domain: ctx.missionDomain }, continuation: false };
        }
        // «quiero cancelar» alone, as an explicit request: say which objects there are. A bare «cancélalo» is the model's.
        if (REQUEST_OPENER.test(plain) && options.length > 0 && !ctx.pendingConfirmation) return { kind: 'ambiguous', verb: 'cancel', options };
        return null;
    }
    return null;
}

// ── Candidates ──────────────────────────────────────────────────────────────

export interface Candidate {
    id: string;
    ref: string;
    /** appointment: service; order: first product name(s). */
    label: string;
    date?: string;
    time?: string;
    status?: string;
    serviceId?: string;
    vehicleId?: string;
    staffId?: string;
    total?: string;
    /** order: the status in the customer's language (for the listing). */
    statusLabel?: string;
    cancellable: boolean;
}

const ORDER_STATUS_LABELS: Record<string, Record<string, string>> = {
    es: { pending: 'pendiente', confirmed: 'confirmado', processing: 'en preparación', preparing: 'en preparación', ready: 'listo', shipped: 'enviado', in_transit: 'en camino', delivered: 'entregado', completed: 'completado', cancelled: 'anulado', canceled: 'anulado', refunded: 'reembolsado', failed: 'fallido' },
    en: { pending: 'pending', confirmed: 'confirmed', processing: 'being prepared', preparing: 'being prepared', ready: 'ready', shipped: 'shipped', in_transit: 'in transit', delivered: 'delivered', completed: 'completed', cancelled: 'cancelled', canceled: 'cancelled', refunded: 'refunded', failed: 'failed' },
    pt: { pending: 'pendente', confirmed: 'confirmado', processing: 'em preparação', preparing: 'em preparação', ready: 'pronto', shipped: 'enviado', in_transit: 'em trânsito', delivered: 'entregue', completed: 'concluído', cancelled: 'cancelado', canceled: 'cancelado', refunded: 'reembolsado', failed: 'com falha' },
    fr: { pending: 'en attente', confirmed: 'confirmée', processing: 'en préparation', preparing: 'en préparation', ready: 'prête', shipped: 'expédiée', in_transit: 'en transit', delivered: 'livrée', completed: 'terminée', cancelled: 'annulée', canceled: 'annulée', refunded: 'remboursée', failed: 'échouée' },
};
export function orderStatusLabel(status: unknown, language?: string): string {
    const lang = ['es', 'en', 'pt', 'fr'].includes(String(language).slice(0, 2).toLowerCase()) ? String(language).slice(0, 2).toLowerCase() : 'es';
    const key = String(status ?? '').toLowerCase();
    return ORDER_STATUS_LABELS[lang][key] || key || '-';
}

const PAYMENT_STATUS_LABELS: Record<string, Record<string, string>> = {
    es: { paid: 'pagado', unpaid: 'sin pagar', partially_paid: 'pago parcial', awaiting_payment: 'pendiente de pago' },
    pt: { paid: 'pago', unpaid: 'não pago', partially_paid: 'pago parcialmente', awaiting_payment: 'aguardando pagamento' },
    fr: { paid: 'payée', unpaid: 'non payée', partially_paid: 'partiellement payée', awaiting_payment: 'en attente de paiement' },
};
const STATUS_ALT = 'pending|confirmed|processing|preparing|shipped|in_transit|delivered|completed|cancelled|canceled|refunded|failed|paid|unpaid|partially_paid|awaiting_payment';
/**
 * A status is translated only where it is NAMED AS A STATUS: right after a status label and its verb («el estado es pending», «el pedido
 * está shipped», «Estado del pago: paid»). A bare word is left alone - it may be a quoted product name, the manufacturer's text or a
 * word of a link.
 */
const LABELED_STATUS = new RegExp(
    '(\\b(?:estado(?: (?:del?|de la) (?:pedido|pago|orden|compra|reserva))?|status|statut|situa[cç][aã]o|pedido|pago|pagamento|paiement|commande|order|payment)\\b)'
    + '(\\s*:\\s*|\\s+(?:es|est[aá]|sigue|queda|qued[oó]|se encuentra|contin[uú]a|figura|aparece|[eé]|est|reste|segue|fica|ficou)(?:\\s+(?:en|como|a[uú]n|todav[ií]a|ainda))?\\s+)'
    + '(' + STATUS_ALT + ')(?![\\w-])', 'gi');
/** Spans that are never rewritten: links (with their query strings), quoted text and code. */
const PROTECTED_SPAN = /(?:https?:\/\/|www\.)\S+|\b[\w-]+(?:\.[\w-]+)+\/\S*|\S+\?\S+=\S*|"[^"\n]*"|“[^”\n]*”|`[^`\n]*`/gi;
const SPAN_MARK = '\uE000';

/**
 * An internal status word («pending», «in_transit») that reached a reply in another language («El estado es pending») is put in the
 * customer's language with the same labels the server's own listing uses. English replies are left alone, and so is every link, quoted
 * name and word that is not named as a status.
 */
export function localizeStatusWords(text: string, language?: string): string {
    const lang = langOf(language);
    if (!text || lang === 'en') return text;
    const parked: string[] = [];
    const masked = text.replace(PROTECTED_SPAN, span => `${SPAN_MARK}${parked.push(span) - 1}${SPAN_MARK}`);
    const translated = masked.replace(LABELED_STATUS, (match: string, label: string, connector: string, word: string) => {
        const key = word.toLowerCase();
        let label2 = PAYMENT_STATUS_LABELS[lang]?.[key] ?? ORDER_STATUS_LABELS[lang][key];
        if (!label2) return match;
        // «sigue en processing» → «sigue en preparación», not «sigue en en preparación»: the connector already says «en».
        if (/\ben\s+$/i.test(connector) && /^en\s/i.test(label2)) label2 = label2.slice(3);
        return `${label}${connector}${word[0] !== word[0].toLowerCase() ? label2[0].toUpperCase() + label2.slice(1) : label2}`;
    });
    return translated.replace(new RegExp(`${SPAN_MARK}(\\d+)${SPAN_MARK}`, 'g'), (_m, index: string) => parked[Number(index)]);
}

/** EVERY order of the customer, newest first, with its status: for «¿qué pedidos tengo?» (the cancellable ones are a subset). */
export function orderListing(result: any, locale = 'es-CO', language = 'es'): Candidate[] {
    const rows: any[] = Array.isArray(result?.orders) ? result.orders : [];
    return rows.filter(row => typeof row?.id === 'string').slice(0, 5).map(row => {
        const items: any[] = Array.isArray(row.items) ? row.items : [];
        const label = items.slice(0, 2).map(item => `${Number(item.quantity) > 1 ? `${item.quantity} ` : ''}${item.productName}`).join(', ') + (items.length > 2 ? '…' : '');
        const amount = Number(row.totalAmount);
        return {
            id: row.id, ref: shortReference(row.id), label, status: String(row.status ?? ''), statusLabel: orderStatusLabel(row.status, language),
            total: Number.isFinite(amount) ? `${amount.toLocaleString(locale, { maximumFractionDigits: 2 })} ${String(row.currency ?? '').toUpperCase()}`.trim() : undefined,
            cancellable: false,
        };
    });
}

export function appointmentCandidates(result: any): Candidate[] {
    const rows: any[] = Array.isArray(result?.appointments) ? result.appointments : [];
    return rows
        .filter(row => typeof row?.id === 'string' && !['cancelled', 'canceled', 'completed', 'no_show', 'expired'].includes(String(row.status)))
        .map(row => ({
            id: row.id, ref: shortReference(row.id), label: String(row.service ?? ''), date: String(row.date ?? ''), time: String(row.time ?? ''),
            status: String(row.status ?? ''), serviceId: row.serviceId, staffId: row.staffId, vehicleId: row.vehicleId, cancellable: true,
        }));
}

export function orderCandidates(result: any, locale = 'es-CO'): Candidate[] {
    const rows: any[] = Array.isArray(result?.orders) ? result.orders : [];
    return rows
        .filter(row => typeof row?.id === 'string' && !['cancelled', 'canceled', 'delivered', 'completed'].includes(String(row.status)))
        .map(row => {
            const items: any[] = Array.isArray(row.items) ? row.items : [];
            const label = items.slice(0, 2).map(item => `${Number(item.quantity) > 1 ? `${item.quantity} ` : ''}${item.productName}`).join(', ')
                + (items.length > 2 ? '…' : '');
            const amount = Number(row.totalAmount);
            return {
                id: row.id, ref: shortReference(row.id), label, status: String(row.status ?? ''),
                total: Number.isFinite(amount) ? `${amount.toLocaleString(locale, { maximumFractionDigits: 2 })} ${String(row.currency ?? '').toUpperCase()}`.trim() : undefined,
                cancellable: ['pending', 'confirmed'].includes(String(row.status)) && ['pending', 'failed'].includes(String(row.paymentStatus ?? '')),
            };
        });
}

const ORDINALS: Array<[RegExp, number]> = [
    [/(?:primer[ao]?|1|first|primeira)/, 0],
    [/(?:segund[ao]|2|second)/, 1],
    [/(?:tercer[ao]?|3|third|terceira)/, 2],
];
const WEEKDAYS_ES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** The date, time and weekday words of a message, to hold against a candidate. */
function datePicks(text: string) {
    const weekdays = WEEKDAYS_ES.filter(day => text.includes(` ${day} `));
    const dayMonths = [...text.matchAll(/\b(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/g)]
        .map(m => ({ day: Number(m[1]), month: MONTHS_ES.indexOf(m[2]) + 1 }));
    const dayOnly = [...text.matchAll(/\bdia (\d{1,2})\b/g)].map(m => Number(m[1]));
    const times = [...text.matchAll(/\b(\d{1,2}):(\d{2})\b/g)].map(m => `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`);
    const hours = [...text.matchAll(/\blas (\d{1,2})\b/g)].map(m => Number(m[1]));
    return { weekdays, dayMonths, dayOnly, times, hours, any: !!(weekdays.length || dayMonths.length || dayOnly.length || times.length || hours.length) };
}

function scoreCandidate(candidate: Candidate, picks: ReturnType<typeof datePicks>, text: string): { score: number; contradicted: boolean } {
    let score = 0;
    let contradicted = false;
    if (candidate.date) {
        const [y, m, d] = candidate.date.split('-').map(Number);
        const weekday = WEEKDAYS_ES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
        if (picks.weekdays.length) { if (picks.weekdays.includes(weekday)) score += 2; else contradicted = true; }
        if (picks.dayMonths.length) { if (picks.dayMonths.some(p => p.day === d && p.month === m)) score += 3; else contradicted = true; }
        if (picks.dayOnly.length) { if (picks.dayOnly.includes(d)) score += 2; else contradicted = true; }
    }
    if (candidate.time) {
        const [h] = candidate.time.split(':').map(Number);
        if (picks.times.length) { if (picks.times.includes(candidate.time)) score += 1; else contradicted = true; }
        if (picks.hours.length) { if (picks.hours.includes(h)) score += 1; else contradicted = true; }
    }
    const label = normalizeForIntent(candidate.label);
    if (label.length >= 3 && text.includes(` ${label} `)) score += 1;
    return { score, contradicted };
}

/**
 * Picks the ONE candidate the customer's words point at; null when they point at none, at several, or away from the only one.
 * Order: the reference, then dates and times, then an ordinal that is (nearly) the whole message. «La que tengo el 3 de noviembre»
 * is a date, «espera un segundo» and «primero dime…» are not choices.
 */
export function chooseCandidate(rawText: string, candidates: Candidate[], options: { verifySingle?: boolean; ignoreDates?: boolean } = {}): Candidate | null {
    const text = ` ${normalizeForIntent(rawText).replace(/[^\p{L}\p{N}\s:]/gu, ' ').replace(/\s+/g, ' ').trim()} `;
    // «mejor muévela al viernes»: the Friday is where it goes, not which appointment it is.
    const picks = options.ignoreDates ? datePicks('') : datePicks(text);
    if (candidates.length === 1) {
        // «cancela la del martes» with only a Thursday: the words contradict the only record, so ask instead of assuming.
        if (options.verifySingle && picks.any && scoreCandidate(candidates[0], picks, text).contradicted) return null;
        return candidates[0];
    }
    const refs = candidates.filter(candidate => text.includes(` ${candidate.ref.toLowerCase()} `) || text.includes(candidate.id.toLowerCase()));
    if (refs.length === 1) return refs[0];
    const scored = candidates.map(candidate => ({ candidate, ...scoreCandidate(candidate, picks, text) }))
        .filter(item => item.score > 0 && !item.contradicted).sort((a, b) => b.score - a.score);
    if (scored.length) return scored[1] && scored[1].score === scored[0].score ? null : scored[0].candidate;
    const whole = text.trim();
    // «el 3» with a candidate on the 3rd is a day, not the third one: ask.
    const bareNumber = /^(?:(?:la|el|opcion|numero|la opcion|el numero)\s+)?([123])$/.exec(whole.replace(/^(?:cancela|cancelar|mueve|mover|quiero)\s+/, ''));
    if (bareNumber && candidates.some(candidate => Number((candidate.date || '').slice(8, 10)) === Number(bareNumber[1]))) return null;
    if (CHOICE_ORDINAL.test(whole)) {
        for (const [pattern, index] of ORDINALS) if (pattern.test(whole) && candidates[index]) return candidates[index];
        if (/\b(?:ultim[ao]|last)\b/.test(whole)) return candidates[candidates.length - 1];
    }
    return null;
}

// ── Reschedule target ───────────────────────────────────────────────────────

const NEXT_DAY = /\b(?:dia siguiente|siguiente dia|al otro dia|un dia despues|el dia de despues|next day|the day after|dia seguinte|le lendemain)\b/;
const SAME_TIME = /\b(?:misma hora|mismo horario|a la misma hora|same time|mesma hora|meme heure)\b/;

export interface InterpretedTarget { date?: string | null; time?: string | null }

function addDays(iso: string, days: number): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** A way of naming the day this reader cannot resolve («la próxima semana», «en 3 días»): the day was given, so it is asked, never dropped. */
const UNREADABLE_DAY = /\b(?:proxima semana|semana que viene|semana proxima|next week|la semana|en \d+ dias|in \d+ days|fin de semana|weekend|proximo mes|next month|quincena)\b/;
const RELATIVE_DAY = /\b(?:hoy|manana|pasado manana|today|tomorrow|hoje|amanha|aujourd|demain)\b/;

/**
 * What the customer's words say about WHERE the appointment goes:
 *  - `target`: a date and a time (a part not named stays as the appointment has it, but only when NO day was named at all);
 *  - `ask`: no usable day or time, or a day was named that cannot be read (never «only the hour changes»);
 *  - `conflict`: the weekday and the day of the month disagree («viernes 17 de octubre» when the 17th is a Saturday);
 *  - `past`: an explicit date that already passed (this year's, when no year was said: it is not rolled forward in silence).
 *
 * An explicit day + month beats the weekday; a weekday written as the selector of the record («la del jueves») is not where it
 * goes; a bare weekday said on that same weekday is the next one («el viernes» on a Friday is not today).
 */
export type TargetReading =
    | { kind: 'target'; date: string; time: string }
    | { kind: 'ask' }
    | { kind: 'conflict'; date: string; weekday: number }
    | { kind: 'past'; date: string };

export function readTarget(rawText: string, appointment: Candidate, interpreted: InterpretedTarget | null, todayIso: string): TargetReading {
    const text = normalizeForIntent(rawText).replace(/[^\p{L}\p{N}\s:]/gu, ' ').replace(/\s+/g, ' ').trim();
    const baseDate = appointment.date || '';
    const baseTime = appointment.time || '';
    let date: string | null = null;
    let time: string | null = null;
    if (NEXT_DAY.test(text)) date = addDays(baseDate, 1);
    if (SAME_TIME.test(text)) time = baseTime;
    if (!date) {
        const reading = readDateReference(text, todayIso, { referenceDate: baseDate });
        if (reading.kind === 'conflict') return { kind: 'conflict', date: reading.date, weekday: reading.saidWeekday };
        if (reading.kind === 'past') return { kind: 'past', date: reading.date };
        if (reading.kind === 'ambiguous') return { kind: 'ask' };
        if (reading.kind === 'date') date = reading.date;
        else if (/\bpasado manana\b/.test(text)) date = addDays(todayIso, 2);
        else {
            const interpretedDate = String(interpreted?.date ?? '').trim().toLowerCase();
            // The interpreter reads a selector weekday («la del jueves») as the destination too: its date counts here only
            // when the customer used a relative word or no weekday at all.
            const interpreterMayDecide = RELATIVE_DAY.test(text) || !weekdayMentions(text).length;
            if (interpretedDate && interpreterMayDecide) {
                if (/^\d{4}-\d{2}-\d{2}$/.test(interpretedDate)) date = interpretedDate;
                else if (interpretedDate === 'today') date = todayIso;
                else if (interpretedDate === 'tomorrow') date = addDays(todayIso, 1);
            }
            // A day was named in a way that is not understood: ask, do not move only the hour.
            if (!date && UNREADABLE_DAY.test(text)) return { kind: 'ask' };
        }
    }
    const interpretedTime = String(interpreted?.time ?? '').trim();
    if (!time && /^([01]?\d|2[0-3]):[0-5]\d$/.test(interpretedTime)) time = interpretedTime.padStart(5, '0');
    if (!date && !time) return { kind: 'ask' };
    return { kind: 'target', date: date || baseDate, time: time || baseTime };
}

/** The new date and time of a reschedule request, or null when the words do not say (see `readTarget`). */
export function resolveTarget(rawText: string, appointment: Candidate, interpreted: InterpretedTarget | null, todayIso: string):
    { date: string; time: string } | null {
    const reading = readTarget(rawText, appointment, interpreted, todayIso);
    return reading.kind === 'target' ? { date: reading.date, time: reading.time } : null;
}

// ── Texts ───────────────────────────────────────────────────────────────────

export type AddressForm = 'usted' | 'tu';

export function addressFormOf(value: unknown): AddressForm {
    const form = String(value ?? '').toLowerCase();
    // «vos» regions are addressed with «tú» too: the API sends no voseo (no-voseo-in-strings.spec).
    return form === 'vos' || form === 'tu' ? 'tu' : 'usted';
}

const LOCALES: Record<string, string> = { es: 'es-CO', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR' };

/**
 * «viernes 16 de octubre». With `todayIso`, the YEAR is written whenever it is not the current one («viernes 8 de enero de 2027»):
 * a proposal that moves something into next year must say so.
 */
export function formatDay(date: string, lang: string, todayIso?: string): string {
    const [y, m, d] = date.split('-').map(Number);
    if (!y || !m || !d) return date;
    const withYear = !!todayIso && Number(todayIso.slice(0, 4)) !== y;
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(LOCALES[lang] || LOCALES.es,
        { weekday: 'long', day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' as const } : {}), timeZone: 'UTC' }).replace(',', '');
}

type Lang = 'es' | 'en' | 'pt' | 'fr';
const WEEKDAY_NAMES_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_NAMES_PT = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const WEEKDAY_NAMES_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const langOf = (language?: string): Lang => (['es', 'en', 'pt', 'fr'].includes(String(language).slice(0, 2).toLowerCase())
    ? String(language).slice(0, 2).toLowerCase() : 'es') as Lang;

/** Orders that can no longer be cancelled: offering to cancel them («Si desea anular alguno…») is noise when ALL of the listing is one of these. */
const CLOSED_ORDER_STATUS = new Set(['cancelled', 'canceled', 'delivered', 'completed', 'refunded', 'failed']);
/** The closing line of the orders listing, only when at least one order is still open. */
const orderHint = (cs: Candidate[], text: string): string => (cs.some(c => !CLOSED_ORDER_STATUS.has(String(c.status ?? '').toLowerCase())) ? `\n${text}` : '');

/** An order of the listing: what it is, how much, where it stands, and the reference to quote. */
const orderLine = (c: Candidate) => `- ${c.label}${c.total ? ` (${c.total})` : ''} — ${c.statusLabel || c.status || '-'} (Ref. ${c.ref})`;
const whenAt = (c: Candidate, lang: Lang, todayIso?: string) => `${formatDay(c.date || '', lang, todayIso)}${c.time ? (lang === 'en' ? ` at ${c.time}` : lang === 'fr' ? ` à ${c.time}` : ` a las ${c.time}`) : ''}`;
const when = (c: Candidate, lang: Lang) => whenAt(c, lang);
const line = (c: Candidate, domain: TransitionDomain, lang: Lang) => domain === 'appointment'
    ? `- ${c.label}: ${when(c, lang)} (${lang === 'en' ? 'Ref.' : 'Ref.'} ${c.ref})`
    : `- ${c.label}${c.total ? ` (${c.total})` : ''} (Ref. ${c.ref})`;

export interface Texts {
    noAppointments(): string;
    noOrders(): string;
    notCancellable(c: Candidate): string;
    list(cs: Candidate[]): string;
    askWhich(verb: 'cancel' | 'reschedule', domain: TransitionDomain, cs: Candidate[]): string;
    proposeCancel(domain: TransitionDomain, c: Candidate): string;
    proposeReschedule(c: Candidate, target: { date: string; time: string }): string;
    askTarget(c: Candidate): string;
    slotTaken(target: { date: string; time: string }, alternatives: string[]): string;
    doneCancel(domain: TransitionDomain, ref: string, alternatives: string[]): string;
    doneReschedule(ref: string, target: { date: string; time: string }): string;
    ambiguous(options: TransitionDomain[]): string;
    noMatch(domain: TransitionDomain, c: Candidate): string;
    pastDate(c: Candidate): string;
    /** The weekday and the day of the month the customer wrote disagree: asked, never resolved by guessing. */
    dateConflict(c: Candidate, date: string, weekday: number): string;
    /** The appointment's start time has already passed: not cancelled or moved by chat (a no-show is not a cancellation); a person is offered. */
    alreadyStarted(verb: 'cancel' | 'reschedule', c: Candidate): string;
    /** «¿Qué pedidos tengo?» / «¿cuál es el estado de mi pedido?»: the server's own listing, with the status and the reference. */
    listOrders(cs: Candidate[]): string;
    noOrdersAtAll(): string;
    /** The customer must verify before the records can be read: the code was sent, the server says where. */
    verifyNeeded(hint?: string): string;
    codeAlreadySent(hint?: string): string;
    codeWrong(): string;
    codeExpired(): string;
    codeUnavailable(): string;
    /** No code can be issued (locked, no channel): a person is OFFERED, never opened without asking. */
    identityBlocked(): string;
    verifiedNothingToResume(): string;
    /** The write failed after the yes: what the record says NOW (re-read), never what the model assumes. */
    stillScheduled(verb: 'cancel' | 'reschedule', c: Candidate): string;
    orderStillActive(c: Candidate): string;
    noLongerListed(ref: string): string;
    stateUnknown(): string;
}

export function transitionTexts(language: string | undefined, form: AddressForm = 'usted', todayIso?: string): Texts {
    const lang = langOf(language);
    // Dates of a proposal carry their year when it is not the current one (see formatDay).
    const dayOf = (date: string, l: string) => formatDay(date, l, todayIso);
    const when = (c: Candidate, l: Lang) => whenAt(c, l, todayIso);
    const D = (domain: TransitionDomain) => ({
        es: domain === 'appointment' ? 'su cita' : 'su pedido', en: domain === 'appointment' ? 'your appointment' : 'your order',
        pt: domain === 'appointment' ? 'o seu agendamento' : 'o seu pedido', fr: domain === 'appointment' ? 'votre rendez-vous' : 'votre commande',
    }[lang]);
    const tu = form === 'tu' && lang === 'es';
    const S = (domain: TransitionDomain) => tu ? (domain === 'appointment' ? 'tu cita' : 'tu pedido') : D(domain);
    const alt = (alternatives: string[]) => alternatives.length ? alternatives.join(', ') : '';
    const T: Record<Lang, Texts> = {
        es: {
            noAppointments: () => tu ? 'No tienes citas próximas. ¿Quieres agendar una?' : 'Usted no tiene citas próximas. ¿Desea agendar una?',
            noOrders: () => tu ? 'No encuentro pedidos tuyos que se puedan cancelar.' : 'No encuentro pedidos suyos que se puedan cancelar.',
            notCancellable: c => tu
                ? `El pedido ${c.ref} ya no se puede cancelar por este chat. ¿Quieres que le pida a alguien del equipo que lo revise?`
                : `El pedido ${c.ref} ya no se puede cancelar por este chat. ¿Desea que le pida a alguien del equipo que lo revise?`,
            list: cs => `${tu ? (cs.length === 1 ? 'Tienes una cita' : `Tienes ${cs.length} citas`) : (cs.length === 1 ? 'Usted tiene una cita' : `Usted tiene ${cs.length} citas`)}:\n${cs.map(c => line(c, 'appointment', 'es')).join('\n')}\n${tu ? '¿Quieres cancelar o mover alguna?' : '¿Desea cancelar o mover alguna?'}`,
            askWhich: (verb, domain, cs) => `${tu ? 'Tienes' : 'Usted tiene'} ${cs.length} ${domain === 'appointment' ? 'citas' : 'pedidos'}:\n${cs.map(c => line(c, domain, 'es')).join('\n')}\n${tu ? '¿Cuál quieres' : '¿Cuál desea'} ${verb === 'cancel' ? 'cancelar' : 'mover'}? ${tu ? 'Dime' : 'Indíqueme'} la referencia${domain === 'appointment' ? ', o el día y la hora' : ''}.`,
            proposeCancel: (domain, c) => domain === 'appointment'
                ? `${tu ? '¿Confirmas que quieres cancelar' : '¿Confirma que desea cancelar'} ${S('appointment')} de ${c.label} del ${when(c, 'es')} (Ref. ${c.ref})? La cita se anula y el horario queda libre.`
                : `${tu ? '¿Confirmas que quieres ANULAR' : '¿Confirma que desea ANULAR'} ${S('order')} (Ref. ${c.ref}): ${c.label}${c.total ? `, total ${c.total}` : ''}? El pedido no se entregará y no es un pago.`,
            proposeReschedule: (c, t) => `${tu ? '¿Confirmas que movamos' : '¿Confirma que movamos'} ${S('appointment')} de ${c.label} (Ref. ${c.ref}) del ${when(c, 'es')} al ${when({ ...c, date: t.date, time: t.time }, 'es')}?`,
            askTarget: c => `${tu ? '¿Para qué día y hora quieres' : '¿Para qué día y hora desea'} mover ${S('appointment')} de ${c.label} (Ref. ${c.ref}), hoy ${tu ? 'programada' : 'programada'} el ${when(c, 'es')}?`,
            slotTaken: (t, alts) => `${dayOf(t.date, 'es')} a las ${t.time} no está disponible.${alts.length ? ` ${tu ? 'Tengo libre' : 'Tengo libre'}: ${alt(alts)}.` : ''} ${tu ? '¿Qué otro día u hora te sirve?' : '¿Qué otro día u hora le sirve?'}`,
            doneCancel: (domain, ref, alts) => `${domain === 'appointment' ? 'Su cita' : 'Su pedido'} (Ref. ${ref}) quedó ${domain === 'appointment' ? 'cancelada' : 'anulado'}.`.replace('Su ', tu ? 'Tu ' : 'Su ')
                + (alts.length ? ` ${tu ? 'Si quieres volver a agendar, tengo libre' : 'Si desea volver a agendar, tengo libre'}: ${alt(alts)}.` : ''),
            doneReschedule: (ref, t) => `${tu ? 'Tu' : 'Su'} cita (Ref. ${ref}) quedó reprogramada para el ${dayOf(t.date, 'es')} a las ${t.time}.`,
            ambiguous: options => options.length === 1
                ? `${tu ? 'No me queda claro qué quieres cancelar. ¿Se trata de' : 'No me queda claro qué desea cancelar. ¿Se trata de'} ${S(options[0])}?`
                : `Hay más de una gestión posible: ${options.map(o => S(o)).join(' o ')}. ${tu ? '¿Sobre cuál quieres continuar?' : '¿Sobre cuál desea continuar?'}`,
            noMatch: (domain, c) => `${tu ? 'No encuentro' : 'No encuentro'} ${domain === 'appointment' ? 'una cita' : 'un pedido'} con ese día u hora. ${tu ? 'Tienes' : 'Usted tiene'}:\n${line(c, domain, 'es')}\n${tu ? '¿Es esa la que quieres?' : '¿Es esa la que desea?'}`,
            pastDate: c => `${tu ? 'Esa fecha ya pasó.' : 'Esa fecha ya pasó.'} ${tu ? '¿Para qué día y hora quieres' : '¿Para qué día y hora desea'} mover ${S('appointment')} de ${c.label} (Ref. ${c.ref})?`,
            alreadyStarted: (verb, c) => `${tu ? 'Tu cita' : 'Su cita'} de ${c.label} (Ref. ${c.ref}) era el ${when(c, 'es')}: ya comenzó o ya pasó, así que no puedo ${verb === 'cancel' ? 'cancelarla' : 'moverla'} desde este chat. ${policyPersonOfferText('es')}`,
            dateConflict: (c, d, w) => `El ${dayOf(d, 'es')} no es ${WEEKDAY_NAMES_ES[w]}. ${tu ? '¿Qué día y hora quieres exactamente' : '¿Qué día y hora desea exactamente'} para mover ${S('appointment')} de ${c.label} (Ref. ${c.ref})?`,
            listOrders: cs => `${tu ? (cs.length === 1 ? 'Tienes un pedido' : `Tienes ${cs.length} pedidos`) : (cs.length === 1 ? 'Usted tiene un pedido' : `Usted tiene ${cs.length} pedidos`)}:\n${cs.map(c => orderLine(c)).join('\n')}${orderHint(cs, tu ? 'Si quieres anular alguno, dime la referencia.' : 'Si desea anular alguno, indíqueme la referencia.')}`,
            noOrdersAtAll: () => tu ? 'No encuentro pedidos tuyos.' : 'No encuentro pedidos suyos.',
            verifyNeeded: hint => `${tu ? 'Para ver o cambiar tus citas necesito verificar tu identidad.' : 'Para ver o cambiar sus citas necesito verificar su identidad.'} ${hint ? `${tu ? 'Te envié' : 'Le envié'} un código a ${hint}` : `${tu ? 'Te envié' : 'Le envié'} un código de verificación`}; ${tu ? 'escríbelo' : 'escríbalo'} aquí para continuar.`,
            codeAlreadySent: hint => `${tu ? 'Ya te envié' : 'Ya le envié'} un código de verificación${hint ? ` a ${hint}` : ''}; ${tu ? 'escríbelo' : 'escríbalo'} aquí para continuar.`,
            codeWrong: () => tu ? 'Ese código no coincide. Revísalo y escríbelo de nuevo.' : 'Ese código no coincide. Revíselo y escríbalo de nuevo.',
            codeExpired: () => tu ? 'El código venció. ¿Quieres que te envíe uno nuevo?' : 'El código venció. ¿Desea que le envíe uno nuevo?',
            codeUnavailable: () => tu ? 'No pude comprobar el código en este momento. Escríbelo de nuevo en unos segundos.' : 'No pude comprobar el código en este momento. Escríbalo de nuevo en unos segundos.',
            identityBlocked: () => `${tu ? 'Por seguridad no puedo verificar tu identidad por este chat en este momento.' : 'Por seguridad no puedo verificar su identidad por este chat en este momento.'} ${policyPersonOfferText('es')}`,
            verifiedNothingToResume: () => tu ? 'Gracias, tu identidad quedó verificada. ¿Qué quieres hacer con tu cita?' : 'Gracias, su identidad quedó verificada. ¿Qué desea hacer con su cita?',
            stillScheduled: (verb, c) => `No pude ${verb === 'cancel' ? 'cancelar' : 'mover'} ${S('appointment')} de ${c.label} (Ref. ${c.ref}): sigue programada para el ${when(c, 'es')}. ${policyPersonOfferText('es')}`,
            orderStillActive: c => `No pude anular ${S('order')} (Ref. ${c.ref}): sigue vigente. ${policyPersonOfferText('es')}`,
            noLongerListed: ref => `${tu ? 'Tu cita' : 'Su cita'} (Ref. ${ref}) ya no aparece entre ${tu ? 'tus' : 'sus'} citas próximas, pero no pude confirmar que el cambio se hiciera. ${policyPersonOfferText('es')}`,
            stateUnknown: () => `No pude comprobar ahora el estado de ${tu ? 'tu' : 'su'} gestión, así que no doy por hecho ningún cambio. ${policyPersonOfferText('es')}`,
        },
        en: {
            noAppointments: () => 'You have no upcoming appointments. Would you like to book one?',
            noOrders: () => 'I do not find any orders of yours that can be cancelled.',
            notCancellable: c => `Order ${c.ref} can no longer be cancelled in this chat. Would you like me to ask someone from the team to review it?`,
            list: cs => `You have ${cs.length === 1 ? 'one appointment' : `${cs.length} appointments`}:\n${cs.map(c => line(c, 'appointment', 'en')).join('\n')}\nWould you like to cancel or move one?`,
            askWhich: (verb, domain, cs) => `You have ${cs.length} ${domain === 'appointment' ? 'appointments' : 'orders'}:\n${cs.map(c => line(c, domain, 'en')).join('\n')}\nWhich one would you like to ${verb === 'cancel' ? 'cancel' : 'move'}? Tell me the reference${domain === 'appointment' ? ', or the day and time' : ''}.`,
            proposeCancel: (domain, c) => domain === 'appointment'
                ? `Do you confirm you want to cancel your ${c.label} appointment on ${when(c, 'en')} (Ref. ${c.ref})?`
                : `Do you confirm you want to VOID (cancel) your order (Ref. ${c.ref}): ${c.label}${c.total ? `, total ${c.total}` : ''}? The order will not be delivered; this is not a payment.`,
            proposeReschedule: (c, t) => `Do you confirm we move your ${c.label} appointment (Ref. ${c.ref}) from ${when(c, 'en')} to ${when({ ...c, date: t.date, time: t.time }, 'en')}?`,
            askTarget: c => `Which day and time would you like to move your ${c.label} appointment (Ref. ${c.ref}), currently on ${when(c, 'en')}, to?`,
            slotTaken: (t, alts) => `${dayOf(t.date, 'en')} at ${t.time} is not available.${alts.length ? ` Free: ${alt(alts)}.` : ''} What other day or time works for you?`,
            doneCancel: (domain, ref, alts) => `Your ${domain === 'appointment' ? 'appointment' : 'order'} (Ref. ${ref}) has been cancelled.${alts.length ? ` If you want to book again, these are free: ${alt(alts)}.` : ''}`,
            doneReschedule: (ref, t) => `Your appointment (Ref. ${ref}) has been moved to ${dayOf(t.date, 'en')} at ${t.time}.`,
            ambiguous: options => options.length === 1 ? `I am not sure what you want to cancel. Is it ${D(options[0])}?` : `There is more than one possible task: ${options.map(o => D(o)).join(' or ')}. Which one would you like to continue?`,
            noMatch: (domain, c) => `I do not find ${domain === 'appointment' ? 'an appointment' : 'an order'} for that day or time. You have:\n${line(c, domain, 'en')}\nIs that the one?`,
            pastDate: c => `That date has already passed. Which day and time would you like to move your ${c.label} appointment (Ref. ${c.ref}) to?`,
            alreadyStarted: (verb, c) => `Your ${c.label} appointment (Ref. ${c.ref}) was on ${when(c, 'en')}: it has already started or passed, so I cannot ${verb === 'cancel' ? 'cancel' : 'move'} it from this chat. ${policyPersonOfferText('en')}`,
            dateConflict: (c, d, w) => `${dayOf(d, 'en')} is not a ${WEEKDAY_NAMES_EN[w]}. Which day and time exactly would you like to move your ${c.label} appointment (Ref. ${c.ref}) to?`,
            listOrders: cs => `You have ${cs.length === 1 ? 'one order' : `${cs.length} orders`}:\n${cs.map(c => orderLine(c)).join('\n')}${orderHint(cs, 'If you want to cancel one, tell me its reference.')}`,
            noOrdersAtAll: () => 'I do not find any orders of yours.',
            verifyNeeded: hint => `To see or change your appointments I need to verify your identity. I sent a code ${hint ? `to ${hint}` : 'for verification'}; type it here to continue.`,
            codeAlreadySent: hint => `I already sent a verification code${hint ? ` to ${hint}` : ''}; type it here to continue.`,
            codeWrong: () => 'That code does not match. Please check it and type it again.',
            codeExpired: () => 'The code has expired. Would you like me to send you a new one?',
            codeUnavailable: () => 'I could not check the code right now. Please type it again in a few seconds.',
            identityBlocked: () => `For security I cannot verify your identity in this chat right now. ${policyPersonOfferText('en')}`,
            verifiedNothingToResume: () => 'Thank you, your identity is verified. What would you like to do with your appointment?',
            stillScheduled: (verb, c) => `I could not ${verb === 'cancel' ? 'cancel' : 'move'} your ${c.label} appointment (Ref. ${c.ref}): it is still scheduled for ${when(c, 'en')}. ${policyPersonOfferText('en')}`,
            orderStillActive: c => `I could not cancel your order (Ref. ${c.ref}): it is still active. ${policyPersonOfferText('en')}`,
            noLongerListed: ref => `Your appointment (Ref. ${ref}) no longer appears among your upcoming appointments, but I could not confirm that the change was made. ${policyPersonOfferText('en')}`,
            stateUnknown: () => `I could not check the state of your request right now, so I am not assuming any change was made. ${policyPersonOfferText('en')}`,
        },
        pt: {
            noAppointments: () => 'Você não tem agendamentos próximos. Quer agendar um?',
            noOrders: () => 'Não encontro pedidos seus que possam ser cancelados.',
            notCancellable: c => `O pedido ${c.ref} não pode mais ser cancelado por este chat. Quer que eu peça a alguém da equipe para revisar?`,
            list: cs => `Você tem ${cs.length === 1 ? 'um agendamento' : `${cs.length} agendamentos`}:\n${cs.map(c => line(c, 'appointment', 'pt')).join('\n')}\nQuer cancelar ou mudar algum?`,
            askWhich: (verb, domain, cs) => `Você tem ${cs.length} ${domain === 'appointment' ? 'agendamentos' : 'pedidos'}:\n${cs.map(c => line(c, domain, 'pt')).join('\n')}\nQual você quer ${verb === 'cancel' ? 'cancelar' : 'mudar'}? Informe a referência${domain === 'appointment' ? ', ou o dia e a hora' : ''}.`,
            proposeCancel: (domain, c) => domain === 'appointment'
                ? `Confirma que quer cancelar o agendamento de ${c.label} em ${when(c, 'pt')} (Ref. ${c.ref})?`
                : `Confirma que quer ANULAR o pedido (Ref. ${c.ref}): ${c.label}${c.total ? `, total ${c.total}` : ''}? O pedido não será entregue; isto não é um pagamento.`,
            proposeReschedule: (c, t) => `Confirma que mudemos o agendamento de ${c.label} (Ref. ${c.ref}) de ${when(c, 'pt')} para ${when({ ...c, date: t.date, time: t.time }, 'pt')}?`,
            askTarget: c => `Para que dia e hora quer mudar o agendamento de ${c.label} (Ref. ${c.ref}), hoje em ${when(c, 'pt')}?`,
            slotTaken: (t, alts) => `${dayOf(t.date, 'pt')} às ${t.time} não está disponível.${alts.length ? ` Livres: ${alt(alts)}.` : ''} Que outro dia ou hora serve para você?`,
            doneCancel: (domain, ref, alts) => `${domain === 'appointment' ? 'O seu agendamento' : 'O seu pedido'} (Ref. ${ref}) foi cancelado.${alts.length ? ` Se quiser agendar de novo, estão livres: ${alt(alts)}.` : ''}`,
            doneReschedule: (ref, t) => `O seu agendamento (Ref. ${ref}) foi mudado para ${dayOf(t.date, 'pt')} às ${t.time}.`,
            ambiguous: options => options.length === 1 ? `Não ficou claro o que você quer cancelar. É ${D(options[0])}?` : `Há mais de uma tarefa possível: ${options.map(o => D(o)).join(' ou ')}. Sobre qual deseja continuar?`,
            noMatch: (domain, c) => `Não encontro ${domain === 'appointment' ? 'um agendamento' : 'um pedido'} nesse dia ou hora. Você tem:\n${line(c, domain, 'pt')}\nÉ esse?`,
            pastDate: c => `Essa data já passou. Para que dia e hora quer mudar o agendamento de ${c.label} (Ref. ${c.ref})?`,
            alreadyStarted: (verb, c) => `O seu agendamento de ${c.label} (Ref. ${c.ref}) era em ${when(c, 'pt')}: já começou ou já passou, então não consigo ${verb === 'cancel' ? 'cancelá-lo' : 'mudá-lo'} por este chat. ${policyPersonOfferText('pt')}`,
            dateConflict: (c, d, w) => `${dayOf(d, 'pt')} não é ${WEEKDAY_NAMES_PT[w]}. Para que dia e hora exatamente quer mudar o agendamento de ${c.label} (Ref. ${c.ref})?`,
            listOrders: cs => `Você tem ${cs.length === 1 ? 'um pedido' : `${cs.length} pedidos`}:\n${cs.map(c => orderLine(c)).join('\n')}${orderHint(cs, 'Se quiser cancelar algum, informe a referência.')}`,
            noOrdersAtAll: () => 'Não encontro pedidos seus.',
            verifyNeeded: hint => `Para ver ou mudar seus agendamentos preciso verificar sua identidade. Enviei um código ${hint ? `para ${hint}` : 'de verificação'}; escreva-o aqui para continuar.`,
            codeAlreadySent: hint => `Já enviei um código de verificação${hint ? ` para ${hint}` : ''}; escreva-o aqui para continuar.`,
            codeWrong: () => 'Esse código não confere. Revise e escreva de novo.',
            codeExpired: () => 'O código expirou. Quer que eu envie um novo?',
            codeUnavailable: () => 'Não consegui verificar o código agora. Escreva de novo em alguns segundos.',
            identityBlocked: () => `Por segurança não consigo verificar sua identidade neste chat agora. ${policyPersonOfferText('pt')}`,
            verifiedNothingToResume: () => 'Obrigado, sua identidade foi verificada. O que você quer fazer com o seu agendamento?',
            stillScheduled: (verb, c) => `Não consegui ${verb === 'cancel' ? 'cancelar' : 'mudar'} o agendamento de ${c.label} (Ref. ${c.ref}): continua marcado para ${when(c, 'pt')}. ${policyPersonOfferText('pt')}`,
            orderStillActive: c => `Não consegui cancelar o pedido (Ref. ${c.ref}): continua ativo. ${policyPersonOfferText('pt')}`,
            noLongerListed: ref => `O agendamento (Ref. ${ref}) não aparece mais entre os próximos, mas não consegui confirmar que a mudança foi feita. ${policyPersonOfferText('pt')}`,
            stateUnknown: () => `Não consegui verificar agora o estado da sua solicitação, então não dou nenhuma mudança como feita. ${policyPersonOfferText('pt')}`,
        },
        fr: {
            noAppointments: () => 'Vous n’avez aucun rendez-vous à venir. Souhaitez-vous en prendre un ?',
            noOrders: () => 'Je ne trouve aucune commande de votre part pouvant être annulée.',
            notCancellable: c => `La commande ${c.ref} ne peut plus être annulée par ce chat. Souhaitez-vous que je demande à quelqu’un de l’équipe de la vérifier ?`,
            list: cs => `Vous avez ${cs.length === 1 ? 'un rendez-vous' : `${cs.length} rendez-vous`} :\n${cs.map(c => line(c, 'appointment', 'fr')).join('\n')}\nSouhaitez-vous en annuler ou en déplacer un ?`,
            askWhich: (verb, domain, cs) => `Vous avez ${cs.length} ${domain === 'appointment' ? 'rendez-vous' : 'commandes'} :\n${cs.map(c => line(c, domain, 'fr')).join('\n')}\nLequel souhaitez-vous ${verb === 'cancel' ? 'annuler' : 'déplacer'} ? Indiquez la référence${domain === 'appointment' ? ', ou le jour et l’heure' : ''}.`,
            proposeCancel: (domain, c) => domain === 'appointment'
                ? `Confirmez-vous l’annulation de votre rendez-vous ${c.label} du ${when(c, 'fr')} (Réf. ${c.ref}) ?`
                : `Confirmez-vous l’ANNULATION de votre commande (Réf. ${c.ref}) : ${c.label}${c.total ? `, total ${c.total}` : ''} ? Elle ne sera pas livrée ; ce n’est pas un paiement.`,
            proposeReschedule: (c, t) => `Confirmez-vous le déplacement de votre rendez-vous ${c.label} (Réf. ${c.ref}) du ${when(c, 'fr')} au ${when({ ...c, date: t.date, time: t.time }, 'fr')} ?`,
            askTarget: c => `Pour quel jour et quelle heure souhaitez-vous déplacer votre rendez-vous ${c.label} (Réf. ${c.ref}), actuellement le ${when(c, 'fr')} ?`,
            slotTaken: (t, alts) => `Le ${dayOf(t.date, 'fr')} à ${t.time} n’est pas disponible.${alts.length ? ` Disponibles : ${alt(alts)}.` : ''} Quel autre jour ou horaire vous convient ?`,
            doneCancel: (domain, ref, alts) => `${domain === 'appointment' ? 'Votre rendez-vous' : 'Votre commande'} (Réf. ${ref}) a été annulé${domain === 'appointment' ? '' : 'e'}.${alts.length ? ` Pour reprendre rendez-vous, disponibles : ${alt(alts)}.` : ''}`,
            doneReschedule: (ref, t) => `Votre rendez-vous (Réf. ${ref}) a été déplacé au ${dayOf(t.date, 'fr')} à ${t.time}.`,
            ambiguous: options => options.length === 1 ? `Je ne sais pas ce que vous souhaitez annuler. S’agit-il de ${D(options[0])} ?` : `Plusieurs démarches sont possibles : ${options.map(o => D(o)).join(' ou ')}. Laquelle souhaitez-vous poursuivre ?`,
            noMatch: (domain, c) => `Je ne trouve pas ${domain === 'appointment' ? 'de rendez-vous' : 'de commande'} pour ce jour ou cette heure. Vous avez :\n${line(c, domain, 'fr')}\nEst-ce celui-ci ?`,
            pastDate: c => `Cette date est déjà passée. Pour quel jour et quelle heure souhaitez-vous déplacer votre rendez-vous ${c.label} (Réf. ${c.ref}) ?`,
            alreadyStarted: (verb, c) => `Votre rendez-vous ${c.label} (Réf. ${c.ref}) était le ${when(c, 'fr')} : il a déjà commencé ou est passé, je ne peux donc pas ${verb === 'cancel' ? 'l’annuler' : 'le déplacer'} depuis ce chat. ${policyPersonOfferText('fr')}`,
            dateConflict: (c, d, w) => `Le ${dayOf(d, 'fr')} n’est pas un ${WEEKDAY_NAMES_FR[w]}. Pour quel jour et quelle heure exactement souhaitez-vous déplacer votre rendez-vous ${c.label} (Réf. ${c.ref}) ?`,
            listOrders: cs => `Vous avez ${cs.length === 1 ? 'une commande' : `${cs.length} commandes`} :\n${cs.map(c => orderLine(c)).join('\n')}${orderHint(cs, 'Pour en annuler une, indiquez sa référence.')}`,
            noOrdersAtAll: () => 'Je ne trouve aucune commande de votre part.',
            verifyNeeded: hint => `Pour voir ou modifier vos rendez-vous, je dois vérifier votre identité. J’ai envoyé un code ${hint ? `à ${hint}` : 'de vérification'} ; saisissez-le ici pour continuer.`,
            codeAlreadySent: hint => `J’ai déjà envoyé un code de vérification${hint ? ` à ${hint}` : ''} ; saisissez-le ici pour continuer.`,
            codeWrong: () => 'Ce code ne correspond pas. Vérifiez-le et saisissez-le à nouveau.',
            codeExpired: () => 'Le code a expiré. Souhaitez-vous que je vous en envoie un nouveau ?',
            codeUnavailable: () => 'Je n’ai pas pu vérifier le code pour le moment. Saisissez-le à nouveau dans quelques secondes.',
            identityBlocked: () => `Par sécurité, je ne peux pas vérifier votre identité dans ce chat pour le moment. ${policyPersonOfferText('fr')}`,
            verifiedNothingToResume: () => 'Merci, votre identité est vérifiée. Que souhaitez-vous faire avec votre rendez-vous ?',
            stillScheduled: (verb, c) => `Je n’ai pas pu ${verb === 'cancel' ? 'annuler' : 'déplacer'} votre rendez-vous ${c.label} (Réf. ${c.ref}) : il reste prévu le ${when(c, 'fr')}. ${policyPersonOfferText('fr')}`,
            orderStillActive: c => `Je n’ai pas pu annuler votre commande (Réf. ${c.ref}) : elle reste active. ${policyPersonOfferText('fr')}`,
            noLongerListed: ref => `Votre rendez-vous (Réf. ${ref}) n’apparaît plus parmi vos prochains rendez-vous, mais je n’ai pas pu confirmer que le changement a été effectué. ${policyPersonOfferText('fr')}`,
            stateUnknown: () => `Je n’ai pas pu vérifier l’état de votre demande pour le moment, je ne considère donc aucun changement comme effectué. ${policyPersonOfferText('fr')}`,
        },
    };
    return T[lang];
}

// ── Orchestration ───────────────────────────────────────────────────────────

export interface TransitionIO {
    /**
     * Runs a tool through the executor and the central guard. The caller passes `identityChallenge: 'none'`: reading the
     * customer's records never sends a verification code as a side effect (see `driveIdentity`).
     */
    execute(toolName: string, args: Record<string, unknown>): Promise<any>;
    /** Date and time the customer's words name (the interpreter); null when none. */
    interpretTarget(text: string): Promise<InterpretedTarget | null>;
    todayIso: string;
    /** The tenant's local time now («HH:MM»): a same-day move to a time that already passed is refused. Absent: only the date is checked. */
    nowTime?: string;
    language: string;
    form: AddressForm;
    /** The tenant's locale for amounts (regional profile). */
    locale?: string;
    now?: () => number;
}

/** The proposal (ledger row) that is waiting for the customer's yes, as the pending lookup returns it. */
export interface PendingProposal { toolName: string; args: Record<string, unknown>; ledgerId?: string }

export interface TransitionOptions {
    continuation?: boolean;
    /** The message repeats the request the pending proposal answers: show that proposal again. */
    restate?: boolean;
    /** The proposal waiting for a yes, when there is one for the writer of this request. */
    pending?: PendingProposal | null;
    /** A verification code was already sent for a request of this conversation. */
    pendingIdentity?: PendingIdentityRequestV1 | null;
    /**
     * The record a proposal of ANOTHER action was about («quiero cancelar la D5959EA9» → «no, mejor reprográmala para el viernes»):
     * when the new words name no record, this is the one they mean. The customer is not asked again which one.
     */
    pivotTargetId?: string | null;
}

export interface TransitionOutcome {
    handled: boolean;
    text?: string;
    /** The customer is asked a yes/no whose answer the pending ledger row will take. */
    awaitsConsent?: boolean;
    /** The writer this exchange is about while the target is still being chosen; cleared when the proposal is made. */
    awaitingWriter?: string | null;
    /** A code was sent and the request waits for it (value), or the wait ended (null). Undefined: nothing changed. */
    awaitingIdentity?: PendingIdentityRequestV1 | null;
    /** The reply ends by OFFERING a person; only the customer's «sí» opens a handoff. */
    offersPerson?: boolean;
    /**
     * The proposal the customer was ALREADY shown, and that is still waiting in the ledger, is shown again unchanged. Nothing was
     * proposed this turn, so the focus the arbiter moved for the repeated request goes back to what the proposal was issued under.
     */
    reshown?: boolean;
    executed: Array<{ name: string; result: any }>;
}

const NOT_HANDLED: TransitionOutcome = { handled: false, executed: [] };

/** A code stays valid ten minutes (chat-identity.service); one request is never given a second while it lives. */
const CODE_LIVE_MS = 9 * 60_000;

// (`eval_identity_fixture_required` is NOT here: a preview or an evaluation has no real code to send or accept, so the engine
// leaves that turn to the model's own flow, which the evaluation exists to exercise.)
const IDENTITY_BLOCKED_ERRORS: ReadonlySet<string> = new Set([
    'identity_locked', 'identity_unverifiable', 'identity_context_required',
]);

/** The identity answer of a guarded call: `verify` (a code is the way forward), `blocked` (no code can be issued), or none. */
export function identityGate(result: any): 'verify' | 'blocked' | null {
    const error = result?.error;
    if (typeof error !== 'string') return null;
    if (error === 'identity_verification_required') return 'verify';
    return IDENTITY_BLOCKED_ERRORS.has(error) ? 'blocked' : null;
}

/** The appointment's start time is behind the tenant's clock (`nowTime` absent: only whole days before today count). */
export function appointmentHasStarted(c: Candidate, io: Pick<TransitionIO, 'todayIso' | 'nowTime'>): boolean {
    if (!c.date) return false;
    if (c.date < io.todayIso) return true;
    return c.date === io.todayIso && !!io.nowTime && !!c.time && c.time <= io.nowTime;
}

const nowOf = (io: TransitionIO) => (io.now ? io.now() : Date.now());

/**
 * The customer must verify before the engine can read or change their appointments (a business type where an appointment is
 * sensitive). The server drives it, explicitly and once:
 *  - the read that found the chat unverified sent NOTHING (`identityChallenge: 'none'`);
 *  - here the code is requested, once per request: while the one already sent for it is live, it is not sent again;
 *  - the reply says where the code went («Le envié un código a …; escríbalo aquí»), and the request waits for it, with its words.
 * Never the model, never silent.
 */
async function driveIdentity(request: TransitionRequest, text: string, io: TransitionIO, executed: TransitionOutcome['executed'],
    existing: PendingIdentityRequestV1 | null | undefined, retried: boolean): Promise<TransitionOutcome> {
    const T = transitionTexts(io.language, io.form);
    const live = existing && existing.stage === 'awaiting_code' && existing.codeSentAt
        && nowOf(io) - Date.parse(existing.codeSentAt) < CODE_LIVE_MS;
    if (live) return { handled: true, text: T.codeAlreadySent(existing!.hint), awaitingIdentity: existing, executed };
    const started = await io.execute('request_identity_code', {});
    executed.push({ name: 'request_identity_code', result: started });
    if (started?.alreadyVerified === true && !retried) return runTransitionInner(request, text, io, {}, executed, true);
    if (started?.sent === true || started?.pending === true) {
        const sentAt = new Date(nowOf(io)).toISOString();
        const hint = typeof started.sentTo === 'string' ? started.sentTo : existing?.hint;
        const pending: PendingIdentityRequestV1 = {
            verb: request.verb, domain: request.domain, text: text.slice(0, 400), stage: 'awaiting_code', ...(hint ? { hint } : {}),
            codeSentAt: sentAt, askedAt: existing?.askedAt ?? sentAt,
        };
        return { handled: true, text: started.sent === true ? T.verifyNeeded(hint) : T.codeAlreadySent(hint), awaitingIdentity: pending, executed };
    }
    // No code can be issued (too many in the hour, a lockout, no e-mail or phone on file): a person is OFFERED, nothing is opened.
    if (identityGate(started) === 'blocked' || started?.shouldHandoff === true) {
        return { handled: true, text: T.identityBlocked(), awaitingIdentity: null, offersPerson: true, executed };
    }
    return { ...NOT_HANDLED, executed };
}

function blockedOutcome(io: TransitionIO, executed: TransitionOutcome['executed']): TransitionOutcome {
    return { handled: true, text: transitionTexts(io.language, io.form).identityBlocked(), awaitingIdentity: null, offersPerson: true, executed };
}

/** A code-looking message: one group of six digits and little else («123456», «el código es 123456»). */
export function extractIdentityCode(raw: string): string | null {
    const text = String(raw ?? '').trim();
    if (!text || text.length > 60) return null;
    const groups = [...text.matchAll(/(?<!\d)(\d{3})[\s-]?(\d{3})(?!\d)/g)];
    return groups.length === 1 ? `${groups[0][1]}${groups[0][2]}` : null;
}

/**
 * The customer's message while a verification code is awaited. The code verifies and the request resumes (it is not asked
 * again); a wrong, lapsed or blocked code is answered by the server. Anything else ends the wait and goes on as a normal turn.
 */
export async function handleIdentityReply(pending: PendingIdentityRequestV1, text: string, io: TransitionIO): Promise<TransitionOutcome> {
    const T = transitionTexts(io.language, io.form);
    const executed: TransitionOutcome['executed'] = [];
    const request: TransitionRequest = { verb: pending.verb, domain: pending.domain };
    const fresh = nowOf(io) - Date.parse(pending.askedAt) < 30 * 60_000;
    if (!fresh) return { handled: false, awaitingIdentity: null, executed };

    if (pending.stage === 'offer_new_code') {
        const plain = clauseText(text).replace(/[,.;!?¿¡]/g, ' ').replace(/\s+/g, ' ').trim();
        if (YES_OPENER.test(plain) || BARE_YES.test(plain)) return driveIdentity(request, pending.text, io, executed, null, false);
        return { handled: false, awaitingIdentity: null, executed };
    }

    const code = extractIdentityCode(text);
    if (code) {
        const verdict = await io.execute('verify_identity_code', { code });
        executed.push({ name: 'verify_identity_code', result: verdict });
        if (verdict?.verified === true) {
            const resumed = await runTransitionInner(request, pending.text, io, {}, executed, false);
            if (resumed.handled) return { ...resumed, awaitingIdentity: resumed.awaitingIdentity ?? null };
            return { handled: true, text: T.verifiedNothingToResume(), awaitingIdentity: null, executed };
        }
        const reason = verdict?.reason;
        if (reason === 'wrong') return { handled: true, text: T.codeWrong(), awaitingIdentity: pending, executed };
        if (reason === 'expired') {
            return { handled: true, text: T.codeExpired(), awaitingIdentity: { ...pending, stage: 'offer_new_code' }, executed };
        }
        if (reason === 'too_many' || verdict?.shouldHandoff === true) {
            return { handled: true, text: T.identityBlocked(), awaitingIdentity: null, offersPerson: true, executed };
        }
        return { handled: true, text: T.codeUnavailable(), awaitingIdentity: pending, executed };
    }
    // The same request again while the code is out: the code is not sent twice, the customer is reminded.
    const repeated = detectFresh(clauseText(text), text, { text, available: ALL_TOOLS, pendingConfirmation: false }, () => true);
    if (repeated?.kind === 'request' && repeated.request.verb === pending.verb && repeated.request.domain === pending.domain) {
        return { handled: true, text: T.codeAlreadySent(pending.hint), awaitingIdentity: pending, executed };
    }
    return { handled: false, awaitingIdentity: null, executed };
}

const ALL_TOOLS: ReadonlySet<string> = new Set(['list_customer_appointments', 'list_my_catalog_orders', ...TRANSITION_TOOLS]);

export function runTransition(request: TransitionRequest, text: string, io: TransitionIO, opts: TransitionOptions = {}): Promise<TransitionOutcome> {
    return runTransitionInner(request, text, io, opts, [], false);
}

async function runTransitionInner(request: TransitionRequest, text: string, io: TransitionIO, opts: TransitionOptions,
    executed: TransitionOutcome['executed'], identityRetried: boolean): Promise<TransitionOutcome> {
    const T = transitionTexts(io.language, io.form, io.todayIso);
    const writer = request.verb === 'list' ? undefined : TRANSITION_WRITER[`${request.verb}:${request.domain}`];
    const pending = opts.pending && writer && opts.pending.toolName === writer ? opts.pending : null;
    const pendingTargetId = pending ? String(pending.args?.orderId ?? pending.args?.appointmentId ?? '') : '';
    /** An identity answer from the guard ends the read: the server drives it (or offers a person), the model is not asked. */
    const identityStop = async (result: any): Promise<TransitionOutcome | null> => {
        const gate = identityGate(result);
        if (!gate) return null;
        if (gate === 'blocked') return blockedOutcome(io, executed);
        return driveIdentity(request, text, io, executed, opts.pendingIdentity, identityRetried);
    };

    if (request.domain === 'order') {
        const listed = await io.execute('list_my_catalog_orders', {});
        executed.push({ name: 'list_my_catalog_orders', result: listed });
        const stop = await identityStop(listed);
        if (stop) return stop;
        if (!listed || listed.error || !Array.isArray(listed.orders)) return { ...NOT_HANDLED, executed };
        if (request.verb === 'list') {
            const rows = orderListing(listed, io.locale || 'es-CO', io.language);
            return { handled: true, text: rows.length ? T.listOrders(rows) : T.noOrdersAtAll(), awaitingWriter: null, executed };
        }
        const candidates = orderCandidates(listed, io.locale || 'es-CO');
        if (!candidates.length) return { handled: true, text: T.noOrders(), awaitingWriter: null, executed };
        // The proposal already shown is shown again, never re-proposed: the guard would read the repeated request as an answer.
        const shown = pending && pendingTargetId ? candidates.find(candidate => candidate.id === pendingTargetId) : undefined;
        if (shown && (opts.restate || chooseCandidate(text, candidates)?.id === shown.id)) {
            return { handled: true, text: T.proposeCancel('order', shown), awaitsConsent: true, awaitingWriter: null, reshown: true, executed };
        }
        const target = chooseCandidate(text, candidates);
        if (!target) return { handled: true, text: T.askWhich('cancel', 'order', candidates), awaitingWriter: writer, executed };
        if (!target.cancellable) return { handled: true, text: T.notCancellable(target), awaitingWriter: null, executed };
        const proposal = await io.execute(writer!, { orderId: target.id });
        executed.push({ name: writer!, result: proposal });
        if (proposal?.error !== 'confirmation_required') return { ...NOT_HANDLED, executed };
        return { handled: true, text: T.proposeCancel('order', target), awaitsConsent: true, awaitingWriter: null, executed };
    }

    const listed = await io.execute('list_customer_appointments', {});
    executed.push({ name: 'list_customer_appointments', result: listed });
    const stop = await identityStop(listed);
    if (stop) return stop;
    if (!listed || listed.error || !Array.isArray(listed.appointments)) return { ...NOT_HANDLED, executed };
    const candidates = appointmentCandidates(listed);
    if (request.verb === 'list') {
        return { handled: true, text: candidates.length ? T.list(candidates) : T.noAppointments(), awaitingWriter: null, executed };
    }
    if (!candidates.length) return { handled: true, text: T.noAppointments(), awaitingWriter: null, executed };
    const shown = pending && pendingTargetId ? candidates.find(candidate => candidate.id === pendingTargetId) : undefined;
    const target = (opts.restate && shown) ? shown
        : (chooseCandidate(text, candidates, { verifySingle: request.verb === 'cancel', ignoreDates: request.verb === 'reschedule' && !opts.continuation })
            ?? (opts.pivotTargetId ? candidates.find(candidate => candidate.id === opts.pivotTargetId) ?? null : null));
    if (!target) {
        return { handled: true, text: candidates.length === 1 ? T.noMatch('appointment', candidates[0]) : T.askWhich(request.verb, 'appointment', candidates), awaitingWriter: writer, executed };
    }

    // What has already started or passed is not cancelled or moved by chat: a no-show must not become a cancellation. The listing still
    // shows it (visibility); changing it is a person's decision, offered as a question.
    if (appointmentHasStarted(target, io)) {
        return { handled: true, text: T.alreadyStarted(request.verb, target), awaitingWriter: null, offersPerson: true, executed };
    }

    if (request.verb === 'cancel') {
        if (shown && target.id === shown.id) {
            return { handled: true, text: T.proposeCancel('appointment', target), awaitsConsent: true, awaitingWriter: null, reshown: true, executed };
        }
        const proposal = await io.execute(writer!, { appointmentId: target.id });
        executed.push({ name: writer!, result: proposal });
        const proposalStop = await identityStop(proposal);
        if (proposalStop) return proposalStop;
        if (proposal?.error !== 'confirmation_required') return { ...NOT_HANDLED, executed };
        return { handled: true, text: T.proposeCancel('appointment', target), awaitsConsent: true, awaitingWriter: null, executed };
    }

    // reschedule: the new date and time come from the customer's words, relative to the appointment where they say so.
    if (opts.restate && shown && typeof pending?.args?.newDate === 'string' && typeof pending.args.newTime === 'string') {
        return { handled: true, text: T.proposeReschedule(shown, { date: pending.args.newDate, time: pending.args.newTime }), awaitsConsent: true, awaitingWriter: null, reshown: true, executed };
    }
    const interpreted = await io.interpretTarget(text).catch(() => null);
    const reading = readTarget(text, target, interpreted, io.todayIso);
    if (reading.kind === 'ask') return { handled: true, text: T.askTarget(target), awaitingWriter: writer, executed };
    if (reading.kind === 'conflict') return { handled: true, text: T.dateConflict(target, reading.date, reading.weekday), awaitingWriter: writer, executed };
    if (reading.kind === 'past') return { handled: true, text: T.pastDate(target), awaitingWriter: writer, executed };
    const when2 = { date: reading.date, time: reading.time };
    if (when2.date === target.date && when2.time === target.time) return { handled: true, text: T.askTarget(target), awaitingWriter: writer, executed };
    // Never proposed, never executed: a date before today, or today at a time that has already gone by.
    if (when2.date < io.todayIso || (when2.date === io.todayIso && !!io.nowTime && when2.time <= io.nowTime)) {
        return { handled: true, text: T.pastDate(target), awaitingWriter: writer, executed };
    }
    // The move the customer was already shown: shown again, not proposed again.
    if (shown && target.id === shown.id && pending?.args?.newDate === when2.date && pending.args.newTime === when2.time) {
        return { handled: true, text: T.proposeReschedule(target, when2), awaitsConsent: true, awaitingWriter: null, reshown: true, executed };
    }
    // A slot is never proposed unverified: without the service, or when the agenda cannot answer, the model's own flow takes over.
    if (!target.serviceId) return { ...NOT_HANDLED, executed };
    const availability = await io.execute('check_availability', {
        date: when2.date, serviceId: target.serviceId, ...(target.staffId ? { staffId: target.staffId } : {}),
        ...(target.vehicleId ? { vehicleId: target.vehicleId } : {}),
    });
    executed.push({ name: 'check_availability', result: availability });
    if (!availability || availability.error || !Array.isArray(availability.slots)) return { ...NOT_HANDLED, executed };
    const times = availability.slots.map((slot: any) => String(slot?.time ?? '')).filter(Boolean);
    if (!times.includes(when2.time)) {
        return { handled: true, text: T.slotTaken(when2, [...new Set<string>(times)].slice(0, 4)), awaitingWriter: writer, executed };
    }
    const proposal = await io.execute(writer!, { appointmentId: target.id, newDate: when2.date, newTime: when2.time });
    executed.push({ name: writer!, result: proposal });
    const proposalStop = await identityStop(proposal);
    if (proposalStop) return proposalStop;
    if (proposal?.error !== 'confirmation_required') return { ...NOT_HANDLED, executed };
    return { handled: true, text: T.proposeReschedule(target, when2), awaitsConsent: true, awaitingWriter: null, executed };
}

/**
 * The verification lapsed between the proposal and the customer's yes: ask for the code, once, and keep the request (its
 * words rebuilt from the proposal's own arguments, since the yes carries none).
 */
export async function requestIdentityForTool(toolName: string, args: any, io: TransitionIO): Promise<TransitionOutcome | null> {
    const request = transitionRequestForTool(toolName);
    if (!request || request.verb === 'list') return null;
    const ref = shortReference(args?.appointmentId ?? args?.orderId);
    const text = request.verb === 'cancel' ? `cancelar ${ref}` : `reprogramar ${ref} ${String(args?.newDate ?? '')} ${String(args?.newTime ?? '')}`.trim();
    return driveIdentity(request, text, io, [], null, false);
}

/** Ids of the appointments and orders the turn knows (tool results and the active objects of the prompt). */
export function knownRecordIds(executed: ReadonlyArray<{ name: string; result: any }>, context?: any): string[] {
    const ids = new Set<string>();
    const add = (value: unknown) => { if (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) ids.add(value); };
    for (const { result } of executed || []) {
        if (!result || typeof result !== 'object') continue;
        for (const row of [...(Array.isArray(result.appointments) ? result.appointments : []), ...(Array.isArray(result.orders) ? result.orders : [])]) add(row?.id);
        add(result.order?.id); add(result.appointment?.id); add(result.id);
    }
    for (const item of Array.isArray(context?.activeObjects?.items) ? context.activeObjects.items : []) {
        if (item?.kind === 'appointment' || item?.kind === 'order' || item?.kind === 'food_order') add(item.id);
    }
    return [...ids];
}

/** Answers of the guard that mean «nothing was attempted» (a proposal, a refusal, a missing code): not a write that failed. */
const NO_EFFECT_ERRORS: ReadonlySet<string> = new Set([
    'confirmation_required', 'mission_selection_required', 'action_rejected', 'reschedule_must_be_atomic', 'confirmation_already_used',
    'identity_verification_required', 'identity_locked', 'identity_unverifiable', 'identity_context_required', 'tool_not_authorised',
    'confirmation_not_converging', 'approval_required',
]);

/**
 * The cancellation / reschedule among the tools a turn ran whose LAST attempt failed (a later success of the same record clears it).
 * Only a write that was attempted and failed: a proposal, a refusal or a missing code is not one.
 */
export function failedTransitionOf(executed: ReadonlyArray<{ name: string; result: any; args?: any }>): { name: string; args: any } | null {
    const failed = new Map<string, { name: string; args: any }>();
    for (const tool of executed || []) {
        if (!TRANSITION_TOOLS.has(tool.name) || !tool.args || typeof tool.args !== 'object') continue;
        const target = String(tool.args.appointmentId ?? tool.args.orderId ?? '');
        if (!target) continue;
        const key = `${tool.name}:${target}`;
        const error = tool.result?.error;
        if (typeof error === 'string' && !NO_EFFECT_ERRORS.has(error) && !isToolAuthorityDenial(error)) failed.set(key, { name: tool.name, args: tool.args });
        else if (!error && tool.result?.success !== false) failed.delete(key);
    }
    return failed.values().next().value ?? null;
}

/**
 * The appointments and orders the turn READ (tool results, the active objects), each with its status and the words that identify
 * it (short reference, product or service name). A reply repeating the status of ONE of them in the present only reports it.
 */
export function knownRecordFacts(executed: ReadonlyArray<{ name: string; result: any }>, context?: any): RecordFact[] {
    const facts: RecordFact[] = [];
    const add = (status: unknown, id: unknown, ...names: unknown[]) => {
        if (typeof status !== 'string' || !status.trim()) return;
        const tokens = [typeof id === 'string' && id ? shortReference(id) : '', ...names].filter((token): token is string => typeof token === 'string' && token.trim().length >= 3);
        if (tokens.length) facts.push({ status: status.trim().toLowerCase(), tokens });
    };
    for (const { name, result } of executed || []) {
        if (!result || typeof result !== 'object' || isWriteResultName(name)) continue;
        for (const row of [...(Array.isArray(result.appointments) ? result.appointments : []), result.appointment]) add(row?.status, row?.id, row?.service);
        for (const row of [...(Array.isArray(result.orders) ? result.orders : []), result.order]) {
            add(row?.status, row?.id, ...(Array.isArray(row?.items) ? row.items.map((item: any) => item?.productName) : []));
        }
    }
    for (const item of Array.isArray(context?.activeObjects?.items) ? context.activeObjects.items : []) {
        add(item?.statusClass === 'cancelled' ? 'cancelled' : item?.status, item?.id, item?.label, item?.reference);
    }
    for (const order of Array.isArray(context?.recentOrders) ? context.recentOrders : []) add(order?.status, order?.id, order?.label);
    return facts;
}

/** A write's own result is not a read of a record's state (it is what the claim guard audits). */
function isWriteResultName(name: string): boolean {
    return /^(?:cancel|create|reschedule|place|update|book|confirm)_/.test(name);
}

/** The deterministic account of a transition the server executed after the customer's yes. */
export function transitionDoneText(toolName: string, args: any, result: any, language: string | undefined, form: AddressForm, todayIso?: string): string | null {
    const request = transitionRequestForTool(toolName);
    if (!request || !result || result.error || result.success === false) return null;
    const T = transitionTexts(language, form, todayIso);
    if (request.verb === 'reschedule') {
        const appointment = result.appointment ?? {};
        const ref = shortReference(appointment.id ?? args?.appointmentId);
        const date = String(appointment.date ?? args?.newDate ?? '');
        const time = String(appointment.time ?? args?.newTime ?? '');
        return date && time ? T.doneReschedule(ref, { date, time }) : null;
    }
    const alternatives = (Array.isArray(result.alternatives) ? result.alternatives : []).slice(0, 3)
        .map((slot: any) => `${formatDay(String(slot.date ?? ''), langOf(language))} ${slot.time}`);
    if (request.domain === 'appointment') return T.doneCancel('appointment', shortReference(args?.appointmentId), alternatives);
    return T.doneCancel('order', shortReference(result.order?.id ?? args?.orderId), []);
}

/**
 * The write the customer confirmed FAILED. What they are told is what the records say NOW, read again — never what the model
 * assumes («sigue tal como está» is only said when the appointment is verifiably still there). When the re-read shows the change
 * did happen (the write committed and a later step failed), the done text is returned instead.
 */
export async function transitionFailureText(toolName: string, args: any, io: TransitionIO): Promise<string | null> {
    const request = transitionRequestForTool(toolName);
    if (!request || request.verb === 'list') return null;
    const T = transitionTexts(io.language, io.form);
    try {
        if (request.domain === 'order') {
            const listed = await io.execute('list_my_catalog_orders', {});
            const id = String(args?.orderId ?? '');
            const rows: any[] = Array.isArray(listed?.orders) ? listed.orders : [];
            if (listed?.error || !Array.isArray(listed?.orders)) return T.stateUnknown();
            const row = rows.find(order => order?.id === id);
            if (!row) return T.stateUnknown();
            if (['cancelled', 'canceled'].includes(String(row.status))) return T.doneCancel('order', shortReference(id), []);
            const candidate = orderListing({ orders: [row] }, io.locale || 'es-CO', io.language)[0];
            return T.orderStillActive(candidate);
        }
        const listed = await io.execute('list_customer_appointments', {});
        if (listed?.error || !Array.isArray(listed?.appointments)) return T.stateUnknown();
        const id = String(args?.appointmentId ?? '');
        const row = listed.appointments.find((appointment: any) => appointment?.id === id);
        if (!row) return T.noLongerListed(shortReference(id));
        const [candidate] = appointmentCandidates({ appointments: [row] });
        if (!candidate) return T.noLongerListed(shortReference(id));
        if (request.verb === 'reschedule' && args?.newDate && candidate.date === args.newDate && candidate.time === args.newTime) {
            return T.doneReschedule(candidate.ref, { date: candidate.date!, time: candidate.time! });
        }
        return T.stillScheduled(request.verb, candidate);
    } catch {
        return T.stateUnknown();
    }
}
