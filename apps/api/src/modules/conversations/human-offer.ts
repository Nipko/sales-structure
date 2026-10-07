import { offersHumanHandoff, removeHandoffPromiseSentences } from '../../common/utils/outcome-claim.util';

/**
 * The honest "I don't have that confirmed" reply offers a person from the team.
 * A "yes" to that offer must produce a REAL handoff whatever the model says
 * next ("Listo, le aviso al equipo" is a paraphrase nothing would execute), so
 * the offer leaves a short-lived mark on the conversation and the next inbound
 * message is judged against it deterministically.
 */
export const HUMAN_OFFER_MARK = 'pendingHumanOffer';
export const HUMAN_OFFER_TTL_MS = 15 * 60 * 1000;

export const NO_DATA_WAIT_REPLACEMENT: Record<string, string> = {
    es: 'No tengo ese dato confirmado en este momento. ¿Quiere que le pida a una persona del equipo que lo confirme?',
    en: 'I don’t have that information confirmed right now. Would you like me to ask someone from the team to confirm it?',
    pt: 'Não tenho essa informação confirmada neste momento. Quer que eu peça a alguém da equipe para confirmar?',
    fr: "Je n'ai pas cette information confirmée pour le moment. Souhaitez-vous que je demande à quelqu'un de l'équipe de la confirmer ?",
};

/** Only the offer, as a question: for a reply that already says everything else it has to say. */
export const HUMAN_OFFER_QUESTION: Record<string, string> = {
    es: '¿Quiere que le pida a una persona del equipo que lo confirme?',
    en: 'Would you like me to ask someone from the team to confirm it?',
    pt: 'Quer que eu peça a alguém da equipe para confirmar?',
    fr: "Souhaitez-vous que je demande à quelqu'un de l'équipe de la confirmer ?",
};
/**
 * The offer that follows the answer to a refund / return policy question: the
 * agent states the policy and the customer who wants the refund itself says yes
 * once, instead of being escalated without asking.
 */
export const POLICY_PERSON_OFFER_QUESTION: Record<string, string> = {
    es: '¿Desea que le pida a una persona del equipo que se encargue de su caso?',
    en: 'Would you like me to ask someone from the team to take care of your case?',
    pt: 'Deseja que eu peça a alguém da equipe para cuidar do seu caso?',
    fr: "Souhaitez-vous que je demande à quelqu'un de l'équipe de s'occuper de votre dossier ?",
};
export const policyPersonOfferText = (lang?: string): string =>
    POLICY_PERSON_OFFER_QUESTION[(lang || 'es').slice(0, 2).toLowerCase()] || POLICY_PERSON_OFFER_QUESTION.es;

/** True when the reply's last sentence is a question (a "sí" would answer THAT one). */
export function endsWithQuestion(text: unknown): boolean {
    return typeof text === 'string' && /[?？]["'”’)\]\s]*$/.test(text.trimEnd());
}

/**
 * The reply to a policy question, followed by the offer of a person. Left alone
 * when it already offers one, and when it already ends with a question of its
 * own: two questions in a row would make the customer's "sí" ambiguous.
 */
export function withPolicyPersonOffer(response: string, lang?: string): string {
    if (!response || !response.trim()) return response;
    if (containsHumanOffer(response) || offersHumanHandoff(response) || endsWithQuestion(response)) return response;
    return `${response.trimEnd()}\n\n${policyPersonOfferText(lang)}`;
}

export const humanOfferQuestionText = (lang?: string): string =>
    HUMAN_OFFER_QUESTION[(lang || 'es').slice(0, 2).toLowerCase()] || HUMAN_OFFER_QUESTION.es;

export const noDataWaitReplacementText = (lang?: string): string =>
    NO_DATA_WAIT_REPLACEMENT[(lang || 'es').slice(0, 2).toLowerCase()] || NO_DATA_WAIT_REPLACEMENT.es;

/** Same fact, with NO offer: used when no person can be reached from this conversation. */
export const NO_DATA_NO_OFFER: Record<string, string> = {
    es: 'No tengo ese dato confirmado en este momento.',
    en: 'I don’t have that information confirmed right now.',
    pt: 'Não tenho essa informação confirmada neste momento.',
    fr: "Je n'ai pas cette information confirmée pour le moment.",
};
export const noDataNoOfferText = (lang?: string): string =>
    NO_DATA_NO_OFFER[(lang || 'es').slice(0, 2).toLowerCase()] || NO_DATA_NO_OFFER.es;

/**
 * The wording these offers had before the platform spoke to customers with «usted»
 * («¿Quieres que le pida…»). A conversation that was offered a person with the old words
 * must still read its customer's «sí» as accepting that offer for the 15 minutes the offer
 * lives, so the detectors keep recognising them.
 */
const LEGACY_HUMAN_OFFER_QUESTION = '¿Quieres que le pida a una persona del equipo que lo confirme?';
const LEGACY_NO_DATA_WAIT_REPLACEMENT =
    'No tengo ese dato confirmado en este momento. ¿Quieres que le pida a una persona del equipo que lo confirme?';

/** True when the stored outbound text contains one of our offers. */
export function containsHumanOffer(text: unknown): boolean {
    return typeof text === 'string' && [
        ...Object.values(HUMAN_OFFER_QUESTION), ...Object.values(POLICY_PERSON_OFFER_QUESTION), LEGACY_HUMAN_OFFER_QUESTION,
    ].some(o => text.includes(o));
}

export function isHumanOfferText(text: unknown): boolean {
    if (typeof text !== 'string') return false;
    const t = text.trim();
    return t === LEGACY_NO_DATA_WAIT_REPLACEMENT || Object.values(NO_DATA_WAIT_REPLACEMENT).some(o => o === t);
}

const AFFIRM_CORE = new Set([
    'si', 'sii', 'claro', 'dale', 'ok', 'okay', 'vale', 'listo', 'bueno', 'perfecto', 'correcto', 'porfa',
    'yes', 'yeah', 'yep', 'sure', 'please', 'sim', 'pode', 'oui', 'ouais', 'accord', 'volontiers',
    'quiero', 'quero', 'gusto', 'favor', 'plait',
]);
const AFFIRM_FILL = new Set([
    'por', 'favor', 'gracias', 'thanks', 'thank', 'you', 'merci', 'obrigado', 'obrigada', 'ser', 'de',
    'acuerdo', 'd', 'bien', 'sur', 'con', 'gusto', 'que', 'si', 's', 'il', 'vous', 'plait', 'please',
    'ya', 'pues', 'entonces', 'gracias', 'seria', 'genial', 'great', 'good',
]);

/** A short message that is only agreement ("sí", "dale", "yes please", "sim, por favor"). */
export function isAffirmation(text: unknown): boolean {
    if (typeof text !== 'string') return false;
    const tokens = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || tokens.length > 4) return false;
    return tokens.every(t => AFFIRM_CORE.has(t) || AFFIRM_FILL.has(t)) && tokens.some(t => AFFIRM_CORE.has(t));
}

export type HumanOfferMark = { at: string; expiresAt: string };
export function isLiveHumanOffer(mark: any, now = Date.now()): boolean {
    const exp = mark && typeof mark.expiresAt === 'string' ? Date.parse(mark.expiresAt) : NaN;
    return Number.isFinite(exp) && exp > now;
}

/**
 * A "sí" to an offer of a person that was written in free text (the model's own
 * "Si quiere, le paso con alguien del equipo"), not only to our fixed offer
 * sentence. The previous outbound message must itself offer a person.
 */
export function isAffirmationOfHumanOffer(userText: unknown, previousOutbound: unknown): boolean {
    return isAffirmation(userText)
        && (containsHumanOffer(previousOutbound) || offersHumanHandoff(previousOutbound));
}

/**
 * The honest "nobody from the team is available" notice goes in front of the
 * turn's own answer, in the same message batch. Nothing to say after it (no
 * answer) or an answer owned by an earlier attempt: leave the text as it is.
 */
export function withReturnNotice<T extends string | null | undefined>(notice: string | null | undefined, response: T, answerIsStored: boolean): T | string {
    if (!notice || !response || answerIsStored) return response;
    return `${notice}\n\n${response}`;
}

/**
 * An unsolicited promise of a transfer becomes the offer in question form.
 *   · Something is left after the promise sentence goes: append ONLY the question.
 *     "No tengo ese dato confirmado" next to a reply that just gave the data would
 *     contradict it.
 *   · Nothing is left: the whole honest "no confirmed data" reply and its question.
 *   · No person can be reached (`canOffer` false): keep what is left, or say there is
 *     no confirmed data, and offer nobody.
 */
export function offerInsteadOfPromise(response: string, lang: string | undefined, canOffer: boolean): string {
    const kept = removeHandoffPromiseSentences(response);
    if (!canOffer) return kept || noDataNoOfferText(lang);
    return kept ? `${kept}\n\n${humanOfferQuestionText(lang)}` : noDataWaitReplacementText(lang);
}
