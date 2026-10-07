import { normalizeCustomerIntent } from '../../common/conversation/intent-normalizer';
import { removeHandoffPromiseSentences } from '../../common/utils/outcome-claim.util';

/**
 * ═══ THE TURN THAT ANSWERS WHAT THE CUSTOMER WROTE WHILE NOBODY ANSWERED ═══
 *
 * After an unattended handoff returns to the agent, `HandoffReturnReplayService`
 * runs the normal inbound turn once more over the waiting messages. That turn is
 * not an ordinary one, and these are the rules it follows:
 *
 *  · It never hands off again by keyword, by a request for a person or by a
 *    custom trigger. The owner's rule is that when nobody answers the agent
 *    resumes and says so; escalating again would give the customer the same
 *    "te estoy transfiriendo" and another ten minutes of silence. What they
 *    asked for is acknowledged instead (see `ReturnAsk`), and a NEW message
 *    asking for a person after the return is an ordinary message: it starts a
 *    new episode.
 *  · It does not treat a bare "sí" as consent to anything proposed before the
 *    handoff: the text spans minutes of waiting, not the answer to the last
 *    question asked.
 *  · It does not repeat in the prompt what the combined text already holds.
 *
 * The turn is recognised by server state AND by the marker the listener put on
 * the message, never by the message alone.
 */

/** What the customer asked for in the words they sent while waiting. */
export type ReturnAsk = 'person' | 'complaint' | 'discount' | 'other';

export interface ReturnReplayTurn {
    /** The handoff episode the replay belongs to (`metadata.handoff.startedAt`). */
    readonly startedAt: string;
}

export const RETURN_REPLAY_MESSAGE_FLAG = 'handoffReturnReplay';

const isTrue = (value: unknown): boolean => value === true || value === 'true';

/**
 * Is this the replay of the handoff that was just returned?
 *
 * The marker on the message is not enough: the conversation must carry the claim
 * the listener took for THIS episode. A webhook redelivery of the original
 * message has no marker, and a stale marker meets a claim for another episode.
 */
export function returnReplayTurn(conversation: any, msg: any): ReturnReplayTurn | null {
    if (msg?.metadata?.[RETURN_REPLAY_MESSAGE_FLAG] !== true) return null;
    const handoff = conversation?.metadata?.handoff;
    if (!handoff || !isTrue(handoff.returnedToAi) || !handoff.startedAt) return null;
    if (String(handoff.returnReplayFor ?? '') !== String(handoff.startedAt)) return null;
    return { startedAt: String(handoff.startedAt) };
}

/** Which kind of request the keyword classifier heard, or null when it heard none. */
export function returnAskOf(reason: string | null | undefined): ReturnAsk | null {
    if (!reason) return null;
    if (reason === 'human_request' || reason === 'customer_accepted_human_offer') return 'person';
    if (reason === 'complaint') return 'complaint';
    if (reason === 'discount_request') return 'discount';
    if (reason.startsWith('custom_trigger:')) return 'other';
    return null;
}

/**
 * Is every line the customer sent a bare confirmation ("sí", "dale", "ok")?
 * Such a text answers whatever was asked last, and after minutes of waiting
 * nobody can say what that was.
 */
export function isBareConsent(text: unknown, country?: string | null): boolean {
    const lines = String(text ?? '').split('\n').map(line => line.trim()).filter(Boolean);
    if (!lines.length) return false;
    return lines.every(line => {
        const intent = normalizeCustomerIntent(line, { country });
        return (intent.intent === 'affirm' || intent.intent === 'acknowledge') && intent.confidence !== 'low';
    });
}

const RECHECK: Record<string, string> = {
    es: 'Ha pasado un rato desde su mensaje y no quiero confirmar nada por error: ¿podría indicarme de nuevo qué necesita?',
    en: 'Some time has passed since your message and I do not want to confirm anything by mistake: could you tell me again what you need?',
    pt: 'Passou um tempo desde a sua mensagem e não quero confirmar nada por engano: poderia me dizer novamente o que precisa?',
    fr: "Un moment s'est écoulé depuis votre message et je ne veux rien confirmer par erreur : pourriez-vous m'indiquer à nouveau ce dont vous avez besoin ?",
};
const NOTE_LEFT: Record<string, string> = {
    es: 'Dejé su solicitud anotada para que el equipo la vea y le contacte cuando esté disponible.',
    en: 'I have left your request noted so the team can see it and contact you when they are available.',
    pt: 'Deixei o seu pedido anotado para que a equipe o veja e entre em contato quando estiver disponível.',
    fr: "J'ai noté votre demande pour que l'équipe la voie et vous contacte lorsqu'elle sera disponible.",
};
const pick = (table: Record<string, string>, lang?: string) =>
    table[String(lang || 'es').slice(0, 2).toLowerCase()] || table.es;

/** The answer to a waiting text that was only a confirmation. */
export function staleConsentReply(lang: string | undefined, noteLeft: boolean): string {
    return noteLeft ? `${pick(NOTE_LEFT, lang)} ${pick(RECHECK, lang)}` : pick(RECHECK, lang);
}

const NOTE_TITLE: Record<Exclude<ReturnAsk, never>, string> = {
    person: 'Cliente pidió hablar con una persona y nadie respondió',
    complaint: 'Cliente expresó una queja y nadie respondió',
    discount: 'Cliente pidió un descuento y nadie respondió',
    other: 'Cliente activó una regla de atención humana y nadie respondió',
};

/** The internal follow-up the team sees when the customer's request went unanswered. */
export function returnNoteTask(ask: ReturnAsk, waitingText: string): { title: string; description: string } {
    const excerpt = String(waitingText || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    return {
        title: NOTE_TITLE[ask],
        description: `Escribió mientras nadie del equipo atendía y el agente retomó la conversación: «${excerpt}»`,
    };
}

/**
 * The agent's own promise of a transfer ("un asesor se comunicará con usted") on a
 * replay turn. The conversation has just come back because nobody answered: honouring
 * the promise would put it in the queue again for another ten minutes. The promise
 * sentence goes; when the request WAS left for the team, one true sentence says so
 * (no time promised); otherwise the rest of the answer stands on its own.
 */
export function rewriteReplayPromise(response: string, lang: string | undefined, noteLeft: boolean): string {
    const kept = removeHandoffPromiseSentences(response);
    const note = noteLeft ? pick(NOTE_LEFT, lang) : '';
    return [kept, note].filter(Boolean).join('\n\n') || pick(TEAM_UNAVAILABLE, lang);
}

/** What stands in for a reply that was nothing but a promise of a transfer. */
const TEAM_UNAVAILABLE: Record<string, string> = {
    es: 'En este momento el equipo no está disponible; con gusto le ayudo mientras tanto.',
    en: 'The team is not available right now; I am happy to help you in the meantime.',
    pt: 'Neste momento a equipe não está disponível; terei prazer em ajudar enquanto isso.',
    fr: "L'équipe n'est pas disponible pour le moment ; je vous aide volontiers en attendant.",
};

/**
 * The monthly model budget ran out while answering a replay. The ordinary text promises that a
 * person will be told, which the replay cannot keep (it never transfers), so this one only says
 * the truth. It is a fixed system text, not an answer: the return notice ("I keep helping you")
 * is NOT put in front of it.
 */
export const BUDGET_EXHAUSTED_REPLAY_MSG: Record<string, string> = {
    es: 'En este momento no puedo atenderle por este medio automático. Le pedimos que vuelva a escribirnos más tarde.',
    en: 'I cannot help you through this automatic channel right now. Please write to us again later.',
    pt: 'Neste momento não consigo atendê-lo por este meio automático. Por favor, escreva novamente mais tarde.',
    fr: 'Je ne peux pas vous répondre par ce canal automatique pour le moment. Merci de nous écrire à nouveau plus tard.',
};
export const budgetExhaustedReplayText = (lang?: string): string =>
    pick(BUDGET_EXHAUSTED_REPLAY_MSG, lang);

/**
 * Tools whose only effect is to hand the conversation to a person. None is registered today
 * (handoffs reach a person through the post-tool path, the promise path and the engines, all of
 * which the replay turn disables), so this is a guard for the day one appears: the replay must
 * not offer the model a way back into the queue. Tools that merely MAY end in a handoff
 * (payment links, claims, emergency triage…) stay available: what they do first is the answer.
 */
const PURE_HANDOFF_TOOLS: ReadonlySet<string> = new Set([
    'request_human', 'escalate_to_human', 'handoff_to_human', 'transfer_to_human', 'transfer_to_agent',
    'connect_to_human', 'talk_to_human', 'escalate_conversation', 'handoff',
]);
export const isPureHandoffTool = (name: unknown): boolean => typeof name === 'string' && PURE_HANDOFF_TOOLS.has(name);

/** The tools offered to the model on a replay turn. */
export function toolsForReplay<T extends { name?: unknown; function?: { name?: unknown } }>(tools: readonly T[]): T[] {
    return tools.filter(tool => !isPureHandoffTool(tool?.name ?? tool?.function?.name));
}
