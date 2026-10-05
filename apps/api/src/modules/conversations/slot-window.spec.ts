import { MAX_OFFERED_SLOTS, selectSlotWindow } from './slot-window';

const pad = (n: number) => String(n).padStart(2, '0');
const day = Array.from({ length: 20 }, (_, i) => {
    const m = 8 * 60 + i * 30;
    return { time: `${pad(Math.floor(m / 60))}:${pad(m % 60)}` };
});
const times = (slots: Array<{ time: string }>) => slots.map(s => s.time);

describe('selectSlotWindow', () => {
    it('keeps the first slots when no time was requested', () => {
        expect(times(selectSlotWindow(day))).toEqual(['08:00', '08:30', '09:00', '09:30', '10:00', '10:30']);
        expect(times(selectSlotWindow(day, ''))).toHaveLength(MAX_OFFERED_SLOTS);
    });

    it('ignores a requested time it cannot read instead of dropping slots', () => {
        expect(times(selectSlotWindow(day, 'por la tarde'))).toEqual(times(day.slice(0, 6)));
        expect(times(selectSlotWindow(day, '25:99'))).toEqual(times(day.slice(0, 6)));
    });

    it('includes an exact afternoon slot and returns chronological order', () => {
        const out = times(selectSlotWindow(day, '16:00'));
        expect(out).toContain('16:00');
        expect(out).toHaveLength(MAX_OFFERED_SLOTS);
        expect(out).toEqual([...out].sort());
    });

    it('keeps both neighbours when the requested time falls between two slots', () => {
        expect(times(selectSlotWindow(day, '16:10'))).toEqual(expect.arrayContaining(['16:00', '16:30']));
    });

    it('anchors to the edges of the day', () => {
        expect(times(selectSlotWindow(day, '08:00'))).toEqual(times(day.slice(0, 6)));
        expect(times(selectSlotWindow(day, '23:00'))).toEqual(times(day.slice(-6)));
    });

    it('returns a short list untouched', () => {
        expect(selectSlotWindow(day.slice(0, 4), '16:00')).toEqual(day.slice(0, 4));
    });
});
