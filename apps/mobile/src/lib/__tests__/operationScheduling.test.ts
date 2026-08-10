import { buildScheduledTransition, validScheduleInput } from '../operationScheduling';

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
});
