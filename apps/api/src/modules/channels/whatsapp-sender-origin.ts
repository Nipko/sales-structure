/**
 * A WhatsApp sender may only ever come from a WhatsApp conversation.
 *
 * ── WHAT WENT WRONG ─────────────────────────────────────────────────────────
 *
 * `conversations.channel_account_id` holds whichever account the customer wrote
 * to: a WhatsApp phone number id, an Instagram scoped id, a Messenger page id, a
 * Telegram bot, a widget session. Three producers then read that column and
 * handed the value to `sendTemplate` as `fromPhoneNumberId`. An Instagram lead
 * therefore asked the WhatsApp resolver for a connection called `IG_ACCOUNT`.
 *
 * The consequence is not a harmless miss. `connection_not_found` is the good
 * case; the bad one is an id that happens to match some other tenant object, or
 * a resolver that treats "not found" as "fall back to the tenant's oldest" — the
 * exact substitution this whole area was fixed to stop. And from 1 October 2026
 * every one of those sends is a charge on somebody's WABA.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * A connection is inherited ONLY when the thing it is inherited from is a
 * WhatsApp conversation. Everything else yields `undefined`, which is not a
 * default: the resolver then serves a single-number tenant and refuses a
 * multi-number one, so a rule that wants to answer an Instagram lead over
 * WhatsApp has to name the number itself.
 */

/** The channel whose account ids are WhatsApp phone number ids. */
export const WHATSAPP_CHANNEL = 'whatsapp';

/**
 * The WhatsApp sender this origin may lend, or nothing.
 *
 * Takes the channel and the account together because they are only meaningful
 * together — that pairing is the thing the three producers had lost.
 */
export function whatsappSenderFrom(origin: {
    readonly channelType?: string | null;
    readonly channelAccountId?: string | null;
} | null | undefined): string | undefined {
    if (!origin) return undefined;
    const channel = String(origin.channelType ?? '').trim().toLowerCase();
    if (channel !== WHATSAPP_CHANNEL) return undefined;
    const account = String(origin.channelAccountId ?? '').trim();
    return account.length ? account : undefined;
}

/**
 * Why a proactive task has no sender, in words an operator can act on.
 *
 * Returned rather than thrown: the caller decides whether this blocks the task
 * or merely leaves the resolver to answer for a single-number tenant. What it
 * must never do is disappear into a log line, because "the reminder never went
 * out" and "the reminder went out from the wrong number" look identical from
 * outside and have opposite fixes.
 */
export function senderOriginProblem(origin: {
    readonly channelType?: string | null;
    readonly channelAccountId?: string | null;
} | null | undefined): 'origin_missing' | 'origin_is_another_channel' | 'origin_has_no_account' | null {
    if (!origin) return 'origin_missing';
    const channel = String(origin.channelType ?? '').trim().toLowerCase();
    if (!channel) return 'origin_missing';
    if (channel !== WHATSAPP_CHANNEL) return 'origin_is_another_channel';
    return String(origin.channelAccountId ?? '').trim().length ? null : 'origin_has_no_account';
}
