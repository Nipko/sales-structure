import { BadRequestException } from '@nestjs/common';
import { StaffSchedulingService } from './staff-scheduling.service';

describe('StaffSchedulingService', () => {
    const tenantId = '3e8ad32e-a16b-42e6-9634-b8e8cc29292d';
    const schemaName = 'tenant_test';
    let rawQuery: jest.Mock;
    let tenantQuery: jest.Mock;
    let transactionQuery: jest.Mock;
    let prisma: {
        $queryRawUnsafe: jest.Mock;
        executeInTenantSchema: jest.Mock;
        transactionInTenantSchema: jest.Mock;
        getTenantSchemaName: jest.Mock;
        assertTenantSchemaName: jest.Mock;
    };
    let service: StaffSchedulingService;

    beforeEach(() => {
        rawQuery = jest.fn().mockResolvedValue([{ exists: 1 }]);
        tenantQuery = jest.fn().mockResolvedValue([]);
        transactionQuery = jest.fn().mockResolvedValue([]);
        prisma = {
            $queryRawUnsafe: rawQuery,
            executeInTenantSchema: tenantQuery,
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(transactionQuery)),
            getTenantSchemaName: jest.fn().mockResolvedValue(schemaName),
            assertTenantSchemaName: jest.fn(),
        };
        service = new StaffSchedulingService(prisma as any, { del: jest.fn() } as any);
    });

    it('resolves the tenant schema instead of using the tenantId as a schema name', async () => {
        await service.listStaff(tenantId);

        expect(prisma.getTenantSchemaName).toHaveBeenCalledWith(tenantId);
        expect(tenantQuery.mock.calls[0][0]).toBe(schemaName);
        // The DDL path is the only one that still interpolates by hand, so it has
        // to be the one guarded by the fail-fast assertion.
        expect(prisma.assertTenantSchemaName).toHaveBeenCalledWith(schemaName);
        expect(rawQuery.mock.calls.every(([sql]) =>
            typeof sql !== 'string' || !sql.includes(tenantId),
        )).toBe(true);
    });

    it('replaces the complete weekly schedule inside one tenant transaction', async () => {
        await service.setSchedule(tenantId, '11111111-1111-4111-8111-111111111111', [
            { dayOfWeek: 1, startTime: '09:00', endTime: '13:00' },
            { dayOfWeek: 2, startTime: '10:00:00', endTime: '18:00:00', isActive: false },
        ]);

        expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
        expect(prisma.transactionInTenantSchema).toHaveBeenCalledWith(schemaName, expect.any(Function));
        expect(transactionQuery).toHaveBeenCalledTimes(3);
        expect(transactionQuery.mock.calls[0][0]).toContain('DELETE FROM staff_schedules');
        expect(transactionQuery.mock.calls[1][0]).toContain('INSERT INTO staff_schedules');
        expect(transactionQuery.mock.calls[2][1]).toEqual([
            '11111111-1111-4111-8111-111111111111',
            2,
            '10:00:00',
            '18:00:00',
            false,
        ]);
    });

    it('does not expose the DELETE when a later schedule insert fails', async () => {
        const originalRows = [{ dayOfWeek: 5, startTime: '08:00', endTime: '12:00' }];
        let committedRows = originalRows.map(row => ({ ...row }));
        prisma.transactionInTenantSchema.mockImplementationOnce(async (_schema: string, callback: any) => {
            const transactionRows: any[] = committedRows.map(row => ({ ...row }));
            let insertCount = 0;
            const query = jest.fn(async (sql: string, params: any[]) => {
                if (sql.includes('DELETE FROM staff_schedules')) transactionRows.splice(0);
                if (sql.includes('INSERT INTO staff_schedules')) {
                    insertCount += 1;
                    if (insertCount === 2) throw new Error('simulated constraint failure');
                    transactionRows.push({
                        dayOfWeek: params[1],
                        startTime: params[2],
                        endTime: params[3],
                    });
                }
                return [];
            });

            await callback(query);
            committedRows = transactionRows;
        });

        await expect(service.setSchedule(tenantId, '11111111-1111-4111-8111-111111111111', [
            { dayOfWeek: 1, startTime: '09:00', endTime: '13:00' },
            { dayOfWeek: 2, startTime: '10:00', endTime: '18:00' },
        ])).rejects.toThrow('simulated constraint failure');

        expect(committedRows).toEqual(originalRows);
        expect(tenantQuery.mock.calls.some(([, sql]) =>
            typeof sql === 'string' && sql.includes('DELETE FROM staff_schedules'),
        )).toBe(false);
    });

    it('rejects invalid schedule ranges before deleting existing rows', async () => {
        await expect(service.setSchedule(
            tenantId,
            '11111111-1111-4111-8111-111111111111',
            [{ dayOfWeek: 7, startTime: '18:00', endTime: '09:00' }],
        )).rejects.toBeInstanceOf(BadRequestException);

        expect(prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it('replaces all staff-service links atomically', async () => {
        await service.linkServices(tenantId, '11111111-1111-4111-8111-111111111111', [
            '22222222-2222-4222-8222-222222222222',
            '33333333-3333-4333-8333-333333333333',
        ]);

        expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
        expect(transactionQuery).toHaveBeenCalledTimes(3);
        expect(transactionQuery.mock.calls[0][0]).toContain('DELETE FROM staff_service_links');
        expect(transactionQuery.mock.calls[1][0]).toContain('INSERT INTO staff_service_links');
    });

    it('uses the canonical appointment interval columns and the complete service duration', async () => {
        tenantQuery.mockResolvedValueOnce([{ id: 'staff-1', name: 'Ana' }]);

        const result = await service.getAvailableStaff(
            tenantId,
            '22222222-2222-4222-8222-222222222222',
            '2026-08-10', // Monday, independent of the host timezone.
            '09:30',
        );

        expect(result).toEqual([{ id: 'staff-1', name: 'Ana' }]);
        const [schema, sql, params] = tenantQuery.mock.calls[0];
        expect(schema).toBe(schemaName);
        expect(params).toEqual(['22222222-2222-4222-8222-222222222222', 1, '09:30', '2026-08-10']);
        // search_path scopes the tables, so no schema may be spelled out here.
        expect(sql).not.toContain(schemaName);
        expect(sql).toContain('a.assigned_to = sm.id');
        expect(sql).toContain('a.start_at <');
        expect(sql).toContain('a.end_at >');
        expect(sql).toContain("a.status NOT IN ('cancelled', 'no_show')");
        expect(sql).toContain('($4::date + $3::time) < ($4::date + sb.end_time)');
        expect(sql).toContain(') > ($4::date + sb.start_time)');
        expect(sql).toContain(') <= ($4::date + ss.end_time)');
        expect(sql).toContain('sl.duration_override_min');
        expect(sql).toContain('svc.duration_minutes');
        expect(sql).toContain('svc.buffer_minutes');
        expect(sql).not.toContain('a.staff_id');
        expect(sql).not.toContain('a.appointment_date');
        expect(sql).not.toContain('a.appointment_time');
    });

    it.each([
        ['2026-02-30', '09:00'],
        ['08/10/2026', '09:00'],
        ['2026-08-10', '24:00'],
    ])('rejects invalid availability input date=%s time=%s', async (date, time) => {
        await expect(service.getAvailableStaff(
            tenantId,
            '22222222-2222-4222-8222-222222222222',
            date,
            time,
        )).rejects.toBeInstanceOf(BadRequestException);

        // The only raw query is the idempotent table-presence check.
        expect(rawQuery).toHaveBeenCalledTimes(1);
        expect(tenantQuery).not.toHaveBeenCalled();
    });
});
