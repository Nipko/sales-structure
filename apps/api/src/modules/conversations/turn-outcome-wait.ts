import {
    OUTBOUND_CONTRACT_VERSION, assertTurnOutcome, type TurnOutcome,
} from '@parallext/shared';

/**
 * Deciding not to answer, on purpose, with a reason and a time to think again.
 *
 * The turn had exactly one way to say "something went wrong": send the customer
 * *"Disculpa, tuve un problema procesando tu mensaje. ¿Podrías repetirlo?"*.
 * That sentence does three things, and from 1 October 2026 all three cost money:
 *
 *   · it is a delivered WhatsApp service message, so it is a charge;
 *   · it explicitly asks the customer to write again, so it buys another
 *     inbound — and if the cause has not gone away, another failure and another
 *     charge;
 *   · repeated, it is the loop a person sees when they are already frustrated,
 *     which is when they give up rather than when they rephrase.
 *
 * The fix is not to stop telling people. Telling them ONCE is the honest thing
 * and stays. The second one in the same episode becomes a `wait`: a durable
 * decision with a reason and a resume deadline, and **no outbound effect at
 * all**. `assertTurnOutcome` in the shared contract is what makes that
 * structural rather than a promise — a `wait` carrying effects is refused.
 *
 * ── WHAT THIS MUST NOT BECOME ───────────────────────────────────────────────
 *
 * A silence policy is one bad generalisation away from abandoning the people it
 * was meant to protect. Three lines are drawn here on purpose:
 *
 *   1. **It is not an abuse classifier.** Nothing here looks at what the
 *      customer said. It counts what WE did — how many times we have already
 *      told this conversation that we could not process it. A complaint, a
 *      person struggling to be understood, someone writing in another language
 *      or asking for a human is indistinguishable from any other customer here,
 *      which is the point.
 *   2. **A long legitimate task is untouched.** The counter only ever sees
 *      failure notices. A customer forty messages into a booking has zero of
 *      them and is never waited on.
 *   3. **Silence is not the end of the road.** The turn that goes quiet still
 *      records the inbound, still increments the failure count that escalates
 *      the conversation to a person, and still leaves a row an operator can
 *      read. A `wait` means "not by this path, not right now" — not "ignored".
 */

/**
 * ═══ THE FAILURE-NOTICE POLICY ═══
 *
 * Two numbers: how many times one episode may tell a customer we could not
 * answer, and how long a run of failures counts as one episode.
 *
 * They were constants. They are a policy now because the right values are not a
 * property of the code: a clinic answering forty people a day and a shop
 * answering four thousand have different tolerances for "say it once", and a
 * number chosen here for either of them is wrong for the other.
 *
 * The defaults stay where the constants were, so a tenant who configures
 * nothing gets exactly the behaviour that shipped.
 *
 * ── WHAT IS DELIBERATELY NOT CONFIGURABLE ───────────────────────────────────
 *
 * The floor. `maxPerEpisode` cannot go below one and the episode cannot go
 * below a minute, because the failure mode on that side is a customer who
 * writes in, gets nothing, and is never told why — and no configuration should
 * be able to produce silence as its normal behaviour. The ceilings exist for
 * the same reason from the other direction: a hundred notices in an episode is
 * not a policy, it is the loop this whole mechanism exists to break.
 */
export interface FailureNoticePolicy {
    /** How many failure notices one episode may send. At least one. */
    readonly maxPerEpisode: number;
    /** How long a run of failures is treated as the same episode. */
    readonly episodeMs: number;
}

/** How long one run of failures is treated as the same episode, by default. */
export const FAILURE_EPISODE_MS = 30 * 60 * 1000;

/**
 * The starting policy, and the honest one: the customer learns we could not
 * answer, and does not learn it five times.
 */
export const DEFAULT_FAILURE_NOTICE_POLICY: FailureNoticePolicy = Object.freeze({
    maxPerEpisode: 1,
    episodeMs: FAILURE_EPISODE_MS,
});

const MAX_NOTICES_CEILING = 5;
const EPISODE_MIN_MS = 60 * 1000;
const EPISODE_MAX_MS = 24 * 60 * 60 * 1000;

/**
 * Read the policy a tenant configured, refusing what cannot be honoured.
 *
 * Silently clamps rather than throwing: this runs on the answering path, and a
 * mistyped setting must not turn into a customer left unanswered. Anything that
 * is not a finite number at all is ignored entirely, which is different from
 * being clamped — `"lots"` means "nothing was configured", not "the maximum".
 */
export function resolveFailureNoticePolicy(configured: unknown): FailureNoticePolicy {
    const source = (configured ?? {}) as Record<string, unknown>;
    return Object.freeze({
        maxPerEpisode: clampSetting(source.maxPerEpisode, 1, MAX_NOTICES_CEILING,
            DEFAULT_FAILURE_NOTICE_POLICY.maxPerEpisode),
        episodeMs: clampSetting(minutesToMs(source.episodeMinutes), EPISODE_MIN_MS, EPISODE_MAX_MS,
            DEFAULT_FAILURE_NOTICE_POLICY.episodeMs),
    });
}

/**
 * A configured number, or nothing — with `null` firmly in the "nothing" camp.
 *
 * `Number(null)` is zero, and zero is finite, so the obvious version read an
 * unset field as "zero minutes" and clamped it to the one-minute floor: a
 * tenant who had configured NOTHING got a one-minute episode, which is very
 * nearly the loop this whole mechanism exists to break. A JSON settings blob
 * can honestly hold `"90"`, so a numeric string is accepted; `null`, `''`,
 * booleans and words are not.
 */
function asFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

const minutesToMs = (value: unknown): number | null => {
    const minutes = asFiniteNumber(value);
    return minutes === null ? null : minutes * 60_000;
};

/**
 * Clamp into what can be honoured, and treat "not configured" as the default.
 *
 * Clamps rather than throwing because this runs on the answering path: a
 * mistyped setting must not become a customer left unanswered.
 */
function clampSetting(value: unknown, low: number, high: number, fallback: number): number {
    const parsed = typeof value === 'number' ? value : asFiniteNumber(value);
    if (parsed === null || !Number.isFinite(parsed)) return fallback;
    return Math.min(high, Math.max(low, Math.round(parsed)));
}

/**
 * When a wait is worth reconsidering.
 *
 * Not a round number picked to look reasonable: the moment the notice that
 * caused the wait falls out of the episode window, because that is the moment
 * the decision could actually come out differently. A deadline that arrives
 * while the answer is still "wait" teaches an operator to ignore the field.
 */
export function waitResumesAt(
    recent: readonly DeliveredTurnOutcome[], now: Date = new Date(),
    policy: FailureNoticePolicy = DEFAULT_FAILURE_NOTICE_POLICY,
): Date {
    // The same evidence rule: the window is anchored on a notice the customer
    // received, never on one that failed to leave.
    const counted = recent
        .filter(entry => deliveredFailureNotice(entry, now, policy))
        .map(entry => entry.createdAt.getTime());
    const oldest = counted.length ? Math.min(...counted) : now.getTime();
    return new Date(oldest + policy.episodeMs);
}

/** Stable reason codes. Written once so a dashboard and a log agree. */
export const TURN_OUTCOME_REASONS = {
    /** A normal answer that happens to be the failure notice. */
    failureNotice: 'failure_notice',
    /** We already told them, in this episode. Say nothing; cost nothing. */
    failureNoticeAlreadySent: 'failure_notice_already_sent',
    /** The turn produced no words and no effects at all. */
    nothingToSay: 'turn_produced_nothing',
    /** A draft is waiting for a person; the customer is owed nothing yet. */
    awaitingHumanReview: 'awaiting_human_review',
} as const;

export interface TurnOutcomeDecision {
    readonly outcome: TurnOutcome;
    /** False whenever the outcome authorises no outbound effect. */
    readonly deliver: boolean;
}

const outcome = (kind: TurnOutcome['kind'], reason: string | null,
    extra: { resumeAfter?: string } = {}): TurnOutcome => Object.freeze({
    version: OUTBOUND_CONTRACT_VERSION,
    kind,
    ...(reason ? { reason } : {}),
    ...(extra.resumeAfter ? { resumeAfter: extra.resumeAfter } : {}),
    effects: Object.freeze([]) as readonly string[],
});

/**
 * How many failure notices this conversation has already sent in this episode.
 *
 * Reads only our own recorded decisions. An unavailable ledger yields zero,
 * which errs towards speaking — a customer hears something, and the cost is one
 * message rather than a person left in silence by a database problem.
 */
export function failureNoticesInEpisode(
    recent: readonly DeliveredTurnOutcome[],
    now: Date = new Date(),
    policy: FailureNoticePolicy = DEFAULT_FAILURE_NOTICE_POLICY,
): number {
    return recent.filter(entry => deliveredFailureNotice(entry, now, policy)).length;
}

/**
 * A decision, and what the provider said became of it.
 *
 * `deliveredEffects` may be absent for a caller that has no evidence to
 * offer; absent reads as ZERO, which errs towards speaking. Silence is the
 * expensive mistake here — the cheap one is one more message.
 */
export interface DeliveredTurnOutcome {
    readonly outcome: TurnOutcome;
    readonly createdAt: Date;
    readonly deliveredEffects?: number;
}

/**
 * Was this a failure notice the customer actually received?
 *
 * The decision is recorded before the dispatch, so a row saying `send` proves
 * only that a turn INTENDED to speak. A crash before admission, a provider
 * rejection, an unknown outcome — each leaves that row untouched and the
 * customer with nothing. Counting it would then answer the next message with
 * silence on the grounds of a message that was never sent, which is the worst
 * failure this whole feature can produce: a person told nothing, twice.
 */
function deliveredFailureNotice(entry: DeliveredTurnOutcome, now: Date,
    policy: FailureNoticePolicy = DEFAULT_FAILURE_NOTICE_POLICY): boolean {
    return entry.createdAt.getTime() >= now.getTime() - policy.episodeMs
        && entry.outcome?.kind === 'send'
        && entry.outcome?.reason === TURN_OUTCOME_REASONS.failureNotice
        && (entry.deliveredEffects ?? 0) > 0;
}

/**
 * What this turn does, and whether anything may leave because of it.
 *
 * Deliberately given only facts about OUR side of the conversation: whether the
 * turn produced anything, whether what it produced is the failure notice, and
 * how many of those we have already sent. Nothing about the customer's words
 * reaches this function, so nothing about the customer's words can be turned
 * into a reason to stop answering them.
 */
export function decideTurnOutcome(input: {
    /** Did the turn produce words, a form, a link or an attachment? */
    readonly hasEffects: boolean;
    /** Is what it produced the "I could not process that" notice? */
    readonly isFailureNotice: boolean;
    /** Failure notices already sent in this episode. */
    readonly priorFailureNotices: number;
    /** A draft turn: a person reviews it, the customer is owed nothing yet. */
    readonly draft?: boolean;
    /** When the decision could change. Defaults to a whole episode from now. */
    readonly episodeEndsAt?: Date;
    /** The tenant's policy. Omitted means the shipped default. */
    readonly policy?: FailureNoticePolicy;
    readonly now?: Date;
}): TurnOutcomeDecision {
    const now = input.now ?? new Date();
    const policy = input.policy ?? DEFAULT_FAILURE_NOTICE_POLICY;

    if (input.draft) {
        return Object.freeze({ deliver: false,
            outcome: outcome('suppress', TURN_OUTCOME_REASONS.awaitingHumanReview) });
    }
    if (!input.hasEffects) {
        // Previously a log line and a metric. Now a row, so an operator can see
        // that a customer wrote and got nothing, and why.
        return Object.freeze({ deliver: false,
            outcome: outcome('suppress', TURN_OUTCOME_REASONS.nothingToSay) });
    }
    if (input.isFailureNotice && input.priorFailureNotices >= policy.maxPerEpisode) {
        const resumeAt = input.episodeEndsAt ?? new Date(now.getTime() + policy.episodeMs);
        return Object.freeze({ deliver: false, outcome: outcome(
            'wait', TURN_OUTCOME_REASONS.failureNoticeAlreadySent,
            { resumeAfter: resumeAt.toISOString() }) });
    }
    return Object.freeze({ deliver: true,
        outcome: outcome('send', input.isFailureNotice ? TURN_OUTCOME_REASONS.failureNotice : null) });
}

/**
 * The same decision, checked against the shared contract before anybody acts.
 *
 * Belt and braces on the one invariant that matters: a decision that does not
 * deliver must carry no effects, and a `wait` must carry a deadline. Calling
 * the assertion here means a future edit to `decideTurnOutcome` fails at its own
 * boundary rather than in the outbox.
 */
export function decideAndAssertTurnOutcome(input: Parameters<typeof decideTurnOutcome>[0]): TurnOutcomeDecision {
    const decision = decideTurnOutcome(input);
    assertTurnOutcome(decision.outcome);
    if (!decision.deliver && decision.outcome.effects.length > 0) throw new Error('turn_outcome_silence_cannot_send');
    return decision;
}
