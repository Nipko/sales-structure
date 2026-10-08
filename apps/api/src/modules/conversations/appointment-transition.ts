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
const APPOINTMENT_NOUN_RE = /\b(?:cita|citas|turno|consulta|appointment|appointments|rendez vous|agendamento)\b/;

export type AppointmentChange = 'explicit' | 'ambiguous' | null;

export function appointmentChangeRequest(text: unknown): AppointmentChange {
    const raw = String(text ?? '');
    if (!raw.trim() || raw.length > 400) return null;
    const normalized = normalizeForIntent(raw).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized) return null;
    // A question about changing («¿puedo reprogramar?») is still routed: the model answers it with the real tools.
    if (OTHER_DOMAIN.test(normalized) && !APPOINTMENT_NOUN_RE.test(normalized)) return null;
    if (EXPLICIT_RE.test(normalized)) {
        // «reprogramar» alone, or on an appointment noun/possessive: an existing appointment.
        return 'explicit';
    }
    if (GENERIC_NEAR_RE.test(normalized)) return 'ambiguous';
    return null;
}
