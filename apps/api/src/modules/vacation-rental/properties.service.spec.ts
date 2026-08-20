import {
    BadRequestException,
    ConflictException,
    NotFoundException,
} from '@nestjs/common';
import { PropertiesService } from './properties.service';

describe('PropertiesService reservations', () => {
    const schemaName = 'tenant_vacation';
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const propertyId = '22222222-2222-4222-8222-222222222222';
    const contactId = '66666666-6666-4666-8666-666666666666';
    const property = {
        id: propertyId,
        name: 'Casa Mar',
        is_active: true,
        max_guests: 4,
        min_nights: 1,
        night_price: '100.00',
        cleaning_fee: '20.00',
        currency: 'COP',
        check_in_instructions: null,
    };

    function buildService(prismaOverrides: Record<string, any> = {}) {
        const prisma = {
            tenant: { findUnique: jest.fn() },
            executeInTenantSchema: jest.fn(),
            transactionInTenantSchema: jest.fn(),
            ...prismaOverrides,
        };
        const throttle = { enforcePlanLimit: jest.fn() };
        const emailTemplates = { renderAndSend: jest.fn() };
        return {
            service: new PropertiesService(prisma as any, throttle as any, emailTemplates as any),
            prisma,
            emailTemplates,
        };
    }

    it('uses half-open overlap predicates so another guest may arrive on checkout day', async () => {
        const executeInTenantSchema = jest.fn()
            .mockResolvedValueOnce([property])
            .mockResolvedValueOnce([]);
        const { service } = buildService({ executeInTenantSchema });

        const result = await service.checkAvailability(
            schemaName,
            propertyId,
            '2026-08-10',
            '2026-08-12',
        );

        expect(result).toMatchObject({
            available: true,
            nights: 2,
            totalPrice: 220,
        });
        const conflictCall = executeInTenantSchema.mock.calls[1];
        expect(conflictCall[1]).toContain('check_in < $3::date AND check_out > $2::date');
        expect(conflictCall[1]).toContain('date_range_semantics < 2');
        expect(conflictCall[1]).toContain('check_out >= $2::date');
        expect(conflictCall[1]).not.toContain('check_out < $2::date');
        expect(conflictCall[2]).toEqual([propertyId, '2026-08-10', '2026-08-12']);
    });

    it('marks checkout day available in the monthly calendar', async () => {
        const executeInTenantSchema = jest.fn().mockResolvedValue([
            {
                id: '33333333-3333-4333-8333-333333333333',
                check_in: '2026-08-10',
                check_out: '2026-08-12',
                source: 'direct',
                summary: null,
                date_range_semantics: 2,
            },
            {
                id: '44444444-4444-4444-8444-444444444444',
                check_in: '2026-08-20',
                check_out: '2026-08-22',
                source: 'Airbnb',
                summary: null,
                date_range_semantics: 1,
            },
        ]);
        const { service } = buildService({ executeInTenantSchema });

        const calendar = await service.getCalendar(schemaName, propertyId, '2026-08');

        expect(calendar.find((day) => day.date === '2026-08-11')?.status).toBe('booked');
        expect(calendar.find((day) => day.date === '2026-08-12')?.status).toBe('available');
        expect(calendar.find((day) => day.date === '2026-08-22')?.status).toBe('blocked');
        expect(executeInTenantSchema.mock.calls[0][2]).toEqual([
            propertyId,
            '2026-08-01',
            '2026-09-01',
        ]);
    });

    it('says who booked: the calendar carries the origin and the guest name', async () => {
        // La píldora de origen salía vacía porque leía una columna `source` que
        // `property_bookings` nunca tuvo, y el día reservado no decía nada de
        // quién lo ocupó. Nada lo miraba, así que duró meses.
        const executeInTenantSchema = jest.fn().mockResolvedValue([
            {
                id: '33333333-3333-4333-8333-333333333333',
                check_in: '2026-08-10',
                check_out: '2026-08-12',
                source: 'direct',
                summary: 'Ana Gómez',
                date_range_semantics: 2,
                origin: 'agent',
            },
            {
                id: '44444444-4444-4444-8444-444444444444',
                check_in: '2026-08-20',
                check_out: '2026-08-22',
                source: 'Airbnb',
                summary: 'Reserved',
                date_range_semantics: 1,
                origin: null,
            },
        ]);
        const { service } = buildService({ executeInTenantSchema });

        const calendar = await service.getCalendar(schemaName, propertyId, '2026-08');

        const ownBooking = calendar.find((day) => day.date === '2026-08-11');
        expect(ownBooking).toMatchObject({ status: 'booked', origin: 'agent', summary: 'Ana Gómez' });
        // Lo importado sigue sin origen propio: su procedencia es `source`.
        expect(calendar.find((day) => day.date === '2026-08-21')).toMatchObject({
            status: 'blocked',
            source: 'Airbnb',
            origin: null,
        });

        const sql = executeInTenantSchema.mock.calls[0][1];
        // El origen se deriva de `conversation_id`: sólo el agente lo escribe.
        expect(sql).toContain("CASE WHEN conversation_id IS NOT NULL THEN 'agent' ELSE 'manual' END");
        expect(sql).toContain('guest_name as summary');
        // `source` sigue siendo 'direct' para las propias: de ese literal
        // depende que el día se pinte 'booked' y no 'blocked'.
        expect(sql).toContain("'direct' as source");
    });

    it('derives the booking origin in both listings', async () => {
        const executeInTenantSchema = jest.fn().mockResolvedValue([]);
        const { service } = buildService({ executeInTenantSchema });

        await service.listBookings(schemaName, propertyId);
        await service.listUpcomingBookings(schemaName, '2026-08-19');

        const [perProperty, upcoming] = executeInTenantSchema.mock.calls.map((c: any[]) => c[1]);
        expect(perProperty).toContain("CASE WHEN conversation_id IS NOT NULL THEN 'agent' ELSE 'manual' END AS origin");
        expect(upcoming).toContain("CASE WHEN b.conversation_id IS NOT NULL THEN 'agent' ELSE 'manual' END AS origin");
    });

    it('keeps the dashboard manual picker inclusive and supports a one-day block', async () => {
        const block = { id: '55555555-5555-4555-8555-555555555555' };
        const query = jest.fn(async (sql: string, _params?: unknown[]) => {
            if (sql.includes('pg_advisory_xact_lock')) return [];
            if (sql.includes('SELECT * FROM properties')) return [property];
            if (sql.includes(') conflicts LIMIT 1')) return [];
            if (sql.includes('INSERT INTO ical_blocks')) return [block];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const transactionInTenantSchema = jest.fn(
            async (_schema: string, callback: any) => callback(query),
        );
        const { service } = buildService({ transactionInTenantSchema });

        await expect(service.createBlock(schemaName, propertyId, {
            checkIn: '2026-08-10',
            checkOut: '2026-08-10',
        })).resolves.toBe(block);

        expect(query.mock.calls[2][1]).toEqual([propertyId, '2026-08-10', '2026-08-11']);
        expect(query.mock.calls[3][0]).toContain("VALUES ($1::uuid, $2, 'Manual', $3::date, $4::date, 1, $5)");
        expect(query.mock.calls[3][1]).toEqual(expect.arrayContaining([
            propertyId,
            '2026-08-10',
            '2026-08-10',
        ]));
    });

    it('lists active and future stays from a strict date using half-open checkout', async () => {
        const rows = [{ id: 'booking-1', property_name: 'Casa Mar' }];
        const executeInTenantSchema = jest.fn().mockResolvedValue(rows);
        const { service } = buildService({ executeInTenantSchema });

        await expect(service.listUpcomingBookings(schemaName, '2026-08-08')).resolves.toBe(rows);

        const call = executeInTenantSchema.mock.calls[0];
        expect(call[1]).toContain("b.status != 'cancelled'");
        expect(call[1]).toContain('b.check_out > $1::date');
        expect(call[2]).toEqual(['2026-08-08']);
        await expect(service.listUpcomingBookings(schemaName, '2026-02-30'))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(executeInTenantSchema).toHaveBeenCalledTimes(1);
    });

    it('validates cancellation ids and rejects a booking that does not exist', async () => {
        const executeInTenantSchema = jest.fn().mockResolvedValue([]);
        const { service } = buildService({ executeInTenantSchema });

        await expect(service.cancelBooking(schemaName, 'not-a-uuid'))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(executeInTenantSchema).not.toHaveBeenCalled();

        await expect(service.cancelBooking(
            schemaName,
            '44444444-4444-4444-8444-444444444444',
        )).rejects.toBeInstanceOf(NotFoundException);
        expect(executeInTenantSchema.mock.calls[0][1]).toContain('RETURNING id');
    });

    it('derives the default listing date from the tenant timezone, not UTC', async () => {
        const tenant = {
            settings: { timezone: 'America/Los_Angeles' },
        };
        const { service } = buildService({
            tenant: { findUnique: jest.fn().mockResolvedValue(tenant) },
        });

        await expect(service.getTenantLocalDate(
            tenantId,
            new Date('2026-08-08T01:00:00.000Z'),
        )).resolves.toBe('2026-08-07');
    });

    it('locks the property and performs conflict detection plus insert in one transaction', async () => {
        const booking = {
            id: '44444444-4444-4444-8444-444444444444',
            nights: 2,
            total_price: '220.00',
            currency: 'COP',
        };
        const query = jest.fn(async (sql: string, _params?: any[]) => {
            if (sql.includes('pg_advisory_xact_lock')) return [];
            if (sql.includes('SELECT * FROM properties')) return [property];
            if (sql.includes(') conflicts LIMIT 1')) return [];
            if (sql.includes('INSERT INTO property_bookings')) return [booking];
            // Guarda de duplicado por contacto: sin filas = no hay duplicado.
            if (sql.includes('SELECT id FROM property_bookings')) return [];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const transactionInTenantSchema = jest.fn(
            async (_schema: string, callback: any) => callback(query),
        );
        const { service, prisma } = buildService({ transactionInTenantSchema });

        await expect(service.createBooking(schemaName, propertyId, {
            guestName: 'Ana',
            guestsCount: 2,
            checkIn: '2026-08-10',
            checkOut: '2026-08-12',
        })).resolves.toMatchObject(booking);

        expect(transactionInTenantSchema).toHaveBeenCalledWith(schemaName, expect.any(Function));
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(query.mock.calls.map(([sql]) => sql)).toEqual([
            expect.stringContaining('pg_advisory_xact_lock'),
            expect.stringContaining('SELECT * FROM properties'),
            expect.stringContaining(') conflicts LIMIT 1'),
            expect.stringContaining('INSERT INTO property_bookings'),
        ]);
        const conflictCall = query.mock.calls[2];
        expect(conflictCall[0]).toContain('check_in < $3::date AND check_out > $2::date');
        expect(conflictCall[0]).toContain('date_range_semantics < 2');
        const insertCall = query.mock.calls[3];
        expect(insertCall[1]).toEqual(expect.arrayContaining([
            propertyId,
            2,
            '2026-08-10',
            '2026-08-12',
            220,
        ]));
    });

    it('validates contact ownership inside the booking transaction and persists it', async () => {
        const booking = { id: '44444444-4444-4444-8444-444444444444', total_price: 120, currency: 'COP' };
        const query = jest.fn(async (sql: string, _params?: any[]) => {
            if (sql.includes('FROM contacts')) return [{ id: contactId }];
            if (sql.includes('FROM opportunities o')) return [];
            if (sql.includes('pg_advisory_xact_lock')) return [];
            if (sql.includes('SELECT * FROM properties')) return [property];
            if (sql.includes(') conflicts LIMIT 1')) return [];
            if (sql.includes('INSERT INTO property_bookings')) return [booking];
            // Guarda de duplicado por contacto: sin filas = no hay duplicado.
            if (sql.includes('SELECT id FROM property_bookings')) return [];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service } = buildService({
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)),
        });

        await expect(service.createBooking(schemaName, propertyId, {
            contactId,
            guestName: 'Ana',
            checkIn: '2026-08-10',
            checkOut: '2026-08-11',
        })).resolves.toMatchObject(booking);

        expect(String(query.mock.calls[0][0])).toContain('FROM contacts');
        const insertCall = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO property_bookings'))!;
        expect(insertCall[1]?.[1]).toBe(contactId);
        expect(insertCall[1]?.[2]).toBeNull();
    });

    it('rejects malformed or foreign contacts before a property booking insert', async () => {
        const query = jest.fn().mockResolvedValue([]);
        const transaction = jest.fn(async (_schema: string, callback: any) => callback(query));
        const { service } = buildService({ transactionInTenantSchema: transaction });
        const booking = {
            checkIn: '2026-08-10',
            checkOut: '2026-08-11',
        };

        await expect(service.createBooking(schemaName, propertyId, {
            ...booking,
            contactId: 'not-a-uuid',
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(transaction).not.toHaveBeenCalled();

        await expect(service.createBooking(schemaName, propertyId, { ...booking, contactId }))
            .rejects.toThrow('contactId does not belong to this tenant');
        expect(transaction).toHaveBeenCalledTimes(1);
        expect(query).toHaveBeenCalledTimes(1);
        expect(String(query.mock.calls[0][0])).toContain('FROM contacts');
    });

    it('serializes concurrent attempts and lets only one overlapping booking commit', async () => {
        let booked = false;
        let lockTail = Promise.resolve();
        const transactionInTenantSchema = jest.fn(async (_schema: string, callback: any) => {
            const previous = lockTail;
            let releaseLock!: () => void;
            lockTail = new Promise<void>((resolve) => { releaseLock = resolve; });
            await previous;
            const query = jest.fn(async (sql: string) => {
                if (sql.includes('pg_advisory_xact_lock')) return [];
                if (sql.includes('SELECT * FROM properties')) return [property];
                if (sql.includes(') conflicts LIMIT 1')) {
                    return booked ? [{ source: 'direct' }] : [];
                }
                if (sql.includes('INSERT INTO property_bookings')) {
                    booked = true;
                    return [{ id: 'winner', total_price: '120', currency: 'COP' }];
                }
                throw new Error(`Unexpected SQL: ${sql}`);
            });
            try {
                return await callback(query);
            } finally {
                releaseLock();
            }
        });
        const { service } = buildService({ transactionInTenantSchema });
        const input = {
            guestName: 'Ana',
            guestsCount: 1,
            checkIn: '2026-08-10',
            checkOut: '2026-08-11',
        };

        const results = await Promise.allSettled([
            service.createBooking(schemaName, propertyId, input),
            service.createBooking(schemaName, propertyId, { ...input, guestName: 'Luis' }),
        ]);

        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
        expect(rejected.reason).toBeInstanceOf(ConflictException);
    });

    it.each([
        ['an impossible date', { checkIn: '2026-02-30', checkOut: '2026-03-02', guestsCount: 1 }],
        ['an empty range', { checkIn: '2026-08-10', checkOut: '2026-08-10', guestsCount: 1 }],
        ['zero guests', { checkIn: '2026-08-10', checkOut: '2026-08-11', guestsCount: 0 }],
        ['fractional guests', { checkIn: '2026-08-10', checkOut: '2026-08-11', guestsCount: 1.5 }],
    ])('rejects %s before opening a transaction', async (_label, input) => {
        const transactionInTenantSchema = jest.fn();
        const { service } = buildService({ transactionInTenantSchema });

        await expect(service.createBooking(schemaName, propertyId, input))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it.each([
        ['minimum stay', { ...property, min_nights: 3 }, 2, /at least 3 nights/],
        ['guest capacity', { ...property, max_guests: 1 }, 2, /maximum of 1 guests/],
        ['inactive property', { ...property, is_active: false }, 1, /inactive/],
    ])('validates %s while holding the property lock', async (
        _label,
        storedProperty,
        guestsCount,
        message,
    ) => {
        const query = jest.fn(async (sql: string) => {
            if (sql.includes('pg_advisory_xact_lock')) return [];
            if (sql.includes('SELECT * FROM properties')) return [storedProperty];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const transactionInTenantSchema = jest.fn(
            async (_schema: string, callback: any) => callback(query),
        );
        const { service } = buildService({ transactionInTenantSchema });

        await expect(service.createBooking(schemaName, propertyId, {
            checkIn: '2026-08-10',
            checkOut: '2026-08-12',
            guestsCount,
        })).rejects.toThrow(message);
        expect(query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
        expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO property_bookings'))).toBe(false);
    });
    // Regression: a tool call carrying a slug ("amazon-minimalist") reached the
    // `::uuid` cast and came back as a raw Postgres 22P02, which the model cannot
    // correct. The guard lives with the SQL so it covers every caller, not only
    // the tool that failed in production.
    it.each([
        ['a slug', 'amazon-minimalist'],
        ['an empty string', ''],
        ['a non-string', 42],
    ])('getById rejects %s before reaching the ::uuid cast', async (_label, badId) => {
        const executeInTenantSchema = jest.fn();
        const { service } = buildService({ executeInTenantSchema });

        await expect(service.getById(schemaName, badId as any))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(executeInTenantSchema).not.toHaveBeenCalled();
    });
});
