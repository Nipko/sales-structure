/**
 * The calendar words of a customer message: «16 de octubre», «viernes», «el 16 de octubre de 2026», «dia 16».
 *
 * One reader for the intent interpreter (booking) and the reschedule target of the transition engine, because both used to read the
 * same message in two different ways and the order of their dictionaries decided the answer: «para el viernes 16 de octubre a las
 * 11:00» became «viernes 9» (the weekday overwrote the date), and «la del miércoles, … para el viernes 16 de octubre» became the
 * miércoles (the first weekday in the dictionary, not the one the customer said last).
 *
 * Rules, in order of authority:
 *   1. an explicit day + month (and year, when said) is the date;
 *   2. a weekday only names a date when no explicit date was said, and never TODAY unless the customer says «hoy» (a «viernes»
 *      said on a Friday is next Friday);
 *   3. a weekday that disagrees with an explicit date («viernes 17 de octubre» when the 17th is a Saturday) is a conflict the
 *      caller must ASK about, never resolve silently.
 *
 * All inputs are text with the accents already folded and the case lowered (`normalizeForIntent` / NFD without marks).
 */

const MONTHS: Record<string, number> = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
    janeiro: 1, fevereiro: 2, marco: 3, maio: 5, junho: 6, julho: 7, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
    janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, decembre: 12,
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const DAY_FIRST = new RegExp(`\\b(\\d{1,2})\\s*(?:de\\s+|del\\s+|of\\s+)?(${MONTH_ALT})\\b(?:\\s*(?:de|del|of|,)?\\s*(20\\d{2})\\b)?`, 'g');
const MONTH_FIRST = new RegExp(`\\b(${MONTH_ALT})\\s+(\\d{1,2})\\b(?!\\s*:)(?:\\s*,?\\s*(20\\d{2})\\b)?`, 'g');

/** Folded weekday names; Portuguese «segunda… sexta» are also Spanish ordinals, so they only count with «feira». */
const WEEKDAYS: Record<string, number> = {
    domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
    dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};
const PT_FEIRA: Record<string, number> = { segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5 };
const WEEKDAY_RE = new RegExp(`\\b(${Object.keys(WEEKDAYS).join('|')})(?:s)?\\b`, 'g');
const PT_FEIRA_RE = new RegExp(`\\b(${Object.keys(PT_FEIRA).join('|')})[- ]feira\\b`, 'g');
/** The same names with «feira» optional: for a reader that already knows the customer writes Portuguese (the booking interpreter). */
const PT_BARE_RE = new RegExp(`\\b(${Object.keys(PT_FEIRA).join('|')})(?:[- ]feira)?\\b`, 'g');
/** A weekday that NAMES the appointment being moved («la del jueves», «de miércoles a viernes»), not where it goes. */
const SELECTOR_BEFORE = /(?:\bdel|\bdesde|\bfrom)\s+(?:el\s+|este\s+|ese\s+|la\s+)?$/;
/** «de jueves a viernes»: the first day of a move is the record's own. A bare «de jueves» («una cita de jueves») is not a selector. */
const RANGE_START_BEFORE = /\bde\s+(?:el\s+)?$/;
const RANGE_END_AFTER = /^\s+(?:a|al|to|hasta)\b/;
const isSelector = (tNorm: string, index: number, length: number): boolean => SELECTOR_BEFORE.test(tNorm.slice(0, index))
    || (RANGE_START_BEFORE.test(tNorm.slice(0, index)) && RANGE_END_AFTER.test(tNorm.slice(index + length)));

export const WEEKDAY_NAMES_ES = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

export interface ExplicitDate {
    /** YYYY-MM-DD. With no year said and the date already past this year, the NEXT year's (see `rolledForward`). */
    date: string;
    /** The date this year when no year was said (equal to `date` unless it rolled forward). */
    thisYearDate: string;
    yearStated: boolean;
    /** No year said and the day had already passed this year: `date` is next year's, the customer was NOT asked. */
    rolledForward: boolean;
    index: number;
}

export interface WeekdayMention {
    weekday: number;
    index: number;
    /** «la del jueves»: names the existing record, not the destination. */
    selector: boolean;
}

function validIso(year: number, month: number, day: number): string | null {
    if (!(day >= 1 && day <= 31) || !(month >= 1 && month <= 12)) return null;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(parsed.getTime()) || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) return null;
    return parsed.toISOString().slice(0, 10);
}

export function weekdayOfIso(iso: string): number {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDaysIso(iso: string, days: number): string {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Every «day + month [+ year]» of the text, in the order the customer said them. */
export function explicitDates(tNorm: string, todayIso: string): ExplicitDate[] {
    const found: ExplicitDate[] = [];
    const currentYear = Number(todayIso.slice(0, 4));
    const take = (index: number, day: number, monthName: string, yearText: string | undefined) => {
        const month = MONTHS[monthName];
        const year = yearText ? Number(yearText) : currentYear;
        const iso = validIso(year, month, day);
        if (!iso) return;
        if (yearText) { found.push({ date: iso, thisYearDate: iso, yearStated: true, rolledForward: false, index }); return; }
        if (iso < todayIso) {
            const next = validIso(year + 1, month, day);
            if (next) found.push({ date: next, thisYearDate: iso, yearStated: false, rolledForward: true, index });
            return;
        }
        found.push({ date: iso, thisYearDate: iso, yearStated: false, rolledForward: false, index });
    };
    const spans: Array<[number, number]> = [];
    for (const m of tNorm.matchAll(DAY_FIRST)) {
        take(m.index ?? 0, Number(m[1]), m[2], m[3]);
        spans.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
    }
    for (const m of tNorm.matchAll(MONTH_FIRST)) {
        // «10 de enero 14:30» was already read day-first; do not read the «enero 14» of it again.
        const at = m.index ?? 0;
        if (spans.some(([from, to]) => at >= from && at < to)) continue;
        take(at, Number(m[2]), m[1], m[3]);
    }
    return found.sort((a, b) => a.index - b.index);
}

/** Every weekday word of the text, in the order the customer said them. */
export function weekdayMentions(tNorm: string, lenientPortuguese = false): WeekdayMention[] {
    const found: WeekdayMention[] = [];
    for (const m of tNorm.matchAll(WEEKDAY_RE)) {
        const index = m.index ?? 0;
        found.push({ weekday: WEEKDAYS[m[1]], index, selector: isSelector(tNorm, index, m[0].length) });
    }
    for (const m of tNorm.matchAll(lenientPortuguese ? PT_BARE_RE : PT_FEIRA_RE)) {
        const index = m.index ?? 0;
        found.push({ weekday: PT_FEIRA[m[1]], index, selector: isSelector(tNorm, index, m[0].length) });
    }
    return found.sort((a, b) => a.index - b.index);
}

/** The first date AFTER `fromIso` (or `fromIso` itself when `includeFrom`) that falls on `weekday`. */
export function nextWeekdayDate(weekday: number, fromIso: string, includeFrom: boolean): string {
    let date = includeFrom ? fromIso : addDaysIso(fromIso, 1);
    for (let i = 0; i < 7 && weekdayOfIso(date) !== weekday; i++) date = addDaysIso(date, 1);
    return date;
}

/** «dia 16» / «el dia 16»: a day of the month with no month named. This month if it has not passed, else the next. */
export function dayOfMonthOnly(tNorm: string, todayIso: string): string | null {
    const m = /\bdia (\d{1,2})\b(?!\s*(?:de\s+)?(?:\d|[a-z]))/.exec(tNorm) ?? /\bdia (\d{1,2})\s*$/.exec(tNorm);
    if (!m) return null;
    const day = Number(m[1]);
    const [year, month] = todayIso.split('-').map(Number);
    const thisMonth = validIso(year, month, day);
    if (thisMonth && thisMonth >= todayIso) return thisMonth;
    return month === 12 ? validIso(year + 1, 1, day) : validIso(year, month + 1, day);
}

export type DateReading =
    | { kind: 'none' }
    /** Several different weekdays as destinations («el martes o el miércoles»): ask. */
    | { kind: 'ambiguous' }
    | { kind: 'date'; date: string; via: 'explicit' | 'weekday' }
    /** The customer's weekday and day-of-month disagree: ask, never choose. */
    | { kind: 'conflict'; date: string; saidWeekday: number }
    /** An explicit day that already passed (this year's, no year said, or a stated past year). */
    | { kind: 'past'; date: string; thisYear: boolean };

/**
 * The date a customer's words name, by the rules in the header. `referenceDate` is the date of the record being moved: a weekday
 * that equals it and is written as its selector («la del jueves») is ignored as a destination.
 */
export function readDateReference(tNorm: string, todayIso: string, options: { referenceDate?: string; rolledIsPast?: boolean; lenientPortuguese?: boolean } = {}): DateReading {
    const explicit = explicitDates(tNorm, todayIso);
    const weekdays = weekdayMentions(tNorm, options.lenientPortuguese === true);
    const targetDays = weekdays.filter(day => !day.selector);
    if (explicit.length) {
        // Several dates («del 15 de octubre al 16 de octubre»): the one that is not the record's own date is where it goes.
        const others = explicit.filter(date => date.date !== options.referenceDate);
        const chosen = (others.length ? others : explicit)[(others.length ? others : explicit).length - 1];
        if (targetDays.length && !targetDays.some(day => day.weekday === weekdayOfIso(chosen.date))) {
            return { kind: 'conflict', date: chosen.date, saidWeekday: targetDays[targetDays.length - 1].weekday };
        }
        if (chosen.rolledForward && options.rolledIsPast !== false) return { kind: 'past', date: chosen.thisYearDate, thisYear: true };
        if (chosen.date < todayIso) return { kind: 'past', date: chosen.date, thisYear: false };
        return { kind: 'date', date: chosen.date, via: 'explicit' };
    }
    const dayOnly = dayOfMonthOnly(tNorm, todayIso);
    if (dayOnly) {
        if (targetDays.length && !targetDays.some(day => day.weekday === weekdayOfIso(dayOnly))) {
            return { kind: 'conflict', date: dayOnly, saidWeekday: targetDays[targetDays.length - 1].weekday };
        }
        return { kind: 'date', date: dayOnly, via: 'explicit' };
    }
    const distinct = [...new Set(targetDays.map(day => day.weekday))];
    if (distinct.length === 1) {
        // «hoy» next to the weekday («hoy viernes») is today; a bare «el viernes» said on a Friday is the next one.
        const today = /\b(?:hoy|today|aujourd|hoje)\b/.test(tNorm);
        return { kind: 'date', date: nextWeekdayDate(distinct[0], todayIso, today), via: 'weekday' };
    }
    return distinct.length > 1 ? { kind: 'ambiguous' } : { kind: 'none' };
}
