import { restoreBookingMission } from './booking-state-continuity';
import type { BookingState } from './booking-engine.service';

describe('booking mission continuity', () => {
    const now = Date.parse('2026-09-06T15:00:00Z');
    const state: BookingState = {
        step: 'confirm', serviceId: 'service', serviceName: 'Consulta', date: '2026-09-10',
        time: '10:00', slots: [{ time: '10:00', endTime: '10:30' }], staffId: 'staff',
        services: [{ id: 'service', name: 'Consulta', price: 100, currency: 'COP', durationMinutes: 30 }],
        customerName: 'Alice', customerEmail: 'alice@example.test', flowStartedAt: '2026-09-06T14:00:00Z',
    };
    it('retains the exact current proposal during its validity period', () => {
        expect(restoreBookingMission(state, '2026-09-06T14:45:00Z', now)).toEqual({ state, requiresRevalidation: false });
    });
    it.each(['2026-09-06T14:20:00Z', '2026-09-05T15:00:00Z', undefined, 'invalid'])('restores preferences but strips stale consent, money and availability at %s', timestamp => {
        const restored = restoreBookingMission(state, timestamp, now);
        expect(restored.requiresRevalidation).toBe(true);
        expect(restored.state).toMatchObject({ step: 'ask_date', serviceId: 'service', date: '2026-09-10', customerName: 'Alice' });
        for (const field of ['time', 'slots', 'staffId', 'services', 'flowStartedAt'] as const) expect(restored.state[field]).toBeUndefined();
        expect(state.step).toBe('confirm');
    });
    it('does not restart a completed task or retain abandoned data indefinitely', () => {
        expect(restoreBookingMission({ ...state, step: 'booked' }, '2026-09-06T14:20:00Z', now).state).toEqual({ step: 'idle' });
        expect(restoreBookingMission(state, '2026-08-01T00:00:00Z', now).state).toEqual({ step: 'idle' });
    });
});
