import { IntentInterpreterService } from './intent-interpreter.service';
import { BookingEngineService, BookingState } from './booking-engine.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

const upcoming = [
    { date: '2026-09-10', weekday: 'Thursday' },
    { date: '2026-09-11', weekday: 'Friday' },
    { date: '2026-09-12', weekday: 'Saturday' },
];

function harness() {
    const router = { execute: jest.fn().mockResolvedValue({ content: JSON.stringify({ intent: 'confirm', isConfirmation: true }) }) };
    const service = new IntentInterpreterService(router as any);
    return { service, router, interpret: (text: string, step = 'confirm', today = '2026-09-06') => service.interpret(text, step, ['Limpieza dental'], today, upcoming) };
}

describe('dialogue interpretation preserves the task without inventing consent', () => {
    it.each([
        ['Hola quiero cita mañana', '2026-09-07'],
        ['Hello I want an appointment tomorrow', '2026-09-07'],
        ['Olá quero agendar amanhã', '2026-09-07'],
        ['Bonjour rendez-vous demain', '2026-09-07'],
    ])('extracts the date despite a greeting: %s', async (text, date) => {
        expect(await harness().interpret(text, 'idle')).toMatchObject({ intent: 'ask_availability', dateMentioned: date, isConfirmation: false });
    });

    it.each(['Gracias, quiero saber primero el precio', 'Gracias, pero qué incluye', 'Thanks, I want to know the price', 'Obrigado, quero saber o preço', 'Merci, je voudrais savoir le prix'])('keeps a question pending: %s', async text => {
        expect(await harness().interpret(text)).toMatchObject({ intent: 'general_question', isConfirmation: false, isNegation: false, questionTopic: text });
    });

    it('does not cancel when a service question contains negation', async () => {
        expect(await harness().interpret('¿Qué servicios no ofrecen?')).toMatchObject({ intent: 'ask_services', isNegation: false, isConfirmation: false });
    });

    it('does not elevate an arbitrary LLM confirmation to authorization', async () => {
        const { interpret, router } = harness();
        expect(await interpret('Me interesa entender mejor')).toMatchObject({ intent: 'unknown', isConfirmation: false });
        expect(router.execute).toHaveBeenCalled();
    });

    it('recognizes the selected service name only when it belongs to the pending proposal', async () => {
        const { service } = harness();
        const matching = await service.interpret('Confirmo la cita de Limpieza dental', 'confirm', ['Limpieza dental', 'Ortodoncia'], '2026-09-06', upcoming, undefined, undefined, ['Limpieza dental']);
        const different = await service.interpret('Confirmo la cita de Ortodoncia', 'confirm', ['Limpieza dental', 'Ortodoncia'], '2026-09-06', upcoming, undefined, undefined, ['Limpieza dental']);
        expect(matching.isConfirmation).toBe(true);
        expect(different.isConfirmation).toBe(false);
    });

    it.each(['Gracias', 'thanks', 'merci', 'obrigado'])('does not confirm on courtesy alone: %s', async text => {
        expect(await harness().interpret(text)).toMatchObject({ intent: 'farewell', isConfirmation: false });
    });

    it.each(['viernes', 'friday', 'sexta', 'vendredi'])('uses the civil weekday independent of the server timezone: %s', async text => {
        // A local-time lookup for UTC midnight resolves Friday as Thursday in
        // America/Bogota. The interpreter must never call that local method.
        const localDay = jest.spyOn(Date.prototype, 'getDay').mockImplementation(() => 0);
        try { expect(await harness().interpret(text, 'ask_date')).toMatchObject({ dateMentioned: '2026-09-11' }); }
        finally { localDay.mockRestore(); }
    });

    it('rolls a civil date into the next year without local timezone arithmetic', async () => {
        expect(await harness().interpret('mañana', 'ask_date', '2026-12-31')).toMatchObject({ dateMentioned: '2027-01-01' });
    });

    it('rejects impossible model dates/times and model-only cancellation', () => {
        const { service } = harness();
        const result = (service as any).sanitizeLlmIntent({ intent: 'cancel', isNegation: true, dateMentioned: '2026-02-31', timeMentioned: '25:70', language: 'zz' }, 'Busco información', '2026-09-06', 'confirm');
        expect(result).toMatchObject({ intent: 'unknown', isNegation: false, isConfirmation: false, dateMentioned: null, timeMentioned: null, language: 'es' });
    });

    it.each(['Gracias, quiero saber primero el precio', '¿Qué servicios no ofrecen?', 'Thanks, I want to know the price first'])('does not create or discard the pending booking when the interpreter receives %s', async text => {
        const state: BookingState = {
            step: 'confirm', services: [{ id: 'service', name: 'Limpieza dental', durationMinutes: 30, price: 20000, currency: 'COP' }],
            serviceId: 'service', serviceName: 'Limpieza dental', date: '2026-09-10', time: '10:00',
            slots: [{ time: '10:00', endTime: '10:30' }], customerName: 'Customer', customerEmail: 'customer@example.test',
        };
        const executor = { execute: jest.fn() };
        const engine = new BookingEngineService({ $queryRawUnsafe: async () => [] } as any, { get: async () => JSON.stringify(state.services), set: async () => undefined } as any, executor as any);
        const interpreted = await harness().interpret(text);
        const result = await engine.process('schema', 'tenant', 'contact', interpreted, text, state, {}, '2026-09-06', 'es', {
            authority: authorityFor('list_services', 'check_availability', 'create_appointment'), conversationId: 'conversation',
        });
        expect(executor.execute).not.toHaveBeenCalled();
        expect(result.state.step).toBe('confirm');
        expect(result.state.serviceId).toBe('service');
    });
});
