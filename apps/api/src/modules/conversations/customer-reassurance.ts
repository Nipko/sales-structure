import { normalizeForIntent } from '@parallext/shared';

/**
 * «Por favor no cancelen mi cita, voy en camino», «I'm on my way, please keep my appointment»: the customer is TELLING the business
 * they are coming. They ask for nothing the business has to do, so the right answer is an acknowledgement («Perfecto, le esperamos»),
 * never «no puedo darle esa acción por confirmada… ¿quiere que le pida a una persona del equipo?».
 *
 * The model answers these well most of the time, but when its answer claims an outcome nothing backed («su cita sigue confirmada»)
 * the claim guard used to replace it with the generic «I cannot confirm that action» fallback, which ends by offering a person. For
 * this kind of message the fallback is this acknowledgement instead.
 */

const NEGATED_CANCEL = /\bno (?:la |lo |me la |me lo )?(?:vayan a |vaya a |va a |vas a )?(?:cancel\w*|anul\w*|libere\w*|pierd\w*)\b|\b(?:do not|don'?t|dont) (?:cancel|release|give away)\b|\bnao (?:cancele\w*|anule\w*)\b|\bn'?annul\w* pas\b|\bne (?:l')?annul\w* pas\b/;
const ON_MY_WAY = /\b(?:voy (?:en camino|para alla|saliendo|llegando)|ya voy|voy en camino|en camino|ya casi llego|estoy llegando|estoy en camino|vamos en camino|llego (?:en \d+|tarde|un poco tarde)|me (?:demoro|retraso|atraso)|(?:i am|i'?m) (?:on my way|running late|coming|almost there)|on my way|running late|be there in|estou (?:a caminho|chegando)|a caminho|j'?arrive|je suis en route|en route)\b/;
const APPOINTMENT_WORD = /\b(?:cita|turno|reserva|consulta|appointment|booking|reservation|agendamento|rendez vous|reunion)\b/;
/** A message that asks for or asks about something is not only a reassurance. */
const ASKS = /\b(?:quiero|necesito|quisiera|puedo|pueden|podria|podrian|cuanto|cuanta|donde|cuando|como|cambiar|mover|reprogram\w*|want|need|could|can you|where|when|how|quero|preciso|je veux|je voudrais)\b/;

/** The whole message tells the business the customer is coming / keeps the appointment, and asks nothing. */
export function isAttendanceReassurance(raw: unknown): boolean {
    const text = String(raw ?? '');
    if (!text.trim() || text.length > 200 || /[?¿]/.test(text)) return false;
    const folded = normalizeForIntent(text).replace(/[,;]/g, ' ');
    if (ASKS.test(folded)) return false;
    const keeps = NEGATED_CANCEL.test(folded) && APPOINTMENT_WORD.test(folded);
    return keeps || ON_MY_WAY.test(folded);
}

const ACK: Record<string, string> = {
    es: 'Perfecto, le esperamos. Si necesita avisarnos de algún cambio, escríbanos por aquí.',
    en: 'Perfect, we will be expecting you. If anything changes, just write to us here.',
    pt: 'Perfeito, estaremos esperando você. Se algo mudar, é só escrever por aqui.',
    fr: 'Parfait, nous vous attendons. Si quelque chose change, écrivez-nous ici.',
};

export const attendanceAckText = (lang?: string): string => ACK[(lang || 'es').slice(0, 2).toLowerCase()] ?? ACK.es;
