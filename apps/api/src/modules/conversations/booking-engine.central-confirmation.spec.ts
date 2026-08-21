import { BookingEngineService, type BookingState } from './booking-engine.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * El permiso con el que el motor entra al turno.
 *
 * El motor escribe citas por fuera del bucle de tools, así que la lista
 * publicada nunca lo alcanzaba. Ahora la autoridad es un parámetro suyo y
 * viaja hasta el ejecutor: estas pruebas verifican, además del flujo, que
 * llegue intacta.
 */
const BOOKING_AUTHORITY = authorityFor(
    'list_services', 'check_availability', 'create_appointment',
);

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
            { authority: BOOKING_AUTHORITY, conversationId },
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
                authority: BOOKING_AUTHORITY,
                authorityEvidence: {
                    kind: 'booking_engine_confirmation',
                    source: 'confirm_yes',
                },
            },
        );
    });

    // Telegram, Instagram, Messenger and the web widget never render the confirm
    // button, so the typed yes is the ONLY consent those channels can produce.
    // The engine used to send it with no evidence at all: the central guard then
    // opened its own challenge and the customer read the raw error code and had
    // to say yes a second time.
    it('carries evidence for a typed confirmation too, so the customer confirms once', async () => {
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
            slots: [{ time: '10:00', endTime: '10:30' }],
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
            // What the interpreter actually returns for a typed yes — the button
            // path short-circuits earlier on the raw payload, this one does not.
            { intent: 'confirm', isConfirmation: true } as any,
            'sí, confirmo',
            bookingState,
            {},
            '2026-08-08',
            'es',
            { authority: BOOKING_AUTHORITY, conversationId },
        );

        expect(result.state.step).toBe('booked');
        expect(toolExecutor.execute).toHaveBeenCalledTimes(1);
        expect(toolExecutor.execute.mock.calls[0][6]).toEqual({
            authority: BOOKING_AUTHORITY,
            authorityEvidence: {
                kind: 'booking_engine_confirmation',
                source: 'text_confirmation',
            },
        });
    });

    it('books a typed confirmation even when the slot list was lost from the state', async () => {
        // Redis expired and the PG backup rehydrated the state without `slots`.
        // The typed yes used to fall into the availability branch and answer a
        // confirmation with a fresh list of times; the button never did, because
        // it short-circuits on the raw payload before the state machine runs.
        const bookingState: BookingState = {
            step: 'confirm',
            services: [{ id: serviceId, name: 'Consultation', durationMinutes: 30, price: 2500, currency: 'USD' }],
            serviceId,
            serviceName: 'Consultation',
            date: '2026-08-12',
            time: '10:00',
            customerName: 'Ada Lovelace',
            customerEmail: 'ada@example.test',
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
            schemaName, tenantId, contactId,
            { intent: 'confirm', isConfirmation: true } as any,
            'sí, confirmo', bookingState, {}, '2026-08-08', 'es',
            { authority: BOOKING_AUTHORITY, conversationId },
        );

        expect(result.state.step).toBe('booked');
        const createCalls = toolExecutor.execute.mock.calls.filter(c => c[3] === 'create_appointment');
        expect(createCalls).toHaveLength(1);
    });

    // The engine executes create_appointment outside the LLM tool loop, so the
    // turn's executed-tool list was empty and the output guardrail audited a real
    // appointment as invented — rewriting "your appointment is booked" into
    // "still pending" in front of a customer who had just been booked.
    it('reports the appointment it created so the claim guardrail knows it is true', async () => {
        const bookingState: BookingState = {
            step: 'confirm',
            services: [{ id: serviceId, name: 'Consultation', durationMinutes: 30, price: 2500, currency: 'USD' }],
            serviceId,
            serviceName: 'Consultation',
            date: '2026-08-12',
            time: '10:00',
            customerName: 'Ada Lovelace',
            customerEmail: 'ada@example.test',
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
            schemaName, tenantId, contactId,
            { intent: 'general_question', isConfirmation: true } as any,
            'confirm_yes', bookingState, {}, '2026-08-08', 'es',
            { authority: BOOKING_AUTHORITY, conversationId },
        );

        expect(result.executedTools).toEqual([
            { name: 'create_appointment', result: { success: true, appointmentId: 'appointment-1' } },
        ]);
    });

    it('reports the existing appointment when the duplicate guard short-circuits', async () => {
        const bookingState: BookingState = {
            step: 'confirm',
            services: [{ id: serviceId, name: 'Consultation', durationMinutes: 30, price: 2500, currency: 'USD' }],
            serviceId,
            serviceName: 'Consultation',
            date: '2026-08-12',
            time: '10:00',
            customerName: 'Ada Lovelace',
            customerEmail: 'ada@example.test',
        };
        const redis = {
            get: jest.fn().mockResolvedValue(JSON.stringify(bookingState.services)),
            set: jest.fn(),
        };
        // The appointment already exists: saying so is the truth, not a claim
        // without backing.
        const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 'appointment-existing' }]) };
        const toolExecutor = { execute: jest.fn().mockResolvedValue({ success: true }) };
        const engine = new BookingEngineService(prisma as any, redis as any, toolExecutor as any);

        const result = await engine.process(
            schemaName, tenantId, contactId,
            { intent: 'general_question', isConfirmation: true } as any,
            'confirm_yes', bookingState, {}, '2026-08-08', 'es',
            { authority: BOOKING_AUTHORITY, conversationId },
        );

        const createCalls = toolExecutor.execute.mock.calls.filter(c => c[3] === 'create_appointment');
        expect(createCalls).toHaveLength(0);
        expect(result.executedTools?.[0]).toMatchObject({
            name: 'create_appointment',
            result: { success: true, idempotentReplay: true },
        });
    });
});
