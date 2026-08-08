import { BookingEngineService, type BookingState } from './booking-engine.service';

const schemaName = 'tenant_booking_confirmation';
const tenantId = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';
const serviceId = '44444444-4444-4444-8444-444444444444';

describe('BookingEngine trusted confirmation wiring', () => {
    it('carries conversation-bound button evidence into create_appointment exactly once', async () => {
        const bookingState: BookingState = {
            step: 'confirm',
            services: [{
                id: serviceId,
                name: 'Consultation',
                durationMinutes: 30,
                price: 2500,
                currency: 'USD',
            }],
            serviceId,
            serviceName: 'Consultation',
            date: '2026-08-12',
            time: '10:00',
            customerName: 'Ada Lovelace',
            customerEmail: 'ada@example.test',
            customerPhone: '+15555550100',
        };
        const redis = {
            get: jest.fn().mockResolvedValue(JSON.stringify(bookingState.services)),
            set: jest.fn(),
        };
        const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) };
        const toolExecutor = {
            execute: jest.fn().mockResolvedValue({ success: true, appointmentId: 'appointment-1' }),
        };
        const engine = new BookingEngineService(prisma as any, redis as any, toolExecutor as any);

        const result = await engine.process(
            schemaName,
            tenantId,
            contactId,
            { intent: 'general_question', isConfirmation: true } as any,
            'confirm_yes',
            bookingState,
            {},
            '2026-08-08',
            'en',
            false,
            undefined,
            conversationId,
        );

        expect(result.state.step).toBe('booked');
        expect(toolExecutor.execute).toHaveBeenCalledTimes(1);
        expect(toolExecutor.execute).toHaveBeenCalledWith(
            schemaName,
            tenantId,
            contactId,
            'create_appointment',
            {
                serviceId,
                date: '2026-08-12',
                time: '10:00',
                staffId: undefined,
                customerName: 'Ada Lovelace',
                customerEmail: 'ada@example.test',
                customerPhone: '+15555550100',
            },
            conversationId,
            {
                authorityEvidence: {
                    kind: 'booking_engine_confirmation',
                    source: 'confirm_yes',
                },
            },
        );
    });
});
