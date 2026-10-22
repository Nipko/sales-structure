import { authorityFor } from './__fixtures__/tool-authority.fixture';
import { SALON_SERVICE_ID, SALON_TENANT_ID, salonExecutor, type SalonOptions } from './__fixtures__/slot-window.harness';

/**
 * PR8 — check_availability `window` through the real handler (slot generation,
 * conflicts, holds). Salon 09:00-19:00, nothing booked tomorrow, as in production.
 */
const date = '2026-10-23';
const contactId = '22222222-2222-4222-8222-222222222222';

async function check(options: SalonOptions, args: Record<string, unknown>) {
    const harness = salonExecutor(options);
    const result = await harness.executor.execute(
        'tenant_salon', SALON_TENANT_ID, contactId, 'check_availability',
        { date, serviceId: SALON_SERVICE_ID, ...args }, undefined,
        { authority: authorityFor('check_availability') },
    );
    return { result, harness };
}
const times = (result: any) => (result.slots as Array<{ time: string }>).map(slot => slot.time);

describe('check_availability with a requested window (flag agentRuntime.slotWindow)', () => {
    it('afternoon: only afternoon slots, spread from 12:00 to closing', async () => {
        const { result, harness } = await check({ flag: true }, { window: { partOfDay: 'afternoon' } });
        expect(result.available).toBe(true);
        expect(result.requestedWindow).toEqual({ partOfDay: 'afternoon', from: '12:00', to: '19:00' });
        expect(result.outsideRequestedWindow).toBeUndefined();
        const offered = times(result);
        expect(offered).toHaveLength(6);
        expect(offered.every(time => time >= '12:00')).toBe(true);
        expect(offered[0]).toBe('12:00');
        expect(offered[offered.length - 1]).toBe('18:30');
        // Holds cover exactly what is offered.
        expect(harness.redis.acquireLockToken).toHaveBeenCalledTimes(offered.length);
    });

    it('"después de las 13:00" offers the range, not only 13:00', async () => {
        const { result } = await check({ flag: true }, { window: { from: '13:00' } });
        const offered = times(result);
        expect(offered.length).toBeGreaterThan(1);
        expect(offered[0]).toBe('13:00');
        expect(offered.every(time => time >= '13:00')).toBe(true);
    });

    it('a full afternoon is typed outsideRequestedWindow with the nearest free slots, never "no availability"', async () => {
        const { result } = await check({ flag: true, booked: [{ start: '12:00', end: '19:00' }] }, { window: { partOfDay: 'afternoon' } });
        expect(result.available).toBe(true);
        expect(result.outsideRequestedWindow).toBe(true);
        expect(times(result)).toEqual(['10:30', '11:00', '11:30']);
        expect(result.message).toContain('never say the day has no availability');
    });

    it('a business that closes at 18:00 answers "evening" with its latest slots', async () => {
        const { result } = await check({ flag: true, hours: [{ start: '09:00', end: '18:00' }] }, { window: { partOfDay: 'evening' } });
        expect(result.outsideRequestedWindow).toBe(true);
        expect(times(result)).toEqual(['16:30', '17:00', '17:30']);
    });

    it('an exact hour wins over the window (explicit-hour behaviour unchanged)', async () => {
        const withWindow = await check({ flag: true }, { time: '15:00', window: { partOfDay: 'morning' } });
        const plain = await check({ flag: false }, { time: '15:00' });
        expect(withWindow.result).toEqual(plain.result);
        expect(times(plain.result)).toContain('15:00');
    });

    it('a malformed window is ignored', async () => {
        const malformed = await check({ flag: true }, { window: { partOfDay: 'tarde' } });
        const plain = await check({ flag: true }, {});
        expect(malformed.result).toEqual(plain.result);
    });
});

describe('check_availability flag-off parity', () => {
    it('with the flag off a `window` argument changes nothing, byte for byte', async () => {
        const withWindow = await check({ flag: false }, { window: { partOfDay: 'afternoon' } });
        const without = await check({ flag: false }, {});
        expect(JSON.stringify(withWindow.result)).toBe(JSON.stringify(without.result));
        expect(times(without.result)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
    });

    it('without a `window` argument the flag is not even read', async () => {
        const { harness } = await check({ flag: true }, {});
        expect(harness.featureFlags.isFeatureEnabled).not.toHaveBeenCalled();
    });
});
