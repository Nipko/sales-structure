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
        });
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
