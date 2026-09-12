/**
 * ═══ WHO OWNS THIS THREAD, WHEN META HAS AN AGENT IN IT TOO ═══
 *
 * Meta's own business agent can answer inside the same conversation this
 * platform answers in. Nothing about our pipeline knows that: `shouldHandoff`
 * reads the customer's words, the durable lane asks whether the effect is still
 * authorised, and neither asks the question that matters here — *is it our turn
 * to speak at all?*
 *
 * If both answer, the customer gets two replies to one message. That is not a
 * duplicate in the sense the outbox prevents (one effect, sent twice); it is two
 * DIFFERENT answers from two agents, possibly contradicting each other, and
 * both billed.
 *
 * ── WHY THE DEFAULT IS "WE DO NOT KNOW", NOT "IT IS OURS" ───────────────────
 *
 * The obvious default is to assume the thread is ours until told otherwise —
 * every existing tenant's thread is, today. But that is exactly the reading
 * that produces the double answer the moment a portfolio turns the Meta agent
 * on: nobody would have told us, and "no record" would have read as permission.
 *
 * So `unknown` is its own state, and what it means is decided by the flag. With
 * coexistence OFF — where this platform is the only agent in the thread, which
 * is every account today — `unknown` speaks, because that is the truth. With it
 * ON, `unknown` stands down and asks, because the cost of staying quiet is a
 * late answer and the cost of the other mistake is two.
 *
 * ── WHY IT IS DURABLE ───────────────────────────────────────────────────────
 *
 * Thread control moves on a webhook and is read on a send, which are different
 * processes and different restarts. Held in memory, a deploy in between makes
 * every thread `unknown` — and under coexistence that means a silent platform.
 * The state belongs in the tenant's schema next to the conversation it is about.
 */

export const THREAD_CONTROL_STATES = [
    /** This platform answers. The only state in which a send may go out. */
    'ours',
    /** Meta's agent holds the thread. We do not speak, and we do not queue. */
    'meta_agent',
    /**
     * We handed control away and the other side has not taken it.
     *
     * Distinct from `meta_agent`: nobody is answering, which is recoverable and
     * has to be, or a dropped handover is a customer waiting for ever.
     */
    'standby',
    /**
     * A person in this business has the thread.
     *
     * Its own state, not a reuse of `meta_agent`. Folding the two together —
     * which the first version did — meant a Meta "gave control" webhook set the
     * thread back to `ours` and the AI answered over a human who was still
     * typing. Meta cannot hand back something it never held.
     */
    'human_operator',
    /** Nobody has told us. Not a synonym for `ours`. */
    'unknown',
] as const;

export type ThreadControlState = (typeof THREAD_CONTROL_STATES)[number];

export interface ThreadControl {
    readonly state: ThreadControlState;
    /** When the state was last established, for the standby timeout. */
    readonly since: Date | null;
    /** What moved it, so a thread that went quiet can be explained. */
    readonly reason: string | null;
}

/**
 * How long a handover may sit unacknowledged before we take the thread back.
 *
 * Ten minutes: long enough that a slow acknowledgement is not mistaken for a
 * dropped one, short enough that a customer is not abandoned. The recovery is
 * deliberately OURS to make — waiting for the other side to notice it never
 * took control is waiting for the party that already failed.
 */
export const STANDBY_TIMEOUT_MS = 10 * 60 * 1000;

/** Events that move thread control. Each names who caused it. */
export type ThreadControlEvent =
    /** Meta told us its agent took the thread. */
    | { readonly kind: 'meta_took_control'; readonly detail?: string }
    /** Meta told us the thread came back to us. */
    | { readonly kind: 'meta_gave_control'; readonly detail?: string }
    /** We handed it over and are waiting for the other side. */
    | { readonly kind: 'we_handed_over'; readonly detail?: string }
    /** A person in the console took the thread. Outranks both agents. */
    | { readonly kind: 'human_took_over'; readonly detail?: string }
    /** The standby window elapsed with no acknowledgement. */
    | { readonly kind: 'standby_expired'; readonly detail?: string };

/**
 * The next state, from the current one and what happened.
 *
 * A total function over the pair, so a transition nobody thought about cannot
 * fall through to "keep whatever we had" — which is how a thread gets stuck in
 * `standby` and stops being answered by anybody.
 */
export function nextThreadControl(
    current: ThreadControl, event: ThreadControlEvent, at: Date,
): ThreadControl {
    const moved = (state: ThreadControlState, reason: string): ThreadControl =>
        Object.freeze({ state, since: at, reason });

    switch (event.kind) {
        case 'meta_took_control':
            return moved('meta_agent', event.detail ?? 'meta_took_control');
        case 'meta_gave_control':
            // A human's hold outranks this. Meta returning control it never had
            // must not take the thread away from the person in it — that is the
            // AI answering over somebody who is still typing.
            return current.state === 'human_operator'
                ? current
                : moved('ours', event.detail ?? 'meta_gave_control');
        case 'we_handed_over':
            // `standby`, not `meta_agent`: we know we let go, and we do NOT know
            // that anybody caught it. Recording the optimistic state here is how
            // a dropped handover becomes a customer nobody answers.
            return moved('standby', event.detail ?? 'we_handed_over');
        case 'human_took_over':
            // A person is in the thread. Neither agent speaks, and this is not
            // `standby` — somebody IS answering, so no timeout should fire.
            return moved('human_operator', event.detail ?? 'human_took_over');
        case 'standby_expired':
            // Only from standby. Arriving here in any other state means a stale
            // timer fired after control already moved, and honouring it would
            // take the thread back from whoever legitimately holds it.
            return current.state === 'standby'
                ? moved('ours', event.detail ?? 'standby_expired')
                : current;
        default: {
            // Exhaustiveness: a new event kind fails to compile rather than
            // silently leaving the thread where it was.
            const unreachable: never = event;
            return unreachable;
        }
    }
}

/** Has a standby handover gone unacknowledged long enough to take back? */
export function standbyExpired(control: ThreadControl, now: Date): boolean {
    if (control.state !== 'standby' || !control.since) return false;
    return now.getTime() - control.since.getTime() >= STANDBY_TIMEOUT_MS;
}

export interface SpeakVerdict {
    readonly maySpeak: boolean;
    /** `true` when the caller should keep the effect and try again later. */
    readonly retryable: boolean;
    readonly reason: string;
}

/**
 * May this platform answer in this thread right now?
 *
 * `coexistence` is the flag. Off — every account today — this answers yes for
 * everything except a thread a person has taken, because there is no other
 * agent to collide with and refusing would be inventing a problem.
 */
export function mayPlatformSpeak(input: {
    readonly control: ThreadControl;
    readonly coexistenceEnabled: boolean;
    readonly now: Date;
}): SpeakVerdict {
    const { control, coexistenceEnabled, now } = input;

    if (control.state === 'human_operator') {
        // BEFORE the flag, and deliberately. The flag is about the OTHER AGENT:
        // it says whether Meta has one in this thread. A person in this business
        // taking the conversation is the escalation that exists today, on every
        // account, with coexistence off — and an AI reply delivered over their
        // answer is precisely the failure a handoff exists to prevent.
        //
        // Not retryable, for a stronger reason than the agent case: there is no
        // later moment at which sending it becomes right.
        return {
            maySpeak: false,
            retryable: false,
            reason: 'human_operator:a person in this business holds this thread',
        };
    }

    if (!coexistenceEnabled) {
        return {
            maySpeak: true,
            retryable: false,
            reason: 'coexistence_off:this platform is the only agent in the thread',
        };
    }

    if (control.state === 'ours') {
        return { maySpeak: true, retryable: false, reason: 'thread_is_ours' };
    }

    if (control.state === 'standby') {
        // The handover was never acknowledged. Taking it back is recoverable
        // and has to be: the alternative is a customer waiting for ever on a
        // message nobody owns.
        if (standbyExpired(control, now)) {
            return { maySpeak: true, retryable: false, reason: 'standby_expired:taking the thread back' };
        }
        return {
            maySpeak: false,
            retryable: true,
            reason: 'standby:handed over and not yet acknowledged',
        };
    }

    if (control.state === 'meta_agent') {
        // NOT retryable. Another agent is answering this customer; holding our
        // reply to deliver it later would put a stale answer into a
        // conversation that has moved on.
        return {
            maySpeak: false,
            retryable: false,
            reason: 'meta_agent:another agent holds this thread',
        };
    }

    // `unknown`, with coexistence ON. Nobody has told us, and under coexistence
    // that is the state in which a double answer happens. Retryable, because the
    // next webhook may say whose it is.
    return {
        maySpeak: false,
        retryable: true,
        reason: 'unknown:thread control has not been established for this conversation',
    };
}

/** The state a conversation starts in: nobody has said anything yet. */
export function initialThreadControl(): ThreadControl {
    return Object.freeze({ state: 'unknown' as const, since: null, reason: null });
}
