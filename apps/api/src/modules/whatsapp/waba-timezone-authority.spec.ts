import {
    contradictoryWabas, describeResolution, resolveZone, usableZone, type NumberZone,
} from './waba-timezone-authority';

const NOW = new Date('2026-10-05T12:00:00.000Z');

const number = (over: Partial<NumberZone> & { channelAccountId: string }): NumberZone => ({
    wabaId: 'waba-1', timezoneId: 42, zone: null, evidence: null, ...over,
});

describe('what counts as a time zone', () => {
    it('accepts one the runtime can actually date with', () => {
        for (const zone of ['America/Bogota', 'America/Argentina/Buenos_Aires', 'UTC', 'Europe/Madrid']) {
            expect(usableZone(zone, NOW)).toBe(zone);
        }
    });

    it('refuses Meta\'s numeric id, which is the whole problem', () => {
        // `timezone_id` is an integer from Facebook's own table. Accepted as a
        // zone it would date every charge against a value the runtime cannot
        // even parse.
        expect(usableZone('42', NOW)).toBeNull();
        expect(usableZone(42, NOW)).toBeNull();
        expect(usableZone('', NOW)).toBeNull();
        expect(usableZone('Not/AZone', NOW)).toBeNull();
        expect(usableZone(null, NOW)).toBeNull();
    });
});

describe('resolving one number', () => {
    it('uses the zone somebody already confirmed', () => {
        const target = number({ channelAccountId: 'a', zone: 'America/Bogota',
            evidence: { source: 'human_confirmed', at: NOW.toISOString() } });
        expect(resolveZone(target, [target], NOW))
            .toMatchObject({ kind: 'known', zone: 'America/Bogota' });
    });

    it('carries a confirmed zone to another number of the same account and id', () => {
        // Meta's zone belongs to the WABA, so this is reading one fact twice
        // rather than guessing a second one.
        const donor = number({ channelAccountId: 'a', zone: 'America/Bogota' });
        const target = number({ channelAccountId: 'b' });
        const resolution = resolveZone(target, [donor, target], NOW);
        expect(resolution).toMatchObject({ kind: 'inherited', zone: 'America/Bogota' });
        expect((resolution as any).evidence)
            .toMatchObject({ source: 'same_waba_same_id', from: 'a', timezoneId: 42 });
    });

    it('will not carry a zone across business accounts', () => {
        // Two WABAs can report the same numeric id and sit in different
        // countries. Inheriting there would be exactly the guess this refuses.
        const other = number({ channelAccountId: 'a', wabaId: 'waba-OTHER', zone: 'America/Bogota' });
        const target = number({ channelAccountId: 'b', wabaId: 'waba-1' });
        expect(resolveZone(target, [other, target], NOW))
            .toEqual({ kind: 'unmapped', reason: 'no_confirmation_for_this_id' });
    });

    it('will not carry a zone across different numeric ids', () => {
        const donor = number({ channelAccountId: 'a', timezoneId: 7, zone: 'America/Bogota' });
        const target = number({ channelAccountId: 'b', timezoneId: 42 });
        expect(resolveZone(target, [donor, target], NOW))
            .toEqual({ kind: 'unmapped', reason: 'no_confirmation_for_this_id' });
    });

    it('says so plainly when Meta reported no id at all', () => {
        expect(resolveZone(number({ channelAccountId: 'a', timezoneId: null }), [], NOW))
            .toEqual({ kind: 'unmapped', reason: 'no_timezone_id' });
    });

    it('never defaults, because a default is a wrong month nobody notices', () => {
        const resolution = resolveZone(number({ channelAccountId: 'a' }), [], NOW);
        expect(resolution.kind).toBe('unmapped');
        expect(resolution).not.toHaveProperty('zone');
    });

    it('refuses to choose when the account disagrees with itself', () => {
        const left = number({ channelAccountId: 'a', zone: 'America/Bogota' });
        const right = number({ channelAccountId: 'b', zone: 'America/Mexico_City' });
        const target = number({ channelAccountId: 'c' });
        expect(resolveZone(target, [left, right, target], NOW))
            .toEqual({ kind: 'contradictory', zones: ['America/Bogota', 'America/Mexico_City'] });
    });

    it('ignores a sibling whose stored zone is not a zone', () => {
        // A row holding Meta's numeric id would otherwise be inherited as if it
        // were an answer.
        const broken = number({ channelAccountId: 'a', zone: '42' });
        expect(resolveZone(number({ channelAccountId: 'b' }), [broken], NOW).kind).toBe('unmapped');
    });
});

describe('a business account that disagrees with itself', () => {
    it('is reported, not averaged', () => {
        // There is no correct way to average a time zone, and the wrong way
        // dates some charges in a month that did not happen for that number.
        const conflicts = contradictoryWabas([
            number({ channelAccountId: 'a', zone: 'America/Bogota' }),
            number({ channelAccountId: 'b', zone: 'America/Mexico_City' }),
            number({ channelAccountId: 'c', wabaId: 'waba-2', zone: 'UTC' }),
        ], NOW);
        expect(conflicts).toEqual([{
            wabaId: 'waba-1',
            zones: ['America/Bogota', 'America/Mexico_City'],
            numbers: ['a', 'b'],
        }]);
    });

    it('is silent when every number agrees', () => {
        expect(contradictoryWabas([
            number({ channelAccountId: 'a', zone: 'America/Bogota' }),
            number({ channelAccountId: 'b', zone: 'America/Bogota' }),
        ], NOW)).toEqual([]);
    });

    it('does not invent a conflict out of numbers that have no zone yet', () => {
        expect(contradictoryWabas([
            number({ channelAccountId: 'a', zone: 'America/Bogota' }),
            number({ channelAccountId: 'b', zone: null }),
        ], NOW)).toEqual([]);
    });
});

describe('what a person is told', () => {
    it('offers the one-field fix for an unmapped id', () => {
        const target = number({ channelAccountId: 'a' });
        const line = describeResolution(target, resolveZone(target, [], NOW));
        expect(line).toContain('42');
        expect(line).toContain('numeric id');
        expect(line).toContain('every number that reports the same id will follow');
    });

    it('says an inherited zone can be corrected', () => {
        const donor = number({ channelAccountId: 'a', zone: 'America/Bogota' });
        const target = number({ channelAccountId: 'b' });
        expect(describeResolution(target, resolveZone(target, [donor, target], NOW)))
            .toContain('Change it here if that is wrong');
    });

    it('names both zones when the account contradicts itself', () => {
        const target = number({ channelAccountId: 'c' });
        const line = describeResolution(target, resolveZone(target, [
            number({ channelAccountId: 'a', zone: 'America/Bogota' }),
            number({ channelAccountId: 'b', zone: 'America/Mexico_City' }),
            target,
        ], NOW));
        expect(line).toContain('America/Bogota');
        expect(line).toContain('America/Mexico_City');
        expect(line).toContain('wrong month');
    });
});
