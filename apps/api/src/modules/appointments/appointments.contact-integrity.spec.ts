import { BadRequestException } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';

describe('AppointmentsService contact integrity', () => {
    const schemaName = 'tenant_appointments';
    const contactId = '11111111-1111-4111-8111-111111111111';
    const foreignContactId = '22222222-2222-4222-8222-222222222222';
    const serviceId = '33333333-3333-4333-8333-333333333333';
    const appointmentId = '44444444-4444-4444-8444-444444444444';

    const baseInput = {
        serviceId,
        serviceName: 'Consulta',
        startAt: '2026-08-12T09:00:00',
        endAt: '2026-08-12T09:30:00',
        metadata: { timezone: 'America/Bogota' },
    };

    function harness(contactRows: Array<{ id: string }> = []) {
        const query = jest.fn(async (sql: string, _params?: any[]) => {
            if (sql.includes('FROM contacts')) return contactRows;
            if (sql.includes('FROM services')) {
                return [{ id: serviceId, name: 'Consulta', max_concurrent: 1 }];
            }
            if (sql.includes('COUNT(*)::int AS occupied')) return [{ occupied: 0 }];
            return [];
        });
        const executeInTenantSchema = jest.fn(async (_schema: string, sql: string) => {
            if (sql.includes('FROM appointments a')) {
                return [{
                    id: appointmentId,
                    contact_id: contactId,
                    conversation_id: null,
                    assigned_user_id: null,
                    service_id: serviceId,
                    service_name: 'Consulta',
                    start_at: new Date('2026-08-12T09:00:00Z'),
                    end_at: new Date('2026-08-12T09:30:00Z'),
                    status: 'pending',
                    location: null,
                    notes: null,
                    reminder_sent: false,
                    metadata: {},
                    created_at: new Date('2026-08-10T00:00:00Z'),
                }];
            }
            return [];
        });
        const prisma = {
            executeInTenantSchema,
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)),
            tenant: { findFirst: jest.fn() },
        };
        const service = new AppointmentsService(
            prisma as any,
            { emit: jest.fn() } as any,
            { enqueueWithQuery: jest.fn() } as any,
        );
        return { service, prisma, query };
    }

    it.each([
        ['single', (service: AppointmentsService) => service.create(schemaName, baseInput)],
        ['recurring', (service: AppointmentsService) => service.createRecurring(schemaName, {
            ...baseInput,
            recurrence: { frequency: 'weekly' as const, count: 2 },
        })],
    ])('rejects an omitted contact for a %s appointment before opening a transaction', async (_kind, invoke) => {
        const h = harness();

        await expect(invoke(h.service)).rejects.toBeInstanceOf(BadRequestException);
        expect(h.prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it.each([
        ['single', (service: AppointmentsService) => service.create(schemaName, {
            ...baseInput,
            contactId: 'not-a-uuid',
        })],
        ['recurring', (service: AppointmentsService) => service.createRecurring(schemaName, {
            ...baseInput,
            contactId: 'not-a-uuid',
            recurrence: { frequency: 'weekly' as const, count: 2 },
        })],
    ])('rejects a malformed contact UUID for a %s appointment before opening a transaction', async (_kind, invoke) => {
        const h = harness();

        await expect(invoke(h.service)).rejects.toBeInstanceOf(BadRequestException);
        expect(h.prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it.each([
        ['single', (service: AppointmentsService) => service.create(schemaName, {
            ...baseInput,
            contactId: foreignContactId,
        })],
        ['recurring', (service: AppointmentsService) => service.createRecurring(schemaName, {
            ...baseInput,
            contactId: foreignContactId,
            recurrence: { frequency: 'weekly' as const, count: 2 },
        })],
    ])('rejects a foreign tenant contact for a %s appointment inside the write transaction', async (_kind, invoke) => {
        const h = harness([]);

        await expect(invoke(h.service)).rejects.toBeInstanceOf(BadRequestException);

        expect(h.prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
        expect(h.query.mock.calls[0][0]).toContain('SELECT id FROM contacts');
        expect(h.query.mock.calls[0][1]).toEqual([foreignContactId]);
        expect(h.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO appointments'))).toBe(false);
    });

    it('validates and inserts every recurring instance through the same tenant transaction query', async () => {
        const h = harness([{ id: contactId }]);

        const result = await h.service.createRecurring(schemaName, {
            ...baseInput,
            contactId,
            recurrence: { frequency: 'weekly', count: 2 },
        });

        expect(result.appointments).toHaveLength(2);
        expect(h.prisma.transactionInTenantSchema).toHaveBeenCalledTimes(2);
        expect(h.query.mock.calls.filter(([sql]) => sql.includes('SELECT id FROM contacts'))).toHaveLength(2);
        const inserts = h.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO appointments'));
        expect(inserts).toHaveLength(2);
        for (const [, params] of inserts) expect(params?.[1]).toBe(contactId);
    });
});
