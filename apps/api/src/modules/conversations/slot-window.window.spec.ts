import { MAX_OFFERED_SLOTS, selectSlotsInWindow, spreadSlots } from './slot-window';

/** PR8: filter to the requested window BEFORE choosing, spread across it, and type an empty window. */
const pad = (n: number) => String(n).padStart(2, '0');
const at = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
// Salon 09:00-19:00, 30-min slots: 09:00 … 18:30 (20 slots).
const day = Array.from({ length: 20 }, (_, i) => ({ time: at(9 * 60 + i * 30) }));
const times = (slots: Array<{ time: string }>) => slots.map(s => s.time);
const afternoon = { fromMin: 12 * 60, toMin: 19 * 60 };

describe('spreadSlots', () => {
    it('keeps everything when it already fits', () => {
        expect(times(spreadSlots(day.slice(0, 4)))).toEqual(['09:00', '09:30', '10:00', '10:30']);
    });

    it('spreads across the whole range, first and last included, chronological', () => {
        const spread = times(spreadSlots(day));
        expect(spread).toHaveLength(MAX_OFFERED_SLOTS);
        expect(spread[0]).toBe('09:00');
        expect(spread[spread.length - 1]).toBe('18:30');
        expect([...spread].sort()).toEqual(spread);
        expect(new Set(spread).size).toBe(spread.length);
    });

    it('offers one slot per start time when several professionals share it', () => {
        const twoStaff = day.flatMap(slot => [{ ...slot, staffId: 'a' }, { ...slot, staffId: 'b' }]);
        const spread = spreadSlots(twoStaff);
        expect(new Set(times(spread)).size).toBe(spread.length);
        expect(spread.every(slot => slot.staffId === 'a')).toBe(true);
    });
});

describe('selectSlotsInWindow', () => {
    it('afternoon: only slots from 12:00, spread up to closing (never the morning first)', () => {
        const selection = selectSlotsInWindow(day, afternoon);
        expect(selection.kind).toBe('inside');
        const offered = times(selection.slots);
        expect(offered.every(time => time >= '12:00')).toBe(true);
        expect(offered[0]).toBe('12:00');
        expect(offered[offered.length - 1]).toBe('18:30');
        expect(offered).toHaveLength(MAX_OFFERED_SLOTS);
    });

    it('"después de las 13:00" never collapses to the single 13:00 slot', () => {
        const offered = times(selectSlotsInWindow(day, { fromMin: 13 * 60, toMin: 19 * 60 }).slots);
        expect(offered.length).toBeGreaterThan(1);
        expect(offered[0]).toBe('13:00');
        expect(offered.every(time => time >= '13:00')).toBe(true);
    });

    it('`to` is exclusive on the slot start', () => {
        const offered = times(selectSlotsInWindow(day, { fromMin: 9 * 60, toMin: 11 * 60 }).slots);
        expect(offered).toEqual(['09:00', '09:30', '10:00', '10:30']);
    });

    it('with a requested hour, the slots nearest to it inside the window', () => {
        const offered = times(selectSlotsInWindow(day, afternoon, '16:00').slots);
        expect(offered).toContain('16:00');
        expect(offered.every(time => time >= '12:00')).toBe(true);
    });

    it('an empty window is typed outsideRequestedWindow with the nearest free slots', () => {
        const morningOnly = day.filter(slot => slot.time < '12:00');
        const selection = selectSlotsInWindow(morningOnly, afternoon);
        expect(selection.kind).toBe('outsideRequestedWindow');
        expect(times(selection.slots)).toEqual(['10:30', '11:00', '11:30']);
    });

    it('nearest alternatives can come after the window too', () => {
        const lateOnly = day.filter(slot => slot.time >= '17:00');
        const selection = selectSlotsInWindow(lateOnly, { fromMin: 9 * 60, toMin: 12 * 60 });
        expect(selection.kind).toBe('outsideRequestedWindow');
        expect(times(selection.slots)).toEqual(['17:00', '17:30', '18:00']);
    });

    it('a day with no free slot at all is not "outside the window": it is plain no availability', () => {
        expect(selectSlotsInWindow([], afternoon)).toEqual({ kind: 'inside', slots: [], insideCount: 0 });
    });
});
