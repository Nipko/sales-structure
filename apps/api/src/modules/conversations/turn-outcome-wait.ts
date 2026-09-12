import {
    OUTBOUND_CONTRACT_VERSION, assertTurnOutcome, type TurnOutcome,
} from '@parallext/shared';
import { handoffNoticeLanguage, handoffNoticeText } from '../handoff/handoff-notice';

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
 * ── THE OTHER TWO LOOPS MADE OF SUCCESSFUL TURNS ────────────────────────────
 *
 * The failure notice was the easy one, because it is one fixed sentence. Two
 * more loops are made entirely of turns that worked, which is why the spend
 * gate's content digest — the only guard the platform had — cannot see either:
 *
 *   · **A chain of goodbyes.** A question is resolved, the customer says thank
 *     you five different ways, and five different courtesies go out as five
 *     charges. Five distinct strings are five distinct digests. So a goodbye of
 *     OURS is recorded as one, and the second in an episode is a `wait`.
 *   · **One datum that never arrives.** The deterministic runtime re-emits the
 *     ask for a field it is still awaiting, for as long as the customer keeps
 *     failing to supply it. Counted per DATUM, off that runtime's own durable
 *     state, two turns are allowed — the question and one more attempt — and
 *     the third hands the conversation to a person and says so once. That stop
 *     is an `escalate`, not a `wait`, because the directive is "offer another
 *     way", and a `wait` there would be the same dead end without the charge.
 *
 * ── WHAT THIS MUST NOT BECOME ───────────────────────────────────────────────
 *
 * A silence policy is one bad generalisation away from abandoning the people it
 * was meant to protect. Three lines are drawn here on purpose:
 *
 *   1. **It is not an abuse classifier.** Nothing here looks at what the
 *      customer said. It counts what WE did — how many times we have already
 *      told this conversation that we could not process it, how many times we
 *      have said goodbye, how many turns we have spent awaiting one field. A
 *      complaint, a person struggling to be understood, someone writing in
 *      another language or asking for a human is indistinguishable from any
 *      other customer here, which is the point.
 *   2. **A long legitimate task is untouched.** Not because the counters cannot
 *      see ordinary turns — two of them now can — but because of what they
 *      count. A booking that collects a service, then a day, then a time, then
 *      a name changes datum every turn, so each is the FIRST turn awaiting its
 *      own and none is ever stopped. A turn that answers something is not a
 *      goodbye, and a turn that hands over a link or a picture cannot be one.
 *      An ordinary turn is recorded with no reason at all and reads no policy
 *      and no ledger.
 *   3. **Silence is not the end of the road.** The turn that goes quiet still
 *      records the inbound, still increments the failure count that escalates
 *      the conversation to a person, and still leaves a row an operator can
 *      read. A `wait` means "not by this path, not right now" — not "ignored".
 *      And where the road really does end — a datum two turns could not
 *      collect — the outcome is not silence at all: a person takes the
 *      conversation over, and the customer is told so.
 */

/**
 * ═══ THE POLICY: HOW OFTEN THE PLATFORM MAY REPEAT ITSELF ═══
 *
 * Five numbers. One window — how long a run counts as the same episode — and
 * four limits inside it: how many times we may tell a customer we could not
 * answer, how many goodbyes a chain may hold, how many turns may go by awaiting
 * one field, and how many times a handover may be announced.
 *
 * They were constants. They are a policy now because the right values are not a
 * property of the code: a clinic answering forty people a day and a shop
 * answering four thousand have different tolerances for "say it once", and a
 * number chosen here for either of them is wrong for the other.
 *
 * The defaults stay where the constants were, so a tenant who configures
 * nothing gets exactly the behaviour that shipped.
 *
 * ── WHERE THE NUMBERS CAME FROM ─────────────────────────────────────────────
 *
 * The three new ones are the handoff's own starting values, stated there as
 * *valores iniciales para pruebas*: a question plus ONE rephrasing of the same
 * datum with no change; a review after THREE turns without progress; at most
 * ONE pause notice per episode. The first two are one boundary read from both
 * ends — two turns allowed means the third is the review — so they are ONE
 * setting here rather than two that can disagree.
 *
 * ── WHAT IS DELIBERATELY NOT CONFIGURABLE ───────────────────────────────────
 *
 * The floors. `maxPerEpisode` cannot go below one, the episode cannot go below
 * a minute, a goodbye cannot go below one and a handover cannot be announced
 * fewer than once, because the failure mode on that side is a customer who
 * writes in, gets nothing, and is never told why — and no configuration should
 * be able to produce silence as its normal behaviour. `maxTurnsAwaitingOneDatum`
 * has a floor of TWO for a sharper version of the same reason: at one, the
 * first rephrasing of a question would already hand the thread to a person, so
 * somebody who mistyped their id once would never get to type it again.
 *
 * The ceilings exist for the same reason from the other direction: a hundred
 * notices in an episode is not a policy, it is the loop this whole mechanism
 * exists to break.
 */
export interface FailureNoticePolicy {
    /** How many failure notices one episode may send. At least one. */
    readonly maxPerEpisode: number;
    /** How long a run of failures is treated as the same episode. */
    readonly episodeMs: number;
    /**
     * How many closing pleasantries one episode may send.
     *
     * One. Saying "con gusto" after a customer thanks us is courtesy; saying it
     * five times is a chain of automatic replies that Meta bills one by one and
     * that nobody reads. See `isClosingPleasantry` for what counts as one, and
     * note that it is OUR OWN reply being judged, never the customer's.
     */
    readonly maxClosingPleasantriesPerEpisode: number;
    /**
     * How many turns may go by still awaiting ONE datum before a person is
     * offered instead.
     *
     * Two: the question, and one rephrasing of it. The third turn that is still
     * awaiting the same datum is the one that stops asking — which is the same
     * sentence as "review after three turns without progress", counted from the
     * other end.
     */
    readonly maxTurnsAwaitingOneDatum: number;
    /**
     * How many times one episode may tell the customer we are handing over.
     *
     * One. The whole reason the loop is worth stopping is that each lap costs a
     * message; a stop that announces itself on every lap is the same loop with a
     * different sentence in it.
     */
    readonly maxRouteNoticesPerEpisode: number;
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
    maxClosingPleasantriesPerEpisode: 1,
    maxTurnsAwaitingOneDatum: 2,
    maxRouteNoticesPerEpisode: 1,
});

const MAX_NOTICES_CEILING = 5;
const EPISODE_MIN_MS = 60 * 1000;
const EPISODE_MAX_MS = 24 * 60 * 60 * 1000;
const MAX_CLOSINGS_CEILING = 5;
const MAX_ASKS_CEILING = 6;
const MAX_ROUTE_NOTICES_CEILING = 3;

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
        // The same floor-of-one rule as the notices, for the same reason: no
        // setting may make "never say anything" the ordinary behaviour. A
        // tenant who wants two goodbyes gets two; a tenant who asks for zero
        // gets one.
        maxClosingPleasantriesPerEpisode: clampSetting(source.maxClosingPleasantries, 1,
            MAX_CLOSINGS_CEILING, DEFAULT_FAILURE_NOTICE_POLICY.maxClosingPleasantriesPerEpisode),
        // Floor of two, not one. At one, the FIRST rephrasing of a question
        // would already hand the conversation to a person — a customer who
        // mistyped their id once would never get a second chance to type it.
        maxTurnsAwaitingOneDatum: clampSetting(source.maxTurnsAwaitingOneDatum, 2,
            MAX_ASKS_CEILING, DEFAULT_FAILURE_NOTICE_POLICY.maxTurnsAwaitingOneDatum),
        maxRouteNoticesPerEpisode: clampSetting(source.maxRouteNotices, 1,
            MAX_ROUTE_NOTICES_CEILING, DEFAULT_FAILURE_NOTICE_POLICY.maxRouteNoticesPerEpisode),
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
    /** A goodbye of ours. Recorded so the next one can be counted. */
    courtesyClose: 'courtesy_close',
    /** We already said goodbye in this episode. Say nothing; cost nothing. */
    courtesyChainClosed: 'courtesy_chain_closed',
    /**
     * A turn that ended still awaiting one datum. The datum's identity is
     * appended after a colon, so two turns awaiting the SAME one can be counted
     * without the reason ever naming the field a tenant configured.
     */
    awaitingSameDatum: 'awaiting_same_datum',
    /** Enough asking. A person is being offered instead, once per episode. */
    stalledAskRoute: 'stalled_ask_route',
    /** The route was already offered in this episode. Ask nothing more. */
    askWithoutProgress: 'ask_without_progress',
} as const;

/**
 * What a stop has to DO, beyond not speaking.
 *
 * The directive for the stalled ask is not "fall silent" — the platform already
 * did that, because the spend gate refuses an identical send and there is
 * nothing behind the refusal. It is "stop asking AND offer another way", so the
 * decision carries the other way with it: a person takes the conversation, and
 * the customer is told so, once.
 *
 * `notice` is the deterministic sentence, chosen by the server from the closed
 * handoff catalog. The model neither writes it nor edits it.
 */
export interface TurnOutcomeRoute {
    /** The reason the transfer is recorded under. */
    readonly reason: string;
    /** The one sentence the customer is owed. Already in their own language. */
    readonly notice: string;
}

export interface TurnOutcomeDecision {
    readonly outcome: TurnOutcome;
    /** False whenever the outcome authorises no outbound effect. */
    readonly deliver: boolean;
    /**
     * Present only when this turn hands over instead of answering. The caller
     * owes exactly two things then: the transfer, and this one sentence.
     */
    readonly route?: TurnOutcomeRoute;
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
    /**
     * Which inbound the decision belongs to, when the reader knows.
     *
     * The ledger row is keyed by that inbound and updated in place, so a turn
     * re-run after a crash reads ITS OWN earlier decision back. Counters that
     * ask "how many times have we already done this" exclude it; the failure
     * notice does not need to, because it also demands delivery evidence and a
     * notice that was delivered SHOULD stop the next one.
     */
    readonly inboundMessageId?: string;
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
 * ═══ THE TWO COUNTERS THAT DO NOT DEMAND DELIVERY EVIDENCE, AND WHY ═══
 *
 * The failure notice counts only what the provider acknowledged, because the
 * mistake it guards against is a person told nothing twice: if the notice never
 * arrived, the customer still does not know we could not read them, and owes
 * nothing to our bookkeeping.
 *
 * Neither of the two decisions below carries information the customer needs.
 *
 *   · A goodbye that never arrived is a goodbye. Sending a SECOND one does not
 *     repair the first — the customer thanks us again and the chain continues,
 *     which is the thing being stopped.
 *   · An ask that never arrived leaves the customer MORE stuck, not less, so a
 *     person is more warranted rather than less.
 *
 * There is a practical half to it as well, and it is worth saying plainly: the
 * ledger has no arrival evidence at all on the legacy delivery lane, because
 * that lane writes no outbox row for the join to count. A counter that demanded
 * delivery would therefore be permanently zero wherever the durable lane is
 * switched off — which is where most traffic still runs. The failure-notice
 * `wait` has exactly that limit today, deliberately; these two do not.
 */
function inEpisode(entry: DeliveredTurnOutcome, now: Date, policy: FailureNoticePolicy): boolean {
    return entry.createdAt.getTime() >= now.getTime() - policy.episodeMs;
}

/** Our own decision about this very inbound, read back after a crash. */
const ownTurn = (entry: DeliveredTurnOutcome, inboundMessageId?: string): boolean =>
    !!inboundMessageId && entry.inboundMessageId === inboundMessageId;

/**
 * The identity of the datum a turn is still awaiting, as it reaches the ledger.
 *
 * A short digest rather than the field itself. The counter only ever needs to
 * know whether two turns were awaiting the SAME thing, and the row it is
 * written into survives erasure — so it holds a value that can be compared and
 * nothing that can be read back into a tenant's own vocabulary.
 *
 * Deliberately not cryptographic: it is an equality token for a handful of
 * fields inside one conversation, not a secret. It IS stable across processes,
 * which is the only property the counter depends on.
 */
export function datumAskKey(field: string | null | undefined): string | null {
    const name = String(field ?? '').trim().toLowerCase();
    if (!name) return null;
    let hash = 0x811c9dc5;
    for (let i = 0; i < name.length; i += 1) {
        hash ^= name.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

/** The reason a turn still awaiting `key` is recorded under. */
export const awaitingDatumReason = (key: string): string =>
    `${TURN_OUTCOME_REASONS.awaitingSameDatum}:${key}`;

/**
 * ═══ WHAT COUNTS AS A GOODBYE OF OURS ═══
 *
 * The customer's five thank-yous are five different strings, so the digest the
 * spend gate compares cannot see the chain. What CAN be seen is that our own
 * replies stopped carrying anything: no price, no date, no link, no picture,
 * nothing but pleasantry vocabulary.
 *
 * So this reads OUR reply, never the customer's. That distinction is the one
 * this whole file is built on: a complaint, a person insisting, somebody writing
 * in another tongue and somebody asking for a human all produce replies that
 * carry something, and are therefore invisible here.
 *
 * ── WHY TWO CONDITIONS AND NOT ONE ──────────────────────────────────────────
 *
 * Requiring only that every word be pleasantry vocabulary classified "No, no
 * hay" as a goodbye — a real answer to a real question, silenced. So a reply
 * also has to contain one of the closing PHRASES below. "Nada" on its own is an
 * answer; "de nada" is a goodbye.
 *
 * Errs towards speaking in every other direction: a digit, a question, a link
 * or anything longer than a couple of lines disqualifies the reply outright.
 * A missed goodbye costs one message; a misread answer costs a customer.
 */
const CLOSING_PHRASES: readonly string[] = Object.freeze([
    // es
    'de nada', 'con gusto', 'con mucho gusto', 'un placer', 'fue un placer', 'el placer es',
    'gracias a ti', 'gracias a vos', 'gracias a usted', 'a la orden', 'para servirte',
    'para servirle', 'para ayudarte', 'para ayudarle', 'estoy para', 'que tengas', 'que tenga',
    'buen dia', 'buena tarde', 'hasta luego', 'no hay de que', 'cuando quieras', 'cualquier cosa',
    'saludos', 'un abrazo', 'igualmente', 'feliz dia', 'que estes bien', 'con gusto!',
    // en
    'welcome', 'pleasure', 'happy to help', 'glad to help', 'anytime', 'have a great day',
    'have a nice day', 'take care', 'no problem', 'thank you', 'thanks', 'cheers', 'regards',
    // pt
    'com prazer', 'foi um prazer', 'obrigado', 'obrigada', 'disponha', 'ate logo', 'abracos',
    'tenha um bom dia',
    // fr
    'avec plaisir', 'de rien', 'je vous en prie', 'merci', 'bonne journee', 'a bientot',
    'au plaisir', 'cordialement',
]);

/**
 * Every word a goodbye of ours is allowed to be made of.
 *
 * A reply containing anything outside this list is carrying something —
 * a service, a day, a name, an instruction — and is answered, not counted.
 */
const PLEASANTRY_WORDS: ReadonlySet<string> = new Set([
    // es
    'con', 'mucho', 'mucha', 'muchas', 'muchos', 'mil', 'gusto', 'placer', 'un', 'una', 'fue',
    'es', 'gracias', 'a', 'ti', 'vos', 'usted', 'ustedes', 'el', 'la', 'orden', 'estoy', 'estamos',
    'para', 'servirte', 'servirle', 'ayudarte', 'ayudarle', 'que', 'tengas', 'tenga', 'tengan',
    'buen', 'buena', 'buenas', 'dia', 'tarde', 'noche', 'estes', 'bien', 'hasta', 'luego', 'pronto',
    'de', 'nada', 'no', 'hay', 'cuando', 'quieras', 'cualquier', 'cosa', 'me', 'escribis',
    'escribes', 'aca', 'aqui', 'abrazo', 'saludos', 'feliz', 'claro', 'perfecto', 'listo', 'genial',
    'ok', 'vale', 'y', 'tu', 'su', 'siempre', 'encantado', 'encantada', 'igualmente', 'chao',
    'adios', 'cuidate', 'exito', 'exitos', 'suerte', 'si', 'aviso', 'avisas',
    // en
    'you', 'your', 'are', 'youre', 'welcome', 'my', 'happy', 'glad', 'to', 'help', 'anytime',
    'have', 'great', 'nice', 'take', 'care', 'see', 'thank', 'thanks', 'too', 'problem', 'cheers',
    'best', 'regards', 'sure', 'of', 'course', 'all', 'the', 'good', 'bye', 'goodbye', 'again',
    'day', 'pleasure', 'here', 'anything',
    // pt
    'com', 'prazer', 'foi', 'obrigado', 'obrigada', 'voce', 'disponha', 'qualquer', 'coisa',
    'estou', 'tenha', 'bom', 'ate', 'logo', 'abracos', 'otimo', 'tudo', 'mais', 'vez',
    // fr
    'avec', 'plaisir', 'rien', 'je', 'vous', 'en', 'prie', 'merci', 'bonne', 'journee', 'bientot',
    'au', 'cordialement', 'hesitez', 'pas', 'ravi', 'tres', 'continuation',
]);

/** Accents, punctuation and emoji removed; words left. */
function pleasantryWords(reply: string): string[] {
    return reply
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 0);
}

/**
 * Is this reply of ours a bare goodbye?
 *
 * Judges OUR OWN reply, and only its shape. Nothing the customer wrote reaches
 * this function, so nothing the customer writes can make the platform stop
 * answering them.
 */
export function isClosingPleasantry(reply: string | null | undefined,
    carriesEffects = false): boolean {
    const said = String(reply ?? '').trim();
    if (!said || carriesEffects) return false;
    // A question is a turn asking for something; a number is a price, a date or
    // an identifier; a link is an effect. None of the three is a goodbye.
    if (said.length > 160 || /[?¿]/.test(said) || /\d/.test(said) || /https?:\/\//i.test(said)) {
        return false;
    }
    const words = pleasantryWords(said);
    if (!words.length || !words.every(word => PLEASANTRY_WORDS.has(word))) return false;
    const flattened = words.join(' ');
    return CLOSING_PHRASES.some(phrase => flattened.includes(phrase.replace(/[^a-z\s]/g, '').trim()));
}

/** Goodbyes we have already said in this episode, this turn's own excluded. */
export function closingPleasantriesInEpisode(
    recent: readonly DeliveredTurnOutcome[], now: Date = new Date(),
    policy: FailureNoticePolicy = DEFAULT_FAILURE_NOTICE_POLICY,
    inboundMessageId?: string,
): number {
    return recent.filter(entry => inEpisode(entry, now, policy)
        && !ownTurn(entry, inboundMessageId)
        && entry.outcome?.kind === 'send'
        && entry.outcome?.reason === TURN_OUTCOME_REASONS.courtesyClose).length;
}

/** Turns in this episode that ended still awaiting exactly this datum. */
export function turnsAwaitingDatum(
    recent: readonly DeliveredTurnOutcome[], key: string, now: Date = new Date(),
    policy: FailureNoticePolicy = DEFAULT_FAILURE_NOTICE_POLICY,
    inboundMessageId?: string,
): number {
    const reason = awaitingDatumReason(key);
    return recent.filter(entry => inEpisode(entry, now, policy)
        && !ownTurn(entry, inboundMessageId)
        && entry.outcome?.kind === 'send'
        && entry.outcome?.reason === reason).length;
}

/** Times this episode has already offered the customer a person. */
export function routeNoticesInEpisode(
    recent: readonly DeliveredTurnOutcome[], now: Date = new Date(),
    policy: FailureNoticePolicy = DEFAULT_FAILURE_NOTICE_POLICY,
    inboundMessageId?: string,
): number {
    return recent.filter(entry => inEpisode(entry, now, policy)
        && !ownTurn(entry, inboundMessageId)
        && entry.outcome?.kind === 'escalate'
        && entry.outcome?.reason === TURN_OUTCOME_REASONS.stalledAskRoute).length;
}

/**
 * When a wait caused by one of our own recorded decisions is worth revisiting.
 *
 * The same rule `waitResumesAt` follows for the failure notice: the moment the
 * OLDEST decision that caused the wait falls out of the episode, because that
 * is the moment the answer could come out differently. A deadline that arrives
 * while the answer is still "wait" teaches an operator to ignore the field.
 */
export function episodeResumesAt(
    recent: readonly DeliveredTurnOutcome[], reason: string, now: Date = new Date(),
    policy: FailureNoticePolicy = DEFAULT_FAILURE_NOTICE_POLICY,
): Date {
    const counted = recent
        .filter(entry => inEpisode(entry, now, policy) && entry.outcome?.reason === reason)
        .map(entry => entry.createdAt.getTime());
    const oldest = counted.length ? Math.min(...counted) : now.getTime();
    return new Date(oldest + policy.episodeMs);
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
    /** Is what it produced a bare goodbye of ours, carrying nothing? */
    readonly isClosingPleasantry?: boolean;
    /** Goodbyes of ours already sent in this episode. */
    readonly priorClosingPleasantries?: number;
    /** Which datum the runtime is STILL awaiting after this turn, as a token. */
    readonly awaitingDatumKey?: string | null;
    /** Turns of this episode that ended awaiting that same one. */
    readonly priorTurnsAwaitingDatum?: number;
    /** Times this episode already offered the customer a person. */
    readonly priorRouteNotices?: number;
    /** The one deterministic sentence a handover is allowed to say. */
    readonly routeNotice?: string | null;
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
    const resumeAt = () => (input.episodeEndsAt ?? new Date(now.getTime() + policy.episodeMs)).toISOString();

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
        return Object.freeze({ deliver: false, outcome: outcome(
            'wait', TURN_OUTCOME_REASONS.failureNoticeAlreadySent,
            { resumeAfter: resumeAt() }) });
    }
    // ── ENOUGH ASKING FOR ONE THING ─────────────────────────────────────────
    //
    // Judged before the goodbye, because an ask is never a goodbye and the
    // order would otherwise be decided by which classifier happened to run
    // first. The limit is on turns spent awaiting ONE datum: a booking that
    // collects a day, then a time, then a name changes datum every turn and is
    // never counted, which is exactly the difference between a long task and a
    // loop.
    if (input.awaitingDatumKey
        && (input.priorTurnsAwaitingDatum ?? 0) >= policy.maxTurnsAwaitingOneDatum) {
        // The first stop hands over and says so. Any later one in the same
        // episode says nothing at all: the transfer already happened, and
        // repeating the sentence is the loop with different words in it.
        if ((input.priorRouteNotices ?? 0) < policy.maxRouteNoticesPerEpisode && input.routeNotice) {
            return Object.freeze({
                deliver: false,
                outcome: outcome('escalate', TURN_OUTCOME_REASONS.stalledAskRoute),
                route: Object.freeze({
                    reason: TURN_OUTCOME_REASONS.stalledAskRoute, notice: input.routeNotice }),
            });
        }
        return Object.freeze({ deliver: false, outcome: outcome(
            'wait', TURN_OUTCOME_REASONS.askWithoutProgress, { resumeAfter: resumeAt() }) });
    }
    if (input.isClosingPleasantry
        && (input.priorClosingPleasantries ?? 0) >= policy.maxClosingPleasantriesPerEpisode) {
        return Object.freeze({ deliver: false, outcome: outcome(
            'wait', TURN_OUTCOME_REASONS.courtesyChainClosed, { resumeAfter: resumeAt() }) });
    }
    return Object.freeze({ deliver: true, outcome: outcome('send', sendReason(input)) });
}

/**
 * What a permitted turn is recorded as.
 *
 * Every one of these exists so the NEXT turn can count it. A plain answer is
 * recorded with no reason at all, which is what keeps the counters from seeing
 * the ordinary case.
 */
function sendReason(input: {
    readonly isFailureNotice: boolean;
    readonly isClosingPleasantry?: boolean;
    readonly awaitingDatumKey?: string | null;
}): string | null {
    if (input.isFailureNotice) return TURN_OUTCOME_REASONS.failureNotice;
    if (input.awaitingDatumKey) return awaitingDatumReason(input.awaitingDatumKey);
    if (input.isClosingPleasantry) return TURN_OUTCOME_REASONS.courtesyClose;
    return null;
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

/**
 * ═══ THE WHOLE DECISION, INCLUDING THE READS IT NEEDS ═══
 *
 * `decideTurnOutcome` is pure and stays pure: given the counts, it answers. But
 * somebody has to DO the counting, and the three places that could have done it
 * are the turn itself (which then owns a policy it cannot be tested for), the
 * store (which would then know about episodes) or here.
 *
 * Here. The turn's own call site becomes one call, the policy read, the ledger
 * read and the classification all live beside the rule they feed, and the caller
 * keeps the two things only it can do: transferring the conversation, and
 * putting one sentence on the wire.
 *
 * ── WHAT THIS COSTS THE ORDINARY TURN ───────────────────────────────────────
 *
 * Nothing. The three things worth counting are each decidable locally first —
 * the reply is the failure notice, the reply is a goodbye of ours, or the
 * runtime is still awaiting a datum — and a turn where none of them holds
 * returns before the policy read and before the ledger read, exactly as the
 * previous version did for every turn that was not a failure notice.
 *
 * A turn where one of them DOES hold pays two reads: the tenant's settings and
 * one bounded, indexed, single-conversation window of the ledger. That is the
 * honest price of counting something other than failures — a chain of goodbyes
 * and a stalled question are both made of perfectly successful turns.
 */
export async function resolveTurnOutcome(input: {
    readonly hasEffects: boolean;
    readonly isFailureNotice: boolean;
    /** The words this turn produced, judged only for their shape. */
    readonly reply: string | null | undefined;
    /** True when the turn also produced a link, a picture, a form or a writer. */
    readonly carriesEffects: boolean;
    /** The field the procedure runtime is still awaiting, if any. */
    readonly awaitingField: string | null | undefined;
    /** This inbound, so the turn's own earlier attempt is not counted. */
    readonly inboundMessageId?: string | null;
    readonly draft?: boolean;
    readonly now?: Date;
    /**
     * The tongue this conversation is being held in.
     *
     * Narrowed to the four the deterministic handoff catalog ships, and used
     * ONLY to pick which of those four fixed sentences a handover says. The
     * model neither writes that sentence nor edits it, which is what keeps a
     * stop from becoming an opportunity for prose.
     */
    readonly replyLanguage?: string | null;
    /** The tenant's configured policy blob, read only when it can matter. */
    readonly readPolicy?: () => Promise<unknown>;
    /** Recent decisions on this conversation. `[]` when the ledger cannot say. */
    readonly readEpisode?: (since: Date) => Promise<readonly DeliveredTurnOutcome[]>;
}): Promise<TurnOutcomeDecision> {
    const now = input.now ?? new Date();
    // Nothing below can change either answer, and both are reached on turns that
    // have no reason to pay for a settings read or a ledger read.
    if (input.draft || !input.hasEffects) {
        return decideAndAssertTurnOutcome({
            hasEffects: input.hasEffects, isFailureNotice: input.isFailureNotice,
            priorFailureNotices: 0, draft: input.draft, now,
        });
    }
    const awaitingDatumKey = datumAskKey(input.awaitingField);
    const closing = isClosingPleasantry(input.reply, input.carriesEffects);
    // Nothing countable is in play, so nothing is counted and nothing is read.
    // Recorded with no reason at all, which is what keeps every counter above
    // blind to the ordinary case.
    if (!input.isFailureNotice && !closing && !awaitingDatumKey) {
        return decideAndAssertTurnOutcome({
            hasEffects: true, isFailureNotice: false, priorFailureNotices: 0, now,
        });
    }
    const policy = input.readPolicy
        ? resolveFailureNoticePolicy(await input.readPolicy())
        : DEFAULT_FAILURE_NOTICE_POLICY;
    const episode = input.readEpisode
        ? await input.readEpisode(new Date(now.getTime() - policy.episodeMs))
        : [];
    const inbound = input.inboundMessageId ?? undefined;

    // Which of the three waits is in play decides which decisions anchor the
    // deadline, so the deadline is computed from the reason that caused it
    // rather than from a round number.
    const episodeEndsAt = input.isFailureNotice
        ? waitResumesAt(episode, now, policy)
        : awaitingDatumKey
            ? episodeResumesAt(episode, awaitingDatumReason(awaitingDatumKey), now, policy)
            : episodeResumesAt(episode, TURN_OUTCOME_REASONS.courtesyClose, now, policy);

    return decideAndAssertTurnOutcome({
        hasEffects: true,
        isFailureNotice: input.isFailureNotice,
        priorFailureNotices: failureNoticesInEpisode(episode, now, policy),
        isClosingPleasantry: closing,
        priorClosingPleasantries: closingPleasantriesInEpisode(episode, now, policy, inbound),
        awaitingDatumKey,
        priorTurnsAwaitingDatum: awaitingDatumKey
            ? turnsAwaitingDatum(episode, awaitingDatumKey, now, policy, inbound) : 0,
        priorRouteNotices: routeNoticesInEpisode(episode, now, policy, inbound),
        // The handover sentence is taken from the closed catalog the handoff
        // receipt already reproduces from, so the words a customer reads here
        // are the same words every other transfer uses — and there is no fifth
        // language and no free prose reachable from this path.
        routeNotice: handoffNoticeText('transferring', handoffNoticeLanguage(input.replyLanguage)),
        episodeEndsAt,
        policy,
        now,
    });
}
