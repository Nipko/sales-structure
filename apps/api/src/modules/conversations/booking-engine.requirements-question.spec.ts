import { BookingEngineService, type BookingState } from './booking-engine.service';
import { isRequirementsQuestion } from './informational-detour';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

/**
 * E2v P08-4 (dental): «¿Qué datos necesitan para darme cita?» sin misión abierta. El motor contestaba
 * «Estos son nuestros servicios: 1. …»: la pregunta es qué pide el negocio, la contesta el modelo.
 */
const authority = authorityFor('list_services', 'check_availability', 'create_appointment');
const services = [
    { id: 'a', name: 'Consulta general', durationMinutes: 30, price: 0, currency: 'COP', priceStatus: 'example' as const },
    { id: 'b', name: 'Control y seguimiento', durationMinutes: 20, price: 0, currency: 'COP', priceStatus: 'example' as const },
];

describe('isRequirementsQuestion', () => {
    it.each([
        '¿Qué datos necesitan para darme cita?',
        'Qué datos necesitan para agendar una cita',
        '¿Qué documentos debo llevar a la consulta?',
        '¿Qué necesito para agendar una cita?',
        '¿Cuáles son los requisitos para la cita?',
        'Dígame qué datos necesitan',
        'What information do you need to book?',
        'What do I need to book an appointment?',
        'Quais dados vocês precisam para marcar?',
        'O que eu preciso para agendar?',
        'De quoi avez-vous besoin pour le rendez-vous ?',
    ])('«%s» asks what the business needs', (text) => {
        expect(isRequirementsQuestion(text)).toBe(true);
    });

    it.each([
        'Quiero una cita, ¿qué datos necesitan?',
        'Quiero agendar una cita',
        'Necesito una cita para el sábado',
        '¿Tienen disponibilidad para el sábado?',
        '¿Qué servicios tienen?',
        'Mis datos son Ana Pérez, ana@x.com',
        'I want to book, what do you need from me?',
    ])('«%s» is not only a requirements question', (text) => {
        expect(isRequirementsQuestion(text)).toBe(false);
    });

    it('a day or hour the interpreter read keeps the message with the engine', () => {
        expect(isRequirementsQuestion('¿Qué datos necesitan para darme cita el sábado?', { dateMentioned: '2026-11-07' })).toBe(false);
        expect(isRequirementsQuestion('¿Qué datos necesitan para la cita de las 10?', { timeMentioned: '10:00' })).toBe(false);
    });
});

describe('requirements question with no open mission (E2v P08-4)', () => {
    const run = async (text: string, intent: Record<string, unknown>, state: BookingState = { step: 'idle' }) => {
        const execute = jest.fn(async (_s: string, _t: string, _c: string, tool: string) => (tool === 'list_services' ? { services } : { available: false, slots: [] }));
        const engine = new BookingEngineService(
            { $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any,
            { get: async () => JSON.stringify(services), set: async () => {} } as any,
            { execute } as any,
        );
        const result = await engine.process('schema', 'tenant', 'contact', intent as any, text, state, {}, '2026-11-05', 'es', { authority, conversationId: 'c' });
        return { result, execute };
    };

    it('goes to the model instead of listing the services', async () => {
        const { result, execute } = await run('¿Qué datos necesitan para darme cita?', { intent: 'select_service' });
        expect(result.handled).toBe(false);
        expect(result.text).toBeUndefined();
        expect(result.state.step).toBe('idle');
        expect(execute).not.toHaveBeenCalled();
    });

    it('also when the turn was routed to booking by the mission selector', async () => {
        const execute = jest.fn();
        const engine = new BookingEngineService({} as any, { get: async () => JSON.stringify(services), set: async () => {} } as any, { execute } as any);
        const result = await engine.process('schema', 'tenant', 'contact', { intent: 'unknown' } as any,
            '¿Qué datos necesitan para darme cita?', { step: 'idle' }, {}, '2026-11-05', 'es',
            { authority, conversationId: 'c', startSelected: true });
        expect(result.handled).toBe(false);
    });

    it('a real request still enters the engine', async () => {
        const { result } = await run('Quiero una cita, ¿qué datos necesitan?', { intent: 'select_service' });
        expect(result.handled).toBe(true);
        expect(result.state.step).toBe('show_services');
    });

    it('with a draft open the engine keeps its step (only the idle state yields)', async () => {
        const draft: BookingState = { step: 'ask_date', serviceId: 'a', serviceName: 'Consulta general', services };
        const { result } = await run('¿Qué datos necesitan para darme cita?', { intent: 'general_question' }, draft);
        expect(result.state.serviceId).toBe('a');
        expect(result.state.step).toBe('ask_date');
    });
});
