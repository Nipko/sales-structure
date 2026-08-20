import { holdStillAliveSql } from '../../common/utils/payment-policy.util';

export type AppointmentTenantQuery = <T = unknown>(sql: string, params?: unknown[]) => Promise<T>;

export class AppointmentSlotConflictError extends Error {
    readonly code = 'appointment_slot_unavailable';

    constructor(message = 'The appointment slot is no longer available') {
        super(message);
        this.name = AppointmentSlotConflictError.name;
    }
}

export class AppointmentServiceUnavailableError extends Error {
    readonly code = 'appointment_service_unavailable';

    constructor() {
        super('The appointment service is missing or inactive');
        this.name = AppointmentServiceUnavailableError.name;
    }
}

export interface AppointmentCapacityInput {
    schemaName: string;
    serviceId: string;
    staffUserId: string | null;
    startAt: string;
    endAt: string;
    excludeAppointmentId?: string;
}

export interface ActiveAppointmentService {
    id: string;
    name: string;
    maxConcurrent: number;
    /** Precio del servicio y política de pago, leídos bajo el mismo lock. */
    price?: unknown;
    currency?: unknown;
    payment_policy?: unknown;
    deposit_percent?: unknown;
    deposit_amount?: unknown;
}

export function localDatePart(value: string): string {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) throw new AppointmentSlotConflictError('The appointment date is invalid');
    const [, year, month, day] = match;
    const probe = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
    if (
        probe.getUTCFullYear() !== Number(year)
        || probe.getUTCMonth() !== Number(month) - 1
        || probe.getUTCDate() !== Number(day)
    ) {
        throw new AppointmentSlotConflictError('The appointment date is invalid');
    }
    return `${year}-${month}-${day}`;
}

/** Date-only weekday independent from the Node host timezone. */
export function dayOfWeekForLocalDate(value: string): number {
    const [year, month, day] = localDatePart(value).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
}

/** Compare tenant-local wall-clock values without applying the host timezone. */
export function wallClockEpoch(value: string | Date): number {
    if (value instanceof Date) {
        return Date.UTC(
            value.getFullYear(), value.getMonth(), value.getDate(),
            value.getHours(), value.getMinutes(), value.getSeconds(),
        );
    }
    const match = String(value).match(
        /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/,
    );
    if (!match) return Number.NaN;
    const [, year, month, day, hour, minute, second] = match;
    return Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second || 0),
    );
}

export async function lockAndAssertAppointmentCapacity(
    query: AppointmentTenantQuery,
    input: AppointmentCapacityInput,
): Promise<ActiveAppointmentService> {
    const localDate = localDatePart(input.startAt);
    const lockKeys = [
        `appointment:service:${input.schemaName}:${input.serviceId}:${localDate}`,
        ...(input.staffUserId
            ? [`appointment:staff:${input.schemaName}:${input.staffUserId}:${localDate}`]
            : []),
    ].sort();
    for (const lockKey of lockKeys) {
        await query(
            `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))::text AS lock_acquired`,
            [lockKey],
        );
    }

    const services = await query<any[]>(
        // La política de pago viaja con el servicio bloqueado, en la misma
        // consulta que ya decide la capacidad: quien crea la cita necesita saber
        // si nace confirmada o pendiente de pago, y pedirla aparte abriría una
        // ventana entre el bloqueo y la lectura.
        `SELECT id, name, COALESCE(max_concurrent, 1)::int AS max_concurrent,
                price, currency, payment_policy, deposit_percent, deposit_amount
         FROM services
         WHERE id = $1::uuid AND is_active = true
         LIMIT 1
         FOR SHARE`,
        [input.serviceId],
    );
    if (!services?.length) throw new AppointmentServiceUnavailableError();

    const excludeSql = input.excludeAppointmentId ? ' AND id <> $4::uuid' : '';
    if (input.staffUserId) {
        const staffParams: unknown[] = [input.endAt, input.startAt, input.staffUserId];
        if (input.excludeAppointmentId) staffParams.push(input.excludeAppointmentId);
        const staffConflict = await query<any[]>(
            `SELECT id
             FROM appointments
             WHERE status NOT IN ('cancelled') AND ${holdStillAliveSql()}
               AND start_at < $1::timestamp
               AND end_at > $2::timestamp
               AND assigned_to = $3::uuid
               ${excludeSql}
             LIMIT 1`,
            staffParams,
        );
        if (staffConflict?.length) throw new AppointmentSlotConflictError();
    }

    const capacityParams: unknown[] = [input.endAt, input.startAt, input.serviceId];
    if (input.excludeAppointmentId) capacityParams.push(input.excludeAppointmentId);
    const occupancy = await query<Array<{ occupied: number }>>(
        `SELECT COUNT(*)::int AS occupied
         FROM appointments
         WHERE status NOT IN ('cancelled') AND ${holdStillAliveSql()}
           AND start_at < $1::timestamp
           AND end_at > $2::timestamp
           AND service_id = $3::uuid
           ${excludeSql}`,
        capacityParams,
    );
    const maxConcurrent = Math.max(1, Number(services[0].max_concurrent) || 1);
    if (Number(occupancy?.[0]?.occupied || 0) >= maxConcurrent) {
        throw new AppointmentSlotConflictError();
    }

    return {
        id: services[0].id,
        name: services[0].name,
        maxConcurrent,
        price: services[0].price,
        currency: services[0].currency,
        payment_policy: services[0].payment_policy,
        deposit_percent: services[0].deposit_percent,
        deposit_amount: services[0].deposit_amount,
    };
}
