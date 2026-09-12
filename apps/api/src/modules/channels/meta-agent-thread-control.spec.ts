import {
    THREAD_CONTROL_STATES, STANDBY_TIMEOUT_MS, initialThreadControl, nextThreadControl,
    mayPlatformSpeak, standbyExpired, type ThreadControl, type ThreadControlEvent,
} from './meta-agent-thread-control';

/**
 * ═══ TWO AGENTS, ONE THREAD, ONE CUSTOMER ═══
 *
 * Meta's own business agent can answer inside the conversation this platform
 * answers in. Nothing in the pipeline asks whether it is our turn: `shouldHandoff`
 * reads the customer's words, and the durable lane asks whether the effect is
 * still authorised. Neither is the question.
 *
 * If both answer, the customer gets two DIFFERENT replies to one message —
 * possibly contradicting each other, and both billed. That is not the duplicate
 * the outbox prevents.
 */
const NOW = new Date('2026-10-05T12:00:00.000Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);

const at = (state: ThreadControl['state'], sinceMs = 0): ThreadControl =>
    ({ state, since: later(sinceMs), reason: 'test' });

describe('who owns the thread', () => {
    it('starts as unknown, which is not a synonym for ours', () => {
        // The obvious default is "ours until told otherwise", and it is exactly
        // the reading that produces a double answer the day a portfolio turns
        // the Meta agent on: nobody would have told us, and "no record" would
        // have read as permission.
        const start = initialThreadControl();
        expect(start.state).toBe('unknown');
        expect(start.since).toBeNull();
        expect(THREAD_CONTROL_STATES).toContain('unknown');
    });

    it.each([
        ['meta_took_control', 'meta_agent'],
        ['meta_gave_control', 'ours'],
        ['human_took_over', 'meta_agent'],
    ] as const)('moves to %s → %s', (kind, expected) => {
        const after = nextThreadControl(initialThreadControl(), { kind } as ThreadControlEvent, NOW);
        expect(after.state).toBe(expected);
        expect(after.since).toEqual(NOW);
    });

    it('records our own handover as STANDBY, not as the other side holding it', () => {
        // We know we let go. We do NOT know anybody caught it, and recording
        // the optimistic state is how a dropped handover becomes a customer
        // nobody answers.
        const after = nextThreadControl(at('ours'), { kind: 'we_handed_over' }, NOW);
        expect(after.state).toBe('standby');
    });

    it('ignores a standby timeout that fires after control already moved', () => {
        // A stale timer. Honouring it would take the thread back from whoever
        // legitimately holds it, which is the double answer arriving late.
        const held = at('meta_agent');
        expect(nextThreadControl(held, { kind: 'standby_expired' }, NOW)).toEqual(held);
    });

    it('takes the thread back when a handover is never acknowledged', () => {
        const after = nextThreadControl(at('standby'), { kind: 'standby_expired' }, NOW);
        expect(after.state).toBe('ours');
    });

    it('knows when the standby window has elapsed, and not before', () => {
        const handedOver = { state: 'standby' as const, since: NOW, reason: 'we_handed_over' };
        expect(standbyExpired(handedOver, later(STANDBY_TIMEOUT_MS - 1))).toBe(false);
        expect(standbyExpired(handedOver, later(STANDBY_TIMEOUT_MS))).toBe(true);
        // And never for a state that is not waiting on anybody.
        expect(standbyExpired(at('ours'), later(STANDBY_TIMEOUT_MS * 10))).toBe(false);
        expect(standbyExpired({ state: 'standby', since: null, reason: null }, NOW)).toBe(false);
    });
});

describe('may this platform answer right now', () => {
    const speak = (control: ThreadControl, coexistenceEnabled: boolean, now = NOW) =>
        mayPlatformSpeak({ control, coexistenceEnabled, now });

    it('answers everything while coexistence is OFF', () => {
        // Every account today. There is no other agent in the thread, and
        // refusing would be inventing a problem to protect against.
        for (const state of THREAD_CONTROL_STATES) {
            expect(speak(at(state), false).maySpeak).toBe(true);
        }
    });

    it('stands down on an UNKNOWN thread once coexistence is on', () => {
        // The cost of staying quiet is a late answer. The cost of the other
        // mistake is two answers to one message, from two agents.
        const verdict = speak(initialThreadControl(), true);
        expect(verdict.maySpeak).toBe(false);
        // Retryable: the next webhook may say whose thread it is.
        expect(verdict.retryable).toBe(true);
    });

    it('speaks when the thread is ours', () => {
        expect(speak(at('ours'), true).maySpeak).toBe(true);
    });

    it('does NOT hold a reply while the other agent has the thread', () => {
        // Deliberately not retryable. Another agent is answering this customer;
        // delivering our reply later would put a stale answer into a
        // conversation that has moved on.
        const verdict = speak(at('meta_agent'), true);
        expect({ maySpeak: verdict.maySpeak, retryable: verdict.retryable })
            .toEqual({ maySpeak: false, retryable: false });
    });

    it('holds a reply during standby, and sends it when the window lapses', () => {
        const handedOver: ThreadControl = { state: 'standby', since: NOW, reason: 'we_handed_over' };
        const during = speak(handedOver, true, later(STANDBY_TIMEOUT_MS - 1));
        expect({ maySpeak: during.maySpeak, retryable: during.retryable })
            .toEqual({ maySpeak: false, retryable: true });

        // The recovery, and it is OURS to make: waiting for the other side to
        // notice it never took control is waiting for the party that failed.
        const after = speak(handedOver, true, later(STANDBY_TIMEOUT_MS));
        expect(after.maySpeak).toBe(true);
        expect(after.reason).toContain('standby_expired');
    });

    it('always says WHY, because a thread that goes quiet has to be explainable', () => {
        for (const state of THREAD_CONTROL_STATES) {
            expect(speak(at(state), true).reason.length).toBeGreaterThan(8);
        }
    });
});
