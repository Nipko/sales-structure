import { normalizeForIntent } from '@parallext/shared';
import { isInformationSeekingMessage } from '../../common/conversation/intent-normalizer';
import { appointmentChangeRequest } from './appointment-transition';

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
const UUID_G = /(?<![\w/=.:-])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\w/-])/gi;
/** A raw UUID never reaches the customer: it is shown as the short reference. */
export function humanizeReferences(text: string): string {
    return text.replace(UUID_G, match => shortReference(match));
}

// ── Detection ───────────────────────────────────────────────────────────────

const CANCEL_TOKEN = /\b(?:cancel\w*|anul\w*|annul\w*)\b/;
const NEGATED_CANCEL = /\b(?:no (?:quiero |deseo |vayas a |la |lo )?(?:cancelar|cancela|canceles|cancelo)|nao (?:quero )?cancelar|(?:don t|do not|not) (?:want to )?cancel|ne (?:veux |souhaite )?pas annuler)\b/;
const APPOINTMENT_NOUN = /\b(?:cita|citas|turno|turnos|consulta|reserva|appointment|booking|agendamento|rendez vous)\b/;
const ORDER_NOUN = /\b(?:pedido|pedidos|orden|ordenes|compra|order|orders|commande|encomenda)\b/;
const POLICY_WORDS = /\b(?:politica|politicas|policy|cuanto|costo|cobran|penalizacion|multa|reembolso|devolucion|plazo|horas antes|antes de)\b/;
const YES_OPENER = /^\W*(?:si|sí|ok|dale|claro|vale|listo|perfecto|de acuerdo|yes|sim|oui)\b/;
const LIST_APPOINTMENTS = /\b(?:que citas|cuales citas|cuantas citas|mis citas|mis turnos|que turnos|tengo (?:alguna |una |algun )?(?:cita|citas|turno)|cita(?:s)? (?:tengo|agendad\w*|programad\w*)|my appointments|what appointments)\b/;

export interface DetectContext {
    /** The customer's text. */
    text: string;
    /** The writers this turn may call (the published, owner-enabled set). */
    available: ReadonlySet<string>;
    /** Domain of the current tool mission, when one is selected. */
    missionDomain?: string;
    /** Writer of a request whose target is still being chosen (set by an earlier turn of this engine). */
    awaitingWriter?: string;
    /** A confirmation is pending: a yes belongs to it, not to this engine. */
    pendingConfirmation: boolean;
}

export type Detected =
    | { kind: 'request'; request: TransitionRequest; continuation: boolean }
    | { kind: 'ambiguous'; verb: 'cancel'; options: TransitionDomain[] }
    | null;

export function detectTransition(ctx: DetectContext): Detected {
    const raw = String(ctx.text ?? '');
    if (!raw.trim() || raw.length > 400) return null;
    const text = normalizeForIntent(raw).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const can = (verb: TransitionVerb, domain: TransitionDomain) => verb === 'list'
        ? ctx.available.has('list_customer_appointments')
        : ctx.available.has(TRANSITION_WRITER[`${verb}:${domain}`]);

    // The target of a request this engine already opened is being chosen: the answer is that choice.
    const awaiting = transitionRequestForTool(ctx.awaitingWriter);
    if (awaiting && !ctx.pendingConfirmation && can(awaiting.verb, awaiting.domain)) {
        const fresh = detectFresh(text, raw, ctx, can);
        if (fresh && fresh.kind === 'request' && fresh.request.verb !== 'list') return fresh;
        if (!fresh && !/\b(?:no|nada|olvid\w*|mejor no|ya no|dejalo|dejemoslo)\b/.test(text)) return { kind: 'request', request: awaiting, continuation: true };
        return null;
    }
    if (ctx.pendingConfirmation && YES_OPENER.test(text)) return null;
    return detectFresh(text, raw, ctx, can);
}

function detectFresh(text: string, raw: string, ctx: DetectContext, can: (v: TransitionVerb, d: TransitionDomain) => boolean): Detected {
    if (isInformationSeekingMessage(raw) && !/\b(?:quiero|necesito|quisiera|deseo|favor)\b/.test(text)) {
        return LIST_APPOINTMENTS.test(text) && can('list', 'appointment') ? { kind: 'request', request: { verb: 'list', domain: 'appointment' }, continuation: false } : null;
    }
    const change = appointmentChangeRequest(raw);
    if (change && can('reschedule', 'appointment') && !POLICY_WORDS.test(text)) {
        return { kind: 'request', request: { verb: 'reschedule', domain: 'appointment' }, continuation: false };
    }
    if (CANCEL_TOKEN.test(text) && !NEGATED_CANCEL.test(text) && !POLICY_WORDS.test(text)) {
        const wantsAppointment = APPOINTMENT_NOUN.test(text);
        const wantsOrder = ORDER_NOUN.test(text);
        const options = (['appointment', 'order'] as TransitionDomain[]).filter(domain => can('cancel', domain));
        if (wantsAppointment && wantsOrder) return { kind: 'ambiguous', verb: 'cancel', options: ['appointment', 'order'] };
        if (wantsAppointment) return can('cancel', 'appointment') ? { kind: 'request', request: { verb: 'cancel', domain: 'appointment' }, continuation: false } : null;
        if (wantsOrder) return can('cancel', 'order') ? { kind: 'request', request: { verb: 'cancel', domain: 'order' }, continuation: false } : null;
        // «cancélalo» names nothing: the current mission names it, or the tenant has one object only.
        const byMission = ctx.missionDomain === 'appointment' || ctx.missionDomain === 'order' ? ctx.missionDomain : undefined;
        if (byMission && can('cancel', byMission)) return { kind: 'request', request: { verb: 'cancel', domain: byMission }, continuation: false };
        if (options.length === 1 && !ctx.pendingConfirmation) return { kind: 'request', request: { verb: 'cancel', domain: options[0] }, continuation: false };
        if (options.length > 1) return { kind: 'ambiguous', verb: 'cancel', options };
        return null;
    }
    if (LIST_APPOINTMENTS.test(text) && can('list', 'appointment')) {
        return { kind: 'request', request: { verb: 'list', domain: 'appointment' }, continuation: false };
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
            status: String(row.status ?? ''), serviceId: row.serviceId, staffId: row.staffId, cancellable: true,
        }));
}

export function orderCandidates(result: any): Candidate[] {
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
                total: Number.isFinite(amount) ? `${amount.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ${String(row.currency ?? '').toUpperCase()}`.trim() : undefined,
                cancellable: ['pending', 'confirmed'].includes(String(row.status)) && ['pending', 'failed', 'unknown'].includes(String(row.paymentStatus ?? 'unknown')),
            };
        });
}

const ORDINALS: Array<[RegExp, number]> = [
    [/\b(?:primer[ao]?|la 1|el 1|1ra|opcion 1|numero 1|first|primeira|premiere?)\b/, 0],
    [/\b(?:segund[ao]|la 2|el 2|2da|opcion 2|numero 2|second|segunda|deuxieme)\b/, 1],
    [/\b(?:tercer[ao]?|la 3|el 3|3ra|opcion 3|numero 3|third|terceira|troisieme)\b/, 2],
];
const WEEKDAYS_ES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Picks the ONE candidate the customer's words point at; null when they point at none or at several. */
export function chooseCandidate(rawText: string, candidates: Candidate[]): Candidate | null {
    if (candidates.length === 1) return candidates[0];
    const text = ` ${normalizeForIntent(rawText).replace(/[^\p{L}\p{N}\s:]/gu, ' ').replace(/\s+/g, ' ').trim()} `;
    const refs = candidates.filter(candidate => text.includes(` ${candidate.ref.toLowerCase()} `) || text.includes(candidate.id.toLowerCase()));
    if (refs.length === 1) return refs[0];
    for (const [pattern, index] of ORDINALS) if (pattern.test(text) && candidates[index]) return candidates[index];
    if (/\b(?:ultim[ao]|last)\b/.test(text)) return candidates[candidates.length - 1];
    const scored = candidates.map(candidate => {
        let score = 0;
        if (candidate.date) {
            const [y, m, d] = candidate.date.split('-').map(Number);
            const weekday = WEEKDAYS_ES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
            if (text.includes(` ${weekday} `)) score += 2;
            if (new RegExp(`\\b${d} de ${MONTHS_ES[m - 1]}\\b`).test(text) || new RegExp(`\\b${MONTHS_ES[m - 1]} ${d}\\b`).test(text)) score += 3;
            else if (new RegExp(`\\bdia ${d}\\b`).test(text)) score += 2;
        }
        if (candidate.time) {
            const [h, min] = candidate.time.split(':').map(Number);
            if (text.includes(` ${candidate.time} `) || new RegExp(`\\ba las ${h}(?::${String(min).padStart(2, '0')})?\\b`).test(text)) score += 1;
        }
        const label = normalizeForIntent(candidate.label);
        if (label.length >= 3 && text.includes(` ${label} `)) score += 1;
        return { candidate, score };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
    if (!scored.length) return null;
    if (scored[1] && scored[1].score === scored[0].score) return null;
    return scored[0].candidate;
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
    return form === 'tu' || form === 'vos' ? 'tu' : 'usted';
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
                ? `${tu ? '¿Confirmas que quieres cancelar' : '¿Confirma que desea cancelar'} ${S('appointment')} de ${c.label} del ${when(c, 'es')} (Ref. ${c.ref})?`
                : `${tu ? '¿Confirmas que quieres cancelar' : '¿Confirma que desea cancelar'} ${S('order')} (Ref. ${c.ref}): ${c.label}${c.total ? `, total ${c.total}` : ''}?`,
            proposeReschedule: (c, t) => `${tu ? '¿Confirmas que movamos' : '¿Confirma que movamos'} ${S('appointment')} de ${c.label} (Ref. ${c.ref}) del ${when(c, 'es')} al ${when({ ...c, date: t.date, time: t.time }, 'es')}?`,
            askTarget: c => `${tu ? '¿Para qué día y hora quieres' : '¿Para qué día y hora desea'} mover ${S('appointment')} de ${c.label} (Ref. ${c.ref}), hoy ${tu ? 'programada' : 'programada'} el ${when(c, 'es')}?`,
            slotTaken: (t, alts) => `${formatDay(t.date, 'es')} a las ${t.time} no está disponible.${alts.length ? ` ${tu ? 'Tengo libre' : 'Tengo libre'}: ${alt(alts)}.` : ''} ${tu ? '¿Qué otro día u hora te sirve?' : '¿Qué otro día u hora le sirve?'}`,
            doneCancel: (domain, ref, alts) => `${domain === 'appointment' ? 'Su cita' : 'Su pedido'} (Ref. ${ref}) quedó cancelad${domain === 'appointment' ? 'a' : 'o'}.`.replace('Su ', tu ? 'Tu ' : 'Su ')
                + (alts.length ? ` ${tu ? 'Si quieres volver a agendar, tengo libre' : 'Si desea volver a agendar, tengo libre'}: ${alt(alts)}.` : ''),
            doneReschedule: (ref, t) => `${tu ? 'Tu' : 'Su'} cita (Ref. ${ref}) quedó reprogramada para el ${formatDay(t.date, 'es')} a las ${t.time}.`,
            ambiguous: options => `Hay más de una gestión posible: ${options.map(o => S(o)).join(' o ')}. ${tu ? '¿Sobre cuál quieres continuar?' : '¿Sobre cuál desea continuar?'}`,
        },
        en: {
            noAppointments: () => 'You have no upcoming appointments. Would you like to book one?',
            noOrders: () => 'I do not find any orders of yours that can be cancelled.',
            notCancellable: c => `Order ${c.ref} can no longer be cancelled in this chat. Would you like me to ask someone from the team to review it?`,
            list: cs => `You have ${cs.length === 1 ? 'one appointment' : `${cs.length} appointments`}:\n${cs.map(c => line(c, 'appointment', 'en')).join('\n')}\nWould you like to cancel or move one?`,
            askWhich: (verb, domain, cs) => `You have ${cs.length} ${domain === 'appointment' ? 'appointments' : 'orders'}:\n${cs.map(c => line(c, domain, 'en')).join('\n')}\nWhich one would you like to ${verb === 'cancel' ? 'cancel' : 'move'}? Tell me the reference${domain === 'appointment' ? ', or the day and time' : ''}.`,
            proposeCancel: (domain, c) => domain === 'appointment'
                ? `Do you confirm you want to cancel your ${c.label} appointment on ${when(c, 'en')} (Ref. ${c.ref})?`
                : `Do you confirm you want to cancel your order (Ref. ${c.ref}): ${c.label}${c.total ? `, total ${c.total}` : ''}?`,
            proposeReschedule: (c, t) => `Do you confirm we move your ${c.label} appointment (Ref. ${c.ref}) from ${when(c, 'en')} to ${when({ ...c, date: t.date, time: t.time }, 'en')}?`,
            askTarget: c => `Which day and time would you like to move your ${c.label} appointment (Ref. ${c.ref}), currently on ${when(c, 'en')}, to?`,
            slotTaken: (t, alts) => `${formatDay(t.date, 'en')} at ${t.time} is not available.${alts.length ? ` Free: ${alt(alts)}.` : ''} What other day or time works for you?`,
            doneCancel: (domain, ref, alts) => `Your ${domain === 'appointment' ? 'appointment' : 'order'} (Ref. ${ref}) has been cancelled.${alts.length ? ` If you want to book again, these are free: ${alt(alts)}.` : ''}`,
            doneReschedule: (ref, t) => `Your appointment (Ref. ${ref}) has been moved to ${formatDay(t.date, 'en')} at ${t.time}.`,
            ambiguous: options => `There is more than one possible task: ${options.map(o => D(o)).join(' or ')}. Which one would you like to continue?`,
        },
        pt: {
            noAppointments: () => 'Você não tem agendamentos próximos. Quer agendar um?',
            noOrders: () => 'Não encontro pedidos seus que possam ser cancelados.',
            notCancellable: c => `O pedido ${c.ref} não pode mais ser cancelado por este chat. Quer que eu peça a alguém da equipe para revisar?`,
            list: cs => `Você tem ${cs.length === 1 ? 'um agendamento' : `${cs.length} agendamentos`}:\n${cs.map(c => line(c, 'appointment', 'pt')).join('\n')}\nQuer cancelar ou mudar algum?`,
            askWhich: (verb, domain, cs) => `Você tem ${cs.length} ${domain === 'appointment' ? 'agendamentos' : 'pedidos'}:\n${cs.map(c => line(c, domain, 'pt')).join('\n')}\nQual você quer ${verb === 'cancel' ? 'cancelar' : 'mudar'}? Informe a referência${domain === 'appointment' ? ', ou o dia e a hora' : ''}.`,
            proposeCancel: (domain, c) => domain === 'appointment'
                ? `Confirma que quer cancelar o agendamento de ${c.label} em ${when(c, 'pt')} (Ref. ${c.ref})?`
                : `Confirma que quer cancelar o pedido (Ref. ${c.ref}): ${c.label}${c.total ? `, total ${c.total}` : ''}?`,
            proposeReschedule: (c, t) => `Confirma que mudemos o agendamento de ${c.label} (Ref. ${c.ref}) de ${when(c, 'pt')} para ${when({ ...c, date: t.date, time: t.time }, 'pt')}?`,
            askTarget: c => `Para que dia e hora quer mudar o agendamento de ${c.label} (Ref. ${c.ref}), hoje em ${when(c, 'pt')}?`,
            slotTaken: (t, alts) => `${formatDay(t.date, 'pt')} às ${t.time} não está disponível.${alts.length ? ` Livres: ${alt(alts)}.` : ''} Que outro dia ou hora serve para você?`,
            doneCancel: (domain, ref, alts) => `${domain === 'appointment' ? 'O seu agendamento' : 'O seu pedido'} (Ref. ${ref}) foi cancelado.${alts.length ? ` Se quiser agendar de novo, estão livres: ${alt(alts)}.` : ''}`,
            doneReschedule: (ref, t) => `O seu agendamento (Ref. ${ref}) foi mudado para ${formatDay(t.date, 'pt')} às ${t.time}.`,
            ambiguous: options => `Há mais de uma tarefa possível: ${options.map(o => D(o)).join(' ou ')}. Sobre qual deseja continuar?`,
        },
        fr: {
            noAppointments: () => 'Vous n’avez aucun rendez-vous à venir. Souhaitez-vous en prendre un ?',
            noOrders: () => 'Je ne trouve aucune commande de votre part pouvant être annulée.',
            notCancellable: c => `La commande ${c.ref} ne peut plus être annulée par ce chat. Souhaitez-vous que je demande à quelqu’un de l’équipe de la vérifier ?`,
            list: cs => `Vous avez ${cs.length === 1 ? 'un rendez-vous' : `${cs.length} rendez-vous`} :\n${cs.map(c => line(c, 'appointment', 'fr')).join('\n')}\nSouhaitez-vous en annuler ou en déplacer un ?`,
            askWhich: (verb, domain, cs) => `Vous avez ${cs.length} ${domain === 'appointment' ? 'rendez-vous' : 'commandes'} :\n${cs.map(c => line(c, domain, 'fr')).join('\n')}\nLequel souhaitez-vous ${verb === 'cancel' ? 'annuler' : 'déplacer'} ? Indiquez la référence${domain === 'appointment' ? ', ou le jour et l’heure' : ''}.`,
            proposeCancel: (domain, c) => domain === 'appointment'
                ? `Confirmez-vous l’annulation de votre rendez-vous ${c.label} du ${when(c, 'fr')} (Réf. ${c.ref}) ?`
                : `Confirmez-vous l’annulation de votre commande (Réf. ${c.ref}) : ${c.label}${c.total ? `, total ${c.total}` : ''} ?`,
            proposeReschedule: (c, t) => `Confirmez-vous le déplacement de votre rendez-vous ${c.label} (Réf. ${c.ref}) du ${when(c, 'fr')} au ${when({ ...c, date: t.date, time: t.time }, 'fr')} ?`,
            askTarget: c => `Pour quel jour et quelle heure souhaitez-vous déplacer votre rendez-vous ${c.label} (Réf. ${c.ref}), actuellement le ${when(c, 'fr')} ?`,
            slotTaken: (t, alts) => `Le ${formatDay(t.date, 'fr')} à ${t.time} n’est pas disponible.${alts.length ? ` Disponibles : ${alt(alts)}.` : ''} Quel autre jour ou horaire vous convient ?`,
            doneCancel: (domain, ref, alts) => `${domain === 'appointment' ? 'Votre rendez-vous' : 'Votre commande'} (Réf. ${ref}) a été annulé${domain === 'appointment' ? '' : 'e'}.${alts.length ? ` Pour reprendre rendez-vous, disponibles : ${alt(alts)}.` : ''}`,
            doneReschedule: (ref, t) => `Votre rendez-vous (Réf. ${ref}) a été déplacé au ${formatDay(t.date, 'fr')} à ${t.time}.`,
            ambiguous: options => `Plusieurs démarches sont possibles : ${options.map(o => D(o)).join(' ou ')}. Laquelle souhaitez-vous poursuivre ?`,
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
        const candidates = orderCandidates(listed);
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
    const target = chooseCandidate(text, candidates);
    if (!target) return { handled: true, text: T.askWhich(request.verb, 'appointment', candidates), awaitingWriter: writer, executed };

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
    if (target.serviceId) {
        const availability = await io.execute('check_availability', { date: when2.date, serviceId: target.serviceId, ...(target.staffId ? { staffId: target.staffId } : {}) });
        executed.push({ name: 'check_availability', result: availability });
        const slots: any[] = Array.isArray(availability?.slots) ? availability.slots : [];
        if (!availability?.error && Array.isArray(availability?.slots)) {
            const times = slots.map(slot => String(slot?.time ?? '')).filter(Boolean);
            if (!times.includes(when2.time)) {
                return { handled: true, text: T.slotTaken(when2, [...new Set(times)].slice(0, 4)), awaitingWriter: writer, executed };
            }
        }
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
