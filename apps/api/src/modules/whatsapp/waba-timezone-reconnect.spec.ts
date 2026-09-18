import {
    evidenceNamesItsAccount, resolveZone, zoneOnConnection, zoneStillConfirmedFor,
    type NumberZone, type ZoneEvidence,
} from './waba-timezone-authority';

/**
 * ═══ A ZONE BELONGS TO THE ACCOUNT IT WAS CONFIRMED FOR ═══
 *
 * The manual reconnect (`WhatsappConnectionService.saveConnection`) rewrote
 * `metadata.wabaId` and `metadata.metaTimezoneId` to the new account and kept
 * `waba_timezone`: a zone confirmed for the OLD account then read as confirmed
 * for the new one, and `resolveZone` offered it to that account's next number
 * as `same_waba_same_id` — a zone nobody confirmed for it. Embedded Signup was
 * fixed for exactly this (apps/whatsapp `resolveBillingFacts`); these pin the
 * same rule on the API side: the reconnect clears what no longer applies, and
 * a donor whose evidence names another account donates nothing.
 */

const NOW = new Date('2026-10-05T12:00:00.000Z');
const confirmedFor = (wabaId: string, timezoneId: number): ZoneEvidence => ({
    source: 'human_confirmed', at: '2026-09-01T00:00:00.000Z', wabaId, timezoneId,
});
const number = (over: Partial<NumberZone> & { channelAccountId: string }): NumberZone => ({
    wabaId: 'waba-1', timezoneId: 42, zone: null, evidence: null, ...over,
});

describe('resolveZone never takes a donor whose zone was confirmed for another account', () => {
    it.each([
        ['another WABA', confirmedFor('waba-old', 42)],
        ['another Meta id', confirmedFor('waba-1', 7)],
    ])('skips a sibling whose evidence names %s', (_label, evidence) => {
        // The sibling now sits on waba-1 / 42, but its zone was confirmed for
        // something else and survived a reconnect.
        const stale = number({ channelAccountId: 'a', zone: 'America/Bogota', evidence });
        const target = number({ channelAccountId: 'b' });
        expect(resolveZone(target, [stale, target], NOW))
            .toEqual({ kind: 'unmapped', reason: 'no_confirmation_for_this_id' });
    });

    it('still inherits from a sibling whose evidence names the account it is on', () => {
        const donor = number({ channelAccountId: 'a', zone: 'America/Bogota', evidence: confirmedFor('waba-1', 42) });
        const target = number({ channelAccountId: 'b' });
        expect(resolveZone(target, [donor, target], NOW)).toMatchObject({ kind: 'inherited', zone: 'America/Bogota' });
    });

    it('still inherits from a zone with no evidence, or evidence that predates the ids', () => {
        // Unknown is not a change: rows confirmed before evidence carried ids.
        for (const evidence of [null, { source: 'human_confirmed', at: '2026-09-01T00:00:00.000Z' } as ZoneEvidence]) {
            const donor = number({ channelAccountId: 'a', zone: 'America/Bogota', evidence });
            expect(resolveZone(number({ channelAccountId: 'b' }), [donor], NOW).kind).toBe('inherited');
        }
    });

    it('does not let a stale donor turn an agreeing account into a contradiction to choose from', () => {
        const donor = number({ channelAccountId: 'a', zone: 'America/Bogota', evidence: confirmedFor('waba-1', 42) });
        const stale = number({ channelAccountId: 'c', zone: 'Europe/Madrid', evidence: confirmedFor('waba-old', 42) });
        expect(resolveZone(number({ channelAccountId: 'b' }), [donor, stale], NOW))
            .toMatchObject({ kind: 'inherited', zone: 'America/Bogota' });
    });

    it('reads "12", 12 and " 12 " as one Meta id', () => {
        expect(zoneStillConfirmedFor({ wabaId: 'w', timezoneId: ' 12 ' }, { wabaId: 'w', timezoneId: 12 })).toBe(true);
        expect(evidenceNamesItsAccount(number({ channelAccountId: 'a', timezoneId: 12, evidence: confirmedFor('waba-1', 12) })))
            .toBe(true);
    });
});

describe('zoneOnConnection: what a manual (re)connection leaves on the row', () => {
    const existing = (zone: string | null, metadata: Record<string, unknown>) => ({ zone, metadata });
    const onWaba1 = { channelAccountId: 'phone-1', wabaId: 'waba-1' };

    it('keeps a zone confirmed for this same account, and writes nothing about it', () => {
        const decision = zoneOnConnection({
            existing: existing('America/Bogota', { wabaId: 'waba-1', metaTimezoneId: '42', wabaTimezoneEvidence: confirmedFor('waba-1', 42) }),
            account: { ...onWaba1, timezoneId: '42' }, siblings: [], now: NOW,
        });
        expect(decision).toEqual({ wabaTimezone: undefined, metadata: {}, superseded: null, resolution: null });
    });

    it('keeps it when Meta simply did not report an id this time', () => {
        const decision = zoneOnConnection({
            existing: existing('America/Bogota', { wabaId: 'waba-1', metaTimezoneId: '42' }),
            account: { ...onWaba1, timezoneId: undefined }, siblings: [], now: NOW,
        });
        expect(decision.wabaTimezone).toBeUndefined();
        expect(decision.metadata).toEqual({});
    });

    it('clears a zone confirmed for another WABA, even when Meta reports the same id', () => {
        const decision = zoneOnConnection({
            existing: existing('America/Bogota', { wabaId: 'waba-old', metaTimezoneId: '42', wabaTimezoneEvidence: confirmedFor('waba-old', 42) }),
            account: { ...onWaba1, timezoneId: '42' }, siblings: [], now: NOW,
        });
        expect(decision.wabaTimezone).toBeNull();
        expect(decision.metadata).toEqual({ wabaTimezoneEvidence: null });
        expect(decision.superseded).toBe('America/Bogota');
    });

    it('clears a zone confirmed for another Meta id on the same WABA', () => {
        const decision = zoneOnConnection({
            existing: existing('America/Bogota', { wabaId: 'waba-1', metaTimezoneId: '42' }),
            account: { ...onWaba1, timezoneId: '7' }, siblings: [], now: NOW,
        });
        expect(decision.wabaTimezone).toBeNull();
        expect(decision.superseded).toBe('America/Bogota');
    });

    it('drops the old Meta id when the number moved to a WABA that reported none', () => {
        const decision = zoneOnConnection({
            existing: existing(null, { wabaId: 'waba-old', metaTimezoneId: '42' }),
            account: { ...onWaba1, timezoneId: null }, siblings: [], now: NOW,
        });
        // waba-1 never reported 42; keeping it would say it did.
        expect(decision.metadata).toEqual({ metaTimezoneId: null });
        expect(decision.wabaTimezone).toBeUndefined();
    });

    it('gives the new account the zone its own WABA already confirmed, with where it came from', () => {
        const sibling = number({ channelAccountId: 'phone-2', zone: 'America/Lima', evidence: confirmedFor('waba-1', 42) });
        const decision = zoneOnConnection({
            existing: existing('Europe/Madrid', { wabaId: 'waba-old', metaTimezoneId: '42' }),
            account: { ...onWaba1, timezoneId: '42' }, siblings: [sibling], now: NOW,
        });
        expect(decision.wabaTimezone).toBe('America/Lima');
        expect(decision.superseded).toBe('Europe/Madrid');
        expect(decision.metadata.wabaTimezoneEvidence).toEqual({
            source: 'same_waba_same_id', at: NOW.toISOString(), timezoneId: 42, wabaId: 'waba-1', from: 'phone-2',
        });
    });

    it('never inherits for the new account from a sibling whose zone was confirmed elsewhere', () => {
        const stale = number({ channelAccountId: 'phone-2', zone: 'America/Lima', evidence: confirmedFor('waba-old', 42) });
        const decision = zoneOnConnection({
            existing: null, account: { ...onWaba1, timezoneId: '42' }, siblings: [stale], now: NOW,
        });
        expect(decision.wabaTimezone).toBeUndefined();
        expect(decision.metadata).not.toHaveProperty('wabaTimezoneEvidence');
    });

    it('never lets a row inherit from its own stale self', () => {
        const self = number({ channelAccountId: 'phone-1', wabaId: 'waba-1', zone: 'Europe/Madrid' });
        const decision = zoneOnConnection({
            existing: existing(null, { wabaId: 'waba-1', metaTimezoneId: '42' }),
            account: { ...onWaba1, timezoneId: '42' }, siblings: [self], now: NOW,
        });
        expect(decision.wabaTimezone).toBeUndefined();
    });
});
