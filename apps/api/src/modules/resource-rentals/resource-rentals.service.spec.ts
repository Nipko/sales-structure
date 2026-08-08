import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    NotFoundException,
} from '@nestjs/common';
import { ResourceRentalsService } from './resource-rentals.service';

describe('ResourceRentalsService', () => {
    const schemaName = 'tenant_resources';
    const vehicleId = '11111111-1111-4111-8111-111111111111';
    const petId = '22222222-2222-4222-8222-222222222222';
    const serviceId = '33333333-3333-4333-8333-333333333333';
    const rentalId = '44444444-4444-4444-8444-444444444444';
    const actorId = '55555555-5555-4555-8555-555555555555';

    function buildService(transactionInTenantSchema?: jest.Mock) {
        const prisma = {
            executeInTenantSchema: jest.fn(),
            transactionInTenantSchema: transactionInTenantSchema || jest.fn(),
        };
        return {
            service: new ResourceRentalsService(prisma as any),
            prisma,
        };
    }

    function txWith(query: jest.Mock) {
        return jest.fn(async (_schema: string, callback: any) => callback(query));
    }

    it('rejects malformed UUIDs and impossible or empty date ranges before opening a transaction', async () => {
        const { service, prisma } = buildService();
        const base = {
            type: 'vehicle_rental' as const,
            resourceId: vehicleId,
            startDate: '2026-08-10',
            endDate: '2026-08-12',
        };

        await expect(service.create(schemaName, { ...base, resourceId: 'not-a-uuid' }))
            .rejects.toBeInstanceOf(BadRequestException);
        await expect(service.create(schemaName, { ...base, startDate: '2026-02-30' }))
            .rejects.toBeInstanceOf(BadRequestException);
        await expect(service.create(schemaName, { ...base, endDate: base.startDate }))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it.each(['vehicle_rental', 'pet_boarding'] as const)(
        'rejects %s ranges longer than 366 days before opening a transaction',
        async (type) => {
            const { service, prisma } = buildService();
            await expect(service.create(schemaName, {
                type,
                resourceId: type === 'vehicle_rental' ? vehicleId : petId,
                serviceId: type === 'pet_boarding' ? serviceId : undefined,
                startDate: '2026-01-01',
                endDate: '2027-01-03',
            })).rejects.toBeInstanceOf(BadRequestException);
            expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
        },
    );

    it('locks a vehicle and uses half-open overlap predicates before inserting', async () => {
        const created = { id: rentalId, rental_type: 'vehicle_rental', status: 'reserved' };
        const query = jest.fn(async (sql: string, _params?: any[]) => {
            if (sql.includes('pg_advisory_xact_lock')) return [];
            if (sql.includes('FROM vehicles')) {
                return [{ id: vehicleId, make: 'Kia', model: 'Rio', year: 2025, status: 'available' }];
            }
            if (sql.includes("rental_type = 'vehicle_rental'")) return [];
            if (sql.includes('INSERT INTO resource_rentals')) return [created];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const transaction = txWith(query);
        const { service, prisma } = buildService(transaction);

        await expect(service.create(schemaName, {
            type: 'vehicle_rental',
            resourceId: vehicleId,
            startDate: '2026-08-10',
            endDate: '2026-08-12',
            customerName: 'Ana',
        }, actorId)).resolves.toBe(created);

        expect(transaction).toHaveBeenCalledWith(schemaName, expect.any(Function));
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(query.mock.calls.map(([sql]) => sql)).toEqual([
            expect.stringContaining('pg_advisory_xact_lock'),
            expect.stringContaining('FROM vehicles'),
            expect.stringContaining("rental_type = 'vehicle_rental'"),
            expect.stringContaining('INSERT INTO resource_rentals'),
        ]);
        const overlapCall = query.mock.calls[2];
        expect(overlapCall[0]).toContain('start_date < $3::date');
        expect(overlapCall[0]).toContain('end_date > $2::date');
        expect(overlapCall[1]).toEqual([vehicleId, '2026-08-10', '2026-08-12']);
    });

    it('returns clear vehicle not-found, unavailable and overlap errors', async () => {
        for (const scenario of ['missing', 'unavailable', 'overlap'] as const) {
            const query = jest.fn(async (sql: string, _params?: any[]) => {
                if (sql.includes('pg_advisory_xact_lock')) return [];
                if (sql.includes('FROM vehicles')) {
                    if (scenario === 'missing') return [];
                    return [{ id: vehicleId, status: scenario === 'unavailable' ? 'sold' : 'available' }];
                }
                if (sql.includes("rental_type = 'vehicle_rental'")) {
                    return [{ id: rentalId, start_date: '2026-08-10', end_date: '2026-08-12' }];
                }
                throw new Error(`Unexpected SQL: ${sql}`);
            });
            const { service } = buildService(txWith(query));
            const promise = service.create(schemaName, {
                type: 'vehicle_rental',
                resourceId: vehicleId,
                startDate: '2026-08-10',
                endDate: '2026-08-12',
            });

            if (scenario === 'missing') await expect(promise).rejects.toBeInstanceOf(NotFoundException);
            else await expect(promise).rejects.toBeInstanceOf(ConflictException);
        }
    });

    it('locks boarding capacity and checks every night in the half-open range', async () => {
        const query = jest.fn(async (sql: string, _params?: any[]) => {
            if (sql.includes('pg_advisory_xact_lock')) return [];
            if (sql.includes('FROM pets')) return [{ id: petId, name: 'Toby', is_active: true }];
            if (sql.includes('FROM services')) {
                return [{ id: serviceId, category: 'guarderia', max_concurrent: 2, is_active: true }];
            }
            if (sql.includes("resource_id = $1::uuid")) return [];
            if (sql.includes('WITH requested_nights')) {
                return [{ night: '2026-08-11', occupied: 2 }];
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service } = buildService(txWith(query));

        await expect(service.create(schemaName, {
            type: 'pet_boarding',
            resourceId: petId,
            serviceId,
            startDate: '2026-08-10',
            endDate: '2026-08-13',
        })).rejects.toBeInstanceOf(ConflictException);

        expect(query.mock.calls[0][1]![0]).toContain(`boarding-service:${serviceId}`);
        expect(query.mock.calls[1][1]![0]).toContain(`pet:${petId}`);
        const capacityCall = query.mock.calls.find(([sql]) => sql.includes('WITH requested_nights'));
        expect(capacityCall?.[0]).toContain("($3::date - INTERVAL '1 day')");
        expect(capacityCall?.[0]).toContain('r.start_date <= n.night');
        expect(capacityCall?.[0]).toContain('r.end_date > n.night');
        expect(capacityCall?.[1]).toEqual([serviceId, '2026-08-10', '2026-08-13', 2]);
    });

    it('creates boarding only for an active pet and an active hotel/guarderia service', async () => {
        const created = { id: rentalId, rental_type: 'pet_boarding', status: 'reserved' };
        const query = jest.fn(async (sql: string, _params?: any[]) => {
            if (sql.includes('pg_advisory_xact_lock')) return [];
            if (sql.includes('FROM pets')) return [{ id: petId, name: 'Toby', is_active: true }];
            if (sql.includes('FROM services')) {
                return [{ id: serviceId, category: 'hotel', max_concurrent: 3, is_active: true }];
            }
            if (sql.includes("resource_id = $1::uuid")) return [];
            if (sql.includes('WITH requested_nights')) return [];
            if (sql.includes('INSERT INTO resource_rentals')) return [created];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service } = buildService(txWith(query));

        await expect(service.create(schemaName, {
            type: 'pet_boarding',
            resourceId: petId,
            serviceId,
            startDate: '2026-08-10',
            endDate: '2026-08-11',
        })).resolves.toBe(created);
        expect(query.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining([
            'pet_boarding', petId, serviceId, '2026-08-10', '2026-08-11',
        ]));
    });

    it('allows agents to perform non-terminal pickup/check-in transitions', async () => {
        const current = { id: rentalId, rental_type: 'vehicle_rental', status: 'reserved' };
        const updated = { ...current, status: 'picked_up' };
        const query = jest.fn(async (sql: string, _params?: any[]) => {
            if (sql.includes('SELECT * FROM resource_rentals')) return [current];
            if (sql.includes('UPDATE resource_rentals')) return [updated];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service } = buildService(txWith(query));

        await expect(service.transition(schemaName, rentalId, 'picked_up', 'tenant_agent'))
            .resolves.toEqual(updated);
    });

    it('reserves terminal transitions and cancellation for admins and supervisors', async () => {
        const current = { id: rentalId, rental_type: 'pet_boarding', status: 'checked_in' };
        const query = jest.fn(async (sql: string, _params?: any[]) => {
            if (sql.includes('SELECT * FROM resource_rentals')) return [current];
            if (sql.includes('UPDATE resource_rentals')) return [{ ...current, status: 'checked_out' }];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const transaction = txWith(query);
        const { service } = buildService(transaction);

        await expect(service.transition(schemaName, rentalId, 'checked_out', 'tenant_agent'))
            .rejects.toBeInstanceOf(ForbiddenException);
        await expect(service.transition(schemaName, rentalId, 'checked_out', 'tenant_supervisor'))
            .resolves.toMatchObject({ status: 'checked_out' });
    });

    it('rejects invalid edges and never mutates a terminal rental', async () => {
        const invalidQuery = jest.fn(async (sql: string, _params?: any[]) => {
            if (sql.includes('SELECT * FROM resource_rentals')) {
                return [{ id: rentalId, rental_type: 'vehicle_rental', status: 'reserved' }];
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const terminalQuery = jest.fn(async (sql: string, _params?: any[]) => {
            if (sql.includes('SELECT * FROM resource_rentals')) {
                return [{ id: rentalId, rental_type: 'vehicle_rental', status: 'returned' }];
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        });

        await expect(buildService(txWith(invalidQuery)).service.transition(
            schemaName, rentalId, 'returned', 'tenant_admin',
        )).rejects.toBeInstanceOf(ConflictException);
        await expect(buildService(txWith(terminalQuery)).service.transition(
            schemaName, rentalId, 'cancelled', 'tenant_admin',
        )).rejects.toBeInstanceOf(ConflictException);
        expect(invalidQuery.mock.calls.some(([sql]) => sql.includes('UPDATE resource_rentals'))).toBe(false);
        expect(terminalQuery.mock.calls.some(([sql]) => sql.includes('UPDATE resource_rentals'))).toBe(false);
    });

    it('returns 404 for a missing rental transition target', async () => {
        const query = jest.fn().mockResolvedValue([]);
        const { service } = buildService(txWith(query));

        await expect(service.transition(schemaName, rentalId, 'picked_up', 'tenant_agent'))
            .rejects.toBeInstanceOf(NotFoundException);
    });
});
