export function parseApiTimestamp(value?: string, dateOnly = false): Date | null {
    if (!value) return null;
    const raw = String(value).trim();
    const match = raw.match(
        /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?)?$/,
    );

    // PostgreSQL TIMESTAMP values are business-local wall-clock values. Build
    // them from components so JavaScript never interprets a timezone-less
    // value as UTC (which would turn Bogotá 09:00 into 04:00).
    if (match) {
        const [, year, month, day, hour = '0', minute = '0', second = '0', millis = '0'] = match;
        const date = new Date(
            Number(year),
            Number(month) - 1,
            Number(day),
            dateOnly ? 0 : Number(hour),
            dateOnly ? 0 : Number(minute),
            dateOnly ? 0 : Number(second),
            dateOnly ? 0 : Number(millis.padEnd(3, '0')),
        );
        return Number.isNaN(date.getTime()) ? null : date;
    }

    // Timestamps carrying Z/an explicit offset describe an instant and may be
    // parsed normally. Reject ambiguous non-ISO strings instead of guessing.
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return null;
    const instant = new Date(raw);
    return Number.isNaN(instant.getTime()) ? null : instant;
}
