import * as fs from 'fs';
import * as path from 'path';
import { assertTurnOutcome, type TurnOutcome } from '@parallext/shared';
import {
    DEFAULT_FAILURE_NOTICE_POLICY, FAILURE_EPISODE_MS, TURN_OUTCOME_REASONS,
    resolveFailureNoticePolicy,
    awaitingDatumReason, closingPleasantriesInEpisode, datumAskKey, isClosingPleasantry,
    routeNoticesInEpisode, turnsAwaitingDatum,
    decideAndAssertTurnOutcome, decideTurnOutcome, failureNoticesInEpisode, waitResumesAt,
} from './turn-outcome-wait';

const NOW = new Date('2026-10-01T12:00:00.000Z');

/**
 * A decision the provider acknowledged.
 *
 * `deliveredEffects` is how many of the turn's effects actually arrived. It
 * matters because the decision row is written BEFORE the dispatch it asks
 * for — otherwise a crash would lose the intent and send the notice twice —
 * so the row on its own proves only that a turn meant to speak.
 */
const sent = (reason: string, at: Date, deliveredEffects = 1) => ({
    createdAt: at, deliveredEffects,
    outcome: { version: 1, kind: 'send', reason, effects: [] } as TurnOutcome,
});

/** The same decision, with nothing to show for it. */
const decidedOnly = (reason: string, at: Date) => sent(reason, at, 0);

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
            priorFailureNotices: DEFAULT_FAILURE_NOTICE_POLICY.maxPerEpisode, now: NOW,
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
            { createdAt: new Date(NOW.getTime() - 60_000), deliveredEffects: 1,
                outcome: { version: 1, kind: 'send', effects: [] } as TurnOutcome },
        ], NOW)).toBe(0);
    });

    /**
     * ═══ A DECISION IS NOT A DELIVERY ═══
     *
     * Between deciding to send the notice and the customer's phone there is a
     * commit, a queue, a lease and a POST. Each of them can fail, and each
     * leaves the decision row exactly as it was. Counting that row would
     * answer the customer's NEXT message with silence, on the strength of a
     * message they never received — a person told nothing, twice, which is
     * the worst outcome this feature can produce.
     */
    it.each([
        ['a crash before the batch was admitted'],
        ['a provider rejection'],
        ['an outcome nobody could resolve'],
        ['an acceptance with no delivery evidence'],
    ])('does not count a notice that never arrived: %s', () => {
        // All four end the same way in the ledger — a `send` decision with no
        // acknowledged effect — so all four must be counted the same way.
        const undelivered = decidedOnly(TURN_OUTCOME_REASONS.failureNotice,
            new Date(NOW.getTime() - 60_000));
        expect(failureNoticesInEpisode([undelivered], NOW)).toBe(0);
        // And the customer is answered rather than left waiting.
        expect(decideTurnOutcome({
            hasEffects: true, isFailureNotice: true,
            priorFailureNotices: failureNoticesInEpisode([undelivered], NOW), now: NOW,
        }).deliver).toBe(true);
    });

    it('counts it once the provider acknowledged it, and then stays quiet', () => {
        const delivered = sent(TURN_OUTCOME_REASONS.failureNotice, new Date(NOW.getTime() - 60_000));
        expect(failureNoticesInEpisode([delivered], NOW)).toBe(1);
        expect(decideTurnOutcome({
            hasEffects: true, isFailureNotice: true,
            priorFailureNotices: failureNoticesInEpisode([delivered], NOW),
            episodeEndsAt: waitResumesAt([delivered], NOW), now: NOW,
        }).deliver).toBe(false);
    });

    it('anchors the wait on a notice that arrived, never on one that did not', () => {
        // Otherwise an older decision that failed to leave would push the
        // deadline back and hold the silence open longer than the episode.
        const ghost = decidedOnly(TURN_OUTCOME_REASONS.failureNotice,
            new Date(NOW.getTime() - 25 * 60_000));
        const real = sent(TURN_OUTCOME_REASONS.failureNotice, new Date(NOW.getTime() - 5 * 60_000));
        expect(waitResumesAt([ghost, real], NOW).toISOString())
            .toBe(new Date(real.createdAt.getTime() + FAILURE_EPISODE_MS).toISOString());
    });

    it('does not count a previous wait — silence is not a notice', () => {
        // Otherwise one wait would justify the next forever, and a conversation
        // that recovered would still be treated as failing.
        expect(failureNoticesInEpisode([{
            createdAt: new Date(NOW.getTime() - 60_000), deliveredEffects: 0,
            outcome: { version: 1, kind: 'wait', reason: TURN_OUTCOME_REASONS.failureNoticeAlreadySent,
                resumeAfter: NOW.toISOString(), effects: [] } as TurnOutcome,
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

describe('what counts as a goodbye of ours', () => {
    /**
     * The classifier reads OUR reply, never the customer's. What it has to get
     * right is not "did it spot the goodbye" — a missed one costs a single
     * message — but "did it ever call an ANSWER a goodbye", because that one
     * costs a customer.
     */
    it.each([
        ['¡Con gusto!'],
        ['Gracias a ti.'],
        ['Un placer, estoy para servirte.'],
        ['Que tengas un buen día.'],
        ['De nada, cualquier cosa estoy aquí.'],
        ['My pleasure, happy to help.'],
        ['Com prazer, disponha.'],
        ['Avec plaisir, bonne journée.'],
    ])('reads %s as one', reply => {
        expect(isClosingPleasantry(reply)).toBe(true);
    });

    it.each([
        // Every one of these is a real answer, and the early versions of this
        // classifier called two of them goodbyes.
        ['No, no hay.'],
        ['Nada.'],
        ['El corte cuesta cuarenta mil pesos.'],
        ['Abrimos de lunes a sábado.'],
        ['Claro, te agendo para mañana a las 3.'],
        ['¿Te sirve el martes?'],
        ['Con gusto, aquí tienes el enlace: https://pay.example.test/x'],
        ['Gracias. Ahora necesito tu documento para continuar con la reserva de mañana.'],
    ])('never reads %s as one', reply => {
        expect(isClosingPleasantry(reply)).toBe(false);
    });

    it('stops reading a reply as a goodbye once it is longer than a goodbye', () => {
        // Every word here is pleasantry vocabulary and the phrase is in the
        // catalog, so the only thing refusing it is the length bound. A reply
        // this long is doing something other than saying goodbye, whatever its
        // vocabulary, and the whole classifier is built to err this way.
        const short = 'Con gusto, gracias a ti, que tengas un buen dia.';
        const long = `${short} ${short} ${short} ${short}`;
        expect(short.length).toBeLessThanOrEqual(160);
        expect(long.length).toBeGreaterThan(160);
        expect(isClosingPleasantry(short)).toBe(true);
        expect(isClosingPleasantry(long)).toBe(false);
    });

    it('is not a goodbye when the turn also handed over a link or a picture', () => {
        // A reply that carries an effect is carrying something, whatever its
        // words look like, and the effect is what the customer came for.
        expect(isClosingPleasantry('¡Con gusto!', true)).toBe(false);
        expect(isClosingPleasantry('¡Con gusto!', false)).toBe(true);
    });

    it('never counts the turn re-running after a crash as a previous turn', () => {
        // The ledger row is keyed by the inbound and UPDATED in place, so a
        // turn that recorded `send` and then died is read back by its own
        // retry. Counted, the retry would see itself as two turns and hand a
        // customer to a person on their FIRST attempt at the datum.
        const own = {
            createdAt: new Date(NOW.getTime() - 1_000), deliveredEffects: 0,
            inboundMessageId: 'inbound-1',
            outcome: { version: 1 as const, kind: 'send' as const,
                reason: awaitingDatumReason('abcd1234'), effects: [] as readonly string[] },
        };
        const someoneElse = { ...own, inboundMessageId: 'inbound-0' };
        expect(turnsAwaitingDatum([own], 'abcd1234', NOW,
            DEFAULT_FAILURE_NOTICE_POLICY, 'inbound-1')).toBe(0);
        expect(turnsAwaitingDatum([someoneElse], 'abcd1234', NOW,
            DEFAULT_FAILURE_NOTICE_POLICY, 'inbound-1')).toBe(1);
        // The same rule for the other two counters.
        const closing = { ...own, outcome: { ...own.outcome, reason: TURN_OUTCOME_REASONS.courtesyClose } };
        expect(closingPleasantriesInEpisode([closing], NOW,
            DEFAULT_FAILURE_NOTICE_POLICY, 'inbound-1')).toBe(0);
        const routed = { ...own, outcome: { version: 1 as const, kind: 'escalate' as const,
            reason: TURN_OUTCOME_REASONS.stalledAskRoute, effects: [] as readonly string[] } };
        expect(routeNoticesInEpisode([routed], NOW,
            DEFAULT_FAILURE_NOTICE_POLICY, 'inbound-1')).toBe(0);
        expect(routeNoticesInEpisode([{ ...routed, inboundMessageId: 'inbound-0' }], NOW,
            DEFAULT_FAILURE_NOTICE_POLICY, 'inbound-1')).toBe(1);
    });

    it('gives two turns awaiting one field the same token, and two fields two', () => {
        // The whole difference between a long task and a loop. It is also why
        // the token is a digest: the reason code survives erasure, so it holds
        // something comparable and nothing readable.
        expect(datumAskKey('cedula')).toBe(datumAskKey('  CEDULA '));
        expect(datumAskKey('cedula')).not.toBe(datumAskKey('fecha'));
        expect(datumAskKey('')).toBeNull();
        expect(datumAskKey(null)).toBeNull();
        expect(datumAskKey('cedula')).not.toContain('cedula');
    });
});

describe('the turn actually uses it', () => {
    const service = fs.readFileSync(path.join(__dirname, 'conversations.service.ts'), 'utf8');

    it('decides the outcome before it delivers anything', () => {
        // `resolveTurnOutcome` is the one call the turn makes now: it reads the
        // policy, reads the episode and runs `decideAndAssertTurnOutcome`, so
        // the counting cannot drift away from the rule it feeds.
        const decidedAt = service.indexOf('await resolveTurnOutcome({');
        const deliveredAt = service.indexOf('await this.dispatchReplyThroughOutbox({');
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

describe('the failure-notice policy', () => {
    const NOW = new Date('2026-10-05T12:00:00.000Z');

    it('ships with the behaviour that was hard-coded before it', () => {
        expect(resolveFailureNoticePolicy(undefined)).toEqual({
            maxPerEpisode: 1, episodeMs: 30 * 60 * 1000,
            // The three limits added with the courtesy chain and the stalled
            // ask. Asserted whole rather than by field: a new limit that
            // shipped without anybody choosing its default would fail here
            // instead of arriving silently on every tenant.
            maxClosingPleasantriesPerEpisode: 1,
            maxTurnsAwaitingOneDatum: 2,
            maxRouteNoticesPerEpisode: 1,
        });
    });

    it('honours a tenant that wants to say it twice, over a longer episode', () => {
        expect(resolveFailureNoticePolicy({ maxPerEpisode: 2, episodeMinutes: 90 })).toEqual({
            maxPerEpisode: 2, episodeMs: 90 * 60 * 1000,
            maxClosingPleasantriesPerEpisode: 1,
            maxTurnsAwaitingOneDatum: 2,
            maxRouteNoticesPerEpisode: 1,
        });
    });

    it('refuses to be configured into silence', () => {
        // The failure mode on this side is a customer who writes in, gets
        // nothing and is never told why. No setting may make that the normal
        // behaviour, so zero and negatives clamp to one rather than being
        // honoured or throwing on the answering path.
        expect(resolveFailureNoticePolicy({ maxPerEpisode: 0 }).maxPerEpisode).toBe(1);
        expect(resolveFailureNoticePolicy({ maxPerEpisode: -3 }).maxPerEpisode).toBe(1);
    });

    it('refuses to be configured into the loop it exists to break', () => {
        expect(resolveFailureNoticePolicy({ maxPerEpisode: 100 }).maxPerEpisode).toBe(5);
        expect(resolveFailureNoticePolicy({ episodeMinutes: 60 * 24 * 30 }).episodeMs)
            .toBe(24 * 60 * 60 * 1000);
        expect(resolveFailureNoticePolicy({ episodeMinutes: 0 }).episodeMs).toBe(60 * 1000);
    });

    it('treats a value that is not a number as nothing configured', () => {
        // Different from clamping, and the difference matters: `"lots"` is a
        // mistake, and reading a mistake as "the maximum" would quintuple the
        // notices a customer receives because somebody typed a word.
        expect(resolveFailureNoticePolicy({ maxPerEpisode: 'lots', episodeMinutes: null }))
            .toEqual(DEFAULT_FAILURE_NOTICE_POLICY);
        expect(resolveFailureNoticePolicy('nonsense')).toEqual(DEFAULT_FAILURE_NOTICE_POLICY);
    });

    it('lets the second notice through when the tenant allows two', () => {
        const sent = [{
            outcome: { version: 1 as const, kind: 'send' as const, reason: TURN_OUTCOME_REASONS.failureNotice,
                effects: [] as readonly string[] },
            createdAt: new Date(NOW.getTime() - 60_000),
            deliveredEffects: 1,
        }];
        const policy = resolveFailureNoticePolicy({ maxPerEpisode: 2 });
        const decision = decideTurnOutcome({
            hasEffects: true, isFailureNotice: true,
            priorFailureNotices: failureNoticesInEpisode(sent, NOW, policy),
            policy, now: NOW,
        });
        expect(decision.deliver).toBe(true);
        // And the third does not.
        expect(decideTurnOutcome({
            hasEffects: true, isFailureNotice: true, priorFailureNotices: 2, policy, now: NOW,
        }).deliver).toBe(false);
    });

    it('refuses to be configured into never closing or never asking twice', () => {
        // The floors of the three limits added with the courtesy chain and the
        // stalled ask, and the one that is NOT one: at a single turn per datum
        // the first rephrasing of a question would already hand the thread to a
        // person, so a customer who mistyped their id once would never get a
        // second chance to type it.
        expect(resolveFailureNoticePolicy({ maxClosingPleasantries: 0 })
            .maxClosingPleasantriesPerEpisode).toBe(1);
        expect(resolveFailureNoticePolicy({ maxTurnsAwaitingOneDatum: 1 })
            .maxTurnsAwaitingOneDatum).toBe(2);
        expect(resolveFailureNoticePolicy({ maxTurnsAwaitingOneDatum: 0 })
            .maxTurnsAwaitingOneDatum).toBe(2);
        expect(resolveFailureNoticePolicy({ maxRouteNotices: 0 })
            .maxRouteNoticesPerEpisode).toBe(1);
    });

    it('refuses to be configured into the loops those three exist to break', () => {
        expect(resolveFailureNoticePolicy({ maxClosingPleasantries: 99 })
            .maxClosingPleasantriesPerEpisode).toBe(5);
        expect(resolveFailureNoticePolicy({ maxTurnsAwaitingOneDatum: 99 })
            .maxTurnsAwaitingOneDatum).toBe(6);
        expect(resolveFailureNoticePolicy({ maxRouteNotices: 99 })
            .maxRouteNoticesPerEpisode).toBe(3);
    });

    it('honours a tenant that wants three attempts at one datum', () => {
        const policy = resolveFailureNoticePolicy({ maxTurnsAwaitingOneDatum: 3 });
        expect(decideTurnOutcome({
            hasEffects: true, isFailureNotice: false, priorFailureNotices: 0,
            awaitingDatumKey: 'abcd1234', priorTurnsAwaitingDatum: 2,
            routeNotice: 'transfiriendo', policy, now: NOW,
        }).deliver).toBe(true);
        expect(decideTurnOutcome({
            hasEffects: true, isFailureNotice: false, priorFailureNotices: 0,
            awaitingDatumKey: 'abcd1234', priorTurnsAwaitingDatum: 3,
            routeNotice: 'transfiriendo', policy, now: NOW,
        }).outcome.kind).toBe('escalate');
    });

    it(`counts an episode by the tenant's own window`, () => {
        const forty = [{
            outcome: { version: 1 as const, kind: 'send' as const, reason: TURN_OUTCOME_REASONS.failureNotice,
                effects: [] as readonly string[] },
            createdAt: new Date(NOW.getTime() - 40 * 60 * 1000),
            deliveredEffects: 1,
        }];
        // Forty minutes ago is outside the default half-hour episode and inside
        // a ninety-minute one. Same evidence, different tenant, different answer.
        expect(failureNoticesInEpisode(forty, NOW)).toBe(0);
        expect(failureNoticesInEpisode(forty, NOW, resolveFailureNoticePolicy({ episodeMinutes: 90 })))
            .toBe(1);
    });
});
