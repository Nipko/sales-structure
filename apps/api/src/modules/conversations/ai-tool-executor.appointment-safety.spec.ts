import { AIToolExecutorService } from './ai-tool-executor.service';

describe('AIToolExecutorService appointment cancellation safety', () => {
    const schemaName = 'tenant_appointment_safety';
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const contactId = '22222222-2222-4222-8222-222222222222';
    const appointmentId = '33333333-3333-4333-8333-333333333333';
    const calendarIntegrationId = '55555555-5555-4555-8555-555555555555';
    const calendarOwnerId = '66666666-6666-4666-8666-666666666666';

    function createHarness(queryResults: any[][]) {
        const queuedResults = [...queryResults];
        let insertedAppointment: any | undefined;
        const rawQuery: jest.Mock<any, any[]> = jest.fn(async (..._args: any[]) => (
            queuedResults.shift() ?? []
        ));
        const transactionQuery: jest.Mock<any, [string, unknown[]?]> = jest.fn(async (
            sql: string,
            params: unknown[] = [],
        ) => {
            // Keep outbox bookkeeping independent from the ordered domain-query
            // fixtures below. This models one immutable, active calendar owner.
            if (sql.includes('COALESCE(calendar_sync_revision')) {
                return [{
                    ...appointment,
                    ...(insertedAppointment || {}),
                    assigned_to: null,
                    location: insertedAppointment?.location ?? null,
                    notes: insertedAppointment?.notes ?? null,
                    metadata: insertedAppointment?.metadata ?? {},
                    customer_email: insertedAppointment?.customer_email ?? null,
                    calendar_integration_id: calendarIntegrationId,
                    calendar_owner_id: calendarOwnerId,
                    calendar_provider: 'google',
                    calendar_event_id: 'provider-event-1',
                    calendar_sync_revision: 0,
                }];
            }
            if (sql.includes('FROM calendar_integrations')
                && (
                    sql.includes('WHERE id = $1::uuid AND is_active = true')
                    || sql.includes('WHERE ci.id = $1::uuid AND ci.is_active = true')
                )) {
                return [{ id: calendarIntegrationId, user_id: calendarOwnerId, provider: 'google' }];
            }
            if (sql.includes('calendar_sync_outbox') || sql.includes('calendar_sync_state')) {
                return [];
            }
            if (sql.includes('SELECT id FROM contacts')) {
                return [{ id: contactId }];
            }
            if (sql.includes('FROM opportunities o')) {
                return [];
            }
            const result = await rawQuery(sql, ...params);
            if (sql.includes('INSERT INTO appointments') && result?.[0]) {
                insertedAppointment = {
                    ...result[0],
                    service_id: params[3],
                    service_name: params[4],
                    assigned_to: params[5],
                    start_at: params[6],
                    end_at: params[7],
                    customer_email: params[10],
                    location: params[11],
                    notes: params[12],
                    metadata: JSON.parse(String(params[13] || '{}')),
                };
            }
            return result;
        });
        const prisma = {
            $queryRawUnsafe: rawQuery,
            user: { findMany: jest.fn().mockResolvedValue([]) },
            executeInTenantSchema: jest.fn(async (_schema: string, sql: string, params: unknown[] = []) => (
                rawQuery(sql, ...params)
            )),
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => (
                callback(transactionQuery)
            )),
        };
        const redis = {
            acquireLockToken: jest.fn().mockResolvedValue('slot-lock-token'),
            releaseLockToken: jest.fn().mockResolvedValue(undefined),
        };
        const eventEmitter = { emit: jest.fn() };
        const calendarIntegration = {
            createEvent: jest.fn(),
            updateEvent: jest.fn().mockResolvedValue(true),
        };
        const propertiesService = { getById: jest.fn() };
        const executor = new AIToolExecutorService(
            prisma as any,
            redis as any,
            eventEmitter as any,
            calendarIntegration as any,
            {} as any,
            {} as any,
            {} as any,
            propertiesService as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {
                preflight: jest.fn().mockResolvedValue({ allowed: true, policy: { externalEffect: 'none' } }),
                complete: jest.fn().mockResolvedValue(undefined),
                fail: jest.fn().mockResolvedValue(undefined),
            } as any,
            {} as any,
            {} as any,
        );
        return {
            executor,
            prisma,
            redis,
            eventEmitter,
            calendarIntegration,
            propertiesService,
            transactionQuery,
        };
    }

    const appointment = {
        id: appointmentId,
        contact_id: contactId,
        service_id: null,
        service_name: 'Consulta',
        start_at: new Date('2026-08-10T15:00:00.000Z'),
        end_at: new Date('2026-08-10T15:30:00.000Z'),
        status: 'confirmed',
    };

    it('updates and emits the canonical event only for the winning cancellation', async () => {
        const harness = createHarness([[appointment], [{ id: appointmentId }]]);

        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'cancel_appointment',
            { appointmentId, reason: 'Cambio de planes' },
        );

        expect(result).toMatchObject({ success: true, alternatives: [] });
        expect(harness.prisma.$queryRawUnsafe.mock.calls[1][0]).toContain("status <> 'cancelled'");
        expect(harness.prisma.$queryRawUnsafe.mock.calls[1][0]).toContain('cancellation_reason');
        expect(harness.eventEmitter.emit).toHaveBeenCalledTimes(1);
        expect(harness.eventEmitter.emit).toHaveBeenCalledWith(
            'appointment.cancelled',
            expect.objectContaining({
                schemaName,
                reason: 'Cambio de planes',
                appointment: expect.objectContaining({ id: appointmentId, contactId, status: 'cancelled' }),
            }),
        );
    });

    it('does not repeat notes or events when the appointment was already cancelled', async () => {
        const harness = createHarness([[{ ...appointment, status: 'cancelled' }]]);

        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'cancel_appointment',
            { appointmentId },
        );

        expect(result).toMatchObject({ success: true, alreadyCancelled: true });
        expect(harness.prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
        expect(harness.eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('treats a concurrent winning update as the same success without duplicate effects', async () => {
        const harness = createHarness([[appointment], []]);

        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'cancel_appointment',
            { appointmentId },
        );

        expect(result).toMatchObject({ success: true, alreadyCancelled: true });
        expect(harness.eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('does not reveal physical access instructions before the booked stay begins', async () => {
        const harness = createHarness([[]]);
        harness.propertiesService.getById.mockResolvedValue({
            id: appointmentId,
            name: 'Casa de prueba',
            check_in_instructions: 'CODE-1234',
            address: 'Calle privada 1',
        });

        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'get_check_in_instructions',
            { propertyId: appointmentId },
        );

        expect(result.error).toContain('no active booking');
        expect(harness.prisma.$queryRawUnsafe.mock.calls[0][0]).toContain('check_in <= CURRENT_DATE');
        expect(harness.prisma.$queryRawUnsafe.mock.calls[0][0]).toContain('check_out >= CURRENT_DATE');
        expect(result).not.toHaveProperty('address');
        expect(result).not.toHaveProperty('checkInInstructions');
    });

    it('applies one guarded reschedule and emits only after the winning update', async () => {
        const harness = createHarness([
            [{ ...appointment, assigned_to: null }],
            [{ duration_minutes: 30 }],
            [],
            [{ id: appointmentId }],
            [],
        ]);

        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'reschedule_appointment',
            { appointmentId, newDate: '2026-08-12', newTime: '11:00', reason: 'Cambio' },
        );

        expect(result).toMatchObject({ success: true });
        const updateSql = harness.prisma.$queryRawUnsafe.mock.calls[3][0];
        expect(updateSql).toContain("status <> 'cancelled'");
        expect(updateSql).toContain('start_at IS DISTINCT FROM');
        expect(updateSql).toContain('RETURNING id');
        expect(harness.redis.releaseLockToken).toHaveBeenCalledWith(
            `lock:slot:${schemaName}:any:2026-08-12`,
            'slot-lock-token',
        );
        expect(harness.eventEmitter.emit).toHaveBeenCalledTimes(1);
        expect(harness.eventEmitter.emit).toHaveBeenCalledWith(
            'appointment.rescheduled',
            expect.objectContaining({ appointmentId, newStartAt: '2026-08-12T11:00:00' }),
        );
    });

    it('treats an exact reschedule retry as success without notes, provider calls or events', async () => {
        const harness = createHarness([
            [{ ...appointment, assigned_to: null }],
            [{ duration_minutes: 30 }],
            [],
            [],
            [{ id: appointmentId }],
        ]);

        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'reschedule_appointment',
            { appointmentId, newDate: '2026-08-12', newTime: '11:00' },
        );

        expect(result).toMatchObject({ success: true, alreadyRescheduled: true });
        const updateSql = harness.prisma.$queryRawUnsafe.mock.calls[3][0];
        expect(updateSql).toContain('notes = COALESCE(notes');
        expect(updateSql).toContain('start_at = $6::timestamp');
        expect(updateSql).toContain('end_at = $7::timestamp');
        expect(harness.prisma.$queryRawUnsafe.mock.calls.filter(([sql]) =>
            typeof sql === 'string' && sql.includes('UPDATE appointments'),
        )).toHaveLength(1);
        expect(harness.calendarIntegration.createEvent).not.toHaveBeenCalled();
        expect(harness.calendarIntegration.updateEvent).not.toHaveBeenCalled();
        expect(harness.eventEmitter.emit).not.toHaveBeenCalled();
        expect(harness.redis.releaseLockToken).toHaveBeenCalledTimes(1);
    });

    it('fails closed instead of rescheduling without owning the slot lock', async () => {
        const harness = createHarness([
            [{ ...appointment, assigned_to: null }],
            [{ duration_minutes: 30 }],
        ]);
        jest.spyOn(harness.executor as any, 'acquireSlotLock').mockResolvedValue(null);

        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'reschedule_appointment',
            { appointmentId, newDate: '2026-08-12', newTime: '11:00' },
        );

        expect(result).toMatchObject({ retryable: true });
        expect(harness.prisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);
        expect(harness.redis.releaseLockToken).not.toHaveBeenCalled();
        expect(harness.eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('fails closed instead of creating an appointment without owning the slot lock', async () => {
        const serviceId = '44444444-4444-4444-8444-444444444444';
        const harness = createHarness([[
            {
                id: serviceId,
                name: 'Consulta',
                duration_minutes: 30,
                duration_type: 'fixed',
                duration_minutes_max: null,
                price: 0,
                currency: 'COP',
                location_type: 'in_person',
            },
        ]]);
        jest.spyOn(harness.executor as any, 'acquireSlotLock').mockResolvedValue(null);

        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'create_appointment',
            {
                serviceId,
                date: '2026-08-12',
                time: '11:00',
                customerName: 'Cliente',
            },
        );

        expect(result).toMatchObject({ retryable: true });
        expect(harness.prisma.$queryRawUnsafe.mock.calls.some(([sql]) =>
            typeof sql === 'string' && sql.includes('INSERT INTO') && sql.includes('appointments'),
        )).toBe(false);
        expect(harness.redis.releaseLockToken).not.toHaveBeenCalled();
        expect(harness.calendarIntegration.createEvent).not.toHaveBeenCalled();
        expect(harness.eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('rejects check_availability for a staff UUID outside the tenant before reading slots', async () => {
        const serviceId = '44444444-4444-4444-8444-444444444444';
        const foreignStaffId = '77777777-7777-4777-8777-777777777777';
        const harness = createHarness([[]]);

        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'check_availability',
            { serviceId, staffId: foreignStaffId, date: '2026-08-12' },
        );

        expect(result).toMatchObject({ error: 'tool_failed' });
        expect(harness.prisma.executeInTenantSchema).toHaveBeenCalledTimes(1);
        expect(harness.prisma.$queryRawUnsafe.mock.calls.some(([sql]) => (
            typeof sql === 'string' && sql.includes('availability_slots')
        ))).toBe(false);
        expect(harness.calendarIntegration.createEvent).not.toHaveBeenCalled();
    });

    it('rejects create_appointment for a staff UUID outside the tenant before lock, insert or outbox', async () => {
        const serviceId = '44444444-4444-4444-8444-444444444444';
        const foreignStaffId = '77777777-7777-4777-8777-777777777777';
        const harness = createHarness([[
            {
                id: serviceId,
                name: 'Consulta',
                duration_minutes: 30,
                duration_type: 'fixed',
                duration_minutes_max: null,
                price: 0,
                currency: 'COP',
                location_type: 'in_person',
                location_address: 'Calle 10',
                meeting_link: null,
            },
        ], [], []]);

        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'create_appointment',
            {
                serviceId,
                staffId: foreignStaffId,
                date: '2026-08-12',
                time: '11:00',
                customerName: 'Cliente',
            },
        );

        expect(result).toMatchObject({ error: 'tool_failed' });
        expect(harness.redis.acquireLockToken).not.toHaveBeenCalled();
        expect(harness.prisma.transactionInTenantSchema).not.toHaveBeenCalled();
        expect(harness.transactionQuery).not.toHaveBeenCalled();
        expect(harness.eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('persists the complete calendar enrichment before capturing the exact outbox payload', async () => {
        const serviceId = '44444444-4444-4444-8444-444444444444';
        const harness = createHarness([[
            {
                id: serviceId,
                name: 'Consulta',
                duration_minutes: 30,
                duration_type: 'fixed',
                duration_minutes_max: null,
                max_concurrent: 1,
                price: 0,
                currency: 'COP',
                location_type: 'in_person',
                location_address: 'Calle 10 # 20-30',
                meeting_link: 'https://meet.example/static-room',
            },
        ], [], [], [{ id: serviceId, name: 'Consulta', max_concurrent: 1 }], [{ occupied: 0 }], [{
            id: appointmentId,
            service_name: 'Consulta',
            start_at: '2026-08-12T11:00:00',
            end_at: '2026-08-12T11:30:00',
            status: 'confirmed',
        }]]);

        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'create_appointment',
            {
                serviceId,
                date: '2026-08-12',
                time: '11:00',
                customerName: 'Cliente',
                customerPhone: '+573001112233',
                customerEmail: 'cliente@example.com',
                notes: 'Traer documentos',
            },
        );

        expect(result).toMatchObject({
            success: true,
            appointment: { id: appointmentId, meetingUrl: 'https://meet.example/static-room' },
        });
        const insertCall = harness.transactionQuery.mock.calls.find(([sql]) => (
            sql.includes('INSERT INTO appointments')
        ));
        expect(insertCall).toBeDefined();
        const insertParams = insertCall![1] as any[];
        expect(insertParams[11]).toBe('Calle 10 # 20-30');
        expect(insertParams[12]).toBe(
            'Customer: Cliente\nEmail: cliente@example.com\nPhone: +573001112233\n\n'
            + 'Service: Consulta (N/A)\nDuration: 30 min\n\nNotes: Traer documentos',
        );
        expect(JSON.parse(insertParams[13])).toEqual({
            isOnline: false,
            meetingUrl: 'https://meet.example/static-room',
        });

        const outboxCall = harness.transactionQuery.mock.calls.find(([sql]) => (
            sql.includes('INSERT INTO calendar_sync_outbox')
        ));
        expect(outboxCall).toBeDefined();
        expect(JSON.parse(String((outboxCall![1] as any[])[7]))).toEqual({
            appointmentId,
            integrationId: calendarIntegrationId,
            ownerUserId: calendarOwnerId,
            provider: 'google',
            externalEventId: 'provider-event-1',
            summary: 'Consulta',
            startAt: '2026-08-12T11:00:00',
            endAt: '2026-08-12T11:30:00',
            location: 'Calle 10 # 20-30',
            description: insertParams[12],
            attendeeEmail: 'cliente@example.com',
            isOnline: false,
        });
        expect(harness.prisma.$queryRawUnsafe.mock.calls.some(([sql]) => (
            typeof sql === 'string'
            && sql.includes('UPDATE')
            && sql.includes('meetingUrl')
        ))).toBe(false);
    });

    it.each([
        ['google', { google_event_id: 'google-event-1', outlook_event_id: null }],
        ['microsoft', { google_event_id: null, outlook_event_id: 'outlook-event-1' }],
    ])('queues the existing %s event update and performs no provider I/O in the writer', async (_provider, eventIds) => {
        const harness = createHarness([
            [{ ...appointment, assigned_to: null, ...eventIds }],
            [{ duration_minutes: 30 }],
            [],
            [{ id: appointmentId }],
        ]);

        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'reschedule_appointment',
            { appointmentId, newDate: '2026-08-12', newTime: '11:00' },
        );

        expect(result).toMatchObject({
            success: true,
            calendarSynced: false,
            calendarSyncState: 'pending',
        });
        expect(harness.transactionQuery.mock.calls.some(([sql]) => (
            typeof sql === 'string' && sql.includes('INSERT INTO calendar_sync_outbox')
        ))).toBe(true);
        expect(harness.calendarIntegration.updateEvent).not.toHaveBeenCalled();
        expect(harness.calendarIntegration.createEvent).not.toHaveBeenCalled();
        expect(harness.eventEmitter.emit).toHaveBeenCalledTimes(1);
    });

    it('rejects a stale competing reschedule without appending a note or emitting effects', async () => {
        const harness = createHarness([
            [{ ...appointment, assigned_to: null }],
            [{ duration_minutes: 30 }],
            [],
            [],
            [],
        ]);

        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'reschedule_appointment',
            { appointmentId, newDate: '2026-08-12', newTime: '11:00' },
        );

        expect(result.error).toContain('changed concurrently');
        const updateCall = harness.prisma.$queryRawUnsafe.mock.calls[3];
        expect(updateCall[0]).toContain('start_at = $6::timestamp');
        expect(updateCall[0]).toContain('end_at = $7::timestamp');
        expect(updateCall[6]).toBe(appointment.start_at);
        expect(updateCall[7]).toBe(appointment.end_at);
        expect(harness.calendarIntegration.createEvent).not.toHaveBeenCalled();
        expect(harness.calendarIntegration.updateEvent).not.toHaveBeenCalled();
        expect(harness.eventEmitter.emit).not.toHaveBeenCalled();
    });
});
