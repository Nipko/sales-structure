import { AIToolExecutorService } from './ai-tool-executor.service';

describe('AIToolExecutorService appointment cancellation safety', () => {
    const schemaName = 'tenant_appointment_safety';
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const contactId = '22222222-2222-4222-8222-222222222222';
    const appointmentId = '33333333-3333-4333-8333-333333333333';

    function createHarness(queryResults: any[][]) {
        const prisma = { $queryRawUnsafe: jest.fn() };
        for (const result of queryResults) prisma.$queryRawUnsafe.mockResolvedValueOnce(result);
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
        );
        return { executor, prisma, redis, eventEmitter, calendarIntegration, propertiesService };
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
            typeof sql === 'string' && sql.includes('UPDATE') && sql.includes('.appointments'),
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
        expect(harness.prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
        expect(harness.prisma.$queryRawUnsafe.mock.calls.some(([sql]) =>
            typeof sql === 'string' && sql.includes('INSERT INTO') && sql.includes('.appointments'),
        )).toBe(false);
        expect(harness.redis.releaseLockToken).not.toHaveBeenCalled();
        expect(harness.calendarIntegration.createEvent).not.toHaveBeenCalled();
        expect(harness.eventEmitter.emit).not.toHaveBeenCalled();
    });

    it.each([
        ['google', { google_event_id: 'google-event-1', outlook_event_id: null }],
        ['microsoft', { google_event_id: null, outlook_event_id: 'outlook-event-1' }],
    ])('patches the existing %s event and never creates a replacement', async (provider, eventIds) => {
        const harness = createHarness([
            [{ ...appointment, assigned_to: null, ...eventIds }],
            [{ duration_minutes: 30 }],
            [],
            [{ id: appointmentId }],
            [{ user_id: '55555555-5555-4555-8555-555555555555', provider }],
        ]);

        const result = await harness.executor.execute(
            schemaName,
            tenantId,
            contactId,
            'reschedule_appointment',
            { appointmentId, newDate: '2026-08-12', newTime: '11:00' },
        );

        expect(result).toMatchObject({ success: true, calendarSynced: true });
        expect(harness.calendarIntegration.updateEvent).toHaveBeenCalledTimes(1);
        expect(harness.calendarIntegration.updateEvent).toHaveBeenCalledWith(
            schemaName,
            '55555555-5555-4555-8555-555555555555',
            provider === 'google' ? 'google-event-1' : 'outlook-event-1',
            expect.objectContaining({
                startAt: '2026-08-12T11:00:00',
                endAt: '2026-08-12T11:30:00',
            }),
            provider,
        );
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
