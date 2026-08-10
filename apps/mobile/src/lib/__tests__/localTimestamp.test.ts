import { parseApiTimestamp } from '../localTimestamp';

describe('tenant-local wall-clock timestamps', () => {
    it('keeps a Bogotá 09:00 timestamp at 09:00 without applying a UTC shift', () => {
        const date = parseApiTimestamp('2026-08-10T09:00:00');
        expect(date).not.toBeNull();
        expect(date?.getFullYear()).toBe(2026);
        expect(date?.getMonth()).toBe(7);
        expect(date?.getDate()).toBe(10);
        expect(date?.getHours()).toBe(9);
        expect(date?.getMinutes()).toBe(0);
    });

    it('rejects ambiguous non-ISO timestamp strings', () => {
        expect(parseApiTimestamp('08/10/2026 09:00')).toBeNull();
    });
});
