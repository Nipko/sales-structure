import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
    isRepairOrderTransitionAllowed,
    RepairOrdersService,
} from './repair-orders.service';

describe('RepairOrdersService', () => {
    const schemaName = 'tenant_workshop';
    const contactId = '11111111-1111-4111-8111-111111111111';
    const otherContactId = '22222222-2222-4222-8222-222222222222';
    const vehicleId = '33333333-3333-4333-8333-333333333333';
    const orderId = '44444444-4444-4444-8444-444444444444';
    const actorId = '55555555-5555-4555-8555-555555555555';

    function transaction(query: jest.Mock) {
        return jest.fn(async (_schema: string, callback: any) => callback(query));
    }

    function build(query = jest.fn()) {
        const prisma = {
            executeInTenantSchema: jest.fn(),
            transactionInTenantSchema: transaction(query),
        };
        return { service: new RepairOrdersService(prisma as any), prisma, query };
    }

    it('declares an explicit lifecycle and does not allow skipping approval or reopening terminal work', () => {
        expect(isRepairOrderTransitionAllowed('intake', 'estimating')).toBe(true);
        expect(isRepairOrderTransitionAllowed('estimating', 'awaiting_approval')).toBe(true);
        expect(isRepairOrderTransitionAllowed('approved', 'in_progress')).toBe(true);
        expect(isRepairOrderTransitionAllowed('ready', 'delivered')).toBe(true);
        expect(isRepairOrderTransitionAllowed('intake', 'in_progress')).toBe(false);
        expect(isRepairOrderTransitionAllowed('awaiting_approval', 'in_progress')).toBe(false);
        expect(isRepairOrderTransitionAllowed('delivered', 'intake')).toBe(false);
        expect(isRepairOrderTransitionAllowed('cancelled', 'estimating')).toBe(false);
    });

    it('returns operational workshop counts without treating cancelled work as open', async () => {
        const { service, prisma } = build();
        prisma.executeInTenantSchema.mockResolvedValueOnce([{
            open: 7,
            awaiting_approval: 2,
            ready_for_delivery: 1,
            delivered_last_30_days: 9,
        }]);

        await expect(service.summary(schemaName)).resolves.toEqual({
            open: 7,
            awaitingApproval: 2,
            readyForDelivery: 1,
            deliveredLast30Days: 9,
        });
        expect(String(prisma.executeInTenantSchema.mock.calls[0][1])).toContain("status NOT IN ('delivered', 'cancelled')");
    });

    it('requires a CRM contact and a vehicle identified by VIN or plate before inserting', async () => {
        const missingContact = build(jest.fn().mockResolvedValue([]));
        await expect(missingContact.service.create(schemaName, {
            contactId,
            vehicle: { make: 'Mazda', model: '3', licensePlate: 'ABC123' },
            customerConcern: 'Siente una vibración al frenar',
        }, { type: 'tenant_user' })).rejects.toBeInstanceOf(NotFoundException);
        expect(missingContact.query).toHaveBeenCalledTimes(1);
        expect(String(missingContact.query.mock.calls[0][0])).toContain('FROM contacts');

        const missingIdentity = build(jest.fn(async (sql: string) => {
            if (sql.includes('FROM contacts')) return [{ id: contactId }];
            throw new Error(`Unexpected SQL: ${sql}`);
        }));
        await expect(missingIdentity.service.create(schemaName, {
            contactId,
            vehicle: { make: 'Mazda', model: '3' },
            customerConcern: 'Siente una vibración al frenar',
        }, { type: 'tenant_user' })).rejects.toBeInstanceOf(BadRequestException);
        expect(missingIdentity.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO repair_orders'))).toBe(false);
    });

    it('persists the customer concern as intake evidence without manufacturing a diagnosis', async () => {
        const created = {
            id: orderId,
            contact_id: contactId,
            vehicle_id: vehicleId,
            customer_concern: 'Hace un ruido cuando giro',
            status: 'intake',
            version: 1,
        };
        const query = jest.fn(async (sql: string, params?: any[]) => {
            if (sql.includes('FROM repair_orders ro') && sql.includes('idempotency_key')) return [];
            if (sql.includes('FROM contacts')) return [{ id: contactId }];
            if (sql.includes('FROM customer_vehicles') && sql.includes('FOR UPDATE')) return [];
            if (sql.includes('INSERT INTO customer_vehicles')) return [{
                id: vehicleId, contact_id: contactId, make: 'Mazda', model: '3', license_plate: 'ABC123',
            }];
            if (sql.includes('FROM opportunities o')) return [];
            if (sql.includes('INSERT INTO repair_orders')) return [created];
            if (sql.includes('INSERT INTO repair_order_events')) return [];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service } = build(query);

        const result = await service.create(schemaName, {
            contactId,
            vehicle: { make: 'Mazda', model: '3', licensePlate: 'abc123' },
            customerConcern: 'Hace un ruido cuando giro',
            reportedSymptoms: ['ruido al girar'],
            idempotencyKey: 'turn-ledger-1',
        }, { id: actorId, type: 'tenant_user' });

        expect(result).toMatchObject({ id: orderId, status: 'intake', idempotentReplay: false });
        const insert = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO repair_orders'))!;
        expect(String(insert[0])).toContain('customer_concern');
        expect(String(insert[0])).toContain('reported_symptoms');
        expect(String(insert[0])).not.toContain('diagnosis_summary');
        expect(insert[1]).toEqual(expect.arrayContaining([
            'Hace un ruido cuando giro', JSON.stringify(['ruido al girar']), 'turn-ledger-1',
        ]));
    });

    it('replays an idempotent create before updating or inserting a vehicle', async () => {
        const replay = {
            id: orderId,
            contact_id: contactId,
            vehicle_id: vehicleId,
            make: 'Mazda',
            model: '3',
            idempotency_key: 'turn-ledger-1',
        };
        const query = jest.fn().mockResolvedValueOnce([replay]);
        const { service } = build(query);

        await expect(service.create(schemaName, {
            contactId,
            vehicle: { make: 'Mazda', model: '3', licensePlate: 'ABC123', mileageKm: 99999 },
            customerConcern: 'Hace un ruido cuando giro',
            idempotencyKey: 'turn-ledger-1',
        }, { type: 'agent' })).resolves.toMatchObject({
            id: orderId,
            vehicle: { id: vehicleId, make: 'Mazda', model: '3' },
            idempotentReplay: true,
        });

        expect(query).toHaveBeenCalledTimes(1);
        expect(String(query.mock.calls[0][0])).toContain('idempotency_key');
    });

    it('publishes a versioned estimate, derives its exact total and requests approval', async () => {
        const current = { id: orderId, status: 'estimating', version: 2 };
        const updated = {
            ...current,
            status: 'awaiting_approval',
            approval_status: 'pending',
            estimate_amount_cents: 125000,
            version: 3,
        };
        const query = jest.fn(async (sql: string, params?: any[]) => {
            if (sql.includes('SELECT * FROM repair_orders')) return [current];
            if (sql.includes('UPDATE repair_orders')) return [updated];
            if (sql.includes('INSERT INTO repair_order_events')) return [];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service } = build(query);

        await expect(service.updateEstimate(schemaName, orderId, {
            expectedVersion: 2,
            lineItems: [
                { description: 'Pastillas de freno', quantity: 1, unitAmountCents: 85000 },
                { description: 'Mano de obra', quantity: 2, unitAmountCents: 20000 },
            ],
            amountCents: 125000,
            currency: 'cop',
        }, actorId)).resolves.toEqual(updated);

        const update = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE repair_orders'))!;
        expect(update[1]).toEqual(expect.arrayContaining([125000, 'COP', 2]));
        expect(String(update[0])).toContain("status = 'awaiting_approval'");
        expect(String(update[0])).toContain("approval_status = 'pending'");
    });

    it('rejects a model- or client-supplied total that does not match line items', async () => {
        const { service, prisma } = build();
        await expect(service.updateEstimate(schemaName, orderId, {
            expectedVersion: 1,
            lineItems: [{ description: 'Repuesto', quantity: 2, unitAmountCents: 30000 }],
            amountCents: 50000,
        })).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it('does not invent a country currency when an estimate omits it', async () => {
        const { service, prisma } = build();
        await expect(service.updateEstimate(schemaName, orderId, {
            expectedVersion: 1,
            amountCents: 50000,
        })).rejects.toThrow('currency is required');
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it('accepts an estimate decision only for the owning contact and exact pending order', async () => {
        const current = {
            id: orderId,
            contact_id: contactId,
            status: 'awaiting_approval',
            approval_status: 'pending',
            estimate_amount_cents: 125000,
            currency: 'COP',
        };
        const query = jest.fn(async (sql: string, params?: any[]) => {
            if (sql.includes('SELECT * FROM repair_orders')) {
                return params?.[1] === contactId ? [current] : [];
            }
            if (sql.includes('UPDATE repair_orders')) return [{ ...current, status: 'approved', approval_status: 'approved' }];
            if (sql.includes('INSERT INTO repair_order_events')) return [];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service } = build(query);

        await expect(service.decideEstimate(schemaName, orderId, otherContactId, true))
            .rejects.toBeInstanceOf(NotFoundException);
        await expect(service.decideEstimate(schemaName, orderId, contactId, true))
            .resolves.toMatchObject({ status: 'approved', approval_status: 'approved', idempotentReplay: false });
        const ownerQuery = query.mock.calls.find(([, params]) => params?.[1] === contactId);
        expect(String(ownerQuery?.[0])).toContain('contact_id = $2::uuid');
    });

    it('requires attributable evidence when staff records a customer decision', async () => {
        const { service, prisma } = build();
        await expect(service.decideEstimate(
            schemaName, orderId, null, true, 'tenant_user', actorId, '',
        )).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it('rejects a non-boolean estimate decision before any transaction', async () => {
        const { service, prisma } = build();
        await expect(service.decideEstimate(
            schemaName, orderId, contactId, 'false' as unknown as boolean,
        )).rejects.toThrow('accepted must be a boolean');
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it('stores the staff actor and evidence for an offline customer approval', async () => {
        const current = {
            id: orderId, status: 'awaiting_approval', approval_status: 'pending',
            estimate_amount_cents: 125000, currency: 'COP',
        };
        const query = jest.fn(async (sql: string, _params?: any[]) => {
            if (sql.includes('SELECT * FROM repair_orders')) return [current];
            if (sql.includes('UPDATE repair_orders')) return [{ ...current, status: 'approved', approval_status: 'approved' }];
            if (sql.includes('INSERT INTO repair_order_events')) return [];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        const { service } = build(query);

        await expect(service.decideEstimate(
            schemaName, orderId, null, true, 'tenant_user', actorId,
            'Cliente aprobó por llamada el 25/08 a las 10:30',
        )).resolves.toMatchObject({ status: 'approved' });

        const event = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO repair_order_events'))!;
        expect(event[1]).toEqual(expect.arrayContaining([
            actorId,
            'tenant_user',
            expect.stringContaining('Cliente aprobó por llamada'),
        ]));
    });

    it('only assigns an active staff record as technician', async () => {
        const query = jest.fn()
            .mockResolvedValueOnce([{ id: orderId, vehicle_id: vehicleId, status: 'approved', version: 4 }])
            .mockResolvedValueOnce([]);
        const { service } = build(query);

        await expect(service.updateOperationalDetails(schemaName, orderId, {
            expectedVersion: 4,
            assignedTechnicianId: actorId,
        }, actorId)).rejects.toThrow('assignedTechnicianId must identify active staff');
        expect(query).toHaveBeenCalledTimes(2);
        expect(String(query.mock.calls[1][0])).toContain('FROM staff_members');
    });

    it('enforces optimistic versioning and requires final money before delivery', async () => {
        const staleQuery = jest.fn().mockResolvedValue([{ id: orderId, status: 'approved', version: 4 }]);
        await expect(build(staleQuery).service.transition(schemaName, orderId, {
            status: 'in_progress', expectedVersion: 3,
        })).rejects.toBeInstanceOf(ConflictException);

        const readyQuery = jest.fn().mockResolvedValue([{ id: orderId, status: 'ready', version: 4, final_amount_cents: null }]);
        await expect(build(readyQuery).service.transition(schemaName, orderId, {
            status: 'delivered', expectedVersion: 4,
        })).rejects.toThrow('A final amount is required before delivery');
        expect(readyQuery.mock.calls.some(([sql]) => String(sql).includes('UPDATE repair_orders'))).toBe(false);
    });

    it('does not let the generic status endpoint forge an estimate decision', async () => {
        const { service, prisma } = build();
        await expect(service.transition(schemaName, orderId, {
            status: 'approved', expectedVersion: 1,
        })).rejects.toThrow('Estimate decisions require the dedicated evidence path');
        await expect(service.transition(schemaName, orderId, {
            status: 'rejected', expectedVersion: 1,
        })).rejects.toThrow('Estimate decisions require the dedicated evidence path');
        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });
});
