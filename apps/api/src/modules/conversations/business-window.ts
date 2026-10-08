import { businessHoursConfigured, scheduleEntryForDay, scheduleEntryWindow } from './informational-hours';

/**
 * The business opening window for a calendar date, in minutes since midnight.
 *
 * Used to read an unqualified "a las 4" as 16:00 when 04:00 is outside the
 * business hours and 16:00 is inside. Returns null whenever the hours are not
 * known for that date: the caller must then assume nothing.
 */
export interface BusinessWindow { openMin: number; closeMin: number }
export type BusinessWindowResolver = (dateISO: string) => BusinessWindow | null;

const EN_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function toMinutes(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const [h, m] = value.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
}

function windowOf(entry: any): BusinessWindow | null {
    const window = scheduleEntryWindow(entry);
    return window && window[1] > window[0] ? { openMin: window[0], closeMin: window[1] } : null;
}

const hasEntries = (value: unknown): boolean =>
    !!value && typeof value === 'object' && Object.keys(value as object).length > 0;

/**
 * The agenda-derived day (`{ windows: [{ open, close }] }`, see informational-hours.ts)
 * as one window: earliest opening to latest closing. A day without windows is closed.
 */
function derivedWindowOf(entry: any): BusinessWindow | null {
    const windows: any[] = Array.isArray(entry?.windows) ? entry.windows : [];
    let openMin: number | null = null;
    let closeMin: number | null = null;
    for (const w of windows) {
        const open = toMinutes(w?.open);
        const close = toMinutes(w?.close);
        if (open == null || close == null || close <= open) continue;
        openMin = openMin == null ? open : Math.min(openMin, open);
        closeMin = closeMin == null ? close : Math.max(closeMin, close);
    }
    return openMin == null || closeMin == null ? null : { openMin, closeMin };
}

/**
 * Same precedence as the after-hours gate (`isWithinOpeningHours`, informational-hours.ts): business
 * hours that list a week, else the agent schedule, whichever spelling the day keys use. An empty
 * business record (the wizard's `schedule: {}`) is not configured and does not hide the agent
 * schedule. Only when neither is configured does the schedule derived from the appointment agenda
 * (`derivedHours`) describe the window: a configured policy is never overridden by an agenda.
 */
export function resolveBusinessWindow(bizHours: any, agentHours: any, dateISO: string, derivedHours?: any): BusinessWindow | null {
    const date = new Date(`${dateISO}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return null;
    const dow = date.getUTCDay();
    if (businessHoursConfigured(bizHours)) {
        // 24/7 has no window to read the hour against.
        return bizHours.is247 ? null : windowOf(scheduleEntryForDay(bizHours.schedule, dow));
    }
    const schedule = agentHours?.schedule;
    if (hasEntries(schedule)) return windowOf(scheduleEntryForDay(schedule, dow));
    if (derivedHours && !derivedHours.unknown && hasEntries(derivedHours.schedule)) {
        return derivedWindowOf(derivedHours.schedule[EN_DAYS[dow]]);
    }
    return null;
}

/**
 * "a las 4" with no am/pm: hours 1-7 that fall outside the window while the
 * afternoon reading falls inside are the afternoon. Anything else is left as
 * the customer wrote it.
 */
export function disambiguateBareHour(hour: number, minutes: number, window: BusinessWindow | null): number {
    if (!window || hour < 1 || hour > 7) return hour;
    const at = (h: number) => h * 60 + minutes;
    const inside = (h: number) => at(h) >= window.openMin && at(h) <= window.closeMin;
    return !inside(hour) && inside(hour + 12) ? hour + 12 : hour;
}
