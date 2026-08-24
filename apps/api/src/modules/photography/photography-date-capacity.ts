import { holdStillAliveSql } from '../../common/utils/payment-policy.util';

export type PhotographyTenantQuery = <T = unknown>(
    sql: string,
    params?: unknown[],
) => Promise<T>;

/** A quote request owns the proposed date while the studio follows up. */
export const PHOTO_QUOTE_HOLD_MS = 24 * 60 * 60 * 1000;

export interface PhotoDateCapacity {
    date: string;
    blocked: boolean;
    appointmentCount: number;
    sessionCount: number;
    taken: number;
    available: boolean;
}

export class PhotoDateUnavailableError extends Error {
    readonly code = 'photo_date_unavailable';
    readonly date: string;

    constructor(date: string) {
        super(`Photography date ${date} is not available`);
        this.name = PhotoDateUnavailableError.name;
        this.date = date;
    }
}

export class InvalidPhotoDateError extends Error {
    readonly code = 'invalid_photo_date';

    constructor() {
        super('The photography date is invalid');
        this.name = InvalidPhotoDateError.name;
    }
}

/** Validate a tenant-local date without applying the Node host timezone. */
export function normalizePhotoLocalDate(value: unknown): string {
    const raw = value instanceof Date ? value.toISOString() : String(value || '');
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) throw new InvalidPhotoDateError();
    const [, year, month, day] = match;
    const probe = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
    if (
        probe.getUTCFullYear() !== Number(year)
        || probe.getUTCMonth() !== Number(month) - 1
        || probe.getUTCDate() !== Number(day)
    ) {
        throw new InvalidPhotoDateError();
    }
    return `${year}-${month}-${day}`;
}

/**
 * Read the same occupancy predicate used by the writer.
 *
 * Legacy `requested` rows have no hold and therefore do not occupy a date.
 * A current quote request occupies only while its explicit clock is alive.
 */
export async function readPhotoDateCapacity(
    query: PhotographyTenantQuery,
    dateInput: unknown,
    excludeSessionId: string | null = null,
): Promise<PhotoDateCapacity> {
    const date = normalizePhotoLocalDate(dateInput);
    const rows = await query<Array<{
        blocked: boolean;
        appointment_count: number;
        session_count: number;
    }>>(
        `SELECT
            EXISTS (
                SELECT 1
                  FROM blocked_dates b
                 WHERE b.blocked_date = $1::date
                   AND b.user_id IS NULL
            ) AS blocked,
            (
                SELECT COUNT(*)::int
                  FROM appointments a
                 WHERE a.start_at::date = $1::date
                   AND a.status IN ('pending', 'confirmed', 'pending_payment')
                   AND ${holdStillAliveSql('a')}
            ) AS appointment_count,
            (
                SELECT COUNT(*)::int
                  FROM photo_sessions p
                 WHERE p.scheduled_at::date = $1::date
                   AND ($2::uuid IS NULL OR p.id <> $2::uuid)
                   AND (
                        p.status IN ('scheduled', 'in_progress')
                        OR (p.status = 'requested' AND p.hold_expires_at > NOW())
                   )
            ) AS session_count`,
        [date, excludeSessionId],
    );
    const blocked = rows?.[0]?.blocked === true;
    const appointmentCount = Number(rows?.[0]?.appointment_count || 0);
    const sessionCount = Number(rows?.[0]?.session_count || 0);
    const taken = appointmentCount + sessionCount;
    return {
        date,
        blocked,
        appointmentCount,
        sessionCount,
        taken,
        available: !blocked && taken === 0,
    };
}

/** Serialize competing quote requests, then re-read before the INSERT/UPDATE. */
export async function lockAndAssertPhotoDateCapacity(
    query: PhotographyTenantQuery,
    input: { schemaName: string; date: unknown; excludeSessionId?: string | null },
): Promise<PhotoDateCapacity> {
    const date = normalizePhotoLocalDate(input.date);
    await query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))::text AS lock_acquired`,
        [`photo-date:${input.schemaName}:${date}`],
    );
    const capacity = await readPhotoDateCapacity(query, date, input.excludeSessionId || null);
    if (!capacity.available) throw new PhotoDateUnavailableError(date);
    return capacity;
}
