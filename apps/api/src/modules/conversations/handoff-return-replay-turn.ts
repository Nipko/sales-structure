import { normalizeCustomerIntent } from '../../common/conversation/intent-normalizer';

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
