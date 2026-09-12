/**
 * What the console may say about a reply an agent just typed.
 *
 * A 200 from `sendAgentMessage` means the reply was SAVED. The send runs inline
 * after the row is written, and its failure used to reach only the server log —
 * so an expired token or a provider 500 left the agent looking at an ordinary
 * bubble while the customer waited for an answer that never left. The row now
 * carries what happened, and this decides what the person who typed it is told.
 *
 * `pending` is not a milder `failed`: it means no send was attempted at all —
 * no channel resolved, or the outcome could not be written down. Neither may be
 * shown as delivered, and they are not the same thing to act on.
 *
 * ── AND A THIRD THING TO ACT ON ─────────────────────────────────────────────
 *
 * `reconciliation_required` is what the row says when the provider gave NO
 * answer. The request may have been processed, so the one thing the agent must
 * not do is retype it — on WhatsApp that is a second message the customer may
 * already have, and a second charge against the business's own WABA.
 *
 * It reached here as an unrecognised value, and the rule below treats anything
 * unrecognised as accepted. So the state that means "nobody knows" was being
 * shown as a delivered reply: the opposite lie from the one this file was
 * written to stop, and the more expensive one, because it is silent.
 */
export type AgentReplyDelivery = 'pending' | 'sent' | 'failed' | 'unconfirmed';

export interface AgentReplyDeliveryNotice {
    /** What the bubble carries. Never `sent` unless the provider accepted it. */
    state: AgentReplyDelivery;
    /** i18n key for the line under the bubble, or null when there is nothing to say. */
    badgeKey: 'notDelivered' | 'notConfirmed' | 'outcomeUnknown' | null;
    /** i18n key for the message shown to the agent, or null. */
    noticeKey: 'sendNotDelivered' | 'sendNotConfirmed' | 'sendOutcomeUnknown' | null;
}

export function agentReplyDeliveryNotice(status: unknown): AgentReplyDeliveryNotice {
    if (status === 'failed') return { state: 'failed', badgeKey: 'notDelivered', noticeKey: 'sendNotDelivered' };
    if (status === 'pending') return { state: 'pending', badgeKey: 'notConfirmed', noticeKey: 'sendNotConfirmed' };
    // No answer from the provider. Distinct from both of the above because the
    // ACTION is different: do not resend, and do not treat it as delivered.
    if (status === 'reconciliation_required') {
        return { state: 'unconfirmed', badgeKey: 'outcomeUnknown', noticeKey: 'sendOutcomeUnknown' };
    }
    // Anything else — `sent`, or an older API that sends no status at all — is
    // treated as accepted. A console that warned on every unknown value would
    // teach agents to ignore the warning, which costs more than it saves.
    return { state: 'sent', badgeKey: null, noticeKey: null };
}
