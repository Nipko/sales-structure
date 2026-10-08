import { normalizeForIntent } from '@parallext/shared';

/**
 * «¿En qué quedó mi cita?», «¿ya está?», «¿quedó?», «what happened with my booking?»: the customer asks where the
 * booking stands. Nothing about the proposal on the table changes, so it must neither renew the confirmation nor be
 * read as an answer to it: the following «sí» still belongs to the same proposal.
 *
 * Narrow on purpose: a short QUESTION about the state of the booking. A question about a price, a schedule or a policy
 * is not one (it can change what the customer is agreeing to).
 */
const STATUS_OPENER = /\b(?:en que quedo|en que va|como va|como quedo|que paso con|que paso|ya quedo|quedo (?:agendad|confirmad|reservad|listo|lista)\w*|ya esta(?: (?:listo|lista|confirmad|agendad|reservad))?|esta (?:confirmad|agendad|reservad|listo|lista)\w*|ya (?:me )?(?:agendaste|reservaste|confirmaste|agendo|reservo|confirmo)|sigue pendiente|alguna novedad|alguna noticia|what happened|what(?:'s| is) the status|is it (?:booked|confirmed|done|set)|is (?:it|that) all set|did it (?:go through|work)|any news|where (?:are we|is it)|how(?:'s| is) (?:my|the) (?:booking|appointment)|ja esta|ja ficou|ficou (?:agendad|confirmad|marcad)\w*|como esta (?:o meu|meu|a minha|minha)|est ce que c est (?:bon|fait|confirme|reserve)|c est bon|ou en est|ca y est)\b/;
const BOOKING_WORDS = /\b(?:cita|reserva|turno|agendamiento|appointment|booking|reservation|agendamento|consulta|rendez vous|agendaste|reservaste|confirmaste)\b/;

export function isBookingStatusQuestion(text: unknown): boolean {
    const raw = String(text ?? '').trim();
    if (!raw || raw.length > 80) return false;
    const normalized = normalizeForIntent(raw).replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/'/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized) return false;
    const isQuestion = /[?¿]/.test(raw)
        || /^(?:en que quedo|en que va|como va|como quedo|que paso|alguna novedad|what happened|how is|how s|any news|where are we|ou en est)\b/.test(normalized);
    if (!isQuestion) return false;
    if (/^(?:ya )?quedo$/.test(normalized)) return true;
    if (!STATUS_OPENER.test(normalized)) return false;
    // A status question is about the booking, not about money, hours or anything else being asked at the same time.
    if (/\b(?:precio|cuesta|cuanto|costo|cobran|pago|pagar|descuento|horario|abren|cierran|price|cost|how much|discount|hours|open|close|preco|prix|combien)\b/.test(normalized)) return false;
    // «¿ya está?» / «¿quedó?» say it all alone; anything longer has to name the booking or be one of the openers.
    // Not about something else being "ready", "open" or "going": «¿ya está abierto?», «¿cómo va el clima?», «¿qué pasó con mi pedido?».
    if (/\b(?:abiert\w*|cerrad\w*|clima|pedido|todo|toda|todos|open|closed|weather|order|everything|tudo|commande|tout|compra|pago)\b/.test(normalized)) return false;
    return normalized.split(' ').length <= 3 || BOOKING_WORDS.test(normalized) || /\b(?:en que quedo|que paso con) (?:eso|esto)\b/.test(normalized);
}
