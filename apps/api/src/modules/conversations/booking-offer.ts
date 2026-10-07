/**
 * The model's reply offers to book ("¿Le gustaría agendar una cita para ese servicio?",
 * "Would you like to book", "gostaria de agendar", "voulez-vous réserver"). While the mission is
 * only an interest, a bare "ok"/"perfecto" right after this offer is the customer accepting it.
 * Heuristic and multilingual; it must be a question.
 */
const OFFER: readonly RegExp[] = [
    /\b(?:le gustaria|te gustaria|desea|deseas|quiere|quieres|quisiera|prefiere|prefieres|podemos|puedo|le reservo|te reservo|le agendo|te agendo)\b[^.?!]{0,50}\b(?:agendar|reservar|reserve|reservo|agende|agendo|apartar|programar|separar)\b/,
    /\b(?:would you like|do you want|shall i|want me to|can i|should i)\b[^.?!]{0,40}\b(?:book|schedule|reserve|set up|arrange)\b/,
    /\b(?:gostaria de|quer|deseja|posso|quer que eu)\b[^.?!]{0,40}\b(?:agendar|marcar|reservar|agende|marque|reserve)\b/,
    /\b(?:voulez vous|souhaitez vous|puis je|dois je)\b[^.?!]{0,40}\b(?:reserver|prendre rendez vous|planifier|reserve)\b/,
];

export const BOOKING_OFFER_TTL_MS = 15 * 60 * 1000;

export function containsBookingOffer(reply: unknown): boolean {
    const raw = String(reply ?? '');
    if (!/[?¿]/.test(raw)) return false;
    const text = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’-]/g, ' ');
    return OFFER.some(re => re.test(text));
}
