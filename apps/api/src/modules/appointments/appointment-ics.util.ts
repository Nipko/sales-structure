/**
 * Calendar (.ics) generation and wall-clock formatting for appointment emails.
 *
 * TIME MODEL — the one thing to get right here:
 * `appointments.start_at` / `end_at` are NAIVE timestamps: the wall clock of the
 * tenant's timezone, with no offset attached. That means:
 *   - To DISPLAY them, parse as UTC and format with timeZone 'UTC'. The digits
 *     survive untouched no matter what timezone the container runs in. (Parsing a
 *     naive string with `new Date()` silently applies the SERVER timezone — which
 *     is right only as long as every container stays on UTC.)
 *   - To put them in a CALENDAR, they must become a real instant, which requires
 *     the tenant's timezone. `08:00` in Bogotá is 13:00Z; getting this wrong puts
 *     the customer's appointment five hours off in their phone.
 */

const NAIVE_SUFFIX = /[zZ]$|[+-]\d{2}:?\d{2}$/;

/**
 * Parse a naive wall-clock timestamp into a Date whose UTC fields hold those
 * exact digits. Only ever format this with `timeZone: 'UTC'`.
 */
export function parseWallClock(value: string): Date {
    return new Date(NAIVE_SUFFIX.test(value) ? value.replace(NAIVE_SUFFIX, 'Z') : `${value}Z`);
}

/**
 * Resolve a naive wall clock in `timezone` to the real UTC instant.
 * Iterative correction (same approach as calendar-integration.service) so DST
 * boundaries land on the right side instead of drifting an hour.
 */
export function wallClockToUtc(value: string, timezone: string): Date {
    const desired = parseWallClock(value).getTime();
    if (Number.isNaN(desired)) return new Date(NaN);

    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23',
    });

    let candidate = desired;
    for (let i = 0; i < 4; i += 1) {
        const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate))
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, Number(part.value)]));
        const represented = Date.UTC(
            parts.year, parts.month - 1, parts.day,
            parts.hour, parts.minute, parts.second,
        );
        const correction = desired - represented;
        candidate += correction;
        if (correction === 0) break;
    }
    return new Date(candidate);
}

/** "martes, 9 de diciembre de 2026" — never the ambiguous "9/12/2026". */
export function formatWallClockDate(value: string, locale: string): string {
    const date = parseWallClock(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(locale, {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    });
}

/** "martes, 9 de diciembre" — the year-less form used in chat messages. */
export function formatWallClockShortDate(value: string, locale: string): string {
    const date = parseWallClock(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(locale, {
        weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
    });
}

export function formatWallClockTime(value: string, locale: string): string {
    const date = parseWallClock(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString(locale, {
        hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'UTC',
    });
}

/** Short offset for the tenant timezone at that instant, e.g. "GMT-5". */
export function timezoneLabel(value: string, timezone: string, locale: string): string {
    try {
        const instant = wallClockToUtc(value, timezone);
        const parts = new Intl.DateTimeFormat(locale, { timeZone: timezone, timeZoneName: 'shortOffset' })
            .formatToParts(instant);
        return parts.find((p) => p.type === 'timeZoneName')?.value || '';
    } catch {
        return '';
    }
}

export function durationMinutes(startAt: string, endAt: string): number {
    const start = parseWallClock(startAt).getTime();
    const end = parseWallClock(endAt).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
    return Math.round((end - start) / 60_000);
}

// ── iCalendar ────────────────────────────────────────────────────────────────

export interface AppointmentIcsInput {
    /** Stable across confirmation/reminder/cancellation: the calendar matches on it. */
    uid: string;
    method: 'REQUEST' | 'CANCEL';
    status: 'CONFIRMED' | 'CANCELLED';
    /** Bumped on cancellation so clients accept the update over the original invite. */
    sequence: number;
    startAt: string;
    endAt: string;
    timezone: string;
    stamp: Date;
    summary: string;
    description?: string;
    location?: string;
    url?: string;
    organizerName?: string;
    organizerEmail?: string;
    attendeeName?: string;
    attendeeEmail?: string;
}

function icsDate(date: Date): string {
    return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/** RFC 5545 §3.3.11: backslash, semicolon, comma and newlines are structural. */
function icsText(value: string): string {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

/**
 * Fold to 75 octets per RFC 5545 §3.1. Folding by characters would split a
 * multi-byte accent in half — "Reunión" is a real service name here — so the
 * width is measured in UTF-8 bytes.
 */
function foldLine(line: string): string {
    const bytes = Buffer.from(line, 'utf8');
    if (bytes.length <= 75) return line;

    const chunks: string[] = [];
    let current = '';
    let currentBytes = 0;
    let limit = 75;

    for (const char of line) {
        const size = Buffer.byteLength(char, 'utf8');
        if (currentBytes + size > limit) {
            chunks.push(current);
            current = '';
            currentBytes = 0;
            limit = 74; // continuation lines carry a leading space
        }
        current += char;
        currentBytes += size;
    }
    if (current) chunks.push(current);
    return chunks.join('\r\n ');
}

/**
 * Build a single-event VCALENDAR. Times are emitted as UTC instants rather than
 * TZID references so no VTIMEZONE block is needed — every client resolves them
 * identically, which matters more than preserving the original zone label.
 */
export function buildAppointmentIcs(input: AppointmentIcsInput): string {
    const start = wallClockToUtc(input.startAt, input.timezone);
    const end = wallClockToUtc(input.endAt, input.timezone);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new Error('invalid_appointment_interval');
    }

    const lines: string[] = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Parallly//Appointments//ES',
        'CALSCALE:GREGORIAN',
        `METHOD:${input.method}`,
        'BEGIN:VEVENT',
        `UID:${icsText(input.uid)}`,
        `SEQUENCE:${input.sequence}`,
        `DTSTAMP:${icsDate(input.stamp)}`,
        `DTSTART:${icsDate(start)}`,
        `DTEND:${icsDate(end)}`,
        `SUMMARY:${icsText(input.summary)}`,
        `STATUS:${input.status}`,
        'TRANSP:OPAQUE',
    ];

    if (input.description) lines.push(`DESCRIPTION:${icsText(input.description)}`);
    if (input.location) lines.push(`LOCATION:${icsText(input.location)}`);
    if (input.url) lines.push(`URL:${icsText(input.url)}`);
    if (input.organizerEmail) {
        const cn = input.organizerName ? `;CN=${icsText(input.organizerName)}` : '';
        lines.push(`ORGANIZER${cn}:mailto:${input.organizerEmail}`);
    }
    if (input.attendeeEmail) {
        const cn = input.attendeeName ? `;CN=${icsText(input.attendeeName)}` : '';
        lines.push(`ATTENDEE${cn};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=FALSE:mailto:${input.attendeeEmail}`);
    }

    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
}
