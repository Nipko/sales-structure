import { normalizeForIntent } from '@parallext/shared';

/**
 * A request to change an appointment that ALREADY EXISTS («reprogramar mi cita», «cambiar mi cita al viernes», «move my
 * appointment», «déplacer mon rendez-vous»). It is not a new booking: the booking engine only creates, and the mission
 * arbiter must hand the turn to the appointment tools (reschedule_appointment, after the normal confirmation), never to
 * the engine, or the customer ends up with a second appointment.
 *
 *  - 'explicit': a verb that can only mean changing an existing appointment (reprogramar, reagendar, remarcar, reschedule,
 *    reporter, remarcar…). Always a transition.
 *  - 'ambiguous': a generic verb («cambiar», «mover», «pasar», «change», «move») on «mi cita». It is a transition unless a
 *    booking draft is being built, where «cambia la hora» corrects the draft.
 */
const EXPLICIT_VERB = '(?:reprogram\\w*|reagend\\w*|remarc\\w*|reschedul\\w*|rebook\\w*|reporter|reportez|decaler|decalez|replanifi\\w*)';
const GENERIC_VERB = '(?:cambi\\w*|mover|muev\\w*|mov(?:e|ing|er)|pasar(?:la|lo|me)?|pasa|pase|chang\\w*|shift\\w*|deplac\\w*|modifi\\w*|mud(?:ar|e|a)|alterar|altere|trocar|adiantar|atrasar|postpon\\w*|posponer\\w*|aplazar\\w*|adelantar\\w*)';
const MY_APPOINTMENT = '(?:mi|mis|la|el|esa|ese|esta|este|my|the|that|this|mon|ma|minha|meu|a|o|nuestra|su|votre)\\s+(?:proxima\\s+|next\\s+|prochaine?\\s+)?(?:cita|citas|turno|consulta|appointment|appointments|booking|rendez vous|agendamento)\\b';
const OTHER_DOMAIN = /\b(?:pedido|orden de compra|order|commande|encomenda|curso|course|matricula|clase|class|tour|habitacion|room|reparacion|repair)\b/;

const EXPLICIT_RE = new RegExp(`\\b${EXPLICIT_VERB}\\b`);
const GENERIC_NEAR_RE = new RegExp(`\\b${GENERIC_VERB}\\b(?:\\s+\\w+){0,4}?\\s+${MY_APPOINTMENT}`);
/** «cambiar de cita» / «mudar de consulta» / «changer de rendez-vous»: the appointment itself, with no determiner. «Cambiar de servicio» is not one. */
const CHANGE_OF_APPOINTMENT_RE = /\b(?:cambi\w*|mud(?:ar|e|a)|troc(?:ar|a)|chang(?:er|ez|e))\s+(?:de|d|of)\s+(?:cita|citas|turno|consulta|appointment|rendez vous|agendamento)\b/;
const APPOINTMENT_NOUN_RE = /\b(?:cita|citas|turno|consulta|appointment|appointments|rendez vous|agendamento)\b/;

export type AppointmentChange = 'explicit' | 'ambiguous' | null;

const NEGATOR = /\b(?:no|nunca|jamas|ni|not|never|nao|non|pas|n|sin|won t|wont|don t|dont|can t|cant|cannot|didn t)\b/;
/**
 * Past, passive and third-person forms of the verbs («me cancelaron la cita», «me cambiaron el turno», «ya cancelé»): someone
 * ELSE did it, or it is done. Tested on the raw text because the accent is the tense (cancelé ≠ cancele).
 */
export const REPORTED_OR_PAST = /\b(?:cancel|cambi|mov|reprogram|reagend|anul|remarc)(?:é|ó|ió)(?![a-záéíóúüñ])|\b(?:cancel|cambi|mov|reprogram|reagend|anul|remarc|aplaz|pospus)\w*(?:aron|ieron|aste|ado|ada|ados|adas|ido|ida)\b|\bme (?:cancelan|cambian|mueven|reprograman|anulan)\b/i;

/** Is the verb at `index` of the clause-punctuated text negated: a negator in the four words before it, with no clause break between. */
/**
 * Accents folded and lower-cased, PUNCTUATION KEPT: `normalizeForIntent` turns commas into spaces and drops the final mark, and a clause
 * break («no, mejor muévela») is exactly what separates a negator from the verb it does not negate.
 */
export function foldKeepingPunctuation(raw: unknown): string {
    return String(raw ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function negatedAt(clauses: string, index: number): boolean {
    const clause = clauses.slice(0, index).split(/[,.;!?¿¡]/).pop() ?? '';
    const words = clause.replace(/['’]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(-4).join(' ');
    return NEGATOR.test(words);
}

export function appointmentChangeRequest(text: unknown): AppointmentChange {
    const raw = String(text ?? '');
    if (!raw.trim() || raw.length > 400) return null;
    const normalized = normalizeForIntent(raw).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized) return null;
    // A question about changing («¿puedo reprogramar?») is still routed: the model answers it with the real tools.
    if (OTHER_DOMAIN.test(normalized) && !APPOINTMENT_NOUN_RE.test(normalized)) return null;
    // «No quiero reprogramar, solo confirmar que voy» / «me cambiaron la cita»: not a request to change it.
    if (REPORTED_OR_PAST.test(raw.toLowerCase().normalize('NFC'))) return null;
    const clauses = foldKeepingPunctuation(raw).replace(/[^\p{L}\p{N}\s,.;!?¿¡']/gu, ' ').replace(/\s+/g, ' ').trim();
    const negated = (re: RegExp) => { const m = re.exec(clauses); return !!m && negatedAt(clauses, m.index); };
    if (EXPLICIT_RE.test(normalized)) {
        // «reprogramar» alone, or on an appointment noun/possessive: an existing appointment.
        return negated(EXPLICIT_RE) ? null : 'explicit';
    }
    if (GENERIC_NEAR_RE.test(normalized) || CHANGE_OF_APPOINTMENT_RE.test(normalized)) {
        return negated(GENERIC_NEAR_RE) || negated(CHANGE_OF_APPOINTMENT_RE) ? null : 'ambiguous';
    }
    return null;
}
