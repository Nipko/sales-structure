import { buildScheduledTransition, buildHomeServiceSchedule, readHomeServices, validScheduleInput } from '../operationScheduling';

describe('atomic operation scheduling', () => {
    it('builds status and tenant-local timestamp together', () => {
        expect(buildScheduledTransition('2026-08-12', '14:30')).toEqual({
            status: 'scheduled',
            scheduledAt: '2026-08-12T14:30:00',
        });
    });

    it('never emits a partial scheduling payload', () => {
        expect(buildScheduledTransition('2026-02-30', '09:00')).toBeNull();
        expect(buildScheduledTransition('2026-08-12', '24:00')).toBeNull();
        expect(validScheduleInput('2026-08-12', '09:05')).toBe(true);
    });

    const service = { id: '11111111-1111-4111-8111-111111111111', name: 'Plomería', category: 'plomeria', durationMinutes: 60, isActive: true };

    it('carries an explicitly selected active service in the atomic scheduling payload', () => {
        const options = readHomeServices({ success: true, data: [service] });
        expect(buildHomeServiceSchedule('2026-09-18', '09:30', service.id, options)).toEqual({
            status: 'scheduled', scheduledAt: '2026-09-18T09:30:00', serviceId: service.id,
        });
        expect(buildHomeServiceSchedule('2026-09-18', '09:30', '', options)).toBeNull();
        expect(buildHomeServiceSchedule('2026-09-18', '09:30', 'deleted-service', options)).toBeNull();
        expect(buildHomeServiceSchedule('2026-02-30', '09:30', service.id, options)).toBeNull();
    });

    it('rejects failed catalogs and filters inactive or open-duration services', () => {
        expect(() => readHomeServices({ success: false, data: [service] })).toThrow();
        expect(() => readHomeServices({ success: true, data: null })).toThrow();
        expect(readHomeServices({ success: true, data: [
            { ...service, isActive: false }, { ...service, durationMinutes: 0 }, { ...service, isActive: undefined },
        ] })).toEqual([]);
        expect(buildHomeServiceSchedule('2026-09-18', '09:30', service.id, [])).toBeNull();
    });
});
