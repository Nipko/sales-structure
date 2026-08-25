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
    const ownerContactId = '66666666-6666-4666-8666-666666666666';
    const foreignContactId = '77777777-7777-4777-8777-777777777777';
    const mediaId = '99999999-9999-4999-8999-999999999999';

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
        await expect(service.create(schemaName, { ...base, contactId: 'not-a-uuid' }))
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

    it('requires a tenant CRM contact for every vehicle rental before opening a transaction', async () => {
        const { service, prisma } = buildService();

        await expect(service.create(schemaName, {
            type: 'vehicle_rental',
            resourceId: vehicleId,
            startDate: '2026-08-10',
            endDate: '2026-08-12',
        })).rejects.toThrow('contactId is required for vehicle_rental');

        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it('locks a vehicle and uses half-open overlap predicates before inserting', async () => {
        const created = { id: rentalId, rental_type: 'vehicle_rental', status: 'pending_review', version: 1 };
        const query = jest.fn(async (sql: string, _params?: any[]) => {
            if (sql.includes('FROM contacts')) return [{ id: ownerContactId }];
            if (sql.includes('FROM opportunities o')) return [];
            if (sql.includes('pg_advisory_xact_lock')) return [];
            if (sql.includes('FROM vehicles')) {
                return [{ id: vehicleId, make: 'Kia', model: 'Rio', year: 2025, status: 'available' }];
            }
            if (sql.includes("rental_type = 'vehicle_rental'")) return [];
            if (sql.includes('INSERT INTO resource_rentals')) return [created];
            if (sql.includes('INSERT INTO resource_rental_events')) return [];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const transaction = txWith(query);
        const { service, prisma } = buildService(transaction);

        await expect(service.create(schemaName, {
            type: 'vehicle_rental',
            resourceId: vehicleId,
            contactId: ownerContactId,
            startDate: '2026-08-10',
            endDate: '2026-08-12',
            customerName: 'Ana',
            metadata: { details: {
                eligibility: {
                    identity: { status: 'verified', evidenceRef: 'caller-assertion' },
                    driverLicense: { status: 'verified', evidenceRef: 'caller-assertion' },
                    insurance: { status: 'verified', evidenceRef: 'caller-assertion' },
                    payment: { status: 'verified', evidenceRef: 'caller-assertion' },
                },
                odometerOut: 100,
                deposit: { amountCents: 500000, currency: 'COP', status: 'held', evidenceRef: 'caller-assertion' },
                contract: { signed: true, signedAt: '2026-08-10T10:00:00Z', signatureMethod: 'otp', evidenceRef: 'caller-assertion' },
            } },
        }, actorId)).resolves.toBe(created);

        expect(transaction).toHaveBeenCalledWith(schemaName, expect.any(Function));
        expect(prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(query.mock.calls.map(([sql]) => sql)).toEqual([
            expect.stringContaining('FROM contacts'),
            expect.stringContaining('FROM opportunities o'),
            expect.stringContaining('pg_advisory_xact_lock'),
            expect.stringContaining('FROM vehicles'),
            expect.stringContaining("rental_type = 'vehicle_rental'"),
            expect.stringContaining('INSERT INTO resource_rentals'),
            expect.stringContaining('INSERT INTO resource_rental_events'),
        ]);
        const overlapCall = query.mock.calls[4];
        expect(overlapCall[0]).toContain('start_date < $3::date');
        expect(overlapCall[0]).toContain('end_date > $2::date');
        expect(overlapCall[1]).toEqual([vehicleId, '2026-08-10', '2026-08-12']);
        expect(query.mock.calls.at(-2)?.[1]).toEqual(expect.arrayContaining([
            ownerContactId, 'pending_review',
        ]));
        const insertedMetadata = JSON.parse(query.mock.calls.at(-2)?.[1]?.[11]);
        expect(insertedMetadata.details.eligibility).toEqual({
            identity: { status: 'pending' },
            driverLicense: { status: 'pending' },
            insurance: { status: 'pending' },
            payment: { status: 'pending' },
        });
        expect(insertedMetadata.details).not.toHaveProperty('odometerOut');
        expect(insertedMetadata.details.deposit).toEqual({
            amountCents: 500000, currency: 'COP', status: 'pending',
        });
        expect(insertedMetadata.details.contract).toEqual({ signed: false });
    });

    it('returns clear vehicle not-found, unavailable and overlap errors', async () => {
        for (const scenario of ['missing', 'unavailable', 'overlap'] as const) {
            const query = jest.fn(async (sql: string, _params?: any[]) => {
                if (sql.includes('FROM contacts')) return [{ id: ownerContactId }];
                if (sql.includes('FROM opportunities o')) return [];
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
                contactId: ownerContactId,
                startDate: '2026-08-10',
                endDate: '2026-08-12',
                customerName: 'Ana',
            });

            if (scenario === 'missing') await expect(promise).rejects.toBeInstanceOf(NotFoundException);
            else await expect(promise).rejects.toBeInstanceOf(ConflictException);
        }
    });

    it('locks boarding capacity and checks every night in the half-open range', async () => {
        const query = jest.fn(async (sql: string, _params?: any[]) => {
            if (sql.includes('pg_advisory_xact_lock')) return [];
            if (sql.includes('FROM pets')) {
                return [{ id: petId, name: 'Toby', is_active: true, contact_id: ownerContactId }];
            }
            if (sql.includes('FROM contacts')) return [{ id: ownerContactId }];
            if (sql.includes('FROM opportunities o')) return [];
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
            if (sql.includes('FROM pets')) {
                return [{ id: petId, name: 'Toby', is_active: true, contact_id: ownerContactId }];
            }
            if (sql.includes('FROM contacts')) return [{ id: ownerContactId }];
            if (sql.includes('FROM opportunities o')) return [];
            if (sql.includes('FROM services')) {
                return [{ id: serviceId, category: 'hotel', max_concurrent: 3, is_active: true }];
            }
            if (sql.includes("resource_id = $1::uuid")) return [];
            if (sql.includes('WITH requested_nights')) return [];
            if (sql.includes('INSERT INTO resource_rentals')) return [created];
            if (sql.includes('INSERT INTO resource_rental_events')) return [];
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
        const insertParams = query.mock.calls.at(-2)?.[1];
        expect(insertParams).toEqual(expect.arrayContaining([
            'pet_boarding', petId, serviceId, ownerContactId, '2026-08-10', '2026-08-11',
        ]));
    });

    it('derives boarding contact from the pet and rejects a mismatched body contactId', async () => {
        const query = jest.fn(async (sql: string) => {
            if (sql.includes('pg_advisory_xact_lock')) return [];
            if (sql.includes('FROM pets')) {
                return [{ id: petId, name: 'Toby', is_active: true, contact_id: ownerContactId }];
            }
            if (sql.includes('FROM contacts')) return [{ id: ownerContactId }];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service } = buildService(txWith(query));

        await expect(service.create(schemaName, {
            type: 'pet_boarding',
            resourceId: petId,
            serviceId,
            contactId: foreignContactId,
            startDate: '2026-08-10',
            endDate: '2026-08-11',
        })).rejects.toThrow('contactId does not match the pet owner');
        expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO resource_rentals'))).toBe(false);
    });

    it('validates a vehicle contact in the tenant before locking or inserting', async () => {
        const query = jest.fn().mockResolvedValue([]);
        const transaction = txWith(query);
        const { service } = buildService(transaction);

        await expect(service.create(schemaName, {
            type: 'vehicle_rental',
            resourceId: vehicleId,
            contactId: foreignContactId,
            startDate: '2026-08-10',
            endDate: '2026-08-11',
            customerName: 'Ana',
        })).rejects.toThrow('contactId does not belong to this tenant');
        expect(query).toHaveBeenCalledTimes(1);
        expect(String(query.mock.calls[0][0])).toContain('FROM contacts');
    });

    it('does not let the generic status endpoint bypass the pickup inspection', async () => {
        const current = { id: rentalId, rental_type: 'vehicle_rental', status: 'reserved' };
        const query = jest.fn(async (sql: string, _params?: any[]) => {
            if (sql.includes('SELECT * FROM resource_rentals')) return [current];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service } = buildService(txWith(query));

        await expect(service.transition(schemaName, rentalId, 'picked_up', 'tenant_agent'))
            .rejects.toBeInstanceOf(ConflictException);
        expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE resource_rentals'))).toBe(false);
    });

    it('reserves terminal transitions and cancellation for admins and supervisors', async () => {
        const current = { id: rentalId, rental_type: 'pet_boarding', status: 'checked_in' };
        const query = jest.fn(async (sql: string, _params?: any[]) => {
            if (sql.includes('SELECT * FROM resource_rentals')) return [current];
            if (sql.includes('UPDATE resource_rentals')) return [{ ...current, status: 'checked_out' }];
            if (sql.includes('INSERT INTO resource_rental_events')) return [];
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

    it('keeps every eligibility dimension pending until an administrator records evidence', async () => {
        const metadata = { details: { driver: { name: 'Ana' }, eligibility: {
            identity: { status: 'pending' }, driverLicense: { status: 'pending' },
            insurance: { status: 'pending' }, payment: { status: 'pending' },
        } } };
        const current = { id: rentalId, rental_type: 'vehicle_rental', status: 'pending_review', version: 1, metadata };
        const updated = { ...current, version: 2 };
        const query = jest.fn(async (sql: string, _params?: any[]) => {
            if (sql.includes('FROM resource_rentals')) return [current];
            if (sql.includes('UPDATE resource_rentals')) return [updated];
            if (sql.includes('INSERT INTO resource_rental_events')) return [];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service } = buildService(txWith(query));

        await expect(service.reviewEligibility(schemaName, rentalId, {
            dimension: 'identity', status: 'verified', evidenceRef: 'review:identity:123', expectedVersion: 1,
        }, actorId, 'tenant_agent')).rejects.toBeInstanceOf(ForbiddenException);

        await expect(service.reviewEligibility(schemaName, rentalId, {
            dimension: 'identity', status: 'verified', evidenceRef: 'review:identity:123', expectedVersion: 1,
        }, actorId, 'tenant_supervisor')).resolves.toEqual(updated);
        const update = query.mock.calls.find(([sql]) => sql.includes('UPDATE resource_rentals'))!;
        const updateParams = update[1] as any[];
        expect(JSON.parse(updateParams[0]).details.eligibility.identity).toMatchObject({
            status: 'verified', evidenceRef: 'review:identity:123', checkedBy: actorId,
        });
    });

    it('approves only a fully reviewed request and rechecks the vehicle range under lock', async () => {
        const cleared = {
            identity: { status: 'verified', evidenceRef: 'identity:1' },
            driverLicense: { status: 'verified', evidenceRef: 'licence:1' },
            insurance: { status: 'not_required', reason: 'tenant policy' },
            payment: { status: 'verified', evidenceRef: 'payment:1' },
        };
        const current = {
            id: rentalId, rental_type: 'vehicle_rental', resource_id: vehicleId,
            start_date: '2026-08-10', end_date: '2026-08-12', status: 'pending_review', version: 4,
            metadata: { details: { driver: { name: 'Ana' }, eligibility: cleared } },
        };
        const query = jest.fn(async (sql: string) => {
            if (sql.includes('SELECT * FROM resource_rentals')) return [current];
            if (sql.includes('pg_advisory_xact_lock')) return [];
            if (sql.includes('FROM vehicles')) return [{ id: vehicleId, status: 'available' }];
            if (sql.includes('id <> $2::uuid')) return [];
            if (sql.includes('UPDATE resource_rentals')) return [{ ...current, status: 'reserved', version: 5 }];
            if (sql.includes('INSERT INTO resource_rental_events')) return [];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service } = buildService(txWith(query));

        await expect(service.approveVehicleRental(
            schemaName, rentalId, 4, actorId, 'tenant_supervisor',
        )).resolves.toMatchObject({ status: 'reserved', version: 5 });
        expect(query.mock.calls.some(([sql]) => sql.includes('pg_advisory_xact_lock'))).toBe(true);
        expect(query.mock.calls.some(([sql]) => sql.includes('id <> $2::uuid'))).toBe(true);
    });

    it('cannot approve while identity, licence, insurance or payment remains pending', async () => {
        const current = {
            id: rentalId, rental_type: 'vehicle_rental', resource_id: vehicleId,
            status: 'pending_review', version: 1,
            metadata: { details: { driver: { name: 'Ana' }, eligibility: {
                identity: { status: 'verified' }, driverLicense: { status: 'pending' },
                insurance: { status: 'not_required' }, payment: { status: 'verified' },
            } } },
        };
        const query = jest.fn(async (sql: string) => {
            if (sql.includes('SELECT * FROM resource_rentals')) return [current];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service } = buildService(txWith(query));

        await expect(service.approveVehicleRental(
            schemaName, rentalId, 1, actorId, 'tenant_admin',
        )).rejects.toBeInstanceOf(ConflictException);
        expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE resource_rentals'))).toBe(false);
    });

    it('records pickup evidence and lifecycle atomically and never stores a raw OTP', async () => {
        const details = {
            driver: { name: 'Ana' },
            eligibility: {
                identity: { status: 'verified', evidenceRef: 'identity:1' },
                driverLicense: { status: 'verified', evidenceRef: 'licence:1' },
                insurance: { status: 'not_required', reason: 'policy' },
                payment: { status: 'verified', evidenceRef: 'payment:1' },
            },
            contract: { signed: true, signedAt: '2026-08-10T10:00:00Z', signatureMethod: 'otp', evidenceRef: 'otp-verification:1' },
        };
        const current = { id: rentalId, rental_type: 'vehicle_rental', status: 'reserved', version: 5, metadata: { details } };
        const inspectionId = '88888888-8888-4888-8888-888888888888';
        const query = jest.fn(async (sql: string) => {
            if (sql.includes('SELECT * FROM resource_rentals')) return [current];
            if (sql.includes('FROM media_files')) return [{ id: mediaId }];
            if (sql.includes('INSERT INTO resource_rental_inspections')) return [{ id: inspectionId }];
            if (sql.includes('UPDATE resource_rentals')) return [{ ...current, status: 'picked_up', version: 6 }];
            if (sql.includes('INSERT INTO resource_rental_events')) return [];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service, prisma } = buildService(txWith(query));

        await expect(service.recordInspection(schemaName, rentalId, {
            inspectionType: 'pickup', odometer: 12000, conditionNotes: 'Sin daños visibles',
            handoffMethod: 'otp', handoffEvidenceRef: '123456', expectedVersion: 5,
        }, actorId)).rejects.toThrow('never the raw code');
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();

        await expect(service.recordInspection(schemaName, rentalId, {
            inspectionType: 'pickup', odometer: 12000, conditionNotes: 'Sin daños visibles',
            handoffMethod: 'manual', handoffEvidenceRef: 'acta:1', expectedVersion: 5,
        }, actorId)).rejects.toThrow('inspection photo');
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();

        await expect(service.recordInspection(schemaName, rentalId, {
            inspectionType: 'pickup', odometer: 12000, fuelPercent: 80,
            conditionNotes: 'Sin daños visibles', handoffMethod: 'otp',
            handoffEvidenceRef: 'otp-verification:1', mediaIds: [mediaId], expectedVersion: 5,
        }, actorId)).resolves.toMatchObject({
            rental: { status: 'picked_up' }, inspection: { id: inspectionId },
        });
        expect(query.mock.calls.some(([sql]) => sql.includes('resource_rental_inspections'))).toBe(true);
        expect(query.mock.calls.some(([sql]) => sql.includes('resource_rental_events'))).toBe(true);
    });

    it('rejects a return odometer lower than the immutable pickup reading', async () => {
        const current = {
            id: rentalId,
            rental_type: 'vehicle_rental',
            status: 'picked_up',
            version: 6,
            metadata: { details: { driver: { name: 'Ana' }, odometerOut: 12000 } },
        };
        const query = jest.fn(async (sql: string) => {
            if (sql.includes('SELECT * FROM resource_rentals')) return [current];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service } = buildService(txWith(query));

        await expect(service.recordInspection(schemaName, rentalId, {
            inspectionType: 'return', odometer: 11999, conditionNotes: 'Devolución',
            mediaIds: [mediaId], handoffMethod: 'manual', handoffEvidenceRef: 'acta:2', expectedVersion: 6,
        }, actorId)).rejects.toThrow('cannot be lower');
        expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO resource_rental_inspections'))).toBe(false);
    });
});
