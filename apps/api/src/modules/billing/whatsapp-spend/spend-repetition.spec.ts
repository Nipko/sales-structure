import {
    DEFAULT_REPETITION_POLICY, describeRepetition, judgeRepetition, resolveRepetitionPolicy,
} from './spend-repetition';
import type { IdenticalDelivery } from './spend-ledger';

const NOW = new Date('2026-10-05T12:00:00.000Z');

const delivered = (minutesAgo: number, producer = 'outbound_queue'): IdenticalDelivery => ({
    effectKey: `eff-${minutesAgo}-${producer}`,
    producer,
    createdAt: new Date(NOW.getTime() - minutesAgo * 60_000),
    state: 'settled',
});

describe('saying the same thing again', () => {
    it('allows the first one, which is just a message', () => {
        expect(judgeRepetition([], DEFAULT_REPETITION_POLICY, NOW))
            .toEqual({ allowed: true, identical: 0, retryAfter: null, producers: [] });
    });

    it('refuses the second one inside the window', () => {
        const verdict = judgeRepetition([delivered(2)], DEFAULT_REPETITION_POLICY, NOW);
        expect(verdict.allowed).toBe(false);
        expect(verdict.identical).toBe(1);
    });

    it('catches the reminder and the drip saying it ten minutes apart', () => {
        // The waste this exists for. Two producers, two effect keys, one
        // sentence — so `effect_key` sees two different effects and this sees
        // one message being sent twice.
        const verdict = judgeRepetition(
            [delivered(9, 'appointment_reminder')], DEFAULT_REPETITION_POLICY, NOW);
        expect(verdict.allowed).toBe(false);
        expect(verdict.producers).toEqual(['appointment_reminder']);
        expect(describeRepetition(verdict)).toContain('appointment_reminder');
    });

    it('allows it again once the window has passed', () => {
        // A repeat is sometimes correct: the first may not have arrived, and a
        // customer may genuinely ask the same thing tomorrow. The limit is a
        // shape, not a sentence.
        expect(judgeRepetition([delivered(11)], DEFAULT_REPETITION_POLICY, NOW).allowed).toBe(true);
    });

    it('measures the cooldown from the last delivery, not from now', () => {
        // Otherwise a conversation retrying inside its own cooldown pushes the
        // deadline forward on every attempt and is never allowed to speak again.
        const verdict = judgeRepetition([delivered(2), delivered(8)], DEFAULT_REPETITION_POLICY, NOW);
        expect(verdict.retryAfter?.toISOString())
            .toBe(new Date(NOW.getTime() - 2 * 60_000 + 10 * 60_000).toISOString());
    });

    it('counts only what is inside the window', () => {
        const verdict = judgeRepetition(
            [delivered(2), delivered(30), delivered(200)],
            resolveRepetitionPolicy({ maxIdentical: 2 }), NOW);
        // Two of the three are outside ten minutes, so one identical delivery
        // stands and a second is still allowed.
        expect(verdict).toEqual({ allowed: true, identical: 1, retryAfter: null,
            producers: ['outbound_queue'] });
    });

    it('lets a tenant pay to say it twice', () => {
        const policy = resolveRepetitionPolicy({ maxIdentical: 2 });
        expect(judgeRepetition([delivered(2)], policy, NOW).allowed).toBe(true);
        expect(judgeRepetition([delivered(2), delivered(4)], policy, NOW).allowed).toBe(false);
    });
});

describe('the repetition policy', () => {
    it('ships with a ten-minute window and one copy', () => {
        expect(resolveRepetitionPolicy(undefined)).toEqual({
            windowMs: 10 * 60 * 1000, maxIdentical: 1, cooldownMs: 10 * 60 * 1000,
        });
    });

    it('refuses to be configured into never sending anything', () => {
        expect(resolveRepetitionPolicy({ maxIdentical: 0 }).maxIdentical).toBe(1);
        expect(resolveRepetitionPolicy({ maxIdentical: -5 }).maxIdentical).toBe(1);
    });

    it('refuses to be configured into the loop it exists to break', () => {
        expect(resolveRepetitionPolicy({ maxIdentical: 500 }).maxIdentical).toBe(10);
        expect(resolveRepetitionPolicy({ windowMinutes: 60 * 24 * 30 }).windowMs)
            .toBe(24 * 60 * 60 * 1000);
    });

    it('reads a null as nothing configured, not as a window of zero', () => {
        // `Number(null)` is zero and zero is finite, which is how an unset field
        // becomes the tightest possible setting in the version nobody tests.
        expect(resolveRepetitionPolicy({ windowMinutes: null, cooldownMinutes: null }))
            .toEqual(DEFAULT_REPETITION_POLICY);
        expect(resolveRepetitionPolicy({ maxIdentical: 'two' }).maxIdentical).toBe(1);
    });

    it('accepts the numeric strings a settings blob honestly holds', () => {
        expect(resolveRepetitionPolicy({ windowMinutes: '30', maxIdentical: '2' }))
            .toEqual({ windowMs: 30 * 60 * 1000, maxIdentical: 2, cooldownMs: 10 * 60 * 1000 });
    });
});
