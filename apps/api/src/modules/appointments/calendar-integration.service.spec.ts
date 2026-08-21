import { google } from 'googleapis';
import { Client as GraphClient } from '@microsoft/microsoft-graph-client';
import { randomUUID } from 'crypto';
import { CalendarIntegrationService } from './calendar-integration.service';

describe('CalendarIntegrationService encryption configuration', () => {
    function construct(encryptionKey?: unknown) {
        const config = {
            get: jest.fn((key: string, fallback?: unknown) => (
                key === 'ENCRYPTION_KEY' ? encryptionKey ?? fallback : fallback
            )),
        };
        return new CalendarIntegrationService(
            {} as any,
            {} as any,
            config as any,
            {} as any,
        { timezoneFor: jest.fn().mockResolvedValue('America/Bogota'), timezoneForSchema: jest.fn().mockResolvedValue('America/Bogota') } as any,
    );
    }

    it('fails closed when ENCRYPTION_KEY is missing', () => {
        expect(() => construct()).toThrow(
            'ENCRYPTION_KEY must be exactly 64 hexadecimal characters',
        );
    });

    it('fails closed when ENCRYPTION_KEY is not exactly 64 hexadecimal characters', () => {
        for (const malformed of [
            '11'.repeat(31),
            '11'.repeat(33),
            'z1'.repeat(32),
            ` ${'11'.repeat(32)}`,
            64,
        ]) {
            expect(() => construct(malformed)).toThrow(
                'ENCRYPTION_KEY must be exactly 64 hexadecimal characters',
            );
        }
    });

    it('accepts an explicit 64-hex key and uses it for authenticated encryption', () => {
        const service = construct('aB'.repeat(32));
        const encrypted = (service as any).encrypt('calendar-refresh-token');

        expect(encrypted).not.toContain('calendar-refresh-token');
        expect((service as any).decrypt(encrypted)).toBe('calendar-refresh-token');
    });
});

describe('CalendarIntegrationService.updateEvent', () => {
    const schemaName = 'tenant_calendar_patch';
    const userId = '11111111-1111-4111-8111-111111111111';
    const staffProfileId = '33333333-3333-4333-8333-333333333333';
    const integrationId = '22222222-2222-4222-8222-222222222222';
    const data = {
        summary: 'Consulta — Reprogramado',
        startAt: '2026-08-12T11:00:00',
        endAt: '2026-08-12T11:30:00',
    };

    function createService() {
        const prisma = {
            executeInTenantSchema: jest.fn().mockResolvedValue([]),
            transactionInTenantSchema: jest.fn(),
            tenant: {
                findFirst: jest.fn(),
            },
        };
        const config = {
            get: jest.fn((key: string, fallback?: unknown) => (
                key === 'ENCRYPTION_KEY' ? '00'.repeat(32) : fallback
            )),
        };
        const service = new CalendarIntegrationService(
            prisma as any,
            {} as any,
            config as any,
            {} as any,
        { timezoneFor: jest.fn().mockResolvedValue('America/Bogota'), timezoneForSchema: jest.fn().mockResolvedValue('America/Bogota') } as any,
    );
        return { service, prisma };
    }

    function integration(provider: 'google' | 'microsoft') {
        return {
            id: integrationId,
            userId,
            provider,
            calendarId: provider === 'google' ? 'team-calendar' : 'primary',
            accountEmail: null,
            label: null,
            assignmentType: 'general',
            assignmentId: null,
            isActive: true,
            connectedAt: '2026-08-01T00:00:00.000Z',
        };
    }

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('maps a public user to a distinct staff profile and prefers that calendar over general', async () => {
        const { service, prisma } = createService();
        const staffCalendar = {
            id: integrationId,
            user_id: userId,
            provider: 'google',
            calendar_id: 'staff-calendar',
            account_email: 'staff@example.test',
            label: 'Staff',
            assignment_type: 'staff',
            assignment_id: staffProfileId,
            is_active: true,
            connected_at: '2026-08-01T00:00:00.000Z',
        };
        prisma.executeInTenantSchema.mockImplementation(async (_schema: string, sql: string) => {
            if (sql.includes('staff_operational_bindings')) return [staffCalendar];
            if (sql.includes("assignment_type = 'general'")) {
                return [{ ...staffCalendar, id: '99999999-9999-4999-8999-999999999999', assignment_type: 'general' }];
            }
            return [];
        });

        const calendars = await service.resolveCalendarsForContext(schemaName, { staffId: userId });

        expect(staffProfileId).not.toBe(userId);
        expect(calendars).toHaveLength(1);
        expect(calendars[0]).toMatchObject({ id: integrationId, assignmentId: staffProfileId });
        const staffLookup = prisma.executeInTenantSchema.mock.calls.find(([, sql]: [string, string]) => (
            sql.includes('staff_operational_bindings')
        ));
        expect(staffLookup[2]).toEqual([userId]);
        expect(staffLookup[1]).toContain('binding.user_id = $1::uuid');
        expect(staffLookup[1]).toContain('ci.assignment_id = binding.staff_id');
        expect(staffLookup[1]).not.toContain('ci.assignment_id = $1::uuid');
        expect(prisma.executeInTenantSchema.mock.calls.some(([, sql]: [string, string]) => (
            sql.includes("assignment_type = 'general'")
        ))).toBe(false);
    });

    it('does not fall back to general when an active legacy staff calendar lacks a canonical binding', async () => {
        const { service, prisma } = createService();
        prisma.executeInTenantSchema.mockImplementation(async (_schema: string, sql: string) => {
            if (sql.includes('FROM calendar_integrations legacy_ci')) {
                return [{
                    id: integrationId,
                    user_id: userId,
                    provider: 'google',
                    calendar_id: 'legacy-staff-calendar',
                    assignment_type: 'staff',
                    assignment_id: userId,
                    is_active: true,
                    connected_at: '2026-08-01T00:00:00.000Z',
                }];
            }
            if (sql.includes('staff_operational_bindings')) return [];
            if (sql.includes("assignment_type = 'general'")) {
                return [{ id: '99999999-9999-4999-8999-999999999999' }];
            }
            return [];
        });

        await expect(service.resolveCalendarsForContext(schemaName, { staffId: userId }))
            .rejects.toThrow('calendar_staff_binding_reconciliation_required');

        const legacyLookup = prisma.executeInTenantSchema.mock.calls.find(([, sql]: [string, string]) => (
            sql.includes('FROM calendar_integrations legacy_ci')
        ));
        expect(legacyLookup[2]).toEqual([userId]);
        expect(legacyLookup[1]).toContain('legacy_ci.assignment_id = $1::uuid');
        expect(legacyLookup[1]).toContain('NOT EXISTS');
        expect(prisma.executeInTenantSchema.mock.calls.some(([, sql]: [string, string]) => (
            sql.includes("assignment_type = 'general'")
        ))).toBe(false);
    });

    it('rejects an invalid assignment type before touching tenant data', async () => {
        const { service, prisma } = createService();

        await expect(service.updateAssignment(schemaName, integrationId, {
            assignmentType: 'warehouse',
        })).rejects.toMatchObject({ status: 400 });
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it('rejects missing or extra assignment identifiers', async () => {
        const { service, prisma } = createService();

        await expect(service.updateAssignment(schemaName, integrationId, {
            assignmentType: 'staff',
        })).rejects.toThrow('Calendar staff/service assignment requires an identifier');
        await expect(service.updateAssignment(schemaName, integrationId, {
            assignmentType: 'general',
            assignmentId: userId,
        })).rejects.toThrow('General calendar assignment cannot include an identifier');
        await expect(service.updateAssignment(schemaName, integrationId, {
            assignmentId: userId,
        })).rejects.toThrow('Calendar assignment type is required when an identifier is provided');
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it('rejects an unknown or inactive assignment target from the tenant authority', async () => {
        const { service, prisma } = createService();
        const query = jest.fn()
            .mockResolvedValueOnce([{ id: integrationId, is_active: true }])
            .mockResolvedValueOnce([]);
        prisma.transactionInTenantSchema.mockImplementation(
            async (_schema: string, callback: any) => callback(query),
        );

        await expect(service.updateAssignment(schemaName, integrationId, {
            assignmentType: 'service',
            assignmentId: '33333333-3333-4333-8333-333333333333',
        })).rejects.toMatchObject({ status: 409 });
        expect(query.mock.calls.some(([sql]: [string]) => sql.includes('UPDATE calendar_integrations')))
            .toBe(false);
    });

    it('canonicalizes a dashboard public user assignment to its bound staff profile', async () => {
        const { service, prisma } = createService();
        const query = jest.fn()
            .mockResolvedValueOnce([{ id: integrationId, is_active: true }])
            .mockResolvedValueOnce([{ id: staffProfileId }])
            .mockResolvedValueOnce([{ id: integrationId }]);
        prisma.transactionInTenantSchema.mockImplementation(
            async (_schema: string, callback: any) => callback(query),
        );

        await service.updateAssignment(schemaName, integrationId, {
            assignmentType: 'staff',
            assignmentId: userId,
        });

        const authorityCall = query.mock.calls.find(([sql]: [string]) => (
            sql.includes('staff_operational_bindings')
        ));
        expect(authorityCall[1]).toEqual([userId]);
        const updateCall = query.mock.calls.find(([sql]: [string]) => (
            sql.includes('UPDATE calendar_integrations')
        ));
        expect(updateCall[1]).toEqual([integrationId, 'staff', staffProfileId]);
    });

    it('returns 404 for an unknown integration and 409 for an inactive integration', async () => {
        const unknown = createService();
        const unknownQuery = jest.fn().mockResolvedValueOnce([]);
        unknown.prisma.transactionInTenantSchema.mockImplementation(
            async (_schema: string, callback: any) => callback(unknownQuery),
        );

        await expect(unknown.service.updateAssignment(schemaName, integrationId, {
            label: 'Equipo Norte',
        })).rejects.toMatchObject({ status: 404 });

        const inactive = createService();
        const inactiveQuery = jest.fn().mockResolvedValueOnce([{
            id: integrationId,
            is_active: false,
        }]);
        inactive.prisma.transactionInTenantSchema.mockImplementation(
            async (_schema: string, callback: any) => callback(inactiveQuery),
        );

        await expect(inactive.service.updateAssignment(schemaName, integrationId, {
            label: 'Equipo Norte',
        })).rejects.toMatchObject({ status: 409 });
        expect(inactiveQuery).toHaveBeenCalledTimes(1);
    });

    it('normalizes a general assignment to null and CAS-updates only an active integration', async () => {
        const { service, prisma } = createService();
        const query = jest.fn()
            .mockResolvedValueOnce([{ id: integrationId, is_active: true }])
            .mockResolvedValueOnce([{ id: integrationId }]);
        prisma.transactionInTenantSchema.mockImplementation(
            async (_schema: string, callback: any) => callback(query),
        );

        await expect(service.updateAssignment(schemaName, integrationId, {
            assignmentType: 'general',
        })).resolves.toBeUndefined();

        const update = query.mock.calls[1];
        expect(update[0]).toContain('assignment_type = $2');
        expect(update[0]).toContain('assignment_id = $3::uuid');
        expect(update[0]).toContain('WHERE id = $1::uuid AND is_active = true');
        expect(update[0]).toContain('RETURNING id');
        expect(update[1]).toEqual([integrationId, 'general', null]);
    });

    it('PATCHes the original Google event and never inserts a replacement', async () => {
        const { service } = createService();
        const patch = jest.fn().mockResolvedValue({ data: { id: 'google-event-1' } });
        const insert = jest.fn();
        const calendarSpy = jest.spyOn(google as any, 'calendar').mockReturnValue({
            events: { patch, insert },
        });
        jest.spyOn(service as any, 'queryIntegrations').mockResolvedValue([integration('google')]);
        jest.spyOn(service as any, 'getGoogleClient').mockResolvedValue({ oauth: true });

        const result = await service.updateEvent(
            schemaName,
            userId,
            'google-event-1',
            data,
            'google',
        );

        expect(result).toBe(true);
        expect(calendarSpy).toHaveBeenCalledTimes(1);
        expect(patch).toHaveBeenCalledWith({
            calendarId: 'team-calendar',
            eventId: 'google-event-1',
            requestBody: {
                summary: data.summary,
                start: { dateTime: data.startAt },
                end: { dateTime: data.endAt },
                location: undefined,
                description: undefined,
            },
            sendUpdates: 'all',
        });
        expect(insert).not.toHaveBeenCalled();
        expect((service as any).queryIntegrations).toHaveBeenCalledWith(
            schemaName,
            expect.stringContaining('provider = $2'),
            [userId, 'google'],
        );
    });

    it('PATCHes the original Microsoft event URL and never posts a replacement', async () => {
        const { service } = createService();
        const patch = jest.fn().mockResolvedValue({ id: 'outlook-event/1' });
        const post = jest.fn();
        const api = jest.fn().mockReturnValue({ patch, post });
        jest.spyOn(service as any, 'queryIntegrations').mockResolvedValue([integration('microsoft')]);
        jest.spyOn(service as any, 'getMicrosoftClient').mockResolvedValue({ api });
        jest.spyOn(service as any, 'getTimezoneFromSchema').mockResolvedValue('America/Bogota');

        const result = await service.updateEvent(
            schemaName,
            userId,
            'outlook-event/1',
            data,
            'microsoft',
        );

        expect(result).toBe(true);
        expect(api).toHaveBeenCalledWith('/me/events/outlook-event%2F1');
        expect(patch).toHaveBeenCalledWith({
            subject: data.summary,
            start: { dateTime: data.startAt, timeZone: 'America/Bogota' },
            end: { dateTime: data.endAt, timeZone: 'America/Bogota' },
            location: undefined,
            body: undefined,
        });
        expect(post).not.toHaveBeenCalled();
        expect((service as any).queryIntegrations).toHaveBeenCalledWith(
            schemaName,
            expect.stringContaining('provider = $2'),
            [userId, 'microsoft'],
        );
    });

    it('blocks disconnect by durable integration ownership without inferring assigned_to', async () => {
        const { service, prisma } = createService();
        const query = jest.fn()
            .mockResolvedValueOnce([{ id: integrationId }])
            .mockResolvedValueOnce([{
                owned_appointments: 2,
                active_outbox_items: 1,
                unresolved_legacy_events: 0,
            }])
            .mockResolvedValueOnce([]);
        prisma.transactionInTenantSchema.mockImplementation(
            async (_schema: string, callback: any) => callback(query),
        );

        await expect(service.disconnect(schemaName, integrationId)).rejects.toMatchObject({
            response: expect.objectContaining({
                error: 'calendar_owner_reconciliation_required',
                ownedAppointments: 2,
                activeOutboxItems: 1,
            }),
        });

        const blockerSql = query.mock.calls[1][0];
        expect(blockerSql).toContain('calendar_integration_id = $1::uuid');
        expect(blockerSql).not.toContain('assigned_to');
        expect(query.mock.calls.some(([sql]: [string]) => (
            sql.includes("SET is_active = false")
        ))).toBe(false);
    });

    it('keeps legacy reassign-disconnect fail-closed when provider work is owned', async () => {
        const { service, prisma } = createService();
        const targetIntegrationId = '33333333-3333-4333-8333-333333333333';
        const query = jest.fn()
            .mockResolvedValueOnce([{ id: integrationId }])
            .mockResolvedValueOnce([{ id: targetIntegrationId }])
            .mockResolvedValueOnce([{
                owned_appointments: 1,
                active_outbox_items: 0,
                unresolved_legacy_events: 0,
            }]);
        prisma.transactionInTenantSchema.mockImplementation(
            async (_schema: string, callback: any) => callback(query),
        );

        await expect(service.reassignAndDisconnect(
            schemaName,
            integrationId,
            targetIntegrationId,
        )).rejects.toMatchObject({
            response: expect.objectContaining({
                error: 'calendar_reassignment_workflow_required',
                applySupported: false,
            }),
        });
        expect(query.mock.calls.some(([sql]: [string]) => sql.includes('UPDATE appointments')))
            .toBe(false);
        expect(query.mock.calls.some(([sql]: [string]) => sql.includes('assigned_to')))
            .toBe(false);
        expect(query.mock.calls.some(([sql]: [string]) => sql.includes("SET is_active = false")))
            .toBe(false);
    });

    it('fails closed when a configured provider cannot verify external availability', async () => {
        const { service } = createService();
        jest.spyOn(service as any, 'getIntegrationByIdOrNull')
            .mockResolvedValue(integration('google'));
        jest.spyOn(service as any, 'googleFreeBusy')
            .mockRejectedValue(new Error('provider unavailable'));

        await expect(service.getFreeBusy(
            schemaName,
            integrationId,
            '2026-08-12T00:00:00Z',
            '2026-08-12T23:59:59Z',
        )).rejects.toThrow('calendar_availability_unverified');
    });

    it('does not publish a partial free/busy result when one selected calendar fails', async () => {
        const { service } = createService();
        const second = { ...integration('microsoft'), id: '55555555-5555-4555-8555-555555555555' };
        jest.spyOn(service as any, 'resolveCalendarsForContext')
            .mockResolvedValue([integration('google'), second]);
        jest.spyOn(service, 'getFreeBusy')
            .mockResolvedValueOnce([{ start: '2026-08-12T10:00:00Z', end: '2026-08-12T11:00:00Z' }])
            .mockRejectedValueOnce(new Error('calendar_availability_unverified'));

        await expect(service.getFreeBusyForDate(
            schemaName,
            '2026-08-12',
            { staffId: userId },
        )).rejects.toThrow('calendar_availability_unverified');
    });

    it('queries the tenant-local Bogota day in UTC and returns busy wall-clock values', async () => {
        const { service } = createService();
        jest.spyOn(service as any, 'getTimezoneFromSchema').mockResolvedValue('America/Bogota');
        jest.spyOn(service, 'resolveCalendarsForContext').mockResolvedValue([integration('google') as any]);
        const getFreeBusy = jest.spyOn(service, 'getFreeBusy').mockResolvedValue([{
            start: '2026-08-13T01:00:00.000Z',
            end: '2026-08-13T01:30:00.000Z',
        }]);

        await expect(service.getFreeBusyForDate(
            schemaName,
            '2026-08-12',
            { staffId: userId },
        )).resolves.toEqual([{
            start: '2026-08-12T20:00:00',
            end: '2026-08-12T20:30:00',
        }]);
        expect(getFreeBusy).toHaveBeenCalledWith(
            schemaName,
            integrationId,
            '2026-08-12T05:00:00.000Z',
            '2026-08-13T05:00:00.000Z',
        );
    });

    it('uses a 23-hour UTC range for a DST spring-forward local day', async () => {
        const { service } = createService();
        jest.spyOn(service as any, 'getTimezoneFromSchema').mockResolvedValue('America/New_York');
        jest.spyOn(service, 'resolveCalendarsForContext').mockResolvedValue([integration('google') as any]);
        const getFreeBusy = jest.spyOn(service, 'getFreeBusy').mockResolvedValue([]);

        await service.getFreeBusyForDate(schemaName, '2026-03-08', { staffId: userId });

        expect(getFreeBusy).toHaveBeenCalledWith(
            schemaName,
            integrationId,
            '2026-03-08T05:00:00.000Z',
            '2026-03-09T04:00:00.000Z',
        );
    });
});

describe('CalendarIntegrationService OAuth isolation', () => {
    const tenantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const userA = '11111111-1111-4111-8111-111111111111';
    const userB = '22222222-2222-4222-8222-222222222222';
    const integrationA = '33333333-3333-4333-8333-333333333333';
    const integrationB = '44444444-4444-4444-8444-444444444444';

    function createHarness() {
        const values = new Map<string, string>();
        const redisClient = {
            set: jest.fn(async (
                key: string,
                value: string,
                _expiryMode: string,
                _ttl: number,
                _setMode: string,
            ) => {
                if (values.has(key)) return null;
                values.set(key, value);
                return 'OK';
            }),
            eval: jest.fn(async (_script: string, _keyCount: number, key: string) => {
                const value = values.get(key) ?? null;
                values.delete(key);
                return value;
            }),
        };
        const prisma = {
            tenant: {
                findFirst: jest.fn(async ({ where }: any) => (
                    where.id === tenantA
                        ? { schemaName: 'tenant_a' }
                        : where.id === tenantB
                            ? { schemaName: 'tenant_b' }
                            : null
                )),
            },
            user: {
                findFirst: jest.fn(async ({ where }: any) => (
                    (where.id === userA && where.tenantId === tenantA)
                    || (where.id === userB && where.tenantId === tenantB)
                        ? { id: where.id }
                        : null
                )),
            },
            executeInTenantSchema: jest.fn(),
        };
        const redis = { getClient: jest.fn(() => redisClient) };
        const configValues: Record<string, string> = {
            ENCRYPTION_KEY: '11'.repeat(32),
            GOOGLE_OAUTH_CLIENT_ID: 'google-client',
            GOOGLE_OAUTH_CLIENT_SECRET: 'google-secret',
            GOOGLE_CALENDAR_REDIRECT_URI: 'https://api.example.test/google/callback',
            MS_CLIENT_ID: 'microsoft-client',
            MS_CLIENT_SECRET: 'microsoft-secret',
            MS_TENANT_ID: 'common',
            MS_CALENDAR_REDIRECT_URI: 'https://api.example.test/microsoft/callback',
        };
        const config = {
            get: jest.fn((key: string, fallback?: unknown) => configValues[key] ?? fallback),
        };
        const throttle = { enforcePlanLimit: jest.fn().mockResolvedValue(undefined) };
        const service = new CalendarIntegrationService(
            prisma as any,
            redis as any,
            config as any,
            throttle as any,
        { timezoneFor: jest.fn().mockResolvedValue('America/Bogota'), timezoneForSchema: jest.fn().mockResolvedValue('America/Bogota') } as any,
    );
        return { service, prisma, redisClient, values, throttle };
    }

    function stateFrom(url: string): string {
        return new URL(url).searchParams.get('state') || '';
    }

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('keeps opaque server-side state isolated when tenant A/B flows interleave', async () => {
        const { service } = createHarness();
        const [urlA, urlB] = await Promise.all([
            service.getGoogleAuthUrl(tenantA, userA),
            service.getGoogleAuthUrl(tenantB, userB),
        ]);
        const stateA = stateFrom(urlA);
        const stateB = stateFrom(urlB);

        expect(stateA).toMatch(/^[0-9a-f-]{36}$/i);
        expect(stateB).toMatch(/^[0-9a-f-]{36}$/i);
        expect(stateA).not.toContain(tenantA);
        expect(stateB).not.toContain(tenantB);

        const bindingB = await (service as any).consumeOAuthState(stateB, 'google');
        const bindingA = await (service as any).consumeOAuthState(stateA, 'google');
        expect(bindingB).toMatchObject({ tenantId: tenantB, userId: userB, provider: 'google' });
        expect(bindingA).toMatchObject({ tenantId: tenantA, userId: userA, provider: 'google' });
    });

    it('rejects tampered and replayed state after one atomic consume', async () => {
        const { service, redisClient } = createHarness();
        const state = stateFrom(await service.getGoogleAuthUrl(tenantA, userA));

        await expect((service as any).consumeOAuthState(randomUUID(), 'google'))
            .rejects.toThrow('Invalid or expired calendar OAuth state');
        await expect((service as any).consumeOAuthState(state, 'google'))
            .resolves.toMatchObject({ tenantId: tenantA, userId: userA });
        await expect((service as any).consumeOAuthState(state, 'google'))
            .rejects.toThrow('Invalid or expired calendar OAuth state');
        expect(redisClient.eval).toHaveBeenCalledTimes(3);
    });

    it('burns a one-time state on provider swap instead of accepting it elsewhere', async () => {
        const { service } = createHarness();
        const state = stateFrom(await service.getMicrosoftAuthUrl(tenantB, userB));

        await expect((service as any).consumeOAuthState(state, 'google'))
            .rejects.toThrow('Calendar OAuth state binding mismatch');
        await expect((service as any).consumeOAuthState(state, 'microsoft'))
            .rejects.toThrow('Invalid or expired calendar OAuth state');
    });

    it('rejects unknown or cross-tenant service/staff assignment targets before issuing state', async () => {
        const { service, redisClient } = createHarness();

        await expect(service.getGoogleAuthUrl(tenantA, userA, 'service', integrationA))
            .rejects.toThrow('Calendar OAuth assignment target is no longer authorized');
        await expect(service.getGoogleAuthUrl(tenantA, userA, 'staff', userB))
            .rejects.toThrow('Calendar OAuth assignment target is no longer authorized');
        expect(redisClient.set).not.toHaveBeenCalled();
    });

    it('canonicalizes a dashboard public user to a distinct staff profile in one-time state', async () => {
        const { service, prisma, values } = createHarness();
        prisma.executeInTenantSchema.mockImplementation(async (
            _schema: string,
            sql: string,
            params: string[] = [],
        ) => {
            if (sql.includes('staff_operational_bindings') && params[0] === userA) {
                return [{ id: integrationA }];
            }
            if (sql.includes('FROM staff_members') && params[0] === integrationA) {
                return [{ id: integrationA }];
            }
            return [];
        });

        const state = stateFrom(await service.getGoogleAuthUrl(
            tenantA,
            userA,
            'staff',
            userA,
        ));
        const stored = JSON.parse(values.get(`oauth:calendar:state:${state}`) || '{}');

        expect(integrationA).not.toBe(userA);
        expect(stored).toMatchObject({
            tenantId: tenantA,
            userId: userA,
            assignmentType: 'staff',
            assignmentId: integrationA,
        });
        await expect((service as any).consumeOAuthState(state, 'google'))
            .resolves.toMatchObject({ assignmentId: integrationA, schemaName: 'tenant_a' });
    });

    it('fails closed for a dashboard public user with no canonical staff binding', async () => {
        const { service, prisma, redisClient } = createHarness();
        prisma.executeInTenantSchema.mockResolvedValue([]);

        await expect(service.getGoogleAuthUrl(tenantA, userA, 'staff', userA))
            .rejects.toThrow('Calendar OAuth assignment target is no longer authorized');
        expect(redisClient.set).not.toHaveBeenCalled();
    });

    it('revalidates an assignment target when consuming state and burns a deleted target', async () => {
        const { service, prisma } = createHarness();
        prisma.executeInTenantSchema
            .mockResolvedValueOnce([{ id: integrationA }])
            .mockResolvedValueOnce([]);
        const state = stateFrom(
            await service.getGoogleAuthUrl(tenantA, userA, 'service', integrationA),
        );

        await expect((service as any).consumeOAuthState(state, 'google'))
            .rejects.toThrow('Calendar OAuth assignment target is no longer authorized');
        await expect((service as any).consumeOAuthState(state, 'google'))
            .rejects.toThrow('Invalid or expired calendar OAuth state');
    });

    it('uses isolated MSAL caches and exact homeAccountId under interleaved A/B reads', async () => {
        const { service, prisma } = createHarness();
        prisma.executeInTenantSchema.mockImplementation(async (schemaName: string) => ([{
            encrypted_refresh_token: schemaName === 'tenant_a' ? 'cache-a' : 'cache-b',
            microsoft_home_account_id: schemaName === 'tenant_a' ? 'home-a' : 'home-b',
        }]));
        jest.spyOn(service as any, 'decrypt').mockImplementation((value: string) => value);

        let deserializeCount = 0;
        let releaseBoth!: () => void;
        const bothDeserialized = new Promise<void>((resolve) => { releaseBoth = resolve; });
        const makeClient = (expectedCache: string, homeAccountId: string, token: string) => {
            const exact = { homeAccountId, username: `${homeAccountId}@example.test` };
            const decoy = { homeAccountId: `decoy-${homeAccountId}`, username: 'decoy@example.test' };
            const tokenCache = {
                deserialize: jest.fn((cache: string) => {
                    expect(cache).toBe(expectedCache);
                    deserializeCount += 1;
                    if (deserializeCount === 2) releaseBoth();
                }),
                getAllAccounts: jest.fn(async () => {
                    await bothDeserialized;
                    return [decoy, exact];
                }),
            };
            return {
                getTokenCache: jest.fn(() => tokenCache),
                acquireTokenSilent: jest.fn().mockResolvedValue({ accessToken: token }),
                tokenCache,
                exact,
            };
        };
        const clientA = makeClient('cache-a', 'home-a', 'token-a');
        const clientB = makeClient('cache-b', 'home-b', 'token-b');
        const factory = jest.spyOn(service as any, 'createMicrosoftClientApplication')
            .mockReturnValueOnce(clientA as any)
            .mockReturnValueOnce(clientB as any);
        jest.spyOn(GraphClient, 'init').mockImplementation((options: any) => options as any);

        await Promise.all([
            (service as any).getMicrosoftClient('tenant_a', integrationA),
            (service as any).getMicrosoftClient('tenant_b', integrationB),
        ]);

        expect(factory).toHaveBeenCalledTimes(2);
        expect(clientA.acquireTokenSilent).toHaveBeenCalledWith({
            account: clientA.exact,
            scopes: ['Calendars.ReadWrite'],
        });
        expect(clientB.acquireTokenSilent).toHaveBeenCalledWith({
            account: clientB.exact,
            scopes: ['Calendars.ReadWrite'],
        });
    });

    it('persists the exact Microsoft homeAccountId returned by the isolated callback cache', async () => {
        const { service, prisma, throttle } = createHarness();
        const binding = {
            version: 1,
            provider: 'microsoft',
            tenantId: tenantA,
            userId: userA,
            assignmentType: 'general',
            assignmentId: null,
            issuedAt: new Date().toISOString(),
            schemaName: 'tenant_a',
        };
        jest.spyOn(service as any, 'consumeOAuthState').mockResolvedValue(binding);
        jest.spyOn(service as any, 'encrypt').mockReturnValue('encrypted-cache-a');
        jest.spyOn(service as any, 'getIntegrationById').mockResolvedValue({ id: integrationA });
        const exact = { homeAccountId: 'home-a', username: 'a@example.test' };
        const tokenCache = {
            getAllAccounts: jest.fn().mockResolvedValue([
                { homeAccountId: 'decoy', username: 'decoy@example.test' },
                exact,
            ]),
            serialize: jest.fn().mockReturnValue('serialized-cache-a'),
        };
        const callbackClient = {
            acquireTokenByCode: jest.fn().mockResolvedValue({ account: exact }),
            getTokenCache: jest.fn(() => tokenCache),
        };
        jest.spyOn(service as any, 'createMicrosoftClientApplication').mockReturnValue(callbackClient);
        prisma.executeInTenantSchema
            .mockResolvedValueOnce([{ c: 0 }])
            .mockResolvedValueOnce([]);

        await service.handleMicrosoftCallback('authorization-code', 'opaque-state');

        expect(throttle.enforcePlanLimit).toHaveBeenCalled();
        const insertCall = prisma.executeInTenantSchema.mock.calls[1];
        expect(insertCall[1]).toContain('microsoft_home_account_id');
        expect(insertCall[2][3]).toBe('home-a');
        expect(tokenCache.serialize).toHaveBeenCalledTimes(1);
    });
});
