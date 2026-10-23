import { claimsTeamRequest, offersHumanHandoff, promisesHumanHandoff, removeHandoffPromiseSentences, teamRequestBacked } from '../../common/utils/outcome-claim.util';

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

/**
 * Words that ask the agent to go ahead with what it offered: «pídanle», «consúltelo», «hazlo», «go ahead», «pode pedir»,
 * «allez-y». Customer-typed, accents folded. Kept to verbs of asking, checking, confirming, contacting and doing, so a
 * message that asks for something ELSE («sí, pero antes dime el precio») is never an acceptance.
 */
const ACCEPT_REQUEST = new Set([
    // es (usted / ustedes / tú)
    'pidanle', 'pidale', 'pidales', 'pidan', 'pida', 'pideles', 'pidele', 'pidelo', 'pidanlo',
    'pregunten', 'preguntenle', 'pregunte', 'preguntele', 'preguntales', 'pregunteles',
    'consulte', 'consultelo', 'consultela', 'consulten', 'consultenlo', 'consultalo', 'consultala', 'consultele',
    'confirme', 'confirmen', 'confirmenlo', 'confirmelo', 'confirmela', 'confirmar', 'confirmarlo', 'confirmalo',
    'averigue', 'averiguelo', 'averiguen', 'averigualo', 'revise', 'reviselo', 'revisen',
    'hazlo', 'hagalo', 'haganlo', 'hagale', 'hagan', 'haga', 'proceda', 'procedan', 'procede', 'adelante',
    'avisen', 'avisenle', 'avise', 'aviseles', 'contacte', 'contacten', 'contactenme', 'conecteme', 'conectame', 'comuniqueme', 'paseme',
    // en
    'go', 'ahead', 'do', 'it', 'ask', 'check', 'confirm', 'contact', 'connect', 'them', 'that', 'thats', 'fine', 'would', 'be',
    // pt
    'pedir', 'preguntar', 'consultar', 'perguntar', 'verificar',
    'pode', 'pede', 'peca', 'pergunte', 'pergunta', 'confirme', 'verifique', 'faca', 'faz', 'isso', 'manda', 'chame',
    // fr
    'allez', 'y', 'vas', 'demandez', 'leur', 'lui', 'verifiez', 'confirmez', 'faites', 'le', 'la',
]);
/** Pronouns and courtesy that go with such a request («que lo confirme», «por usted», «a alguien del equipo»). */
const ACCEPT_REQUEST_FILL = new Set([
    'que', 'lo', 'la', 'le', 'les', 'los', 'me', 'se', 'mi', 'a', 'al', 'el', 'del', 'equipo', 'alguien', 'persona', 'usted', 'ustedes',
    'ellos', 'mismo', 'ahora', 'ya', 'nomas', 'tambien', 'eso', 'esto', 'mucho', 'muchas',
    'me', 'to', 'for', 'please', 'someone', 'team', 'the', 'now', 'sure', 'yes', 'ok', 'okay', 'thanks',
    'por', 'favor', 'pra', 'para', 'mim', 'alguem', 'da', 'equipe', 'agora', 'sim', 'obrigado', 'obrigada',
    'oui', 's', 'il', 'vous', 'plait', 'merci', 'de', 'l', 'equipe', 'quelqu', 'un', 'maintenant',
]);
/** Words that make a «sí» something else: a refusal, a condition, a question about something other than the offer. */
const ACCEPT_BLOCKERS = new Set(['no', 'not', 'nao', 'non', 'pas', 'nunca', 'never', 'pero', 'but', 'mas', 'mais', 'antes', 'before', 'avant', 'primero', 'first', 'mejor', 'better', 'despues', 'later', 'luego']);

/**
 * The customer accepts the offer of a person: a bare agreement («sí», «dale», «yes please») or one that tells the agent
 * to go ahead («Sí, por favor pídanle que lo confirme», «ok hazlo», «por favor consúltelo», «yes, go ahead and ask
 * them», «sim, pode pedir», «oui, allez-y»). Production (Telegram, travel): «Sí, por favor pídanle que lo confirme» had
 * seven words, `isAffirmation` stops at four, so the accepted offer was read as nobody asking and was offered again.
 * A question, a negation or a condition («sí, pero antes…») is never an acceptance.
 */
export function isOfferAcceptance(text: unknown): boolean {
    if (isAffirmation(text)) return true;
    if (typeof text !== 'string' || /[?？¿]/.test(text)) return false;
    const tokens = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[’']/g, ' ').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || tokens.length > 10) return false;
    if (tokens.some(t => ACCEPT_BLOCKERS.has(t))) return false;
    const known = (t: string) => AFFIRM_CORE.has(t) || AFFIRM_FILL.has(t) || ACCEPT_REQUEST.has(t) || ACCEPT_REQUEST_FILL.has(t);
    if (!tokens.every(known)) return false;
    // Something must say yes or ask for it: «por favor» alone, «que lo» or «the team» are not an acceptance.
    return tokens.some(t => AFFIRM_CORE.has(t) && !['favor', 'please', 'plait', 'gusto'].includes(t))
        || tokens.some(t => ACCEPT_REQUEST.has(t) && !['it', 'that', 'them', 'be', 'would', 'fine', 'y', 'le', 'la', 'leur', 'lui', 'isso'].includes(t));
}

/** The sentences of a message, emoji-only and empty segments left out. */
function sentencesOf(text: string): string[] {
    return text.split(/(?<=[.!?…])\s+|\n+/).map(s => s.trim()).filter(s => /\p{L}/u.test(s));
}

/**
 * The message ends by offering a person, so a «sí» answers that offer: one of our fixed offers, or the model's own words
 * as the LAST sentence («¿Quiere que le pida a alguien del equipo que lo confirme por usted?», «¿Le conecto con un
 * asesor?», «Would you like me to check with someone from the team?»). An offer followed by another question
 * («…¿O prefiere ver otro modelo?») does not count: the «sí» would answer that one.
 */
export function endsWithHumanOffer(text: unknown): boolean {
    if (typeof text !== 'string' || !text.trim()) return false;
    if (containsHumanOffer(text) || isHumanOfferText(text)) return true;
    const sentences = sentencesOf(text);
    const last = sentences[sentences.length - 1];
    return !!last && offersHumanHandoff(last);
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
    return isOfferAcceptance(userText)
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
    // The offer is the ONE question of the reply. Production (travel): «¿Desea que le ayude con algo más mientras tanto?»
    // stayed in front of the appended offer, two questions in a row, and a «sí» could answer either.
    const statements = withoutQuestions(kept);
    return statements ? `${statements}\n\n${humanOfferQuestionText(lang)}` : noDataWaitReplacementText(lang);
}

/**
 * The text without its questions. A sentence that states something before its «¿…?» keeps the statement («Tenemos
 * tres modelos, ¿cuál prefiere?» → «Tenemos tres modelos.»); a question with nothing before it goes whole.
 */
export function withoutQuestions(text: string): string {
    const parts = text.split(/((?<=[.!?…])[ \t]+|\n+)/);
    let out = '';
    let pendingSeparator = '';
    for (let i = 0; i < parts.length; i += 2) {
        let sentence = parts[i];
        const separator = parts[i + 1] ?? '';
        if (/[?？]/.test(sentence)) {
            const opening = sentence.indexOf('¿');
            sentence = opening > 0 ? sentence.slice(0, opening).replace(/[\s,;:—–-]+$/, '') : '';
            // «Mientras tanto, ¿…?» leaves a connector, not a statement: only a figure or a clause of four words stays.
            if (!/\d/.test(sentence) && sentence.trim().split(/\s+/).length < 4) sentence = '';
            if (sentence && !/[.!…]$/.test(sentence)) sentence += '.';
        }
        if (!/[\p{L}\d]/u.test(sentence)) {
            // An emoji-only or emptied segment. Its own separator goes with it; a line break that preceded it stays.
            pendingSeparator = pendingSeparator.includes('\n') ? pendingSeparator : separator.includes('\n') ? separator : pendingSeparator;
            continue;
        }
        out += (out ? (pendingSeparator || ' ') : '') + sentence;
        pendingSeparator = separator;
    }
    return out.trim();
}

/**
 * What the turn does with a reply that says the customer's request already went to the team («He registrado su consulta
 * para que alguien del equipo confirme…», «I've passed your request to the team», «Le avisaré en cuanto tenga la respuesta»):
 *   · `none`: no such claim, a transfer promise the existing handoff branches already decide, a fixed system text, or a
 *     receipt of THIS turn makes it true (a created follow-up task, a tool that asked for a person);
 *   · `replay_rewrite`: the replay of an unattended handoff never transfers again, so the claim goes;
 *   · `honour`: the customer asked for a person or accepted the offer of one («Sí, por favor»), so the handoff is opened
 *     and the claim becomes true;
 *   · `rewrite_offer`: nobody asked, so the claim becomes the offer in question form (`offerInsteadOfPromise`).
 * `ensure_crm_lead` is never a receipt: a lead is not a request the team will act on.
 */
export type TeamRequestClaimAction = 'none' | 'replay_rewrite' | 'honour' | 'rewrite_offer';
export function teamRequestClaimAction(input: {
    reply: unknown; executed?: ReadonlyArray<{ name?: string; result?: any }>;
    customerAuthorized: boolean; replay?: boolean; fixedText?: boolean;
}): TeamRequestClaimAction {
    if (input.fixedText || typeof input.reply !== 'string' || !claimsTeamRequest(input.reply)) return 'none';
    if (promisesHumanHandoff(input.reply) || teamRequestBacked(input.executed)) return 'none';
    if (input.replay) return 'replay_rewrite';
    return input.customerAuthorized ? 'honour' : 'rewrite_offer';
}
