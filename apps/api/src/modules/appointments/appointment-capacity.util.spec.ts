import {
    AppointmentSlotConflictError,
    lockAndAssertAppointmentCapacity,
} from './appointment-capacity.util';

describe('canonical appointment capacity writer', () => {
    const input = {
        schemaName: 'tenant_capacity',
        serviceId: '11111111-1111-4111-8111-111111111111',
        staffUserId: '22222222-2222-4222-8222-222222222222',
        startAt: '2026-08-12T09:00:00',
        endAt: '2026-08-12T09:30:00',
    };

    function queryWithOccupancy(occupied: number) {
        const query: jest.Mock<any, any[]> = jest.fn(async (sql: string, _params: any[] = []) => {
            if (sql.includes('FROM services')) {
                return [{ id: input.serviceId, name: 'Consulta', max_concurrent: 1 }];
            }
            if (sql.includes('assigned_to')) return [];
            if (sql.includes('COUNT(*)')) return [{ occupied }];
            return [];
        });
        return query;
    }

    it('takes the shared service/day and staff/day advisory locks before rechecking', async () => {
        const query = queryWithOccupancy(0);

        await expect(lockAndAssertAppointmentCapacity(query, input))
            .resolves.toMatchObject({ id: input.serviceId, maxConcurrent: 1 });

        const calls = query.mock.calls.map(([sql, params]) => ({ sql, params }));
        expect(calls[0].sql).toContain('pg_advisory_xact_lock');
        expect(calls[1].sql).toContain('pg_advisory_xact_lock');
        expect(calls.slice(0, 2).flatMap((call) => call.params)).toEqual(expect.arrayContaining([
            `appointment:service:${input.schemaName}:${input.serviceId}:2026-08-12`,
            `appointment:staff:${input.schemaName}:${input.staffUserId}:2026-08-12`,
        ]));
        expect(calls.findIndex((call) => call.sql.includes('FROM services'))).toBeGreaterThan(1);
        expect(calls.findIndex((call) => call.sql.includes('COUNT(*)')))
            .toBeGreaterThan(calls.findIndex((call) => call.sql.includes('FROM services')));
    });

    it('rejects the second serialized writer when service capacity is already full', async () => {
        const query = queryWithOccupancy(1);

        await expect(lockAndAssertAppointmentCapacity(query, input))
            .rejects.toBeInstanceOf(AppointmentSlotConflictError);
    });
});
