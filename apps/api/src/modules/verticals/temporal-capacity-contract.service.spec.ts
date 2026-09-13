import { BadRequestException } from '@nestjs/common';
import { TemporalCapacityContractService } from './temporal-capacity-contract.service';

describe('TemporalCapacityContractService', () => {
    const service = new TemporalCapacityContractService();

    it('keeps appointment minutes and tenant timezone explicit', () => {
        expect(service.normalize({
            kind: 'appointment',
            startsAtLocal: '2026-08-08T23:30',
            timezone: 'America/Bogota',
            durationMinutes: 90,
            bufferMinutes: 15,
        })).toEqual({
            kind: 'appointment',
            startsAtLocal: '2026-08-08T23:30:00',
            timezone: 'America/Bogota',
            durationMinutes: 90,
            bufferMinutes: 15,
            endsAtLocal: '2026-08-09T01:00:00',
            startsAtUtc: '2026-08-09T04:30:00.000Z',
            endsAtUtc: '2026-08-09T06:00:00.000Z',
        });
    });

    it.each([
        ['Europe/Paris', '2026-03-29T02:15', 'nonexistent_local_time'],
        ['America/New_York', '2026-03-08T02:15', 'nonexistent_local_time'],
        ['Australia/Lord_Howe', '2026-10-04T02:15', 'nonexistent_local_time'],
        ['Pacific/Apia', '2011-12-30T12:00', 'nonexistent_local_time'],
        ['Europe/Paris', '2026-10-25T02:15', 'ambiguous_local_time'],
        ['America/New_York', '2026-11-01T01:15', 'ambiguous_local_time'],
        ['Australia/Lord_Howe', '2026-04-05T01:45', 'ambiguous_local_time'],
    ])('requires clarification for %s %s without inventing a replacement', (timezone, startsAtLocal, error) => {
        try { service.normalize({ kind: 'appointment', startsAtLocal, timezone, durationMinutes: 10 }); throw new Error('unexpected_success'); }
        catch (failure) { expect((failure as BadRequestException).getResponse()).toMatchObject({ error, requiresClarification: true, timezone, field: 'startsAtLocal' }); }
    });

    it.each([
        ['2026-11-01T01:15:00-04:00', '2026-11-01T05:15:00.000Z'],
        ['2026-11-01T01:15:00-05:00', '2026-11-01T06:15:00.000Z'],
    ])('preserves the explicit choice of an ambiguous time %s', (startsAtLocal, startsAtUtc) => {
        expect(service.normalize({ kind: 'appointment', startsAtLocal, timezone: 'America/New_York', durationMinutes: 10 })).toMatchObject({ startsAtLocal: '2026-11-01T01:15:00', endsAtLocal: '2026-11-01T01:25:00', startsAtUtc });
    });

    it.each(['2026-11-01T01:15:00-03:00', '2026-03-08T02:15:00-05:00'])('rejects an explicit offset that does not represent that local time %s', startsAtLocal => {
        try { service.normalize({ kind: 'appointment', startsAtLocal, timezone: 'America/New_York', durationMinutes: 10 }); throw new Error('unexpected_success'); }
        catch (failure) { expect((failure as BadRequestException).getResponse()).toMatchObject({ error: 'local_time_offset_mismatch', requiresClarification: true }); }
    });

    it('never changes the duration silently across a clock transition or a buffered ambiguous boundary', () => {
        for (const input of [
            { startsAtLocal: '2026-03-29T01:30', durationMinutes: 60, bufferMinutes: 0 },
            { startsAtLocal: '2026-10-25T01:30', durationMinutes: 120, bufferMinutes: 0 },
            { startsAtLocal: '2026-10-25T01:30', durationMinutes: 15, bufferMinutes: 30 },
        ]) expect(() => service.normalize({ kind: 'appointment', timezone: 'Europe/Paris', ...input })).toThrow(BadRequestException);
    });

    it.each(['UTC', 'America/Bogota', 'Asia/Kathmandu', 'Pacific/Chatham'])('accepts valid dates without machine timezone drift in %s', timezone => {
        const normalized: any = service.normalize({ kind: 'appointment', timezone, startsAtLocal: '2026-07-15T12:45', durationMinutes: 30 });
        expect(normalized.endsAtLocal).toBe('2026-07-15T13:15:00');
        expect(Date.parse(normalized.endsAtUtc) - Date.parse(normalized.startsAtUtc)).toBe(30 * 60_000);
    });

    it.each(['2026-02-30T10:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T10:00:00+24:00'])('rejects malformed explicit instants instead of Date.parse normalization: %s', startsAt => {
        expect(() => service.normalize({ kind: 'session', startsAt, endsAt: '2026-03-03T12:00:00Z', capacity: 1, booked: 0 })).toThrow(BadRequestException);
    });

    it('derives nights from a half-open date range instead of minutes', () => {
        expect(service.normalize({
            kind: 'nightly',
            checkInDate: '2026-08-08',
            checkOutDate: '2026-08-11',
            minNights: 2,
        })).toMatchObject({ nights: 3, checkInDate: '2026-08-08', checkOutDate: '2026-08-11' });

        expect(() => service.normalize({
            kind: 'nightly',
            checkInDate: '2026-08-08',
            checkOutDate: '2026-08-11',
            nights: 2,
        })).toThrow(BadRequestException);
    });

    it('models daycare/open availability as bounded day capacity', () => {
        const contract = {
            kind: 'day_capacity' as const,
            date: '2026-08-08',
            capacity: 20,
            reserved: 17,
        };
        expect(service.remainingCapacity(contract)).toBe(3);
        expect(() => service.normalize({ ...contract, reserved: 21 })).toThrow(BadRequestException);
    });

    it('models a class/tour session as an instant range with seats', () => {
        expect(service.normalize({
            kind: 'session',
            startsAt: '2026-08-08T10:00:00-05:00',
            endsAt: '2026-08-08T12:00:00-05:00',
            capacity: 12,
            booked: 11,
        })).toEqual({
            kind: 'session',
            startsAt: '2026-08-08T15:00:00.000Z',
            endsAt: '2026-08-08T17:00:00.000Z',
            capacity: 12,
            booked: 11,
        });
    });

    it('enforces half-open resource exclusion without cross-resource collisions', () => {
        const base = {
            kind: 'resource' as const,
            resourceId: '11111111-1111-4111-8111-111111111111',
            startsAt: '2026-08-08T10:00:00Z',
            endsAt: '2026-08-08T11:00:00Z',
            units: 1,
            exclusive: true,
        };
        expect(service.resourcesOverlap(base, { ...base, startsAt: '2026-08-08T10:30:00Z', endsAt: '2026-08-08T11:30:00Z' })).toBe(true);
        expect(service.resourcesOverlap(base, { ...base, startsAt: '2026-08-08T11:00:00Z', endsAt: '2026-08-08T12:00:00Z' })).toBe(false);
        expect(service.resourcesOverlap(base, { ...base, resourceId: '22222222-2222-4222-8222-222222222222' })).toBe(false);
    });

    it('rejects legacy open duration instead of inventing a 30/60 minute appointment', () => {
        expect(() => service.fromLegacyService({
            durationType: 'open',
            durationMinutes: 60,
            startsAtLocal: '2026-08-08T09:00',
            timezone: 'America/Bogota',
        })).toThrow(BadRequestException);
    });
});
