import { AIToolExecutorService } from '../ai-tool-executor.service';
import { SLOT_WINDOW_FLAG } from '../../throttle/feature-flags.service';

/**
 * A salon open 09:00-19:00 with 30-minute services, checked through the REAL
 * `check_availability` handler (slot generation, conflicts, windowing). Only the
 * database rows and the tenant flag are stubbed.
 */
export const SALON_SERVICE_ID = '44444444-4444-4444-8444-444444444444';
export const SALON_TENANT_ID = '11111111-1111-4111-8111-111111111111';
export const SALON_STAFF_ID = '66666666-6666-4666-8666-666666666666';

export interface SalonOptions {
    /** `agentRuntime.slotWindow` for the tenant. */
    flag: boolean;
    /** Appointments already taken that day, as HH:MM start/end. */
    booked?: Array<{ start: string; end: string }>;
    /** Opening window rows (default one row 09:00-19:00). */
    hours?: Array<{ start: string; end: string }>;
}

export function salonExecutor(options: SalonOptions) {
    const booked = options.booked ?? [];
    const hours = options.hours ?? [{ start: '09:00', end: '19:00' }];
    const prisma = {
        $queryRawUnsafe: jest.fn(async (sql: string) => {
            if (sql.includes('FROM') && sql.includes('services WHERE id')) {
                return [{ duration_minutes: 30, buffer_minutes: 0, duration_type: 'fixed', duration_minutes_max: null, max_concurrent: 1, location_type: 'in_person' }];
            }
            if (sql.includes('appointments')) {
                // The salon's only stylist is busy: every service loses those slots.
                return booked.map(slot => ({ assigned_to: SALON_STAFF_ID, service_id: SALON_SERVICE_ID, start_time: slot.start, end_time: slot.end }));
            }
            if (sql.includes('persona_config')) return [{ tz: 'America/Bogota' }];
            return [];
        }),
        $executeRawUnsafe: jest.fn(),
        executeInTenantSchema: jest.fn(async () => []),
        user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const redis = { acquireLockToken: jest.fn().mockResolvedValue('hold') };
    const calendarIntegration = { getFreeBusyForDate: jest.fn().mockResolvedValue([]) };
    const featureFlags = {
        isFeatureEnabled: jest.fn(async (_tenantId: string, key: string) => key === SLOT_WINDOW_FLAG && options.flag),
    };
    const control = {
        preflight: jest.fn().mockResolvedValue({ allowed: true, policy: { externalEffect: 'none' } }),
        complete: jest.fn(),
        fail: jest.fn(),
    };
    const args: any[] = Array.from({ length: 33 }, () => ({}));
    args[0] = prisma; args[1] = redis; args[2] = { emit: jest.fn() }; args[3] = calendarIntegration;
    args[21] = control;
    for (let i = 24; i < 32; i++) args[i] = undefined;
    args[32] = featureFlags;
    const executor: AIToolExecutorService = new (AIToolExecutorService as any)(...args);
    jest.spyOn(executor as any, 'loadOpenWindows').mockResolvedValue({
        outcome: 'ok',
        slots: hours.map(window => ({ user_id: SALON_STAFF_ID, start_time: `${window.start}:00`, end_time: `${window.end}:00` })),
    });
    return { executor, prisma, featureFlags, redis };
}
