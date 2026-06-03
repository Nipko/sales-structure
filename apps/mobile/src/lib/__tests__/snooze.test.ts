import { snoozeUntil } from '../snooze';

describe('snoozeUntil', () => {
    const now = new Date('2026-06-03T14:30:00'); // local

    it('+1h y +3h suman horas', () => {
        expect(snoozeUntil('1h', now).getHours()).toBe(15);
        expect(snoozeUntil('3h', now).getHours()).toBe(17);
    });

    it('mañana 9:00 → día siguiente a las 9', () => {
        const d = snoozeUntil('tomorrow', now);
        expect(d.getDate()).toBe(4);
        expect(d.getHours()).toBe(9);
        expect(d.getMinutes()).toBe(0);
    });

    it('próxima semana → +7 días a las 9', () => {
        const d = snoozeUntil('nextWeek', now);
        expect(d.getDate()).toBe(10);
        expect(d.getHours()).toBe(9);
    });
});
