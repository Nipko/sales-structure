import { isWithinOpeningHours, scheduleEntryForDay, scheduleEntryWindow } from './informational-hours';
import { resolveBusinessWindow } from './business-window';

/**
 * `isWithinOpeningHours` is the single after-hours gate (conversation pipeline AND automation listener).
 * Precedence: business hours that list a week > the agent schedule > nothing configured = open.
 * Every level is pinned with an explicit clock, in every spelling of the day keys the product stores:
 * English full (`monday`, business hours), Spanish abbreviations (`lun`, the agent editor), English
 * abbreviations (`mon`, vertical defaults / older records), Spanish full names, and "HH:MM-HH:MM" strings.
 *
 * Bogota is UTC-5 all year. Wednesday 2026-10-07 11:00 / 15:00 / 20:00, Sunday 2026-10-04 12:00.
 */
const WED_11 = new Date('2026-10-07T16:00:00Z');
const WED_20 = new Date('2026-10-08T01:00:00Z');
const WED_15 = new Date('2026-10-07T20:00:00Z');
const SUN_12 = new Date('2026-10-04T17:00:00Z');
const TZ = 'America/Bogota';

const business = (schedule: any, extra: any = {}) => ({ is247: false, timezone: TZ, schedule, ...extra });
const wizardShell = { is247: false, timezone: TZ, schedule: {}, afterHoursMessage: 'Cerrado' };

describe('level 1: business hours that list a week decide', () => {
    const week = business({ wednesday: { enabled: true, open: '08:00', close: '12:00' }, sunday: { enabled: false, open: '08:00', close: '12:00' } });

    it('open inside the listed day, closed outside it, closed on a disabled day', () => {
        expect(isWithinOpeningHours(week, undefined, WED_11)).toBe(true);
        expect(isWithinOpeningHours(week, undefined, WED_20)).toBe(false);
        expect(isWithinOpeningHours(week, undefined, SUN_12)).toBe(false);
    });

    it('wins over a different agent schedule', () => {
        const agent = { timezone: TZ, schedule: { mie: { start: '18:00', end: '22:00' } } };
        expect(isWithinOpeningHours(week, agent, WED_11)).toBe(true);
        expect(isWithinOpeningHours(week, agent, WED_20)).toBe(false);
    });

    it('24/7 is open at any time, whatever the agent says', () => {
        expect(isWithinOpeningHours({ is247: true }, { schedule: { mie: { start: '01:00', end: '02:00' } } }, WED_20)).toBe(true);
    });

    it('a day missing from the week is closed', () => {
        expect(isWithinOpeningHours(business({ monday: { enabled: true, open: '08:00', close: '12:00' } }), undefined, WED_11)).toBe(false);
    });
});

describe('level 2: the agent schedule decides when the business record lists no day', () => {
    const windows = { start: '14:00', end: '18:00' };
    // Every key spelling must find "today" (Wednesday): the automation bug was that only `mon`-style was read.
    it.each([
        ['Spanish abbreviation (agent editor)', { mie: windows }],
        ['English abbreviation', { wed: windows }],
        ['English full name', { wednesday: windows }],
        ['Spanish full name', { miercoles: windows }],
        ['Spanish full name with accent', { 'miércoles': windows }],
        ['open/close naming', { mie: { open: '14:00', close: '18:00' } }],
        ['"HH:MM-HH:MM" string', { wed: '14:00-18:00' }],
    ])('%s: open inside, closed outside', (_label, schedule) => {
        const agent = { timezone: TZ, schedule };
        for (const bizHours of [null, undefined, {}, wizardShell]) {
            expect(isWithinOpeningHours(bizHours, agent, WED_15)).toBe(true);
            expect(isWithinOpeningHours(bizHours, agent, WED_11)).toBe(false);
            expect(isWithinOpeningHours(bizHours, agent, WED_20)).toBe(false);
        }
    });

    it('a day that is not in the agent schedule, a disabled day and an unreadable value are closed', () => {
        expect(isWithinOpeningHours(null, { timezone: TZ, schedule: { lun: { start: '08:00', end: '18:00' } } }, WED_11)).toBe(false);
        expect(isWithinOpeningHours(null, { timezone: TZ, schedule: { mie: { enabled: false, start: '08:00', end: '18:00' } } }, WED_11)).toBe(false);
        expect(isWithinOpeningHours(null, { timezone: TZ, schedule: { mie: 'cerrado' } }, WED_11)).toBe(false);
    });

    it('seven days 00:00-23:59 is 24/7', () => {
        const all = { start: '00:00', end: '23:59' };
        const schedule = { lun: all, mar: all, mie: all, jue: all, vie: all, sab: all, dom: all };
        expect(isWithinOpeningHours(null, { timezone: TZ, schedule }, WED_20)).toBe(true);
    });

    it('uses the time zone of the source that decides, then the other, then the fallback', () => {
        const agent = { schedule: { mie: { start: '20:30', end: '22:00' } } };
        // 20:00 Bogota is 21:00 in Caracas (UTC-4).
        expect(isWithinOpeningHours({ ...wizardShell, timezone: 'America/Bogota' }, agent, WED_20)).toBe(false);
        expect(isWithinOpeningHours({ ...wizardShell, timezone: 'America/Caracas' }, agent, WED_20)).toBe(true);
        expect(isWithinOpeningHours(null, agent, WED_20, 'America/Caracas')).toBe(true);
        expect(isWithinOpeningHours(null, agent, WED_20, 'America/Bogota')).toBe(false);
        // An invalid zone falls back instead of throwing.
        expect(isWithinOpeningHours(null, { timezone: 'Not/AZone', schedule: { mie: { start: '14:00', end: '18:00' } } }, WED_15)).toBe(true);
    });

    it('reads midnight as 00:00, not 24:00', () => {
        const agent = { timezone: TZ, schedule: { jue: { start: '00:00', end: '02:00' } } };
        expect(isWithinOpeningHours(null, agent, new Date('2026-10-08T05:30:00Z'))).toBe(true); // Thursday 00:30 Bogota
    });
});

/** Bogota is UTC-5: a Bogota wall-clock time as an instant. */
const bogota = (date: string, time: string) => new Date(`${date}T${time}:00-05:00`);

describe('every weekday alias is read (Monday, not only the Wednesday/Sunday the other cases pin)', () => {
    const MON = '2026-10-05';
    it.each([
        ['lun', { lun: { start: '08:00', end: '12:00' } }],
        ['lunes', { lunes: { start: '08:00', end: '12:00' } }],
        ['mon', { mon: { start: '08:00', end: '12:00' } }],
        ['monday', { monday: { start: '08:00', end: '12:00' } }],
    ])('agent key %s', (_alias, schedule) => {
        const agent = { timezone: TZ, schedule };
        expect(isWithinOpeningHours(null, agent, bogota(MON, '11:00'))).toBe(true);
        expect(isWithinOpeningHours(null, agent, bogota(MON, '13:00'))).toBe(false);
        // Another day of the same week is not Monday's entry.
        expect(isWithinOpeningHours(null, agent, bogota('2026-10-06', '11:00'))).toBe(false);
    });

    it('business hours key monday', () => {
        const week = business({ monday: { enabled: true, open: '08:00', close: '12:00' } });
        expect(isWithinOpeningHours(week, undefined, bogota(MON, '11:00'))).toBe(true);
        expect(isWithinOpeningHours(week, undefined, bogota(MON, '13:00'))).toBe(false);
    });
});

describe('the closing minute is inclusive, the minute after is closed', () => {
    const agent = { timezone: TZ, schedule: { mie: { start: '14:00', end: '18:00' } } };
    it('opening and closing boundaries', () => {
        expect(isWithinOpeningHours(null, agent, bogota('2026-10-07', '13:59'))).toBe(false);
        expect(isWithinOpeningHours(null, agent, bogota('2026-10-07', '14:00'))).toBe(true);
        expect(isWithinOpeningHours(null, agent, bogota('2026-10-07', '18:00'))).toBe(true);
        expect(isWithinOpeningHours(null, agent, bogota('2026-10-07', '18:01'))).toBe(false);
    });

    it('business hours have the same boundary', () => {
        const week = business({ wednesday: { enabled: true, open: '14:00', close: '18:00' } });
        expect(isWithinOpeningHours(week, undefined, bogota('2026-10-07', '18:00'))).toBe(true);
        expect(isWithinOpeningHours(week, undefined, bogota('2026-10-07', '18:01'))).toBe(false);
    });
});

describe('overnight windows (close before open)', () => {
    // Monday 2026-10-05 22:00 -> Tuesday 02:00. Tuesday has no entry of its own.
    const night = { timezone: TZ, schedule: { lun: { start: '22:00', end: '02:00' } } };

    it('22:00-02:00 is open Monday evening and Tuesday small hours, closed outside', () => {
        expect(isWithinOpeningHours(null, night, bogota('2026-10-05', '21:59'))).toBe(false);
        expect(isWithinOpeningHours(null, night, bogota('2026-10-05', '22:00'))).toBe(true);
        expect(isWithinOpeningHours(null, night, bogota('2026-10-05', '23:00'))).toBe(true);
        expect(isWithinOpeningHours(null, night, bogota('2026-10-06', '01:00'))).toBe(true);
        expect(isWithinOpeningHours(null, night, bogota('2026-10-06', '02:00'))).toBe(true);
        expect(isWithinOpeningHours(null, night, bogota('2026-10-06', '02:01'))).toBe(false);
        expect(isWithinOpeningHours(null, night, bogota('2026-10-06', '12:00'))).toBe(false);
    });

    it('the small hours belong to the day that opened: Monday 01:00 is not Monday-night overflow', () => {
        expect(isWithinOpeningHours(null, night, bogota('2026-10-05', '01:00'))).toBe(false);
    });

    it('a disabled day contributes no overflow', () => {
        const off = { timezone: TZ, schedule: { lun: { enabled: false, start: '22:00', end: '02:00' } } };
        expect(isWithinOpeningHours(null, off, bogota('2026-10-06', '01:00'))).toBe(false);
        expect(isWithinOpeningHours(null, off, bogota('2026-10-05', '23:00'))).toBe(false);
    });

    it('the week wraps: Sunday night spills into Monday', () => {
        const sunday = { timezone: TZ, schedule: { dom: { start: '22:00', end: '02:00' } } };
        expect(isWithinOpeningHours(null, sunday, bogota('2026-10-05', '01:00'))).toBe(true); // Monday 01:00
        expect(isWithinOpeningHours(null, sunday, bogota('2026-10-04', '23:00'))).toBe(true); // Sunday 23:00
    });

    it('works for business hours too', () => {
        const week = business({ monday: { enabled: true, open: '22:00', close: '02:00' } });
        expect(isWithinOpeningHours(week, undefined, bogota('2026-10-05', '23:00'))).toBe(true);
        expect(isWithinOpeningHours(week, undefined, bogota('2026-10-06', '01:00'))).toBe(true);
        expect(isWithinOpeningHours(week, undefined, bogota('2026-10-06', '03:00'))).toBe(false);
    });

    it.each(['00:00', '24:00'])('a close of %s means midnight: 18:00-%s is open at 23:30', (close) => {
        const evening = { timezone: TZ, schedule: { lun: { start: '18:00', end: close } } };
        expect(isWithinOpeningHours(null, evening, bogota('2026-10-05', '17:59'))).toBe(false);
        expect(isWithinOpeningHours(null, evening, bogota('2026-10-05', '23:30'))).toBe(true);
        expect(isWithinOpeningHours(null, evening, bogota('2026-10-05', '23:59'))).toBe(true);
        expect(isWithinOpeningHours(null, evening, bogota('2026-10-06', '00:01'))).toBe(false);
    });

    it('a close of 00:00 includes the midnight minute itself, nothing after it', () => {
        const evening = { timezone: TZ, schedule: { lun: { start: '18:00', end: '00:00' } } };
        expect(isWithinOpeningHours(null, evening, bogota('2026-10-06', '00:00'))).toBe(true);
        expect(isWithinOpeningHours(null, evening, bogota('2026-10-06', '00:01'))).toBe(false);
    });
});

describe('level 3: nothing configured -> open', () => {
    it.each([
        ['nothing at all', undefined, undefined],
        ['empty agent schedule', null, { schedule: {} }],
        ['no agent schedule', null, {}],
        ['wizard record + empty agent schedule', wizardShell, { schedule: {} }],
    ])('%s', (_label, bizHours, agent) => {
        expect(isWithinOpeningHours(bizHours, agent, WED_20)).toBe(true);
        expect(isWithinOpeningHours(bizHours, agent, SUN_12)).toBe(true);
    });
});

describe('helpers', () => {
    it('finds an entry under any alias of the weekday', () => {
        expect(scheduleEntryForDay({ dom: 'x' }, 0)).toBe('x');
        expect(scheduleEntryForDay({ sat: 'y' }, 6)).toBe('y');
        expect(scheduleEntryForDay({ lun: 'z' }, 2)).toBeUndefined();
        expect(scheduleEntryForDay(null, 1)).toBeUndefined();
    });

    it('reads an entry window from objects and strings', () => {
        expect(scheduleEntryWindow({ start: '08:00', end: '12:30' })).toEqual([480, 750]);
        expect(scheduleEntryWindow('09:00-17:00')).toEqual([540, 1020]);
        expect(scheduleEntryWindow({ enabled: false, open: '08:00', close: '12:00' })).toBeNull();
        expect(scheduleEntryWindow('closed')).toBeNull();
        expect(scheduleEntryWindow(undefined)).toBeNull();
    });
});

describe('resolveBusinessWindow follows the same precedence and keys', () => {
    // 2026-10-07 is a Wednesday.
    it('business hours, then the agent schedule in any spelling, then nothing', () => {
        const biz = business({ wednesday: { enabled: true, open: '08:00', close: '12:00' } });
        const agent = { schedule: { mie: { start: '14:00', end: '18:00' } } };
        expect(resolveBusinessWindow(biz, agent, '2026-10-07')).toEqual({ openMin: 480, closeMin: 720 });
        expect(resolveBusinessWindow(null, agent, '2026-10-07')).toEqual({ openMin: 840, closeMin: 1080 });
        expect(resolveBusinessWindow({ schedule: { wed: '09:00-17:00' }, is247: false }, undefined, '2026-10-07')).toEqual({ openMin: 540, closeMin: 1020 });
        expect(resolveBusinessWindow(null, { schedule: {} }, '2026-10-07')).toBeNull();
        expect(resolveBusinessWindow({ is247: true }, agent, '2026-10-07')).toBeNull();
    });

    it('the empty wizard record does not hide the agent schedule', () => {
        const agent = { schedule: { mie: { start: '14:00', end: '18:00' } } };
        expect(resolveBusinessWindow(wizardShell, agent, '2026-10-07')).toEqual({ openMin: 840, closeMin: 1080 });
    });
});
