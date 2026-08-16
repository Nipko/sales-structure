import { PublicBookingController } from './public-booking.controller';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('PublicBookingController canonical appointment handoff', () => {
    const schemaName = 'tenant_public_booking';
    const serviceId = '11111111-1111-4111-8111-111111111111';
    const staffId = '22222222-2222-4222-8222-222222222222';
    const contactId = '55555555-5555-4555-8555-555555555555';
    const appointmentId = '44444444-4444-4444-8444-444444444444';

    function harness(matchingContacts: Array<{
        id: string;
        channel_type: string;
        external_id: string;
    }> = [], identityState?: {
        contact_count: number;
        linked_contact_count: number;
        profile_count: number;
    }) {
        const existingAppointments: Array<{
            id: string;
            assigned_to: string | null;
            metadata: Record<string, unknown>;
            status: string;
        }> = [];
        const execute = jest.fn(async (_schema: string, sql: string, _params?: any[]) => {
            if (sql.includes('COUNT(ci.contact_id)::int AS linked_contact_count')) {
                return [identityState || {
                    contact_count: matchingContacts.length,
                    linked_contact_count: 0,
                    profile_count: 0,
                }];
            }
            if (sql.includes('FROM contacts') && sql.includes('phone_normalized')) return matchingContacts;
            if (sql.includes('UPDATE contacts')) return matchingContacts;
            if (sql.includes('INSERT INTO contacts')) {
                const created = {
                    id: contactId,
                    channel_type: 'public_booking',
                    external_id: '+573001112233',
                };
                matchingContacts.push(created);
                return [created];
            }
            if (sql.includes('FROM appointments') && sql.includes('publicBookingIdempotencyKey')) {
                return existingAppointments.filter(row => (
                    row.status !== 'cancelled'
                    && row.metadata.publicBookingIdempotencyKey === _params?.[0]
                ));
            }
            return [];
        });
        const prisma = {
            $queryRaw: jest.fn().mockResolvedValue([{
                id: '33333333-3333-4333-8333-333333333333',
                schema_name: schemaName,
                name: 'Negocio',
                is_internal: false,
                subscription_status: 'active',
                public_booking_enabled: true,
            }]),
            executeInTenantSchema: execute,
            transactionInTenantSchema: jest.fn(async (schema: string, callback: any) => callback(
                (sql: string, params?: any[]) => execute(schema, sql, params),
            )),
        };
        const appointments = {
            getBookableSlots: jest.fn().mockResolvedValue([{
                time: '09:00', endTime: '09:30', agentId: staffId, agentName: 'Agente',
            }]),
            create: jest.fn(async (_schema: string, input: any) => {
                existingAppointments.push({
                    id: appointmentId,
                    assigned_to: input.assignedTo || null,
                    metadata: input.metadata,
                    status: 'pending',
                });
                return { id: appointmentId };
            }),
        };
        const services = {
            getById: jest.fn().mockResolvedValue({
                id: serviceId,
                name: 'Consulta',
                isActive: true,
                durationMinutes: 30,
                bufferMinutes: 0,
                maxConcurrent: 1,
                requiredFields: [],
            }),
        };
        const calendar = { getFreeBusyForDate: jest.fn().mockResolvedValue([]) };
        const identity = { resolveOrCreateProfile: jest.fn().mockResolvedValue(undefined) };
        const redis = { incrementRateLimit: jest.fn().mockResolvedValue(1) };
        const controller = new PublicBookingController(
            prisma as any,
            redis as any,
            appointments as any,
            services as any,
            calendar as any,
            identity as any,
        );
        return { controller, prisma, appointments, calendar, identity, redis, existingAppointments };
    }

    it('rechecks the offered slot and passes service plus canonical staff to the shared writer', async () => {
        const h = harness();

        await h.controller.createBooking('negocio', { ip: '127.0.0.1' }, {
            serviceId,
            date: '2026-08-12',
            startTime: '09:00',
            customerName: 'Cliente',
            customerPhone: '+573001112233',
            customerEmail: 'cliente@example.com',
        });

        expect(h.appointments.getBookableSlots).toHaveBeenCalledWith(
            schemaName, '2026-08-12', serviceId, 30, 0, undefined, [], 1,
        );
        expect(h.appointments.create).toHaveBeenCalledWith(schemaName, expect.objectContaining({
            contactId,
            serviceId,
            assignedTo: staffId,
            serviceName: 'Consulta',
            source: 'public_booking',
            customerEmail: 'cliente@example.com',
            metadata: expect.objectContaining({
                publicBookingIdempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
                publicBookingRequestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
            }),
        }));
        expect(h.identity.resolveOrCreateProfile).toHaveBeenCalledWith(
            '33333333-3333-4333-8333-333333333333',
            expect.objectContaining({ id: contactId, channelType: 'public_booking' }),
        );
        expect(h.prisma.executeInTenantSchema.mock.calls.some(([, sql]: [string, string]) => (
            sql.includes('UPDATE appointments')
        ))).toBe(false);
    });

    it('returns one stable contact and appointment on an identical retry', async () => {
        const h = harness();
        const base = {
            serviceId,
            date: '2026-08-12',
            startTime: '09:00',
            customerName: 'Cliente',
            customerEmail: 'cliente@example.com',
        };

        await h.controller.createBooking('negocio', { ip: '127.0.0.1' }, {
            ...base,
            customerPhone: '300 111 2233',
        });
        await h.controller.createBooking('negocio', { ip: '127.0.0.1' }, {
            ...base,
            customerPhone: '+57 300 111 2233',
        });

        const contactCalls = h.prisma.executeInTenantSchema.mock.calls.filter(([, sql]: [string, string]) => (
            sql.includes('INSERT INTO contacts')
        ));
        expect(contactCalls).toHaveLength(1);
        for (const [schema, sql, params] of contactCalls) {
            expect(schema).toBe(schemaName);
            expect(sql).toContain("'public_booking'");
            expect(sql).toContain('phone_normalized');
            expect(sql).toContain('ON CONFLICT (channel_type, external_id) DO UPDATE');
            expect(params?.[0]).toBe('+573001112233');
        }
        expect(h.prisma.executeInTenantSchema.mock.calls.filter(([, sql]: [string, string]) => (
            sql.includes('UPDATE contacts')
        ))).toHaveLength(0);
        expect(h.appointments.create).toHaveBeenCalledTimes(1);
        for (const [, input] of h.appointments.create.mock.calls) {
            expect(input.contactId).toBe(contactId);
        }
    });

    it('reuses one existing cross-channel contact with the same normalized phone', async () => {
        const whatsappContact = {
            id: '66666666-6666-4666-8666-666666666666',
            channel_type: 'whatsapp',
            external_id: '573001112233',
        };
        const h = harness([whatsappContact]);

        await h.controller.createBooking('negocio', { ip: '127.0.0.1' }, {
            serviceId,
            date: '2026-08-12',
            startTime: '09:00',
            customerName: 'Cliente existente',
            customerPhone: '+57 300 111 2233',
        });

        const sql = h.prisma.executeInTenantSchema.mock.calls.map(([, query]: [string, string]) => query);
        expect(sql.some((query: string) => query.includes('INSERT INTO contacts'))).toBe(false);
        expect(sql.some((query: string) => query.includes('UPDATE contacts'))).toBe(true);
        expect(h.appointments.create).toHaveBeenCalledWith(schemaName, expect.objectContaining({
            contactId: whatsappContact.id,
        }));
        expect(h.identity.resolveOrCreateProfile).toHaveBeenCalledWith(
            '33333333-3333-4333-8333-333333333333',
            expect.objectContaining({
                id: whatsappContact.id,
                channelType: 'whatsapp',
                externalId: '573001112233',
                allowPhoneAutoLink: true,
            }),
        );
    });

    it('does not auto-link an arbitrary profile when several contacts share the phone', async () => {
        const h = harness([
            { id: '66666666-6666-4666-8666-666666666666', channel_type: 'whatsapp', external_id: '573001112233' },
            { id: '77777777-7777-4777-8777-777777777777', channel_type: 'sms', external_id: '+573001112233' },
        ]);

        await h.controller.createBooking('negocio', { ip: '127.0.0.1' }, {
            serviceId,
            date: '2026-08-12',
            startTime: '09:00',
            customerName: 'Persona con teléfono compartido',
            customerPhone: '+57 300 111 2233',
        });

        expect(h.identity.resolveOrCreateProfile).toHaveBeenCalledWith(
            '33333333-3333-4333-8333-333333333333',
            expect.objectContaining({
                id: contactId,
                channelType: 'public_booking',
                allowPhoneAutoLink: false,
            }),
        );
        expect(h.appointments.create).toHaveBeenCalledWith(schemaName, expect.objectContaining({
            contactId,
        }));
    });

    it('allows the public contact to join when every matching contact shares one profile', async () => {
        const h = harness([
            { id: '66666666-6666-4666-8666-666666666666', channel_type: 'whatsapp', external_id: '573001112233' },
            { id: '77777777-7777-4777-8777-777777777777', channel_type: 'instagram', external_id: 'ig-123' },
        ], {
            contact_count: 2,
            linked_contact_count: 2,
            profile_count: 1,
        });

        await h.controller.createBooking('negocio', { ip: '127.0.0.1' }, {
            serviceId,
            date: '2026-08-12',
            startTime: '09:00',
            customerName: 'Cliente omnicanal',
            customerPhone: '+57 300 111 2233',
        });

        expect(h.identity.resolveOrCreateProfile).toHaveBeenCalledWith(
            '33333333-3333-4333-8333-333333333333',
            expect.objectContaining({
                id: contactId,
                channelType: 'public_booking',
                allowPhoneAutoLink: true,
            }),
        );
    });

    it('keeps the phone ambiguous when matching contacts belong to different profiles', async () => {
        const h = harness([
            { id: '66666666-6666-4666-8666-666666666666', channel_type: 'whatsapp', external_id: '573001112233' },
            { id: '77777777-7777-4777-8777-777777777777', channel_type: 'sms', external_id: '+573001112233' },
        ], {
            contact_count: 2,
            linked_contact_count: 2,
            profile_count: 2,
        });

        await h.controller.createBooking('negocio', { ip: '127.0.0.1' }, {
            serviceId,
            date: '2026-08-12',
            startTime: '09:00',
            customerName: 'Teléfono familiar',
            customerPhone: '+57 300 111 2233',
        });

        expect(h.identity.resolveOrCreateProfile).toHaveBeenCalledWith(
            '33333333-3333-4333-8333-333333333333',
            expect.objectContaining({ allowPhoneAutoLink: false }),
        );
    });

    it('rate-limits slot discovery independently before calling external FreeBusy', async () => {
        const h = harness();
        h.redis.incrementRateLimit
            .mockResolvedValueOnce(31)
            .mockResolvedValueOnce(1);

        await expect(h.controller.getAvailableSlots(
            'negocio',
            '2026-08-12',
            serviceId,
            { ip: '127.0.0.1' },
        )).rejects.toMatchObject({ status: 429 });
        expect(h.calendar.getFreeBusyForDate).not.toHaveBeenCalled();
        expect(h.redis.incrementRateLimit.mock.calls[0][0]).toContain('ratelimit:booking-slots:tenant:');
        expect(h.redis.incrementRateLimit.mock.calls[1][0]).toContain('ratelimit:booking-slots:global:');
    });

    it('returns public slots below both slot-discovery budgets', async () => {
        const h = harness();
        const result = await h.controller.getAvailableSlots(
            'negocio',
            '2026-08-12',
            serviceId,
            { ip: '127.0.0.1' },
        );

        expect(result.data.slots).toEqual([expect.objectContaining({
            start: '09:00',
            staffId,
        })]);
        expect(h.calendar.getFreeBusyForDate).toHaveBeenCalledTimes(1);
    });

    it('blocks a public booking before service/calendar work when payment authorization is pending', async () => {
        const h = harness();
        h.prisma.$queryRaw.mockResolvedValue([{
            id: '33333333-3333-4333-8333-333333333333',
            schema_name: schemaName,
            name: 'Negocio',
            public_booking_enabled: true,
            subscription_status: 'pending_auth',
        }]);

        await expect(h.controller.createBooking('negocio', { ip: '127.0.0.1' }, {
            serviceId,
            date: '2026-08-12',
            startTime: '09:00',
            customerName: 'Cliente',
            customerPhone: '+573001112233',
        })).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'payment_method_required' }),
        });
        expect(h.calendar.getFreeBusyForDate).not.toHaveBeenCalled();
        expect(h.appointments.create).not.toHaveBeenCalled();
    });

    it('recovers the committed winner when a concurrent retry loses at capacity or unique index', async () => {
        const h = harness();
        const winner = {
            id: appointmentId,
            assigned_to: staffId,
            metadata: {} as Record<string, unknown>,
            status: 'pending',
        };
        let lookup = 0;
        const originalExecute = h.prisma.executeInTenantSchema.getMockImplementation()!;
        h.prisma.executeInTenantSchema.mockImplementation(async (...args: any[]) => {
            const [, sql, params] = args;
            if (sql.includes('FROM appointments') && sql.includes('publicBookingIdempotencyKey')) {
                lookup += 1;
                if (lookup === 1) return [];
                winner.metadata = {
                    publicBookingIdempotencyKey: params[0],
                    publicBookingRequestFingerprint: params[0],
                };
                return [winner];
            }
            return originalExecute(args[0], args[1], args[2]);
        });
        h.appointments.create.mockRejectedValueOnce(new Error('appointment_slot_unavailable'));

        const response = await h.controller.createBooking('negocio', { ip: '127.0.0.1' }, {
            serviceId,
            date: '2026-08-12',
            startTime: '09:00',
            customerName: 'Cliente',
            customerPhone: '+573001112233',
        });

        expect(response.data.appointmentId).toBe(appointmentId);
        expect(h.appointments.create).toHaveBeenCalledTimes(1);
    });

    it('rejects reuse of an explicit idempotency key with a different payload', async () => {
        const h = harness();
        const req = { ip: '127.0.0.1', headers: { 'idempotency-key': 'browser-operation-1' } };
        await h.controller.createBooking('negocio', req, {
            serviceId,
            date: '2026-08-12',
            startTime: '09:00',
            customerName: 'Cliente',
            customerPhone: '+573001112233',
        });

        await expect(h.controller.createBooking('negocio', req, {
            serviceId,
            date: '2026-08-12',
            startTime: '09:00',
            customerName: 'Otra persona',
            customerPhone: '+573001112233',
        })).rejects.toMatchObject({ status: 409 });
        expect(h.appointments.create).toHaveBeenCalledTimes(1);
    });

    it('trusts Cloudflare client IP only when the direct peer is the production tunnel', () => {
        const h = harness();
        const previous = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            expect((h.controller as any).resolveClientIp({
                socket: { remoteAddress: '172.20.0.3' },
                headers: { 'cf-connecting-ip': '203.0.113.8' },
            })).toBe('203.0.113.8');
            expect((h.controller as any).resolveClientIp({
                socket: { remoteAddress: '198.51.100.7' },
                headers: { 'cf-connecting-ip': '203.0.113.9' },
            })).toBe('198.51.100.7');
        } finally {
            process.env.NODE_ENV = previous;
        }
    });

    it('returns HTTP 429 after ten requests in the tenant/IP window', async () => {
        const h = harness();
        h.redis.incrementRateLimit.mockResolvedValue(11);
        await expect(h.controller.createBooking('negocio', { ip: '127.0.0.1' }, {
            serviceId,
            date: '2026-08-12',
            startTime: '09:00',
            customerName: 'Cliente',
            customerPhone: '+573001112233',
        })).rejects.toMatchObject({ status: 429 });
    });

    it('ships a partial unique index for active public-booking idempotency keys', () => {
        const sql = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
        expect(sql).toContain('appt_public_booking_idempotency_idx');
        expect(sql).toContain(`("metadata"->>'publicBookingIdempotencyKey')`);
        expect(sql).toContain(`WHERE "source" = 'public_booking'`);
        expect(sql).toContain(`"status" <> 'cancelled'`);
    });
});
