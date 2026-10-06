import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ToursService } from './tours.service';

describe('ToursService booking contact integrity', () => {
    const schemaName = 'tenant_tours';
    const packageId = '11111111-1111-4111-8111-111111111111';
    const contactId = '22222222-2222-4222-8222-222222222222';
    const bookingId = '33333333-3333-4333-8333-333333333333';
    const input = {
        packageId,
        contactId,
        // Always in the future: a past departure is refused before any query.
        departureDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
        partySize: 2,
    };

    function buildService(
        executeInTenantSchema: jest.Mock,
        transactionImplementation?: (schema: string, callback: (query: any) => Promise<any>) => Promise<any>,
    ) {
        const noticeWrites=jest.fn().mockResolvedValue([{id:'notice-id'}]);
        const transactionInTenantSchema = jest.fn(
            transactionImplementation || (async (
                schema: string,
                callback: (query: (sql: string, params?: any[]) => Promise<any>) => Promise<any>,
            ) => callback((sql, params) => sql.includes('INSERT INTO operational_notice_outbox')
                ? noticeWrites(sql,params)
                : executeInTenantSchema(schema, sql, params))),
        );
        const prisma = { executeInTenantSchema, transactionInTenantSchema };
        const service = new ToursService(
            prisma as any,
            { enforcePlanLimit: jest.fn() } as any,
            { renderAndSend: jest.fn() } as any,
        );
        return { service, prisma, transactionInTenantSchema, noticeWrites };
    }

    it('rejects malformed and foreign contacts before touching inventory', async () => {
        const execute = jest.fn().mockResolvedValue([]);
        const { service, transactionInTenantSchema } = buildService(execute);

        await expect(service.createBooking(schemaName, { ...input, contactId: 'bad-contact' }))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(execute).not.toHaveBeenCalled();
        expect(transactionInTenantSchema).not.toHaveBeenCalled();

        await expect(service.createBooking(schemaName, input))
            .rejects.toThrow('contactId does not belong to this tenant');
        expect(execute).toHaveBeenCalledTimes(1);
        expect(transactionInTenantSchema).toHaveBeenCalledTimes(1);
        expect(String(execute.mock.calls[0][1])).toContain('FROM contacts');
        expect(execute.mock.calls.some(([, sql]) => sql.includes('tour_inventory'))).toBe(false);
    });

    it('persists a contact only after resolving it in the tenant schema', async () => {
        const stored = { id: bookingId, contact_id: contactId, total_price: 200 };
        const execute = jest.fn(async (_schema: string, sql: string, params?: any[]) => {
            if (sql.includes('FROM contacts')) return [{ id: contactId }];
            if (sql.includes('FROM opportunities o')) return [];
            if (sql.includes('FROM tour_packages')) {
                return [{
                    id: packageId,
                    is_active: true,
                    price: 100,
                    currency: 'COP',
                    child_discount_pct: 0,
                }];
            }
            if (sql.includes('FROM tour_bookings')) return [];
            if (sql.includes('FROM tour_inventory')) return [];
            if (sql.includes('INSERT INTO tour_bookings')) {
                expect(params?.[2]).toBe(contactId);
                return [stored];
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service, transactionInTenantSchema, noticeWrites } = buildService(execute);

        await expect(service.createBooking(schemaName, input)).resolves.toBe(stored);
        expect(transactionInTenantSchema).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls.map(([, sql]) => sql)).toEqual([
            expect.stringContaining('FROM contacts'),
            expect.stringContaining('FROM opportunities o'),
            expect.stringContaining('FROM tour_packages'),
            // The duplicate guard runs before any seat is claimed, so a repeat
            // request cannot decrement inventory on its way to being rejected.
            expect.stringContaining('FROM tour_bookings'),
            expect.stringContaining('FROM tour_inventory'),
            // No row for that date: is the package scheduled at all? (unlimited only if not)
            expect.stringContaining('FROM tour_inventory WHERE package_id'),
            expect.stringContaining('INSERT INTO tour_bookings'),
        ]);
        expect(noticeWrites).toHaveBeenCalledTimes(1);
        expect(noticeWrites.mock.calls[0][1]).toEqual(expect.arrayContaining([
            'tour.booking_confirmed',bookingId,contactId,
        ]));
    });

    it.each([
        ['zero party', { partySize: 0 }],
        ['negative party', { partySize: -2 }],
        ['fractional party', { partySize: 1.5 }],
        ['negative adults', { partySize: 2, adults: -1 }],
        ['fractional adults', { partySize: 2, adults: 1.5 }],
        ['null adults', { partySize: 2, adults: null }],
        ['negative children', { partySize: 2, children: -1 }],
        ['inconsistent composition', { partySize: 2, adults: 2, children: 1 }],
    ])('rejects invalid party composition before opening a transaction: %s', async (_label, patch) => {
        const execute = jest.fn();
        const { service, transactionInTenantSchema } = buildService(execute);

        await expect(service.createBooking(schemaName, { ...input, ...patch } as any))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(transactionInTenantSchema).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
    });

    it('ships conservative tenant checks for capacity and party composition', () => {
        const tenantSchema = readFileSync(
            resolve(__dirname, '../../../prisma/tenant-schema.sql'),
            'utf8',
        );

        expect(tenantSchema).toContain('"tour_inventory_capacity_check" CHECK');
        expect(tenantSchema).toContain('"available_seats" <= "total_seats"');
        expect(tenantSchema).toContain('"tour_bookings_party_composition_check" CHECK');
        expect(tenantSchema).toContain('"adults" + COALESCE("children", 0) = "party_size"');
        expect(tenantSchema).toContain('FROM pg_constraint constraint_ref');
        expect(tenantSchema).not.toContain('DROP CONSTRAINT IF EXISTS "tour_inventory_capacity_check"');
        expect(tenantSchema).not.toContain('DROP CONSTRAINT IF EXISTS "tour_bookings_party_composition_check"');
        expect(tenantSchema.match(/tour_(?:inventory_capacity|bookings_party_composition)_check" CHECK[\s\S]*?NOT VALID;/g))
            .toHaveLength(2);
    });

    it('derives the omitted child count and persists an exact party composition', async () => {
        const stored = { id: bookingId, contact_id: contactId, party_size: 3, adults: 1, children: 2 };
        const execute = jest.fn(async (_schema: string, sql: string, params?: any[]) => {
            if (sql.includes('FROM contacts')) return [{ id: contactId }];
            if (sql.includes('FROM opportunities o')) return [];
            if (sql.includes('FROM tour_packages')) {
                return [{ id: packageId, is_active: true, price: 100, currency: 'COP', child_discount_pct: 50 }];
            }
            if (sql.includes('FROM tour_bookings')) return [];
            if (sql.includes('FROM tour_inventory')) return [];
            if (sql.includes('INSERT INTO tour_bookings')) {
                expect(params?.slice(10, 13)).toEqual([3, 1, 2]);
                expect(params?.[14]).toBe(200);
                return [stored];
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service } = buildService(execute);

        await expect(service.createBooking(schemaName, {
            ...input,
            partySize: 3,
            adults: 1,
        })).resolves.toBe(stored);
    });

    // Seats are only enforced when the operator loaded a tour_inventory row.
    // Without one the capacity is unlimited, so a re-issued call wrote a second
    // identical reservation and the customer was booked — and charged — twice.
    // The appointment path has had this guard for months; the tour path had none.
    it('refuses a second identical booking for the same contact, package and departure', async () => {
        const existing = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
        const execute = jest.fn(async (_schema: string, sql: string) => {
            if (sql.includes('FROM contacts')) return [{ id: contactId }];
            if (sql.includes('FROM opportunities o')) return [];
            if (sql.includes('FROM tour_packages')) {
                return [{ id: packageId, is_active: true, price: 100, currency: 'COP', child_discount_pct: 0 }];
            }
            if (sql.includes('FROM tour_bookings')) return [existing];
            if (sql.includes('FROM tour_inventory')) return [];
            if (sql.includes('INSERT INTO tour_bookings')) throw new Error('should never insert a duplicate');
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service } = buildService(execute);

        await expect(service.createBooking(schemaName, input)).rejects.toThrow();
        expect(execute.mock.calls.some(([, sql]) => sql.includes('INSERT INTO tour_bookings'))).toBe(false);
    });

    it('keeps the inventory claim and booking insert in one transaction without compensation', async () => {
        const inventoryId = '44444444-4444-4444-8444-444444444444';
        const execute = jest.fn(async (_schema: string, sql: string) => {
            if (sql.includes('FROM contacts')) return [{ id: contactId }];
            if (sql.includes('FROM opportunities o')) return [];
            if (sql.includes('FROM tour_packages')) {
                return [{ id: packageId, is_active: true, price: 100, currency: 'COP', child_discount_pct: 0 }];
            }
            if (sql.includes('FROM tour_bookings')) return [];
            if (sql.includes('FROM tour_inventory')) {
                expect(sql).toContain('FOR UPDATE');
                return [{ id: inventoryId, available_seats: 4, price_override: null }];
            }
            if (sql.includes('SET available_seats = available_seats -')) return [{ id: inventoryId }];
            if (sql.includes('INSERT INTO tour_bookings')) throw new Error('injected insert failure');
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service, transactionInTenantSchema } = buildService(execute);

        await expect(service.createBooking(schemaName, input)).rejects.toThrow('injected insert failure');
        expect(transactionInTenantSchema).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls.some(([, sql]) => (
            sql.includes('available_seats = available_seats +')
        ))).toBe(false);
    });

    it.each([
        ['a departure in the past', { departureDate: '2020-01-01' }, 'departure_in_past'],
        ['a malformed date', { departureDate: '2026-02-31' }, 'invalid_departure_date'],
        ['a missing date', { departureDate: undefined }, 'invalid_departure_date'],
    ])('createBooking refuses %s before opening a transaction', async (_label, patch, error) => {
        const execute = jest.fn();
        const { service, transactionInTenantSchema } = buildService(execute);

        await expect(service.createBooking(schemaName, { ...input, ...patch } as any))
            .rejects.toMatchObject({ response: expect.objectContaining({ error }) });
        expect(transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it('createBooking refuses a group below the package minimum and a date outside a scheduled package', async () => {
        const run = async (pkg: any, scheduled: boolean) => {
            const execute = jest.fn(async (_schema: string, sql: string) => {
                if (sql.includes('FROM contacts')) return [{ id: contactId }];
                if (sql.includes('FROM opportunities o')) return [];
                if (sql.includes('FROM tour_packages')) return [{ id: packageId, is_active: true, price: 100, ...pkg }];
                if (sql.includes('FROM tour_bookings')) return [];
                if (sql.includes('FROM tour_inventory WHERE package_id')) return scheduled ? [{ '?column?': 1 }] : [];
                if (sql.includes('FROM tour_inventory')) return [];
                throw new Error(`should not reach: ${sql}`);
            });
            const { service } = buildService(execute);
            return service.createBooking(schemaName, { ...input, partySize: 1 });
        };

        await expect(run({ min_party_size: 4 }, false)).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'party_size_too_small', minPartySize: 4 }),
        });
        await expect(run({ min_party_size: 1 }, true)).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'no_departure_on_date' }),
        });
    });

    describe('checkAvailability', () => {
        const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
        const build = (rowsForDate: any[], scheduled: boolean, pkg: any = {}) => {
            const execute = jest.fn(async (_schema: string, sql: string) => {
                if (sql.includes('FROM tour_packages')) return [{ id: packageId, is_active: true, ...pkg }];
                if (sql.includes('FROM tour_inventory WHERE package_id = $1::uuid LIMIT 1')) return scheduled ? [{}] : [];
                if (sql.includes('FROM tour_inventory')) return rowsForDate;
                throw new Error(`Unexpected SQL: ${sql}`);
            });
            return buildService(execute).service;
        };

        it.each([[undefined], [null], ['varios'], [0], [-2], [1.5], ['']])(
            'never says available without a usable traveller count (%p)', async (partySize) => {
                const result = await build([{ available_seats: 6 }], true).checkAvailability(schemaName, packageId, future, partySize);
                expect(result).toMatchObject({ available: false, reason: 'party_size_required', seatsLeft: null });
            });

        it('accepts a numeric string count and checks the seats', async () => {
            const service = build([{ available_seats: 3 }], true);
            await expect(service.checkAvailability(schemaName, packageId, future, '2')).resolves.toEqual({ available: true, seatsLeft: 3 });
            await expect(service.checkAvailability(schemaName, packageId, future, 4)).resolves.toMatchObject({ available: false, reason: 'not_enough_seats' });
        });

        it.each([[undefined], [null], ['varios']])(
            'reports a past date before asking for the traveller count (%p)', async (partySize) => {
                await expect(build([], true).checkAvailability(schemaName, packageId, '2020-01-01', partySize))
                    .resolves.toMatchObject({ available: false, reason: 'departure_in_past' });
                await expect(build([], true).checkAvailability(schemaName, packageId, '2026-02-31', partySize))
                    .resolves.toMatchObject({ available: false, reason: 'invalid_departure_date' });
            });

        it('still asks for the traveller count when the date is fine', async () => {
            await expect(build([], true).checkAvailability(schemaName, packageId, future, undefined))
                .resolves.toMatchObject({ available: false, reason: 'party_size_required' });
        });

        it('searchPackages names the problem of a past or malformed date instead of returning an empty list', async () => {
            const execute = jest.fn(async () => [{ id: packageId, is_active: true }]);
            const { service } = buildService(execute);
            await expect(service.searchPackages(schemaName, { destination: 'Cartagena', date: '2020-01-01' }))
                .rejects.toMatchObject({ response: expect.objectContaining({ error: 'departure_in_past' }) });
            await expect(service.searchPackages(schemaName, { destination: 'Cartagena', date: '2026-02-31' }))
                .rejects.toMatchObject({ response: expect.objectContaining({ error: 'invalid_departure_date' }) });
        });

        it('refuses past dates and dates with no departure on a scheduled package, but not on an unscheduled one', async () => {
            await expect(build([], true).checkAvailability(schemaName, packageId, '2020-01-01', 2))
                .resolves.toMatchObject({ available: false, reason: 'departure_in_past' });
            await expect(build([], true).checkAvailability(schemaName, packageId, future, 2))
                .resolves.toMatchObject({ available: false, reason: 'no_departure_on_date' });
            await expect(build([], false).checkAvailability(schemaName, packageId, future, 2))
                .resolves.toEqual({ available: true, seatsLeft: 'unlimited' });
        });

        it('applies the package minimum', async () => {
            await expect(build([{ available_seats: 9 }], true, { min_party_size: 4 }).checkAvailability(schemaName, packageId, future, 1))
                .resolves.toMatchObject({ available: false, reason: 'party_size_too_small', minPartySize: 4 });
        });
    });

    it('restores inventory exactly once under concurrent cancellation retries', async () => {
        const inventoryId = '44444444-4444-4444-8444-444444444444';
        let bookingStatus = 'reserved';
        let availableSeats = 8;
        let restoreCount = 0;
        const queries: string[] = [];
        let tail = Promise.resolve();

        const transactionInTenantSchema = jest.fn(async (
            _schema: string,
            callback: (query: (sql: string, params?: any[]) => Promise<any>) => Promise<any>,
        ) => {
            const previous = tail;
            let release!: () => void;
            tail = new Promise<void>((resolve) => { release = resolve; });
            await previous;
            try {
                return await callback(async (sql: string, params: any[] = []) => {
                    queries.push(sql);
                    if (sql.includes('SELECT * FROM tour_bookings')) {
                        return [{
                            id: bookingId,
                            inventory_id: inventoryId,
                            party_size: 2,
                            status: bookingStatus,
                        }];
                    }
                    if (sql.includes('UPDATE tour_inventory')) {
                        availableSeats += Number(params[0]);
                        restoreCount++;
                        return [];
                    }
                    if (sql.includes('UPDATE tour_bookings')) {
                        bookingStatus = 'cancelled';
                        return [];
                    }
                    throw new Error(`Unexpected SQL: ${sql}`);
                });
            } finally {
                release();
            }
        });
        const prisma = {
            executeInTenantSchema: jest.fn(),
            transactionInTenantSchema,
        };
        const service = new ToursService(
            prisma as any,
            { enforcePlanLimit: jest.fn() } as any,
            { renderAndSend: jest.fn() } as any,
        );

        await Promise.all([
            service.cancelBooking(schemaName, bookingId),
            service.cancelBooking(schemaName, bookingId),
        ]);

        expect(transactionInTenantSchema).toHaveBeenCalledTimes(2);
        expect(queries.filter((sql) => sql.includes('SELECT * FROM tour_bookings')))
            .toHaveLength(2);
        expect(queries.find((sql) => sql.includes('SELECT * FROM tour_bookings')))
            .toContain('FOR UPDATE');
        expect(restoreCount).toBe(1);
        expect(availableSeats).toBe(10);
        expect(bookingStatus).toBe('cancelled');
    });
});
