import { CalendarSyncOutboxService } from './calendar-sync-outbox.service';

const APPOINTMENT_ID = '11111111-1111-4111-8111-111111111111';
const INTEGRATION_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_ID = '33333333-3333-4333-8333-333333333333';
const STAFF_USER_ID = '77777777-7777-4777-8777-777777777777';
const STAFF_PROFILE_ID = '88888888-8888-4888-8888-888888888888';

describe('CalendarSyncOutboxService', () => {
    const prisma: any = {
        tenant: { findMany: jest.fn() },
    };
    const calendars: any = {
        createEventForIntegration: jest.fn(),
        updateEventForIntegration: jest.fn(),
        deleteEventForIntegration: jest.fn(),
    };
    const service = new CalendarSyncOutboxService(prisma, calendars);

    beforeEach(() => jest.clearAllMocks());

    it('maps the assigned public user through a distinct staff profile before selecting its calendar', async () => {
        const query = jest.fn()
            .mockResolvedValueOnce([{
                id: APPOINTMENT_ID,
                assigned_to: STAFF_USER_ID,
                service_id: null,
                service_name: 'Consulta',
                start_at: '2026-08-08T10:00:00',
                end_at: '2026-08-08T10:30:00',
                metadata: {},
                calendar_sync_revision: 0,
            }])
            .mockResolvedValueOnce([{
                id: INTEGRATION_ID,
                user_id: OWNER_ID,
                provider: 'google',
                staff_id: STAFF_PROFILE_ID,
            }])
            .mockResolvedValue([]);

        await expect(service.enqueueWithQuery(query, APPOINTMENT_ID, 'upsert'))
            .resolves.toMatchObject({ revision: 1 });

        const appointmentUpdate = query.mock.calls.find(([sql]: [string]) => (
            sql.includes('UPDATE appointments') && sql.includes('calendar_owner_id')
        ));
        expect(appointmentUpdate[1].slice(0, 5)).toEqual([
            APPOINTMENT_ID,
            INTEGRATION_ID,
            OWNER_ID,
            'google',
            1,
        ]);
        const insert = query.mock.calls.find(([sql]: [string]) => sql.includes('INSERT INTO calendar_sync_outbox'));
        expect(insert).toBeDefined();
        expect(calendars.createEventForIntegration).not.toHaveBeenCalled();
        const staffLookup = query.mock.calls.find(([sql]: [string]) => sql.includes('staff_operational_bindings'));
        expect(STAFF_PROFILE_ID).not.toBe(STAFF_USER_ID);
        expect(staffLookup[1]).toEqual([STAFF_USER_ID]);
        expect(staffLookup[0]).toContain('WHERE b.user_id = $1::uuid');
        expect(staffLookup[0]).toContain('ci.assignment_id = b.staff_id');
        expect(staffLookup[0]).not.toContain('ci.assignment_id = $1::uuid');
        expect(staffLookup[0]).not.toContain('b.staff_id = $1::uuid');
        expect(query.mock.calls.some(([sql]: [string]) => sql.includes("assignment_type = 'general'")))
            .toBe(false);
    });

    it('does not fall back to general for an active legacy staff calendar without a canonical binding', async () => {
        const query = jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('FROM appointments')) {
                return [{
                    id: APPOINTMENT_ID,
                    assigned_to: STAFF_USER_ID,
                    service_id: null,
                    service_name: 'Consulta',
                    start_at: '2026-08-08T10:00:00',
                    end_at: '2026-08-08T10:30:00',
                    metadata: {},
                    calendar_sync_revision: 0,
                }];
            }
            if (sql.includes('FROM calendar_integrations legacy_ci')) {
                return [{ id: INTEGRATION_ID }];
            }
            if (sql.includes('FROM staff_operational_bindings b')) return [];
            if (sql.includes("assignment_type = 'general'")) {
                return [{ id: INTEGRATION_ID, user_id: OWNER_ID, provider: 'google' }];
            }
            return [];
        });

        await expect(service.enqueueWithQuery(query, APPOINTMENT_ID, 'upsert'))
            .rejects.toThrow('calendar_staff_binding_reconciliation_required');

        const legacyLookup = query.mock.calls.find(([sql]: [string]) => (
            sql.includes('FROM calendar_integrations legacy_ci')
        ));
        expect(legacyLookup[1]).toEqual([STAFF_USER_ID]);
        expect(legacyLookup[0]).toContain('legacy_ci.assignment_id = $1::uuid');
        expect(legacyLookup[0]).toContain('NOT EXISTS');
        expect(query.mock.calls.some(([sql]: [string]) => sql.includes("assignment_type = 'general'")))
            .toBe(false);
        expect(query.mock.calls.some(([sql]: [string]) => sql.includes('INSERT INTO calendar_sync_outbox')))
            .toBe(false);
    });

    it('does not fail over when an immutable calendar owner is inactive', async () => {
        const query = jest.fn()
            .mockResolvedValueOnce([{
                id: APPOINTMENT_ID,
                service_name: 'Consulta',
                start_at: '2026-08-08T10:00:00',
                end_at: '2026-08-08T10:30:00',
                metadata: {},
                calendar_integration_id: INTEGRATION_ID,
                calendar_sync_revision: 2,
            }])
            .mockResolvedValueOnce([]);

        await expect(service.enqueueWithQuery(query, APPOINTMENT_ID, 'delete'))
            .rejects.toThrow('calendar_owner_reconciliation_required');
        expect(query.mock.calls[1][0]).toContain('owner_tenant.schema_name = current_schema()');
        expect(query.mock.calls.some(([sql]: [string]) => sql.includes("assignment_type = 'general'")))
            .toBe(false);
    });

    it('does not guess an owner for a legacy provider event with no integration id', async () => {
        const query = jest.fn().mockResolvedValueOnce([{
            id: APPOINTMENT_ID,
            service_name: 'Consulta',
            start_at: '2026-08-08T10:00:00',
            end_at: '2026-08-08T10:30:00',
            metadata: {},
            calendar_integration_id: null,
            calendar_event_id: null,
            google_event_id: 'legacy-google-event',
            outlook_event_id: null,
            calendar_sync_revision: 0,
        }]);

        await expect(service.enqueueWithQuery(query, APPOINTMENT_ID, 'delete'))
            .rejects.toThrow('calendar_owner_reconciliation_required');
        expect(query).toHaveBeenCalledTimes(1);
    });

    it('reuses the provider-specific legacy event after explicit owner reconciliation', async () => {
        const query = jest.fn()
            .mockResolvedValueOnce([{
                id: APPOINTMENT_ID,
                service_name: 'Consulta',
                start_at: '2026-08-08T10:00:00',
                end_at: '2026-08-08T10:30:00',
                metadata: {},
                calendar_integration_id: INTEGRATION_ID,
                calendar_event_id: null,
                google_event_id: 'legacy-google-event',
                outlook_event_id: null,
                calendar_sync_revision: 0,
            }])
            .mockResolvedValueOnce([{
                id: INTEGRATION_ID,
                user_id: OWNER_ID,
                provider: 'google',
            }])
            .mockResolvedValue([]);

        await service.enqueueWithQuery(query, APPOINTMENT_ID, 'upsert');

        const insert = query.mock.calls.find(([sql]: [string]) => (
            sql.includes('INSERT INTO calendar_sync_outbox')
        ));
        expect(JSON.parse(insert[1][7])).toMatchObject({
            integrationId: INTEGRATION_ID,
            externalEventId: 'legacy-google-event',
        });
    });

    it('fails closed as not_configured when no integration owns the appointment', async () => {
        const query = jest.fn()
            .mockResolvedValueOnce([{
                id: APPOINTMENT_ID,
                service_name: 'Consulta',
                start_at: '2026-08-08T10:00:00',
                end_at: '2026-08-08T10:30:00',
                metadata: {},
                calendar_sync_revision: 0,
            }])
            .mockResolvedValueOnce([]);

        await expect(service.enqueueWithQuery(query, APPOINTMENT_ID, 'upsert')).resolves.toBeNull();
        expect(query.mock.calls.some(([sql]: [string]) => sql.includes("calendar_sync_state = 'not_configured'")))
            .toBe(true);
    });

    it('processes provider I/O only after a durable claim and stores event ownership', async () => {
        const outboxRow = {
            id: '44444444-4444-4444-8444-444444444444',
            appointment_id: APPOINTMENT_ID,
            operation: 'upsert',
            revision: 1,
            attempts: 1,
            idempotency_key: 'appointment:key',
            payload: {
                appointmentId: APPOINTMENT_ID,
                integrationId: INTEGRATION_ID,
                ownerUserId: OWNER_ID,
                provider: 'google',
                externalEventId: null,
                summary: 'Consulta',
                startAt: '2026-08-08T10:00:00',
                endAt: '2026-08-08T10:30:00',
            },
        };
        const successQuery = jest.fn()
            .mockResolvedValueOnce([{ id: outboxRow.id }])
            .mockResolvedValue([]);
        let transaction = 0;
        prisma.transactionInTenantSchema = jest.fn(async (_schema: string, callback: any) => {
            transaction += 1;
            if (transaction === 1) return [outboxRow];
            return callback(successQuery);
        });
        calendars.createEventForIntegration.mockResolvedValue({
            eventId: 'provider-event-1',
            meetingUrl: 'https://meet.example/one',
        });

        await expect(service.processTenant('tenant_demo')).resolves.toBe(1);
        expect(calendars.createEventForIntegration).toHaveBeenCalledWith(
            'tenant_demo',
            INTEGRATION_ID,
            expect.objectContaining({ idempotencyKey: 'appointment:key' }),
        );
        expect(successQuery.mock.calls.some(([sql]: [string]) => sql.includes('calendar_event_id'))).toBe(true);
    });

    it('retries sanitized failures without exposing credentials', async () => {
        const row = {
            id: '44444444-4444-4444-8444-444444444444',
            operation: 'upsert',
            revision: 1,
            attempts: 1,
            idempotency_key: 'appointment:key',
            payload: {
                appointmentId: APPOINTMENT_ID,
                integrationId: INTEGRATION_ID,
                ownerUserId: OWNER_ID,
                provider: 'google',
                externalEventId: null,
                summary: 'Consulta',
                startAt: '2026-08-08T10:00:00',
                endAt: '2026-08-08T10:30:00',
            },
        };
        const failureQuery = jest.fn()
            .mockResolvedValueOnce([{ appointment_id: APPOINTMENT_ID, revision: 1 }])
            .mockResolvedValue([]);
        let transaction = 0;
        prisma.transactionInTenantSchema = jest.fn(async (_schema: string, callback: any) => {
            transaction += 1;
            if (transaction === 1) return [row];
            return callback(failureQuery);
        });
        calendars.createEventForIntegration.mockRejectedValue(
            new Error('token=super-secret https://provider.example/private'),
        );

        await service.processTenant('tenant_demo');
        const failure = failureQuery.mock.calls.find(([sql]: [string]) => (
            sql.includes('UPDATE calendar_sync_outbox') && sql.includes('SET state = $5')
        ));
        expect(failure).toBeDefined();
        expect(failure![1][2]).not.toContain('super-secret');
        expect(failure![1][2]).not.toContain('provider.example');
    });

    it('moves exhausted provider work to an explicit reconciliation obligation', async () => {
        const row = {
            id: '44444444-4444-4444-8444-444444444444',
            operation: 'upsert',
            revision: 4,
            attempts: 10,
            idempotency_key: 'appointment:exhausted',
            payload: {
                appointmentId: APPOINTMENT_ID,
                integrationId: INTEGRATION_ID,
                ownerUserId: OWNER_ID,
                provider: 'google',
                externalEventId: null,
                summary: 'Consulta',
                startAt: '2026-08-08T10:00:00',
                endAt: '2026-08-08T10:30:00',
            },
        };
        const failureQuery = jest.fn()
            .mockResolvedValueOnce([{ appointment_id: APPOINTMENT_ID, revision: 4 }])
            .mockResolvedValue([]);
        let transaction = 0;
        prisma.transactionInTenantSchema = jest.fn(async (_schema: string, callback: any) => {
            transaction += 1;
            if (transaction === 1) return [row];
            return callback(failureQuery);
        });
        calendars.createEventForIntegration.mockRejectedValue(new Error('provider unavailable'));

        await expect(service.processTenant('tenant_demo')).resolves.toBe(1);

        const outboxUpdate = failureQuery.mock.calls.find(([sql]: [string]) => (
            sql.includes('UPDATE calendar_sync_outbox') && sql.includes('SET state = $5')
        ));
        expect(outboxUpdate[1][4]).toBe('reconciliation_required');
        const appointmentUpdate = failureQuery.mock.calls.find(([sql]: [string]) => (
            sql.includes('UPDATE appointments')
        ));
        expect(appointmentUpdate[1][1]).toBe('calendar_reconciliation_required');

    });

    it('promotes legacy exhausted failures during reconciliation and blocks silent requeue', async () => {
        const query = jest.fn(async (sql: string, _params?: unknown[]) => {
            if (sql.includes("WHERE state = 'failed' AND attempts >= $1")) {
                return [{ appointment_id: APPOINTMENT_ID, revision: 7 }];
            }
            if (sql.includes('SELECT a.id')) return [];
            return [];
        });
        prisma.transactionInTenantSchema = jest.fn(async (_schema: string, callback: any) => callback(query));

        await expect(service.reconcileTenant('tenant_demo')).resolves.toBe(0);

        const exhausted = query.mock.calls.find(([sql]: [string]) => (
            sql.includes("WHERE state = 'failed' AND attempts >= $1")
        ));
        expect(exhausted).toBeDefined();
        expect(exhausted![1]).toEqual([10]);
        const missingScan = query.mock.calls.find(([sql]: [string]) => sql.includes('SELECT a.id'));
        expect(missingScan).toBeDefined();
        expect(missingScan![0]).toContain("'reconciliation_required'");
        const appointmentUpdate = query.mock.calls.find(([sql]: [string]) => (
            sql.includes("calendar_sync_error = 'calendar_reconciliation_required'")
        ));
        expect(appointmentUpdate).toBeDefined();
        expect(appointmentUpdate![1]).toEqual([APPOINTMENT_ID, 7]);
        const inactiveOwnerUpdate = query.mock.calls.find(([sql]: [string]) => (
            sql.includes("calendar_sync_error = 'calendar_integration_unavailable'")
        ));
        expect(inactiveOwnerUpdate).toBeDefined();
        expect(inactiveOwnerUpdate![0]).toContain("calendar_sync_state = 'reconciliation_required'");
    });

    it('carries a stale provider result into the next revision instead of creating twice', async () => {
        const row = {
            id: '44444444-4444-4444-8444-444444444444',
            operation: 'upsert',
            revision: 1,
            attempts: 1,
            idempotency_key: 'appointment:revision-1',
            payload: {
                appointmentId: APPOINTMENT_ID,
                integrationId: INTEGRATION_ID,
                ownerUserId: OWNER_ID,
                provider: 'google',
                externalEventId: null,
                summary: 'Consulta',
                startAt: '2026-08-08T10:00:00',
                endAt: '2026-08-08T10:30:00',
            },
        };
        const completionQuery = jest.fn()
            .mockResolvedValueOnce([{ id: row.id }])
            .mockResolvedValueOnce([{
                calendar_integration_id: INTEGRATION_ID,
                calendar_sync_revision: 2,
            }])
            .mockResolvedValue([]);
        let transaction = 0;
        prisma.transactionInTenantSchema = jest.fn(async (_schema: string, callback: any) => {
            transaction += 1;
            if (transaction === 1) return [row];
            return callback(completionQuery);
        });
        calendars.createEventForIntegration.mockResolvedValue({ eventId: 'provider-event-stable' });

        await service.processTenant('tenant_demo');

        const carryForward = completionQuery.mock.calls.find(([sql]: [string]) => (
            sql.includes("jsonb_set(payload, '{externalEventId}'")
        ));
        expect(carryForward[1]).toEqual([
            APPOINTMENT_ID,
            1,
            'provider-event-stable',
            INTEGRATION_ID,
        ]);
        expect(calendars.createEventForIntegration).toHaveBeenCalledTimes(1);
    });
});
