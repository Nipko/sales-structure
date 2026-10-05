import { offersHumanHandoff } from '../../common/utils/outcome-claim.util';

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
    es: 'No tengo ese dato confirmado en este momento. ¿Quieres que le pida a una persona del equipo que lo confirme?',
    en: 'I don’t have that information confirmed right now. Would you like me to ask someone from the team to confirm it?',
    pt: 'Não tenho essa informação confirmada neste momento. Quer que eu peça a alguém da equipe para confirmar?',
    fr: "Je n'ai pas cette information confirmée pour le moment. Souhaitez-vous que je demande à quelqu'un de l'équipe de la confirmer ?",
};

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

/** True when the stored outbound text contains one of our offers. */
export function containsHumanOffer(text: unknown): boolean {
    return typeof text === 'string' && Object.values(NO_DATA_WAIT_REPLACEMENT).some(o => text.includes(o));
}

export function isHumanOfferText(text: unknown): boolean {
    if (typeof text !== 'string') return false;
    const t = text.trim();
    return Object.values(NO_DATA_WAIT_REPLACEMENT).some(o => o === t);
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
    const tokens = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
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
