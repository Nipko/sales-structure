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
    'cap_exhausted',
    'cap_soft_stop',
    'task_budget_exhausted',
    'account_paused',
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
    cap_exhausted: {
        scope: 'account',
        resolution: 'Raise the spending limit for this scope, or wait for the period to roll over.',
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
