import * as fs from 'fs';
import * as path from 'path';
import { assertTurnOutcome, type TurnOutcome } from '@parallext/shared';
import {
    FAILURE_EPISODE_MS, MAX_FAILURE_NOTICES_PER_EPISODE, TURN_OUTCOME_REASONS,
    decideAndAssertTurnOutcome, decideTurnOutcome, failureNoticesInEpisode, waitResumesAt,
} from './turn-outcome-wait';

const NOW = new Date('2026-10-01T12:00:00.000Z');

const sent = (reason: string, at: Date): { outcome: TurnOutcome; createdAt: Date } => ({
    createdAt: at,
    outcome: { version: 1, kind: 'send', reason, effects: [] },
});

describe('deciding not to answer, and what that costs', () => {
    it('lets the first failure notice through — a customer is told once', () => {
        const decision = decideTurnOutcome({
            hasEffects: true, isFailureNotice: true, priorFailureNotices: 0, now: NOW,
        });
        expect(decision.deliver).toBe(true);
        expect(decision.outcome.kind).toBe('send');
        expect(decision.outcome.reason).toBe(TURN_OUTCOME_REASONS.failureNotice);
    });

    it('turns the second one in the same episode into a wait that sends nothing', () => {
        const decision = decideTurnOutcome({
            hasEffects: true, isFailureNotice: true,
            priorFailureNotices: MAX_FAILURE_NOTICES_PER_EPISODE, now: NOW,
        });
        expect(decision.deliver).toBe(false);
        expect(decision.outcome.kind).toBe('wait');
        // The whole point: silence is a decision with a reason and a time.
        expect(decision.outcome.reason).toBe(TURN_OUTCOME_REASONS.failureNoticeAlreadySent);
        // A whole episode from now, because nothing said otherwise.
        expect(decision.outcome.resumeAfter).toBe(new Date(NOW.getTime() + FAILURE_EPISODE_MS).toISOString());
    });

    it('never authorises an effect on any outcome that does not deliver', () => {
        // The invariant the shared contract exists to hold, checked against
        // every shape this function can produce rather than the one we expect.
        for (const input of [
            { hasEffects: false, isFailureNotice: false, priorFailureNotices: 0 },
            { hasEffects: true, isFailureNotice: true, priorFailureNotices: 3 },
            { hasEffects: true, isFailureNotice: false, priorFailureNotices: 0, draft: true },
        ]) {
            const decision = decideAndAssertTurnOutcome({ ...input, now: NOW });
            assertTurnOutcome(decision.outcome);
            if (!decision.deliver) expect(decision.outcome.effects).toEqual([]);
        }
    });

    it('records a silent turn as a suppression instead of losing it', () => {
        const decision = decideTurnOutcome({
            hasEffects: false, isFailureNotice: false, priorFailureNotices: 0, now: NOW,
        });
        expect(decision.deliver).toBe(false);
        expect(decision.outcome.kind).toBe('suppress');
        expect(decision.outcome.reason).toBe(TURN_OUTCOME_REASONS.nothingToSay);
    });

    it('treats a draft as owed to a person, not to the customer', () => {
        const decision = decideTurnOutcome({
            hasEffects: true, isFailureNotice: false, priorFailureNotices: 0, draft: true, now: NOW,
        });
        expect(decision.deliver).toBe(false);
        expect(decision.outcome.reason).toBe(TURN_OUTCOME_REASONS.awaitingHumanReview);
    });
});

describe('who is never silenced by this', () => {
    /**
     * The failure mode a spend guard has to be tested against is not "did it
     * save money" — it is "who did it stop answering". These are the people the
     * directive names, and the answer for every one of them is the same: this
     * policy cannot see them, because it only counts what we already said.
     */
    it('answers a customer deep in a long booking, however many turns it took', () => {
        const decision = decideTurnOutcome({
            hasEffects: true, isFailureNotice: false, priorFailureNotices: 0, now: NOW,
        });
        expect(decision.deliver).toBe(true);
    });

    it('answers a complaint, a rephrasing, another language and a request for a person', () => {
        // None of these reach the decision at all: it takes no customer text.
        // The signature is the guarantee, so this asserts on the signature.
        const source = fs.readFileSync(path.join(__dirname, 'turn-outcome-wait.ts'), 'utf8');
        const signature = source.slice(source.indexOf('export function decideTurnOutcome'),
            source.indexOf('const now = input.now'));
        for (const forbidden of ['text', 'message', 'content', 'language', 'sentiment', 'abuse', 'spam']) {
            expect(signature.toLowerCase()).not.toContain(forbidden);
        }
    });

    it('answers again once a new episode starts', () => {
        const stale = sent(TURN_OUTCOME_REASONS.failureNotice,
            new Date(NOW.getTime() - FAILURE_EPISODE_MS - 1000));
        expect(failureNoticesInEpisode([stale], NOW)).toBe(0);
        expect(decideTurnOutcome({
            hasEffects: true, isFailureNotice: true,
            priorFailureNotices: failureNoticesInEpisode([stale], NOW), now: NOW,
        }).deliver).toBe(true);
    });
});

describe('counting only our own failure notices', () => {
    it('counts a notice sent inside the episode', () => {
        expect(failureNoticesInEpisode([
            sent(TURN_OUTCOME_REASONS.failureNotice, new Date(NOW.getTime() - 60_000)),
        ], NOW)).toBe(1);
    });

    it('does not count an ordinary answer as a failure notice', () => {
        expect(failureNoticesInEpisode([
            { createdAt: new Date(NOW.getTime() - 60_000), outcome: { version: 1, kind: 'send', effects: [] } },
        ], NOW)).toBe(0);
    });

    it('does not count a previous wait — silence is not a notice', () => {
        // Otherwise one wait would justify the next forever, and a conversation
        // that recovered would still be treated as failing.
        expect(failureNoticesInEpisode([{
            createdAt: new Date(NOW.getTime() - 60_000),
            outcome: { version: 1, kind: 'wait', reason: TURN_OUTCOME_REASONS.failureNoticeAlreadySent,
                resumeAfter: NOW.toISOString(), effects: [] },
        }], NOW)).toBe(0);
    });

    it('resumes when the notice that caused the wait leaves the window', () => {
        // Not a round ten minutes: the moment the answer could actually change.
        // A deadline that arrives while the answer is still "wait" teaches an
        // operator to ignore the field.
        const at = new Date(NOW.getTime() - 5 * 60_000);
        const resume = waitResumesAt([sent(TURN_OUTCOME_REASONS.failureNotice, at)], NOW);
        expect(resume.toISOString()).toBe(new Date(at.getTime() + FAILURE_EPISODE_MS).toISOString());
        const decision = decideTurnOutcome({
            hasEffects: true, isFailureNotice: true, priorFailureNotices: 1,
            episodeEndsAt: resume, now: NOW,
        });
        expect(decision.outcome.resumeAfter).toBe(resume.toISOString());
        expect(new Date(decision.outcome.resumeAfter!).getTime()).toBeGreaterThan(NOW.getTime());
    });

    it('takes the OLDEST notice in the window, so the wait ends when the episode does', () => {
        const older = new Date(NOW.getTime() - 20 * 60_000);
        const newer = new Date(NOW.getTime() - 2 * 60_000);
        const resume = waitResumesAt([
            sent(TURN_OUTCOME_REASONS.failureNotice, newer),
            sent(TURN_OUTCOME_REASONS.failureNotice, older),
        ], NOW);
        expect(resume.toISOString()).toBe(new Date(older.getTime() + FAILURE_EPISODE_MS).toISOString());
    });

    it('reads an unavailable ledger as "we do not know", and speaks', () => {
        // The store returns an empty list when it cannot answer. Erring towards
        // one message is better than leaving a person in silence because a
        // database was briefly unreachable.
        expect(failureNoticesInEpisode([], NOW)).toBe(0);
    });
});

describe('the turn actually uses it', () => {
    const service = fs.readFileSync(path.join(__dirname, 'conversations.service.ts'), 'utf8');

    it('decides the outcome before it delivers anything', () => {
        const decidedAt = service.indexOf('decideAndAssertTurnOutcome({');
        const deliveredAt = service.indexOf('const durable = await this.dispatchReplyThroughOutbox({');
        expect(decidedAt).toBeGreaterThan(0);
        expect(deliveredAt).toBeGreaterThan(decidedAt);
    });

    it('returns without reaching any producer when the outcome is a wait', () => {
        const at = service.indexOf(`if (decision.outcome.kind === 'wait')`);
        expect(at).toBeGreaterThan(0);
        const block = service.slice(at, service.indexOf('// 7. Send Response via Channel Gateway', at));
        expect(block).toContain('return;');
        // Not one egress primitive between the decision and the return.
        for (const producer of ['outboundQueue', 'dispatchReplyThroughOutbox', 'sendResponse',
            'sendMedia', 'sendPaymentLink', 'sendCollectedFlow', 'channelGateway']) {
            expect(block).not.toContain(producer);
        }
    });

    it('writes the outcome to the ledger, not only to a log line', () => {
        expect(service).toContain('this.turnLedger.recordOutcome(');
    });

    it('calls only methods the store actually has', () => {
        // The failure this catches: the turn reaches for a method that exists on
        // a test double and not on the store, and every spec stays green while
        // production throws on the first real turn.
        const store = fs.readFileSync(path.join(__dirname, 'agent-turn-ledger.store.ts'), 'utf8');
        const called = new Set([...service.matchAll(/this\.turnLedger\.(\w+)\(/g)].map(match => match[1]));
        expect(called.size).toBeGreaterThan(0);
        for (const method of called) {
            expect(store).toMatch(new RegExp(`\\basync ${method}\\s*\\(`));
        }
    });
});
