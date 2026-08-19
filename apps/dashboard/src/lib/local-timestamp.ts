export interface LocalTimestampParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Parse a PostgreSQL TIMESTAMP WITHOUT TIME ZONE as wall-clock components. */
export function parseLocalTimestamp(value: unknown): LocalTimestampParts | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
  if (!match) return null;
  const [year, month, day, hour, minute, second = 0] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  return { year, month, day, hour, minute, second };
}

export function formatLocalTimestamp(value: unknown, locale?: string): string {
  const parts = parseLocalTimestamp(value);
  if (!parts) return typeof value === "string" ? value : "";
  // UTC is only a formatting frame here. The database value has no timezone,
  // so the chosen wall-clock hour must stay identical on every client/CI zone.
  const frame = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(frame);
}

/**
 * Format a PostgreSQL DATE — a calendar day, not an instant.
 *
 * The API serialises DATE as UTC midnight ("2026-11-13T00:00:00.000Z"). Handing
 * that to the browser's timezone moves it a day BACK west of Greenwich: a
 * check-in stored as 13-nov rendered "12 de nov" in Bogota, and the host makes
 * decisions on that date. The day is the payload; UTC is only the frame that
 * keeps it intact. Parsing the YYYY-MM-DD prefix also accepts a bare date
 * string, which is what some endpoints return.
 */
export function formatDateOnly(value: unknown, locale?: string): string {
  if (typeof value !== "string" || !value.trim()) return typeof value === "string" ? value : "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return value;
  const [year, month, day] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return value;
  const frame = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(frame.getTime())) return value;
  return frame.toLocaleDateString(locale, {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}
