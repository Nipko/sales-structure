/**
 * Why an effect may not be authorised, in terms somebody can act on.
 *
 * Each of these is a distinct human task. Collapsing them into "could not send"
 * is how an operator ends up reading logs for an hour to discover that a tenant
 * never set a time zone — so the code names the missing thing, and `resolution`
 * says who fixes it and how.
 *
 * These are refusals to AUTHORISE, not transport failures: nothing has been sent
 * and nothing has been charged when one of them is returned.
 */

export const SPEND_BLOCK_CODES = [
    'connection_unusable',
    'timezone_missing',
    'payer_unknown',
    'funding_not_ready',
    'rate_unknown',
    'currency_unknown',
    'category_unknown',
    'market_unknown',
    'cap_exhausted',
    'cap_soft_stop',
    'duplicate_recent_send',
    'effect_already_resolved',
    'transmission_held_elsewhere',
    'transmission_outcome_unknown',
    'task_budget_exhausted',
    'account_paused',
    'effect_identity_missing',
] as const;

export type SpendBlockCode = (typeof SPEND_BLOCK_CODES)[number];

export interface SpendBlock {
    readonly code: SpendBlockCode;
    /** Machine-readable context. Never a credential, never a phone number. */
    readonly detail: string;
    /** What was prevented, in minor units, when that is known. */
    readonly avoidedMinor?: number | null;
    readonly currency?: string | null;
    /** The exact next action, in the operator's own terms. */
    readonly resolution: string;
    /** Narrowest thing that had to stop: one account, or one task. */
    readonly scope: 'account' | 'task' | 'contact' | 'tenant';
}

const RESOLUTION: Readonly<Record<SpendBlockCode, { scope: SpendBlock['scope']; resolution: string }>> =
Object.freeze({
    connection_unusable: {
        scope: 'account',
        resolution: 'Reconnect this WhatsApp number in Channels; its connection or credential is not usable.',
    },
    timezone_missing: {
        scope: 'account',
        // Named specifically because the fix is one field and nobody guesses it
        // from a generic failure: the rate and the free month are both dated in
        // the WABA's own zone, and there is no safe default.
        resolution: 'Set the billing time zone for this number: the rate date and the free monthly '
            + 'allowance are both counted in the WhatsApp account\'s own zone.',
    },
    payer_unknown: {
        scope: 'account',
        resolution: 'Reconnect through Embedded Signup so Meta tells us which Business Account pays.',
    },
    funding_not_ready: {
        scope: 'account',
        resolution: 'Add a payment method to this WhatsApp Business Account in Meta. Meta charges the '
            + 'business directly; the Parallly subscription is a separate payment.',
    },
    rate_unknown: {
        scope: 'account',
        resolution: 'No published rate covers this market and category yet. Allow sending at the declared '
            + 'ceiling, or wait for the rate card.',
    },
    currency_unknown: {
        scope: 'account',
        resolution: 'The WhatsApp account\'s billing currency is not one we hold a rate card for.',
    },
    market_unknown: {
        scope: 'contact',
        // The tariff follows the destination country, and some destinations
        // cannot be identified from the number alone: +1 is twenty countries
        // and +7 is two that Meta prices differently. Guessing is a wrong
        // invoice line, so the effect is counted and left unpriced.
        resolution: 'The country of this recipient could not be identified from the number, so '
            + 'no rate line applies. The message is still counted; its exact cost comes from '
            + 'reconciliation against what Meta bills.',
    },
    category_unknown: {
        scope: 'account',
        // Named because the fix is concrete and nobody guesses it from a
        // generic failure: a template whose Meta approval never synced has no
        // category, and pricing it as a service reply understates a marketing
        // send several times over.
        resolution: 'This message could not be classified as one of the five billable '
            + 'WhatsApp categories. Sync the templates for this number so the approved '
            + 'category from Meta is known, or state the category on the producer.',
    },
    cap_exhausted: {
        scope: 'account',
        resolution: 'Raise the spending limit for this scope, or wait for the period to roll over.',
    },
    transmission_held_elsewhere: {
        scope: 'contact',
        // Not an error and not a limit: the message IS being sent, by the
        // attempt that got there first. This caller standing down is the
        // mechanism working.
        resolution: 'Another attempt already holds the right to send this message, so this one '
            + 'stood down. Nothing is lost: the message goes out once, from whichever attempt '
            + 'claimed it.',
    },
    transmission_outcome_unknown: {
        scope: 'contact',
        // The one refusal that is a DECISION not to retry. A previous attempt
        // died with the request already started; whether Meta processed it
        // cannot be established from here, and sending again would be the
        // duplicate delivery the whole transmission right exists to prevent.
        resolution: 'Un intento anterior ya había empezado la petición cuando se cayó. Nadie '
            + 'puede saber si Meta la procesó, así que este mensaje NO se vuelve a enviar: el '
            + 'efecto queda en conciliación y una persona decide si llegó.',
    },
    effect_already_resolved: {
        scope: 'contact',
        // Not a fault, and not a limit: the message this attempt is for has
        // already had its outcome. Sending again would be a second copy of
        // something the customer already received, or a guess about something
        // nobody knows the result of yet.
        resolution: 'This message already has an outcome — delivered, refused, or waiting on '
            + 'reconciliation — so no further attempt is authorised for it. If it needs to be sent '
            + 'again, that is a new message rather than a retry of this one.',
    },
    duplicate_recent_send: {
        scope: 'contact',
        // Named for what it is, so nobody reads it as a fault. The message was
        // not lost and nothing is broken: this exact sentence was already
        // delivered to this person a moment ago, by this producer or another
        // one, and sending it again would buy a second charge and a second
        // buzz on their phone for no new information.
        resolution: 'This exact message was already delivered to this contact moments ago. '
            + 'Check whether two automations cover the same event, or whether the agent is '
            + 'repeating itself because a step cannot complete. An identical message is '
            + 'allowed again once the repeat window passes.',
    },
    cap_soft_stop: {
        scope: 'account',
        // Deliberately a different sentence from cap_exhausted. This one is not
        // an outage: replies to customers are still going out, and what stopped
        // is what the business itself started. Reading them as the same thing is
        // how somebody raises a ceiling in a panic that did not need raising.
        resolution: 'The spending limit is nearly reached, so campaigns, reminders and follow-ups '
            + 'are paused. Replies to customers who write in are still being sent. Raise the limit, '
            + 'raise its soft-stop threshold, or wait for the period to roll over.',
    },
    task_budget_exhausted: {
        scope: 'task',
        resolution: 'This campaign or automation reached its own budget. Raise it to continue.',
    },
    account_paused: {
        scope: 'account',
        resolution: 'This number is paused. Resolve the reason shown beside it and resume sending.',
    },
    effect_identity_missing: {
        scope: 'account',
        // A producer defect, not a tenant one, so the sentence is written for
        // whoever is looking at the log rather than for a business owner. The
        // condition it prevents: an effect keyed only by its own content, where
        // a retry that re-renders the body — a timestamp, a name, a price —
        // mints a SECOND effect and pays for the same message twice.
        resolution: 'This send carries no durable identity, so a retry could not be told from a '
            + 'second message. The producer must bind it to something that survives a restart: '
            + 'a dispatch item, a batch position, a persisted message row, a campaign and '
            + 'recipient, the inbound message being answered, or its own queue job.',
    },
});

export function spendBlock(code: SpendBlockCode, detail: string, money?: {
    avoidedMinor?: number | null; currency?: string | null;
}): SpendBlock {
    return Object.freeze({
        code, detail,
        avoidedMinor: money?.avoidedMinor ?? null,
        currency: money?.currency ?? null,
        ...RESOLUTION[code],
    });
}

/**
 * One line an operator can read without opening the code.
 *
 * Says what was blocked, what it would have cost, and what to do — the three
 * things a limit has to explain, in that order.
 */
export function describeBlock(block: SpendBlock): string {
    const cost = block.avoidedMinor && block.currency
        ? ` Avoided ${(block.avoidedMinor / 100).toFixed(2)} ${block.currency}.`
        : '';
    return `${block.code} (${block.scope}): ${block.detail}.${cost} ${block.resolution}`;
}
