/**
 * Opening hours the customer-facing agent may state - and where they come from.
 *
 * A tenant can describe its hours in three places that the dashboard shows on three
 * different screens: the business hours (Configuración > Horarios de atención,
 * `tenants.settings.businessHours`), the agent's own schedule (`config.hours`) and the
 * appointment agenda (`availability_slots`, turnos > Configuración). They used to disagree:
 * a salon that had only filled the agenda was answered "no tengo el horario configurado".
 *
 * PRECEDENCE (first source that really carries a schedule wins; see `hoursSource`):
 *   1. business hours   - `is247`, or a non-empty `schedule`        (source 'business')
 *   2. the agent's own schedule - a non-empty `config.hours.schedule` (source 'agent')
 *   3. the appointment agenda - bookable hours, read-only            (source 'appointment_availability')
 *   4. nothing anywhere -> the honest "not configured, offer a person" instruction (source 'none')
 * An explicit schedule is never overridden by a lower source, and a source that is merely
 * present but empty (`{ is247: false, timezone, schedule: {} }` written by the wizard) does
 * not count as configured and does not shadow a lower one.
 *
 * Informational opening hours for the prompt, derived from `availability_slots`.
 *
 * Tenants that only configured their appointment agenda (no
 * `tenant.settings.businessHours`, empty agent schedule) have real hours that
 * the prompt never saw, so "¿a qué hora abren?" had no answer. These helpers
 * produce a read-only description for the `<business_hours>` block.
 *
 * The agenda is NOT a source of `isWithinBusinessHours` (the after-hours gate), which uses only
 * levels 1-2 above with "nothing configured = open": whether the agent answers is a tenant
 * setting, and an agenda is bookable hours, not an opening policy - gating on it would silence
 * the bot outside the slots. The derived object is marked `informational` so nothing downstream
 * confuses it with configured hours.
 */

export interface AvailabilityRow {
    user_id?: string | null;
    day_of_week: number | string;
    start_time: string;
    end_time: string;
}

export interface InformationalDay {
    enabled?: false;
    windows?: Array<{ open: string; close: string }>;
}

export interface InformationalHours {
    informational: true;
    source: 'appointment_availability';
    /** True when no source has any hours: the model must say so and offer a person. */
    unknown?: true;
    is247?: false;
    timezone?: string;
    schedule: Record<string, InformationalDay>;
    afterHoursMessage?: string;
}

/** `day_of_week` is 0=Sunday in availability_slots. */
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export const UNKNOWN_INFORMATIONAL_HOURS: InformationalHours = Object.freeze({
    informational: true, source: 'appointment_availability', unknown: true, schedule: {},
}) as InformationalHours;

const toMinutes = (time: unknown): number | null => {
    const match = /^(\d{1,2}):(\d{2})/.exec(String(time ?? ''));
    if (!match) return null;
    const minutes = Number(match[1]) * 60 + Number(match[2]);
    return minutes >= 0 && minutes <= 24 * 60 ? minutes : null;
};
const clock = (minutes: number): string =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Union of every professional's windows per weekday; null when nothing is usable. */
export function deriveInformationalHours(rows: AvailabilityRow[] | null | undefined, timezone?: string | null): InformationalHours | null {
    const byDay = new Map<number, Array<[number, number]>>();
    for (const row of rows ?? []) {
        const day = Number(row.day_of_week);
        const start = toMinutes(row.start_time);
        const end = toMinutes(row.end_time);
        if (!Number.isInteger(day) || day < 0 || day > 6 || start === null || end === null || end <= start) continue;
        byDay.set(day, [...(byDay.get(day) ?? []), [start, end]]);
    }
    if (!byDay.size) return null;
    const schedule: Record<string, InformationalDay> = {};
    for (const day of ORDER) {
        const windows = (byDay.get(day) ?? []).sort((a, b) => a[0] - b[0]);
        if (!windows.length) { schedule[DAY_NAMES[day]] = { enabled: false }; continue; }
        const merged: Array<[number, number]> = [];
        for (const [start, end] of windows) {
            const last = merged[merged.length - 1];
            if (last && start <= last[1]) last[1] = Math.max(last[1], end);
            else merged.push([start, end]);
        }
        schedule[DAY_NAMES[day]] = { windows: merged.map(([start, end]) => ({ open: clock(start), close: clock(end) })) };
    }
    return { informational: true, source: 'appointment_availability', is247: false,
        ...(timezone ? { timezone } : {}), schedule };
}

const hasEntries = (value: unknown): boolean =>
    !!value && typeof value === 'object' && Object.keys(value as object).length > 0;

/** A schedule that actually lists days. `{}` / null / a non-object is "no schedule". */
export const hasScheduleEntries = hasEntries;

export type HoursSource = 'business' | 'agent' | 'appointment_availability' | 'none';

/** Business hours that describe the week (24/7, or at least one listed day). */
export function businessHoursConfigured(tenantHours: any): boolean {
    return !!tenantHours?.is247 || hasEntries(tenantHours?.schedule);
}

/**
 * Which source the customer-facing hours come from (precedence in the header).
 * `promptHours` is what `resolvePromptBusinessHours` produced for the prompt; only its
 * `informational` marker matters here.
 */
export function hoursSource(tenantHours: any, agentHours: any, promptHours?: any): HoursSource {
    if (businessHoursConfigured(tenantHours)) return 'business';
    if (hasEntries(agentHours?.schedule)) return 'agent';
    if (promptHours?.informational === true && promptHours.unknown !== true) return 'appointment_availability';
    return 'none';
}

/**
 * The hours object the PROMPT should describe. Configured hours always win:
 * tenant hours with a schedule, 24/7 mode and an agent schedule are returned
 * exactly as they came. Only when no schedule exists anywhere is the derived
 * agenda (or the explicit "unknown" marker) used.
 */
export function resolvePromptBusinessHours(
    tenantHours: any,
    agentHours: any,
    derived: InformationalHours | null | undefined,
): any {
    if (businessHoursConfigured(tenantHours)) return tenantHours;
    // The agent's own schedule is the answer; `buildSystemPrompt` reads it from `config.hours`.
    if (hasEntries(agentHours?.schedule)) return tenantHours ?? null;
    if (!derived) return tenantHours ?? null;
    return {
        ...(tenantHours && typeof tenantHours === 'object' ? tenantHours : {}),
        ...derived,
        ...(tenantHours?.timezone ?? derived.timezone ? { timezone: tenantHours?.timezone ?? derived.timezone } : {}),
    };
}

const UNKNOWN_HOURS_INSTRUCTION: Record<string, string> = {
    es: 'No hay un horario de atención configurado. Si el cliente pregunta por el horario y no aparece en tu conocimiento, di que no tienes el horario y ofrece comunicarlo con una persona del equipo. Nunca inventes horas.',
    en: 'No opening hours are configured. If the customer asks for the hours and they are not in your knowledge, say you do not have the hours and offer to connect them with a person on the team. Never invent hours.',
    pt: 'Não há horário de atendimento configurado. Se o cliente perguntar o horário e ele não estiver no seu conhecimento, diga que não tem o horário e ofereça passar para uma pessoa da equipe. Nunca invente horários.',
    fr: "Aucun horaire d'ouverture n'est configuré. Si le client demande les horaires et qu'ils ne figurent pas dans vos connaissances, dites que vous ne les avez pas et proposez de le mettre en relation avec une personne de l'équipe. N'inventez jamais d'horaires.",
};

/** What the assistant must do when it has no hours to give. */
export function unknownHoursInstruction(language?: string): string {
    const code = String(language || 'es').slice(0, 2).toLowerCase();
    return UNKNOWN_HOURS_INSTRUCTION[code] ?? UNKNOWN_HOURS_INSTRUCTION.es;
}

/**
 * Every spelling of a weekday key found in stored schedules, indexed by `Date#getDay()` (0 = Sunday).
 * Business hours are written with English full names (`monday`, by the settings page); the agent's own
 * schedule with Spanish abbreviations (`lun`, by the agent editor and the templates); vertical defaults
 * and older records use English abbreviations (`mon`) or Spanish full names. A reader that knows only
 * one spelling finds no entry for "today" and answers "closed" for the whole week.
 */
const DAY_KEY_ALIASES: readonly (readonly string[])[] = [
    ['sunday', 'sun', 'dom', 'domingo'],
    ['monday', 'mon', 'lun', 'lunes'],
    ['tuesday', 'tue', 'mar', 'martes'],
    ['wednesday', 'wed', 'mie', 'miercoles', 'mi\u00e9', 'mi\u00e9rcoles'],
    ['thursday', 'thu', 'jue', 'jueves'],
    ['friday', 'fri', 'vie', 'viernes'],
    ['saturday', 'sat', 'sab', 'sabado', 's\u00e1b', 's\u00e1bado'],
];

/** The entry of a stored schedule for a weekday (0 = Sunday), whichever spelling the key uses. */
export function scheduleEntryForDay(schedule: unknown, dayIndex: number): unknown {
    if (!schedule || typeof schedule !== 'object') return undefined;
    const record = schedule as Record<string, unknown>;
    for (const key of DAY_KEY_ALIASES[dayIndex] ?? []) {
        if (record[key] !== undefined && record[key] !== null) return record[key];
    }
    return undefined;
}

/** [openMin, closeMin] of one schedule entry, or null when that day is closed or unreadable. */
export function scheduleEntryWindow(entry: unknown): [number, number] | null {
    if (typeof entry === 'string') {
        // "08:00-18:00" (vertical defaults); "closed"/"cerrado" is a closed day.
        const match = /^\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/.exec(entry);
        if (!match) return null;
        const open = toMinutes(match[1]);
        const close = toMinutes(match[2]);
        return open === null || close === null ? null : [open, close];
    }
    if (!entry || typeof entry !== 'object') return null;
    const day = entry as Record<string, unknown>;
    if ('enabled' in day && !day.enabled) return null;
    const open = toMinutes(day.open ?? day.start);
    const close = toMinutes(day.close ?? day.end);
    return open === null || close === null ? null : [open, close];
}

/** The weekday (0 = Sunday) and minutes since midnight at `now` in `timezone`. */
function localClock(now: Date, timezone: string): { day: number; minutes: number } {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
    const name = (parts.find(p => p.type === 'weekday')?.value || '').toLowerCase();
    return {
        day: DAY_KEY_ALIASES.findIndex(aliases => aliases[0] === name),
        minutes: (parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10) % 24) * 60
            + parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10),
    };
}

function withinSchedule(schedule: unknown, timezone: string, fallbackTimezone: string, now: Date): boolean {
    let clock: { day: number; minutes: number };
    try { clock = localClock(now, timezone); } catch { clock = localClock(now, fallbackTimezone); }
    const today = scheduleEntryWindow(scheduleEntryForDay(schedule, clock.day));
    if (today) {
        const [open, close] = today;
        // Same-day window; or an overnight one (open > close, "22:00-02:00", "18:00-00:00"): its evening
        // half belongs to today.
        if (open <= close ? clock.minutes >= open && clock.minutes <= close : clock.minutes >= open) return true;
    }
    // The small-hours half of yesterday's overnight window belongs to yesterday's entry.
    const yesterday = scheduleEntryWindow(scheduleEntryForDay(schedule, (clock.day + 6) % 7));
    return !!yesterday && yesterday[0] > yesterday[1] && clock.minutes <= yesterday[1];
}

/**
 * THE after-hours gate: is the business open at `now`? Used by the conversation pipeline
 * (`aiOutsideHours = false` -> after-hours reply) and by the automation listener, so the two can never
 * disagree about the same tenant. Precedence, as for the prompt (see the header):
 *   1. business hours that list a week (24/7, or at least one day) decide;
 *   2. else the agent's own schedule decides (7 days 00:00-23:59 is 24/7);
 *   3. else nothing is configured -> open.
 * The appointment agenda is not a source: it is bookable hours, not opening hours.
 * The end minute is inclusive (18:00 is still open at 18:00). A window whose close is before its open
 * is overnight: "22:00-02:00" is open Monday 23:00 and Tuesday 01:00 (Monday's entry); "18:00-00:00" ends at
 * midnight; "24:00" is also read as midnight. Time zone: the source that decides, then
 * the other one, then `fallbackTimezone`.
 */
export function isWithinOpeningHours(
    tenantHours: any, agentHours: any, now: Date = new Date(), fallbackTimezone = 'America/Bogota',
): boolean {
    if (businessHoursConfigured(tenantHours)) {
        if (tenantHours.is247) return true;
        return withinSchedule(tenantHours.schedule, tenantHours.timezone || agentHours?.timezone || fallbackTimezone, fallbackTimezone, now);
    }
    const schedule = agentHours?.schedule;
    if (!hasEntries(schedule)) return true;
    const values = Object.values(schedule as Record<string, any>);
    if (values.length >= 7 && values.every(v => v && typeof v === 'object' && v.start === '00:00' && v.end === '23:59')) return true;
    return withinSchedule(schedule, agentHours?.timezone || tenantHours?.timezone || fallbackTimezone, fallbackTimezone, now);
}

export type HoursStatus = 'open' | 'closed' | 'unknown';

/** Are the hours of this tenant/agent configured by a person (not derived)? */
export function hasConfiguredHours(tenantHours: any, agentHours: any): boolean {
    return businessHoursConfigured(tenantHours) || hasEntries(agentHours?.schedule);
}

/** Open/closed right now according to the agenda hours, in the given time zone. */
export function informationalStatus(hours: InformationalHours, timezone: string, now: Date = new Date()): HoursStatus {
    let parts: Intl.DateTimeFormatPart[];
    try {
        parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
    } catch { return 'unknown'; }
    const day = (parts.find(p => p.type === 'weekday')?.value || '').toLowerCase();
    const current = (parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10) % 24) * 60
        + parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    const windows = hours.schedule?.[day]?.windows ?? [];
    return windows.some(w => {
        const open = toMinutes(w.open);
        const close = toMinutes(w.close);
        return open !== null && close !== null && current >= open && current < close;
    }) ? 'open' : 'closed';
}

/**
 * The status the PROMPT states. Configured hours keep the existing verdict.
 * Without them `isWithinBusinessHours` answers `open` for lack of data, and the
 * agent then claimed "estamos abiertos" with no hours at all: the status comes
 * from the agenda when there is one, and is `unknown` otherwise.
 */
export function promptHoursStatus(
    configuredStatus: 'open' | 'closed', configured: boolean, promptHours: any, fallbackTimezone: string, now: Date = new Date(),
): HoursStatus {
    if (configured) return configuredStatus;
    if (promptHours?.informational === true && promptHours.unknown !== true) {
        return informationalStatus(promptHours as InformationalHours, promptHours.timezone || fallbackTimezone, now);
    }
    return 'unknown';
}
