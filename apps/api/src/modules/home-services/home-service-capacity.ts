export type HomeServiceTenantQuery = <T = unknown>(
    sql: string,
    params?: unknown[],
) => Promise<T>;

export class HomeServiceSlotUnavailableError extends Error {
    readonly code = 'home_service_slot_unavailable';

    constructor(message = 'The requested home-service window is no longer available') {
        super(message);
        this.name = HomeServiceSlotUnavailableError.name;
    }
}

export class HomeServiceCatalogUnavailableError extends Error {
    readonly code = 'home_service_catalog_unavailable';

    constructor() {
        super('The selected home service is missing or inactive');
        this.name = HomeServiceCatalogUnavailableError.name;
    }
}

export interface HomeServiceCapacityInput {
    schemaName: string;
    serviceId: string;
    startAt: string;
    assignedTechnicianId?: string | null;
    excludeRequestId?: string;
}

export interface HomeServiceCapacitySnapshot {
    service: {
        id: string;
        name: string;
        category: string;
        durationMinutes: number;
        maxConcurrent: number;
    };
    startAt: string;
    endAt: string;
    occupied: number;
    available: boolean;
}

const ACTIVE_OCCUPANCY_STATUSES = "('scheduled', 'dispatched', 'in_progress')";

/**
 * Preserve the tenant's submitted wall-clock components. `scheduled_at` is a
 * timestamp without time zone; applying the API host timezone here would move
 * a 09:00 visit to a different hour for some tenants.
 */
export function normalizeHomeServiceLocalTimestamp(value: unknown): string {
    if (typeof value !== 'string') {
        throw new HomeServiceSlotUnavailableError('The home-service start time is invalid');
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?$/.exec(value.trim());
    if (!match) {
        throw new HomeServiceSlotUnavailableError('The home-service start time is invalid');
    }

    const [, rawYear, rawMonth, rawDay, rawHour, rawMinute, rawSecond = '0'] = match;
    const year = Number(rawYear);
    const month = Number(rawMonth);
    const day = Number(rawDay);
    const hour = Number(rawHour);
    const minute = Number(rawMinute);
    const second = Number(rawSecond);
    const daysInMonth = month >= 1 && month <= 12
        ? new Date(Date.UTC(year, month, 0)).getUTCDate()
        : 0;
    if (day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) {
        throw new HomeServiceSlotUnavailableError('The home-service start time is invalid');
    }
    return `${rawYear}-${rawMonth}-${rawDay}T${rawHour}:${rawMinute}:${rawSecond.padStart(2, '0')}`;
}

function addLocalMinutes(startAt: string, durationMinutes: number): string {
    const [date, time] = startAt.split('T');
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute, second] = time.split(':').map(Number);
    const end = new Date(Date.UTC(year, month - 1, day, hour, minute + durationMinutes, second));
    return [
        `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-${String(end.getUTCDate()).padStart(2, '0')}`,
        `${String(end.getUTCHours()).padStart(2, '0')}:${String(end.getUTCMinutes()).padStart(2, '0')}:${String(end.getUTCSeconds()).padStart(2, '0')}`,
    ].join('T');
}

function localDate(startAt: string): string {
    return startAt.slice(0, 10);
}

async function acquireCapacityLocks(
    query: HomeServiceTenantQuery,
    input: HomeServiceCapacityInput,
    normalizedStartAt: string,
): Promise<void> {
    const keys = [
        `home-service:service:${input.schemaName}:${input.serviceId}:${localDate(normalizedStartAt)}`,
        ...(input.assignedTechnicianId
            ? [`home-service:technician:${input.schemaName}:${input.assignedTechnicianId}:${localDate(normalizedStartAt)}`]
            : []),
    ].sort();
    for (const key of keys) {
        await query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))::text AS lock_acquired',
            [key],
        );
    }
}

/**
 * Canonical read predicate for home-service capacity. The committing path calls
 * this exact function after taking transaction-scoped advisory locks.
 *
 * Legacy scheduled rows predate `service_id`. They are still counted when
 * their `service_type` matches the selected catalogue category; otherwise a
 * migration would make existing work disappear from capacity overnight.
 */
export async function inspectHomeServiceCapacity(
    query: HomeServiceTenantQuery,
    input: HomeServiceCapacityInput,
): Promise<HomeServiceCapacitySnapshot> {
    const startAt = normalizeHomeServiceLocalTimestamp(input.startAt);
    const services = await query<Array<{
        id: string;
        name: string;
        category: string | null;
        duration_minutes: number;
        max_concurrent: number;
    }>>(
        `SELECT id, name, category,
                duration_minutes::int,
                COALESCE(max_concurrent, 1)::int AS max_concurrent
           FROM services
          WHERE id = $1::uuid
            AND is_active = true
            AND duration_minutes > 0
          LIMIT 1`,
        [input.serviceId],
    );
    if (!services?.length) throw new HomeServiceCatalogUnavailableError();

    const service = services[0];
    const durationMinutes = Math.max(1, Number(service.duration_minutes) || 0);
    const maxConcurrent = Math.max(1, Number(service.max_concurrent) || 1);
    const category = service.category || 'otro';
    const endAt = addLocalMinutes(startAt, durationMinutes);
    const excludeSql = input.excludeRequestId ? ' AND sr.id <> $6::uuid' : '';
    const capacityParams: unknown[] = [
        endAt,
        startAt,
        input.serviceId,
        category,
        durationMinutes,
    ];
    if (input.excludeRequestId) capacityParams.push(input.excludeRequestId);
    const occupancy = await query<Array<{ occupied: number }>>(
        `SELECT COUNT(*)::int AS occupied
           FROM service_requests sr
          WHERE sr.status IN ${ACTIVE_OCCUPANCY_STATUSES}
            AND (sr.service_id = $3::uuid OR (sr.service_id IS NULL AND sr.service_type = $4))
            AND sr.scheduled_at < $1::timestamp
            AND sr.scheduled_at
                + make_interval(mins => COALESCE(sr.estimated_duration_minutes, $5::int))
                > $2::timestamp
            ${excludeSql}`,
        capacityParams,
    );

    if (input.assignedTechnicianId) {
        const technicianParams: unknown[] = [endAt, startAt, input.assignedTechnicianId];
        const technicianExcludeSql = input.excludeRequestId ? ' AND sr.id <> $4::uuid' : '';
        if (input.excludeRequestId) technicianParams.push(input.excludeRequestId);
        const conflict = await query<Array<{ id: string }>>(
            `SELECT sr.id
               FROM service_requests sr
              WHERE sr.status IN ${ACTIVE_OCCUPANCY_STATUSES}
                AND sr.assigned_technician_id = $3::uuid
                AND sr.scheduled_at < $1::timestamp
                AND sr.scheduled_at
                    + make_interval(mins => COALESCE(sr.estimated_duration_minutes, 480))
                    > $2::timestamp
                ${technicianExcludeSql}
              LIMIT 1`,
            technicianParams,
        );
        if (conflict?.length) {
            return {
                service: {
                    id: service.id,
                    name: service.name,
                    category,
                    durationMinutes,
                    maxConcurrent,
                },
                startAt,
                endAt,
                occupied: Number(occupancy?.[0]?.occupied || 0),
                available: false,
            };
        }
    }

    const occupied = Number(occupancy?.[0]?.occupied || 0);
    return {
        service: {
            id: service.id,
            name: service.name,
            category,
            durationMinutes,
            maxConcurrent,
        },
        startAt,
        endAt,
        occupied,
        available: occupied < maxConcurrent,
    };
}

/** Lock → canonical read → assertion. Must run inside the writing transaction. */
export async function lockAndAssertHomeServiceCapacity(
    query: HomeServiceTenantQuery,
    input: HomeServiceCapacityInput,
): Promise<HomeServiceCapacitySnapshot> {
    const startAt = normalizeHomeServiceLocalTimestamp(input.startAt);
    await acquireCapacityLocks(query, input, startAt);
    const snapshot = await inspectHomeServiceCapacity(query, { ...input, startAt });
    if (!snapshot.available) throw new HomeServiceSlotUnavailableError();
    return snapshot;
}
