import { normalizeForIntent } from '@parallext/shared';
import { isInformationSeekingMessage } from '../../common/conversation/intent-normalizer';
import { appointmentChangeRequest, negatedAt, REPORTED_OR_PAST } from './appointment-transition';

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

// Not inside a URL or a path (…/orders/<uuid>, ?id=<uuid>): those stay whole.
// Nor inside an e-mail address (<uuid>@pay.example.com, user@<uuid>.example.com).
const UUID_G = /(?<![\w/=.:@-])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\w/@-])/gi;
/** A raw UUID never reaches the customer: it is shown as the short reference. */
export function humanizeReferences(text: string): string {
    return text.replace(UUID_G, match => shortReference(match));
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
const REQUEST_OPENER = /\b(?:quiero|necesito|quisiera|deseo|me gustaria|quisiera|favor|por favor|puedes|podrias|podria|ayudame a|i want to|i need to|i would like to|please|je veux|je voudrais|quero|preciso|gostaria de)\b/;
const YES_OPENER = /^\W*(?:si|sí|ok|dale|claro|vale|listo|perfecto|de acuerdo|yes|sim|oui)\b/;
/** The whole message is the list question; «tengo una cita mañana, ¿dónde queda?» is not. */
const LIST_WHOLE = /^(?:(?:hola|buenas?(?: dias| tardes| noches)?)\s+)?(?:(?:por favor|dime|digame|muestrame|me puedes decir|me podrias decir|quiero ver|quiero saber|necesito saber)\s+)*(?:(?:que|cuales|cuantas) (?:citas|turnos)(?: (?:tengo|hay|tiene|tengo agendadas|tengo programadas|tengo pendientes|agendadas|programadas))?(?: agendad\w+| programad\w+| pendientes)?|(?:cuales|que) son mis (?:citas|turnos)(?: proxim\w+)?|mis (?:proximas )?(?:citas|turnos)|(?:tengo|hay) (?:alguna|algun) (?:cita|turno)(?: agendad\w+| programad\w+| pendiente)?|ver mis (?:proximas )?(?:citas|turnos)|what appointments do i have|my appointments)(?:\s+(?:por favor|gracias))?$/;
const CHOICE_REF = /\b[0-9a-f]{8}\b/;
const CHOICE_DATE = /\b(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|\d{1,2} de (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)|dia \d{1,2}|\d{1,2}:\d{2}|(?:a )?las \d{1,2}|dia siguiente|siguiente dia|misma hora|manana|hoy|pasado manana|next day|same time|tomorrow)\b/;
const CHOICE_ORDINAL = /^(?:(?:cancela|cancelar|cancelala|cancelalo|mueve|mover|muevela|reprograma|esa|ese|la que sea|quiero)\s+)?(?:(?:la|el|opcion|numero|la opcion|el numero)\s+)?(?:primer[ao]?|segund[ao]|tercer[ao]?|ultim[ao]|[123])(?:\s+(?:por favor|gracias))?$/;
const NOT_A_CHOICE = /\b(?:abren|abre|abrir|cierran|horario|horarios|cuesta|cuestan|precio|precios|cuanto|donde|como|cuando|que hora|puedo|pueden|se puede|hay|tienen|atienden|direccion|gracias|hola|buenos|buenas)\b/;

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
    | { kind: 'request'; request: TransitionRequest; continuation: boolean }
    | { kind: 'ambiguous'; verb: 'cancel'; options: TransitionDomain[] }
    | null;

/** The words of a message with accents folded and punctuation kept as clause breaks (`,` and `.`). */
function clauseText(raw: string): string {
    return normalizeForIntent(raw).replace(/[^\p{L}\p{N}\s,.;!?¿¡']/gu, ' ').replace(/\s+/g, ' ').trim();
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
    const text = clauseText(raw).replace(/[,.;!?¿¡]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || NOT_A_CHOICE.test(text)) return false;
    return CHOICE_REF.test(text) && /\d/.test(text.match(CHOICE_REF)![0]) || CHOICE_DATE.test(text) || CHOICE_ORDINAL.test(text);
}

/**
 * The arbiter clarifies («¿cuál?») when several saved tasks match the words. With fewer than two things to choose between,
 * and a message that plainly names ONE object to cancel / move / list, that is not a question to ask: the request goes to
 * this engine as a new task of that object.
 */
export function namedRequestOverridesClarify(clarifyOptions: readonly string[] | undefined, detected: Detected): detected is Extract<NonNullable<Detected>, { kind: 'request' }> {
    return (clarifyOptions || []).length < 2 && detected?.kind === 'request' && !detected.continuation;
}

export function detectTransition(ctx: DetectContext): Detected {
    const raw = String(ctx.text ?? '');
    if (!raw.trim() || raw.length > 400) return null;
    const text = clauseText(raw);
    if (!text) return null;
    const can = (verb: TransitionVerb, domain: TransitionDomain) => verb === 'list'
        ? ctx.available.has('list_customer_appointments')
        : ctx.available.has(TRANSITION_WRITER[`${verb}:${domain}`]);

    // The target of a request this engine opened is being chosen: the very next message, recently, if it picks something.
    const awaiting = transitionRequestForTool(ctx.awaitingWriter);
    if (awaiting && !ctx.pendingConfirmation && can(awaiting.verb, awaiting.domain)) {
        const fresh = detectFresh(text, raw, ctx, can);
        if (fresh && fresh.kind === 'request' && fresh.request.verb !== 'list') return fresh;
        if (!fresh && ctx.awaitingFresh !== false && !isInformationSeekingMessage(raw) && hasChoiceSignal(raw)) {
            return { kind: 'request', request: awaiting, continuation: true };
        }
        return null;
    }
    if (ctx.pendingConfirmation && YES_OPENER.test(text)) return null;
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
    if (ASKING_ABOUT.test(plain) || POLICY_WORDS.test(plain)) return null;
    const asking = isInformationSeekingMessage(raw) && !REQUEST_OPENER.test(plain);
    if (asking) return null;

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
    cancellable: boolean;
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
export function chooseCandidate(rawText: string, candidates: Candidate[], options: { verifySingle?: boolean } = {}): Candidate | null {
    const text = ` ${normalizeForIntent(rawText).replace(/[^\p{L}\p{N}\s:]/gu, ' ').replace(/\s+/g, ' ').trim()} `;
    const picks = datePicks(text);
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

/** The new date and time of a reschedule request. A part the customer did not name stays as the appointment has it. */
export function resolveTarget(rawText: string, appointment: Candidate, interpreted: InterpretedTarget | null, todayIso: string):
    { date: string; time: string } | null {
    const text = normalizeForIntent(rawText).replace(/[^\p{L}\p{N}\s:]/gu, ' ').replace(/\s+/g, ' ').trim();
    const baseDate = appointment.date || '';
    const baseTime = appointment.time || '';
    let date: string | null = null;
    let time: string | null = null;
    if (NEXT_DAY.test(text)) date = addDays(baseDate, 1);
    if (SAME_TIME.test(text)) time = baseTime;
    const interpretedDate = String(interpreted?.date ?? '').trim().toLowerCase();
    if (!date && interpretedDate) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(interpretedDate)) date = interpretedDate;
        else if (interpretedDate === 'today') date = todayIso;
        else if (interpretedDate === 'tomorrow') date = addDays(todayIso, 1);
    }
    const interpretedTime = String(interpreted?.time ?? '').trim();
    if (!time && /^([01]?\d|2[0-3]):[0-5]\d$/.test(interpretedTime)) time = interpretedTime.padStart(5, '0');
    if (!date && !time) return null;
    return { date: date || baseDate, time: time || baseTime };
}

// ── Texts ───────────────────────────────────────────────────────────────────

export type AddressForm = 'usted' | 'tu';

export function addressFormOf(value: unknown): AddressForm {
    const form = String(value ?? '').toLowerCase();
    // «vos» regions are addressed with «tú» too: the API sends no voseo (no-voseo-in-strings.spec).
    return form === 'vos' || form === 'tu' ? 'tu' : 'usted';
}

const LOCALES: Record<string, string> = { es: 'es-CO', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR' };

export function formatDay(date: string, lang: string): string {
    const [y, m, d] = date.split('-').map(Number);
    if (!y || !m || !d) return date;
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(LOCALES[lang] || LOCALES.es,
        { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).replace(',', '');
}

type Lang = 'es' | 'en' | 'pt' | 'fr';
const langOf = (language?: string): Lang => (['es', 'en', 'pt', 'fr'].includes(String(language).slice(0, 2).toLowerCase())
    ? String(language).slice(0, 2).toLowerCase() : 'es') as Lang;

const when = (c: Candidate, lang: Lang) => `${formatDay(c.date || '', lang)}${c.time ? (lang === 'en' ? ` at ${c.time}` : lang === 'fr' ? ` à ${c.time}` : ` a las ${c.time}`) : ''}`;
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
}

export function transitionTexts(language: string | undefined, form: AddressForm = 'usted'): Texts {
    const lang = langOf(language);
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
            slotTaken: (t, alts) => `${formatDay(t.date, 'es')} a las ${t.time} no está disponible.${alts.length ? ` ${tu ? 'Tengo libre' : 'Tengo libre'}: ${alt(alts)}.` : ''} ${tu ? '¿Qué otro día u hora te sirve?' : '¿Qué otro día u hora le sirve?'}`,
            doneCancel: (domain, ref, alts) => `${domain === 'appointment' ? 'Su cita' : 'Su pedido'} (Ref. ${ref}) quedó ${domain === 'appointment' ? 'cancelada' : 'anulado'}.`.replace('Su ', tu ? 'Tu ' : 'Su ')
                + (alts.length ? ` ${tu ? 'Si quieres volver a agendar, tengo libre' : 'Si desea volver a agendar, tengo libre'}: ${alt(alts)}.` : ''),
            doneReschedule: (ref, t) => `${tu ? 'Tu' : 'Su'} cita (Ref. ${ref}) quedó reprogramada para el ${formatDay(t.date, 'es')} a las ${t.time}.`,
            ambiguous: options => options.length === 1
                ? `${tu ? 'No me queda claro qué quieres cancelar. ¿Se trata de' : 'No me queda claro qué desea cancelar. ¿Se trata de'} ${S(options[0])}?`
                : `Hay más de una gestión posible: ${options.map(o => S(o)).join(' o ')}. ${tu ? '¿Sobre cuál quieres continuar?' : '¿Sobre cuál desea continuar?'}`,
            noMatch: (domain, c) => `${tu ? 'No encuentro' : 'No encuentro'} ${domain === 'appointment' ? 'una cita' : 'un pedido'} con ese día u hora. ${tu ? 'Tienes' : 'Usted tiene'}:\n${line(c, domain, 'es')}\n${tu ? '¿Es esa la que quieres?' : '¿Es esa la que desea?'}`,
            pastDate: c => `${tu ? 'Esa fecha ya pasó.' : 'Esa fecha ya pasó.'} ${tu ? '¿Para qué día y hora quieres' : '¿Para qué día y hora desea'} mover ${S('appointment')} de ${c.label} (Ref. ${c.ref})?`,
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
            slotTaken: (t, alts) => `${formatDay(t.date, 'en')} at ${t.time} is not available.${alts.length ? ` Free: ${alt(alts)}.` : ''} What other day or time works for you?`,
            doneCancel: (domain, ref, alts) => `Your ${domain === 'appointment' ? 'appointment' : 'order'} (Ref. ${ref}) has been cancelled.${alts.length ? ` If you want to book again, these are free: ${alt(alts)}.` : ''}`,
            doneReschedule: (ref, t) => `Your appointment (Ref. ${ref}) has been moved to ${formatDay(t.date, 'en')} at ${t.time}.`,
            ambiguous: options => options.length === 1 ? `I am not sure what you want to cancel. Is it ${D(options[0])}?` : `There is more than one possible task: ${options.map(o => D(o)).join(' or ')}. Which one would you like to continue?`,
            noMatch: (domain, c) => `I do not find ${domain === 'appointment' ? 'an appointment' : 'an order'} for that day or time. You have:\n${line(c, domain, 'en')}\nIs that the one?`,
            pastDate: c => `That date has already passed. Which day and time would you like to move your ${c.label} appointment (Ref. ${c.ref}) to?`,
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
            slotTaken: (t, alts) => `${formatDay(t.date, 'pt')} às ${t.time} não está disponível.${alts.length ? ` Livres: ${alt(alts)}.` : ''} Que outro dia ou hora serve para você?`,
            doneCancel: (domain, ref, alts) => `${domain === 'appointment' ? 'O seu agendamento' : 'O seu pedido'} (Ref. ${ref}) foi cancelado.${alts.length ? ` Se quiser agendar de novo, estão livres: ${alt(alts)}.` : ''}`,
            doneReschedule: (ref, t) => `O seu agendamento (Ref. ${ref}) foi mudado para ${formatDay(t.date, 'pt')} às ${t.time}.`,
            ambiguous: options => options.length === 1 ? `Não ficou claro o que você quer cancelar. É ${D(options[0])}?` : `Há mais de uma tarefa possível: ${options.map(o => D(o)).join(' ou ')}. Sobre qual deseja continuar?`,
            noMatch: (domain, c) => `Não encontro ${domain === 'appointment' ? 'um agendamento' : 'um pedido'} nesse dia ou hora. Você tem:\n${line(c, domain, 'pt')}\nÉ esse?`,
            pastDate: c => `Essa data já passou. Para que dia e hora quer mudar o agendamento de ${c.label} (Ref. ${c.ref})?`,
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
            slotTaken: (t, alts) => `Le ${formatDay(t.date, 'fr')} à ${t.time} n’est pas disponible.${alts.length ? ` Disponibles : ${alt(alts)}.` : ''} Quel autre jour ou horaire vous convient ?`,
            doneCancel: (domain, ref, alts) => `${domain === 'appointment' ? 'Votre rendez-vous' : 'Votre commande'} (Réf. ${ref}) a été annulé${domain === 'appointment' ? '' : 'e'}.${alts.length ? ` Pour reprendre rendez-vous, disponibles : ${alt(alts)}.` : ''}`,
            doneReschedule: (ref, t) => `Votre rendez-vous (Réf. ${ref}) a été déplacé au ${formatDay(t.date, 'fr')} à ${t.time}.`,
            ambiguous: options => options.length === 1 ? `Je ne sais pas ce que vous souhaitez annuler. S’agit-il de ${D(options[0])} ?` : `Plusieurs démarches sont possibles : ${options.map(o => D(o)).join(' ou ')}. Laquelle souhaitez-vous poursuivre ?`,
            noMatch: (domain, c) => `Je ne trouve pas ${domain === 'appointment' ? 'de rendez-vous' : 'de commande'} pour ce jour ou cette heure. Vous avez :\n${line(c, domain, 'fr')}\nEst-ce celui-ci ?`,
            pastDate: c => `Cette date est déjà passée. Pour quel jour et quelle heure souhaitez-vous déplacer votre rendez-vous ${c.label} (Réf. ${c.ref}) ?`,
        },
    };
    return T[lang];
}

// ── Orchestration ───────────────────────────────────────────────────────────

export interface TransitionIO {
    execute(toolName: string, args: Record<string, unknown>): Promise<any>;
    /** Date and time the customer's words name (the interpreter); null when none. */
    interpretTarget(text: string): Promise<InterpretedTarget | null>;
    todayIso: string;
    language: string;
    form: AddressForm;
    /** The tenant's locale for amounts (regional profile). */
    locale?: string;
}

export interface TransitionOutcome {
    handled: boolean;
    text?: string;
    /** The customer is asked a yes/no whose answer the pending ledger row will take. */
    awaitsConsent?: boolean;
    /** The writer this exchange is about while the target is still being chosen; cleared when the proposal is made. */
    awaitingWriter?: string | null;
    executed: Array<{ name: string; result: any }>;
}

const NOT_HANDLED: TransitionOutcome = { handled: false, executed: [] };

export async function runTransition(request: TransitionRequest, text: string, io: TransitionIO): Promise<TransitionOutcome> {
    const T = transitionTexts(io.language, io.form);
    const writer = request.verb === 'list' ? undefined : TRANSITION_WRITER[`${request.verb}:${request.domain}`];
    const executed: TransitionOutcome['executed'] = [];

    if (request.domain === 'order') {
        const listed = await io.execute('list_my_catalog_orders', {});
        executed.push({ name: 'list_my_catalog_orders', result: listed });
        if (!listed || listed.error || !Array.isArray(listed.orders)) return { ...NOT_HANDLED, executed };
        const candidates = orderCandidates(listed, io.locale || 'es-CO');
        if (!candidates.length) return { handled: true, text: T.noOrders(), awaitingWriter: null, executed };
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
    if (!listed || listed.error || !Array.isArray(listed.appointments)) return { ...NOT_HANDLED, executed };
    const candidates = appointmentCandidates(listed);
    if (request.verb === 'list') {
        return { handled: true, text: candidates.length ? T.list(candidates) : T.noAppointments(), awaitingWriter: null, executed };
    }
    if (!candidates.length) return { handled: true, text: T.noAppointments(), awaitingWriter: null, executed };
    const target = chooseCandidate(text, candidates, { verifySingle: request.verb === 'cancel' });
    if (!target) {
        return { handled: true, text: candidates.length === 1 ? T.noMatch('appointment', candidates[0]) : T.askWhich(request.verb, 'appointment', candidates), awaitingWriter: writer, executed };
    }

    if (request.verb === 'cancel') {
        const proposal = await io.execute(writer!, { appointmentId: target.id });
        executed.push({ name: writer!, result: proposal });
        if (proposal?.error !== 'confirmation_required') return { ...NOT_HANDLED, executed };
        return { handled: true, text: T.proposeCancel('appointment', target), awaitsConsent: true, awaitingWriter: null, executed };
    }

    // reschedule: the new date and time come from the customer's words, relative to the appointment where they say so.
    const interpreted = await io.interpretTarget(text).catch(() => null);
    const when2 = resolveTarget(text, target, interpreted, io.todayIso);
    if (!when2) return { handled: true, text: T.askTarget(target), awaitingWriter: writer, executed };
    if (when2.date === target.date && when2.time === target.time) return { handled: true, text: T.askTarget(target), awaitingWriter: writer, executed };
    if (when2.date < io.todayIso) return { handled: true, text: T.pastDate(target), awaitingWriter: writer, executed };
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
    if (proposal?.error !== 'confirmation_required') return { ...NOT_HANDLED, executed };
    return { handled: true, text: T.proposeReschedule(target, when2), awaitsConsent: true, awaitingWriter: null, executed };
}

/** The deterministic account of a transition the server executed after the customer's yes. */
export function transitionDoneText(toolName: string, args: any, result: any, language: string | undefined, form: AddressForm): string | null {
    const request = transitionRequestForTool(toolName);
    if (!request || !result || result.error || result.success === false) return null;
    const T = transitionTexts(language, form);
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
