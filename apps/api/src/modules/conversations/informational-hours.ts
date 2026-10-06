/**
 * Informational opening hours for the prompt, derived from `availability_slots`.
 *
 * Tenants that only configured their appointment agenda (no
 * `tenant.settings.businessHours`, empty agent schedule) have real hours that
 * the prompt never saw, so "¿a qué hora abren?" had no answer. These helpers
 * produce a read-only description for the `<business_hours>` block.
 *
 * They are NOT used by `isWithinBusinessHours`: whether the agent answers is a
 * tenant setting (`schedule_mode: 24_7`), and an agenda is not an opening
 * policy. The derived object is marked `informational` so nothing downstream
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
    if (tenantHours?.is247 || hasEntries(tenantHours?.schedule)) return tenantHours;
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

export type HoursStatus = 'open' | 'closed' | 'unknown';

/** Are the hours of this tenant/agent configured by a person (not derived)? */
export function hasConfiguredHours(tenantHours: any, agentHours: any): boolean {
    return !!tenantHours?.is247 || hasEntries(tenantHours?.schedule) || hasEntries(agentHours?.schedule);
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
