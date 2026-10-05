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
const ES_DAYS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];

function toMinutes(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const [h, m] = value.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
}

function windowOf(entry: any): BusinessWindow | null {
    if (!entry || typeof entry !== 'object') return null;
    if ('enabled' in entry && !entry.enabled) return null;
    const openMin = toMinutes(entry.open ?? entry.start);
    const closeMin = toMinutes(entry.close ?? entry.end);
    if (openMin == null || closeMin == null || closeMin <= openMin) return null;
    return { openMin, closeMin };
}

/** Tenant business hours first (English day keys), then the agent schedule (Spanish keys). */
export function resolveBusinessWindow(bizHours: any, agentHours: any, dateISO: string): BusinessWindow | null {
    const date = new Date(`${dateISO}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return null;
    const dow = date.getUTCDay();
    if (bizHours && !bizHours.is247 && bizHours.schedule && Object.keys(bizHours.schedule).length) {
        return windowOf(bizHours.schedule[EN_DAYS[dow]]);
    }
    const schedule = agentHours?.schedule;
    if (!bizHours && schedule && typeof schedule === 'object' && Object.keys(schedule).length) {
        return windowOf(schedule[ES_DAYS[dow]] ?? schedule[EN_DAYS[dow]]);
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
