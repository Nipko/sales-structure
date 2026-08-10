import { BadRequestException } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { ServicesService } from './services.service';
import { dayOfWeekForLocalDate } from './appointment-capacity.util';

describe('Agenda tenant isolation and slot safety', () => {
    const schemaName = 'tenant_scope_a';
    const staffId = '11111111-1111-4111-8111-111111111111';
    const otherStaffId = '22222222-2222-4222-8222-222222222222';
    const serviceId = '33333333-3333-4333-8333-333333333333';
    const otherServiceId = '44444444-4444-4444-8444-444444444444';
    const appointmentId = '55555555-5555-4555-8555-555555555555';
    const contactId = '66666666-6666-4666-8666-666666666666';

    function harness(authorityRows: any[] = []) {
        const executeInTenantSchema = jest.fn(async (_schema: string, sql: string, _params: any[] = []) => {
            if (sql.includes('WHERE u.id = $1::uuid') && sql.includes('t.schema_name = $2')) {
                return authorityRows;
            }
            return [];
        });
        const prisma = {
            executeInTenantSchema,
            transactionInTenantSchema: jest.fn(),
            tenant: { findFirst: jest.fn().mockResolvedValue(null) },
        };
        const calendarOutbox = { enqueueWithQuery: jest.fn() };
        const appointments = new AppointmentsService(
            prisma as any,
            { emit: jest.fn() } as any,
            calendarOutbox as any,
        );
        const services = new ServicesService(
            prisma as any,
            { del: jest.fn() } as any,
        );
        return { prisma, appointments, services };
    }

    it('derives weekday from the tenant-local date without the America/Bogota UTC shift', () => {
        const previous = process.env.TZ;
        process.env.TZ = 'America/Bogota';
        try {
            // Date-only `new Date(...).getDay()` returns Saturday in UTC-5.
            expect(dayOfWeekForLocalDate('2026-08-09')).toBe(0);
        } finally {
            process.env.TZ = previous;
        }
    });

    it.each([
        ['create', (h: ReturnType<typeof harness>) => h.appointments.create(schemaName, {
            contactId,
            assignedTo: otherStaffId,
            serviceName: 'Consulta',
            startAt: '2026-08-12T09:00:00',
            endAt: '2026-08-12T09:30:00',
        })],
        ['update', (h: ReturnType<typeof harness>) => h.appointments.update(
            schemaName, appointmentId, { assignedTo: otherStaffId },
        )],
        ['createRecurring', (h: ReturnType<typeof harness>) => h.appointments.createRecurring(schemaName, {
            contactId,
            assignedTo: otherStaffId,
            serviceName: 'Consulta',
            startAt: '2026-08-12T09:00:00',
            endAt: '2026-08-12T09:30:00',
            recurrence: { frequency: 'weekly', count: 2 },
        })],
        ['saveAvailability', (h: ReturnType<typeof harness>) => h.appointments.saveAvailability(
            schemaName, otherStaffId, [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' }],
        )],
        ['createBlockedDate', (h: ReturnType<typeof harness>) => h.appointments.createBlockedDate(
            schemaName, { userId: otherStaffId, blockedDate: '2026-08-12' },
        )],
        ['list filter', (h: ReturnType<typeof harness>) => h.appointments.list(
            schemaName, { assignedTo: otherStaffId },
        )],
        ['availability filter', (h: ReturnType<typeof harness>) => h.appointments.getAvailability(
            schemaName, otherStaffId,
        )],
        ['blocked-date filter', (h: ReturnType<typeof harness>) => h.appointments.getBlockedDates(
            schemaName, otherStaffId,
        )],
        ['check-slots filter', (h: ReturnType<typeof harness>) => h.appointments.checkAvailableSlots(
            schemaName, '2026-08-12', otherStaffId,
        )],
        ['bookable-slots filter', (h: ReturnType<typeof harness>) => h.appointments.getBookableSlots(
            schemaName, '2026-08-12', serviceId, 30, 0, otherStaffId,
        )],
        ['assignStaff', (h: ReturnType<typeof harness>) => h.services.assignStaff(
            schemaName, serviceId, otherStaffId,
        )],
    ])('rejects a cross-tenant user at the %s boundary before any mutation', async (_name, invoke) => {
        const h = harness([]);

        await expect(invoke(h)).rejects.toBeInstanceOf(BadRequestException);

        expect(h.prisma.transactionInTenantSchema).not.toHaveBeenCalled();
        const mutationCalls = h.prisma.executeInTenantSchema.mock.calls.filter(([, sql]) => (
            /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)
        ));
        expect(mutationCalls).toHaveLength(0);
    });

    it('scopes every scheduling user/name/email join to the active tenant owner', async () => {
        const h = harness([]);

        await h.appointments.list(schemaName);
        await h.appointments.getById(schemaName, appointmentId).catch(() => undefined);
        await h.appointments.getSeriesInstances(schemaName, appointmentId);
        await h.appointments.getAvailability(schemaName);
        await h.appointments.getBlockedDates(schemaName);
        await h.appointments.checkAvailableSlots(schemaName, '2026-08-12');
        await h.appointments.getBookableSlots(schemaName, '2026-08-12', serviceId, 30);
        await h.services.getStaff(schemaName, serviceId);

        const scopedJoins = h.prisma.executeInTenantSchema.mock.calls
            .map(([, sql]) => sql)
            .filter((sql) => sql.includes('public.users'));
        expect(scopedJoins.length).toBeGreaterThanOrEqual(8);
        for (const sql of scopedJoins) {
            expect(sql).toContain('public.tenants');
            expect(sql).toContain('tenant_owner.schema_name');
            expect(sql).toContain('u.tenant_id = tenant_owner.id');
        }
    });

    it('does not consume capacity for an overlapping appointment of another service', async () => {
        const h = harness([]);
        h.prisma.executeInTenantSchema
            .mockResolvedValueOnce([{
                user_id: staffId,
                start_time: '09:00:00',
                end_time: '10:00:00',
                agent_name: 'Agente A',
            }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{
                assigned_to: otherStaffId,
                service_id: otherServiceId,
                start_at: new Date('2026-08-12T09:00:00'),
                end_at: new Date('2026-08-12T09:30:00'),
            }]);

        const slots = await h.appointments.getBookableSlots(
            schemaName,
            '2026-08-12',
            serviceId,
            30,
            0,
            undefined,
            [],
            1,
        );

        expect(slots).toContainEqual({
            time: '09:00',
            endTime: '09:30',
            agentId: staffId,
            agentName: 'Agente A',
        });
        expect(h.prisma.executeInTenantSchema.mock.calls[2][1]).toContain('service_id');
    });

    it('withholds a legacy availability window that overlaps an existing appointment', async () => {
        const h = harness([]);
        h.prisma.executeInTenantSchema
            .mockResolvedValueOnce([{
                user_id: staffId,
                start_time: '09:00:00',
                end_time: '12:00:00',
                agent_name: 'Agente A',
            }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{
                assigned_to: staffId,
                start_at: new Date('2026-08-12T09:30:00'),
                end_at: new Date('2026-08-12T10:00:00'),
            }]);

        const result = await h.appointments.checkAvailableSlots(schemaName, '2026-08-12');

        expect(result.availableSlots).toEqual([]);
    });
});
