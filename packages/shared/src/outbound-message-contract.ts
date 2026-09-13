import type { ChannelType, ConversationalChannelType } from './channel-policy';

/**
 * ═══ WHAT EVERY OUTBOUND EFFECT HAS TO CARRY, FROM 1 OCTOBER 2026 ═══
 *
 * On 1 October Meta starts charging per delivered service message. Until then a
 * reply was free and the only questions worth asking about it were "will it
 * arrive" and "is it any good". From that date every outbound WhatsApp message
 * — from the agent, from a human in the inbox, from a campaign, a reminder, a
 * nurturing sequence, a REST caller — spends somebody's money.
 *
 * "Somebody's" is the word that makes this a contract rather than a counter.
 * Parallly is a Tech Provider: the business pays Meta directly, from ITS card
 * on ITS WhatsApp Business Account. So an outbound effect is only legitimate
 * when four things are true at once, and each of them is a different question
 * with a different way of being unknown:
 *
 *   1. WHO is speaking          — tenant, connection, and the number itself
 *   2. WHO PAYS                 — the WABA and its funding, which is not ours
 *   3. WHAT IT COSTS            — a rate, in a currency, effective on a date
 *   4. WHETHER IT IS ALLOWED    — a reservation taken BEFORE the effect
 *
 * This file is the shape of that answer. It is versioned because it crosses
 * process boundaries — the API, the worker, the WhatsApp service and the
 * dashboard all read it — and because the four fronts building against it will
 * land at different times.
 *
 * ── THE RULE THAT MATTERS MOST ──────────────────────────────────────────────
 *
 * Unknown is not free, and unknown is not zero. Three different states get
 * conflated the moment somebody writes `?? 0`:
 *
 *   · we know it costs nothing      (`free_allowance`, `free_entry_point`)
 *   · we know it costs X            (`priced`)
 *   · we do not know what it costs  (`unknown`)
 *
 * The third one must keep its exposure: a reservation is held, the effect is
 * either refused or sent-and-reconciled by explicit policy, and it is never
 * settled as zero. A gate that rounds the unknown down is a gate that spends
 * without a ceiling, and the ceiling is the whole point of having one.
 */

export const OUTBOUND_CONTRACT_VERSION = 1 as const;

// ─────────────────────────────────────────────────────────────────────────────
// 1 · WHO IS SPEAKING, AND FOR WHOM. Immutable for the life of the effect.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Who a message is going to, and under what claim of permission.
 *
 * `scope` is not decoration. A synthetic rehearsal, an internal alert and a real
 * customer are three different risks, and a pilot that cannot tell them apart is
 * a pilot that eventually messages a customer while proving it does not.
 */
export type RecipientScope =
    /** A real person who is a contact of this tenant. */
    | 'customer'
    /** A number the operator declared for testing, on this tenant. */
    | 'test_recipient'
    /** Staff of the tenant or of the platform. Never a buyer. */
    | 'internal'
    /** No real destination exists: a synthetic transport must absorb it. */
    | 'synthetic';

export interface OutboundRecipient {
    readonly scope: RecipientScope;
    /** The tenant contact, when there is one. Absent for internal/synthetic. */
    readonly contactId?: string | null;
    /**
     * The address the transport will use — a phone, a PSID, a chat id.
     *
     * Optional ON PURPOSE. Identity adaptation must not lose a customer who
     * never gave a phone number, and several channels have no phone at all. An
     * effect with no address is not an error here; it is an effect a
     * phone-shaped transport cannot carry, which is a routing decision made
     * later and with a reason.
     */
    readonly address?: string | null;
}

/** How the account that will be billed by Meta is funded. */
export type PayerKind =
    /** The business pays Meta directly from its own card on its own WABA. */
    | 'business_direct'
    /** A partner (BSP/agency) is billed and settles with the business. */
    | 'partner'
    /** We have not established which. NOT a synonym for `business_direct`. */
    | 'unknown';

/**
 * The account Meta will bill, named separately from the connection.
 *
 * They are not the same thing and conflating them is how a retry moves a charge
 * to a different account. One WABA can carry several numbers; a tenant can hold
 * more than one WABA; a number can be moved between them. The effect records
 * which one it was authorised against, and a retry re-uses that record rather
 * than resolving it again.
 */
export interface OutboundPayer {
    readonly kind: PayerKind;
    /** WhatsApp Business Account id. Absent only when `kind` is `unknown`. */
    readonly wabaId?: string | null;
    /** Business id that owns the WABA, when known. */
    readonly businessId?: string | null;
}

/**
 * The credential the transport will present, by identity — never by value.
 *
 * A token belongs in the secret store. What travels with an effect is which
 * credential was authorised, so a rotation, a revocation or a swap between
 * accounts is visible in the record instead of being silently survived.
 */
export interface OutboundCredentialRef {
    /** Stable id of the stored credential. */
    readonly id: string;
    /** Where it came from: a per-account token, a tenant-wide one, a system user. */
    readonly source: 'channel_account' | 'tenant_credential' | 'system_user';
}

/**
 * Everything about an outbound effect that must not change after admission.
 *
 * Frozen at the moment the effect is created, carried through the queue, and
 * compared on every retry. A retry that resolves the connection again can pick a
 * different number when the first is unhealthy — which reads as resilience and
 * is actually charging a different account for a message the customer will see
 * arriving from a number they do not recognise.
 */
export interface OutboundSendContext {
    readonly version: typeof OUTBOUND_CONTRACT_VERSION;
    readonly tenantId: string;
    readonly channelType: ChannelType;
    /** The exact connection: `channel_accounts.account_id`. Never "any of the tenant's". */
    readonly channelAccountId: string;
    /** The display number/handle, when the channel has one. Diagnostics only. */
    readonly channelAddress?: string | null;
    readonly payer: OutboundPayer;
    readonly credential: OutboundCredentialRef;
    readonly recipient: OutboundRecipient;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Structural validity. Says nothing about whether the account can pay. */
export function isOutboundSendContext(value: unknown): value is OutboundSendContext {
    const context = value as OutboundSendContext;
    return !!context && typeof context === 'object'
        && context.version === OUTBOUND_CONTRACT_VERSION
        && UUID.test(String(context.tenantId))
        && typeof context.channelType === 'string' && !!context.channelType
        && ID.test(String(context.channelAccountId))
        && !!context.payer && ['business_direct', 'partner', 'unknown'].includes(context.payer.kind)
        && (context.payer.kind === 'unknown' || ID.test(String(context.payer.wabaId ?? '')))
        && !!context.credential && ID.test(String(context.credential.id))
        && ['channel_account', 'tenant_credential', 'system_user'].includes(context.credential.source)
        && !!context.recipient
        && ['customer', 'test_recipient', 'internal', 'synthetic'].includes(context.recipient.scope);
}

/**
 * The fields of a send context that a retry may not change.
 *
 * Written as a list rather than as a body of `check(...)` calls so that a
 * field added to `OutboundSendContext` and forgotten here is caught by a test
 * that walks the interface, instead of by whoever notices the bill.
 *
 * Every one of them is either who pays or who receives:
 *
 *   · `payer.businessId` — one Business Portfolio can own several WABAs, and
 *     moving a number between them changes whose account settles with Meta
 *     while `wabaId` may legitimately stay put.
 *   · `credential.source` — the same id can appear as a per-account token and
 *     as a tenant-wide one. A retry that resolves to the other source is
 *     presenting a different secret under a familiar name, which is the exact
 *     substitution the resolvers were fixed to refuse.
 *   · `channelAddress` — documented as diagnostics, and it is what the
 *     customer SEES. A retry arriving from a number they do not recognise is
 *     a different message to them, whoever paid for it.
 */
export const SEND_CONTEXT_IDENTITY = Object.freeze([
    'tenantId', 'channelType', 'channelAccountId', 'channelAddress',
    'payer.kind', 'payer.wabaId', 'payer.businessId',
    'credential.id', 'credential.source',
    'recipient.scope', 'recipient.contactId', 'recipient.address',
] as const);

/**
 * Would a retry of this effect charge the same account and reach the same person?
 *
 * The one question a retry has to answer yes to. Compared field by field rather
 * than by a hash, so a mismatch says WHICH field moved: "the connection changed"
 * and "the payer changed" call for different human decisions.
 */
export function sameSendContext(
    left: OutboundSendContext, right: OutboundSendContext,
): { readonly same: boolean; readonly changed: readonly string[] } {
    const at = (context: OutboundSendContext, path: string): unknown =>
        path.split('.').reduce<any>((value, key) => (value == null ? value : value[key]), context);
    const changed = SEND_CONTEXT_IDENTITY.filter(field =>
        (at(left, field) ?? null) !== (at(right, field) ?? null));
    return { same: changed.length === 0, changed: Object.freeze([...changed]) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 · WHETHER IT MAY BE PAID FOR. Taken BEFORE the effect, settled after.
// ─────────────────────────────────────────────────────────────────────────────

/** Why an outbound message costs what it costs, or why we cannot say. */
export type PricingBasis =
    /** A published rate applies: category × market × currency × effective date. */
    | 'priced'
    /** Inside the number's free service-message allowance for this month. */
    | 'free_allowance'
    /** A free entry point (ads/CTWA and equivalents) covers this window. */
    | 'free_entry_point'
    /** No rate could be resolved. Exposure is retained, never rounded to zero. */
    | 'unknown';

/**
 * What a spend gate answered.
 *
 * `unknown` is a first-class outcome and the reason this is not a boolean.
 * A market we have no rate card for, a category we cannot classify, a quota we
 * could not read — each of them means "we may be about to spend and we cannot
 * say how much", and the honest responses are to refuse or to send under an
 * explicit ceiling with reconciliation. Neither of those is "free".
 */
export type SpendDecision = 'accepted' | 'rejected' | 'unknown';

/** Minor units — cents — as an integer. Never a float: money is not a double. */
export interface Money {
    readonly currency: string;
    readonly minor: number;
}

export interface SpendAuthorization {
    readonly version: typeof OUTBOUND_CONTRACT_VERSION;
    readonly decision: SpendDecision;
    /**
     * The durable reservation this decision created, when it created one.
     *
     * Present for `accepted` AND for `unknown`: an unknown-cost effect that is
     * allowed to proceed holds a reservation at its declared ceiling, because
     * the alternative is spending against nothing.
     */
    readonly reservationId?: string | null;
    readonly basis: PricingBasis;
    /** What was reserved. Zero only when the basis is genuinely free. */
    readonly reserved: Money;
    /** The most this single effect may cost. A rate above it is a refusal. */
    readonly unitCeiling: Money;
    /** Which rate table produced the price, so a later dispute has an authority. */
    readonly rateVersion?: string | null;
    /** Stable code. Required whenever the decision is not `accepted`. */
    readonly reason?: string | null;
    readonly decidedAt: string;
}

/** After the fact: what it really cost, or that we still do not know. */
export type SettlementState =
    /** The provider reported a price and it was charged against the reservation. */
    | 'settled'
    /** Delivered, but no price came back. Exposure stays until reconciliation. */
    | 'pending_reconciliation'
    /** The effect did not happen; the reservation is released in full. */
    | 'released'
    /** We cannot establish whether the effect happened. Exposure is retained. */
    | 'indeterminate';

export interface SpendSettlement {
    readonly version: typeof OUTBOUND_CONTRACT_VERSION;
    readonly reservationId: string;
    readonly state: SettlementState;
    /** What was actually charged. Absent while the state is not `settled`. */
    readonly charged?: Money | null;
    readonly reason?: string | null;
    readonly settledAt: string;
}

/**
 * May this effect proceed, given the decision?
 *
 * Deliberately explicit about `unknown`: it proceeds only where the caller has
 * declared that it may, and never by default. The default answer to "we do not
 * know what this costs" is no.
 */
export function mayProceed(
    authorization: Pick<SpendAuthorization, 'decision'>,
    policy: { readonly allowUnknownCost: boolean },
): boolean {
    if (authorization.decision === 'accepted') return true;
    if (authorization.decision === 'unknown') return policy.allowUnknownCost === true;
    return false;
}

/**
 * How much exposure a settlement leaves behind.
 *
 * The number an operator has to watch: money that may already have been spent
 * and that nothing has yet accounted for. A settlement that reports zero for a
 * delivery whose price never arrived is the accounting error this exists to
 * prevent, so `pending_reconciliation` and `indeterminate` keep the whole
 * reservation.
 */
export function retainedExposure(
    authorization: Pick<SpendAuthorization, 'reserved'>, settlement: Pick<SpendSettlement, 'state' | 'charged'>,
): Money {
    const currency = authorization.reserved.currency;
    switch (settlement.state) {
        case 'released':
            return { currency, minor: 0 };
        case 'settled':
            return { currency, minor: Math.max(0, settlement.charged?.minor ?? authorization.reserved.minor) };
        default:
            return { currency, minor: authorization.reserved.minor };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 · WHAT THE TURN DECIDED. Silence is a result, not a missing message.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The durable outcome of a turn.
 *
 * `wait` exists so that "we are not answering right now" is a recorded decision
 * with a reason and a resumption, instead of an absence that the next tick
 * mistakes for work to do. Before Meta charged per message, an extra "one moment
 * please" was free and mildly annoying; now a loop of them is a bill.
 *
 * The rule this type exists to hold: **no outcome may fabricate a chargeable
 * reply to represent silence.** `wait` and `suppress` produce no outbound
 * effect. If a customer must be told something, that is `send`, and it goes
 * through the spend gate like everything else.
 */
export type TurnOutcomeKind = 'send' | 'wait' | 'suppress' | 'escalate';

export interface TurnOutcome {
    readonly version: typeof OUTBOUND_CONTRACT_VERSION;
    readonly kind: TurnOutcomeKind;
    /** Stable code. Required for everything except a plain `send`. */
    readonly reason?: string | null;
    /** When a `wait` should be reconsidered. Never a busy loop. */
    readonly resumeAfter?: string | null;
    /**
     * Effects this outcome authorises. Empty for `wait` and `suppress`, by
     * construction — see `assertTurnOutcome`.
     */
    readonly effects: readonly string[];
}

export function assertTurnOutcome(outcome: TurnOutcome): void {
    if (!outcome || outcome.version !== OUTBOUND_CONTRACT_VERSION) throw new Error('turn_outcome_invalid');
    if (!['send', 'wait', 'suppress', 'escalate'].includes(outcome.kind)) throw new Error('turn_outcome_invalid');
    if (outcome.kind !== 'send' && !outcome.reason) throw new Error('turn_outcome_reason_required');
    if ((outcome.kind === 'wait' || outcome.kind === 'suppress') && outcome.effects.length > 0) {
        // The whole point. A `wait` that carries an effect is a chargeable
        // message wearing the label of silence.
        throw new Error('turn_outcome_silence_cannot_send');
    }
    if (outcome.kind === 'wait' && !outcome.resumeAfter) throw new Error('turn_outcome_wait_needs_deadline');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · WHETHER THE ACCOUNT CAN PAY AT ALL. Absence proven ≠ not looked at.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether an account is funded, and how we know.
 *
 * `unknown` and `not_ready` are different answers and only one of them is
 * actionable. "We asked Meta and there is no payment method" is a message to the
 * business today; "we could not ask" is a message to us. Collapsing them
 * produces either false alarms to customers or a silent stop on 1 October.
 */
export type FundingState =
    /** A usable payment method is attached and the account is in good standing. */
    | 'ready'
    /** Established that it cannot pay: no method, declined, or suspended. */
    | 'not_ready'
    /** Could not be established. Never presented as either of the above. */
    | 'unknown';

export interface FundingReadiness {
    readonly version: typeof OUTBOUND_CONTRACT_VERSION;
    readonly state: FundingState;
    /** Stable code: `no_payment_method`, `declined`, `partner_billed`, `probe_failed`… */
    readonly reason?: string | null;
    /** Where the answer came from, so a stale cache is visible as one. */
    readonly source: 'provider' | 'cache' | 'operator' | 'inferred';
    readonly checkedAt: string;
    /** After this, the answer is stale and must not be shown as current. */
    readonly staleAfter?: string | null;
}

/** Is this readiness answer still worth showing as current? */
export function isFundingCurrent(readiness: FundingReadiness, now = new Date()): boolean {
    if (!readiness?.staleAfter) return true;
    const deadline = Date.parse(readiness.staleAfter);
    return Number.isFinite(deadline) && deadline > now.getTime();
}

/**
 * What to tell a business, derived rather than written per screen.
 *
 * Every surface that mentions funding — onboarding, the channels page, the
 * pre-October readiness list — must say the same thing about the same state, and
 * must never present `unknown` as a problem the business caused.
 */
export function fundingHeadline(readiness: FundingReadiness, now = new Date()):
    { readonly tone: 'ok' | 'warn' | 'blocked'; readonly code: string } {
    if (!isFundingCurrent(readiness, now)) return { tone: 'warn', code: 'funding_answer_stale' };
    if (readiness.state === 'ready') return { tone: 'ok', code: 'funding_ready' };
    if (readiness.state === 'not_ready') return { tone: 'blocked', code: readiness.reason || 'funding_not_ready' };
    return { tone: 'warn', code: 'funding_unknown' };
}

/**
 * Channels this contract governs today.
 *
 * WhatsApp is the one Meta charges per message from 1 October, and it is the
 * priority. The others are listed because the same gate has to be reachable from
 * every producer — a rate of zero is still a decision that was taken, and a
 * channel that skips the gate is a channel where a future price change lands
 * silently.
 */
export const SPEND_GOVERNED_CHANNELS: readonly ConversationalChannelType[] =
    Object.freeze(['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget']);

/** The channels whose outbound effects are billed by the provider today. */
export const PROVIDER_BILLED_CHANNELS: readonly ConversationalChannelType[] =
    Object.freeze(['whatsapp']);
