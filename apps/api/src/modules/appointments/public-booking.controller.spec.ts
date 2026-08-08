import { PublicBookingController } from './public-booking.controller';

describe('PublicBookingController canonical appointment handoff', () => {
    const schemaName = 'tenant_public_booking';
    const serviceId = '11111111-1111-4111-8111-111111111111';
    const staffId = '22222222-2222-4222-8222-222222222222';

    function harness() {
        const prisma = {
            $queryRaw: jest.fn().mockResolvedValue([{
                id: '33333333-3333-4333-8333-333333333333',
                schema_name: schemaName,
                name: 'Negocio',
                public_booking_enabled: true,
            }]),
            executeInTenantSchema: jest.fn().mockResolvedValue([]),
        };
        const appointments = {
            getBookableSlots: jest.fn().mockResolvedValue([{
                time: '09:00', endTime: '09:30', agentId: staffId, agentName: 'Agente',
            }]),
            create: jest.fn().mockResolvedValue({ id: '44444444-4444-4444-8444-444444444444' }),
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
        const controller = new PublicBookingController(
            prisma as any,
            { incrementRateLimit: jest.fn().mockResolvedValue(1) } as any,
            appointments as any,
            services as any,
            calendar as any,
        );
        return { controller, prisma, appointments, calendar };
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
            serviceId,
            assignedTo: staffId,
            serviceName: 'Consulta',
            source: 'public_booking',
            customerEmail: 'cliente@example.com',
        }));
        expect(h.prisma.executeInTenantSchema.mock.calls.some(([, sql]: [string, string]) => (
            sql.includes('UPDATE appointments')
        ))).toBe(false);
    });
});
