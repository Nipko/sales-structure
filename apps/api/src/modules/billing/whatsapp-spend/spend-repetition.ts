import type { IdenticalDelivery } from './spend-ledger';

/**
 * ═══ SAYING THE SAME THING AGAIN ═══
 *
 * Two wastes, one shape.
 *
 * A customer's phone buzzes twice with the same sentence because the reminder
 * and the drip step both had it queued. And an agent that cannot make progress
 * answers each new message with the answer it already gave — the customer writes
 * again, the turn fails again, and the loop is billed in full.
 *
 * Both are the same fact: THIS EXACT CONTENT, TO THIS PERSON, AGAIN.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 *
 * It is not an abuse classifier and it never becomes one. Nothing here reads
 * what the customer wrote — it counts what WE said. A complaint, a person
 * insisting, somebody writing in another language and somebody asking for a
 * human are indistinguishable from any other message, which is the point: no
 * amount of a customer's own words can make the platform stop answering them.
 *
 * It is also not a content filter. Two DIFFERENT answers, however similar, pass:
 * the comparison is a digest of what is actually being sent, not a judgement
 * about meaning. A platform that decided two sentences "meant the same thing"
 * would eventually refuse to send a price that changed by one peso.
 *
 * ── WHY A COOLDOWN AND NOT A HARD BLOCK ─────────────────────────────────────
 *
 * A repeat is sometimes correct. The first one may not have arrived; a customer
 * may genuinely ask the same question tomorrow. So the second identical message
 * inside the window is refused and the pair is remembered — and once the window
 * passes, the same message is allowed again. The limit is a shape, not a
 * sentence.
 */
export interface RepetitionPolicy {
    /** How long an identical message counts as a repeat. */
    readonly windowMs: number;
    /**
     * How many identical deliveries are allowed inside the window.
     *
     * One. The first one is the message; the second is the duplicate. Raising it
     * means deliberately paying to say the same thing twice.
     */
    readonly maxIdentical: number;
    /**
     * How long after hitting the limit before an identical message is tried
     * again. Measured from the most recent delivery, not from now, so a
     * conversation cannot extend its own cooldown by retrying inside it.
     */
    readonly cooldownMs: number;
}

export const DEFAULT_REPETITION_POLICY: RepetitionPolicy = Object.freeze({
    windowMs: 10 * 60 * 1000,
    maxIdentical: 1,
    cooldownMs: 10 * 60 * 1000,
});

const WINDOW_MIN_MS = 30 * 1000;
const WINDOW_MAX_MS = 24 * 60 * 60 * 1000;
const MAX_IDENTICAL_CEILING = 10;

/**
 * The tenant's policy, clamped to what can be honoured.
 *
 * `maxIdentical: 0` is refused up to one for the same reason the failure-notice
 * floor exists: no setting may make "never send anything" the behaviour. The
 * ceiling exists from the other direction — ten identical messages in ten
 * minutes is not a policy, it is the loop.
 *
 * Anything that is not a number is read as "nothing configured", which is
 * different from being clamped: `null` must not mean "a window of zero".
 */
export function resolveRepetitionPolicy(configured: unknown): RepetitionPolicy {
    const source = (configured ?? {}) as Record<string, unknown>;
    const number = (value: unknown): number | null => {
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        if (typeof value === 'string' && value.trim() !== '') {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
    };
    const clamp = (value: number | null, low: number, high: number, fallback: number) =>
        value === null ? fallback : Math.min(high, Math.max(low, Math.round(value)));
    const minutes = number(source.windowMinutes);
    const cooldown = number(source.cooldownMinutes);
    return Object.freeze({
        windowMs: clamp(minutes === null ? null : minutes * 60_000,
            WINDOW_MIN_MS, WINDOW_MAX_MS, DEFAULT_REPETITION_POLICY.windowMs),
        maxIdentical: clamp(number(source.maxIdentical), 1, MAX_IDENTICAL_CEILING,
            DEFAULT_REPETITION_POLICY.maxIdentical),
        cooldownMs: clamp(cooldown === null ? null : cooldown * 60_000,
            WINDOW_MIN_MS, WINDOW_MAX_MS, DEFAULT_REPETITION_POLICY.cooldownMs),
    });
}

export interface RepetitionVerdict {
    /** May this message be sent? */
    readonly allowed: boolean;
    /** Identical deliveries already inside the window. */
    readonly identical: number;
    /** When an identical message may be tried again. Null when allowed. */
    readonly retryAfter: Date | null;
    /** Which producers already said it, so a diagnosis can name them. */
    readonly producers: readonly string[];
}

/**
 * Judge one candidate against what was already delivered.
 *
 * Pure, and given only our own delivery records — no message bodies, no customer
 * text, no tenant object. Everything it can possibly decide on is something the
 * platform itself did.
 */
export function judgeRepetition(
    recent: readonly IdenticalDelivery[],
    policy: RepetitionPolicy = DEFAULT_REPETITION_POLICY,
    now: Date = new Date(),
): RepetitionVerdict {
    const inWindow = recent.filter(entry =>
        entry.createdAt.getTime() >= now.getTime() - policy.windowMs);
    const producers = [...new Set(inWindow.map(entry => entry.producer))];

    if (inWindow.length < policy.maxIdentical) {
        return Object.freeze({ allowed: true, identical: inWindow.length, retryAfter: null, producers });
    }
    // Measured from the most recent delivery, not from now: a conversation that
    // keeps retrying inside its cooldown would otherwise push its own deadline
    // forward on every attempt and never be allowed to speak again.
    const latest = Math.max(...inWindow.map(entry => entry.createdAt.getTime()));
    return Object.freeze({
        allowed: false,
        identical: inWindow.length,
        retryAfter: new Date(latest + policy.cooldownMs),
        producers,
    });
}

/** One line for an operator: what was stopped, by whom, and until when. */
export function describeRepetition(verdict: RepetitionVerdict): string {
    const who = verdict.producers.length ? verdict.producers.join(', ') : 'an earlier send';
    return `the same message was already delivered ${verdict.identical} time(s) by ${who}`
        + (verdict.retryAfter ? `; an identical one is allowed again after ${verdict.retryAfter.toISOString()}` : '');
}
