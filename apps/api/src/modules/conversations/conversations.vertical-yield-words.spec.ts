import { ConversationsService } from './conversations.service';

/**
 * «Quiero reservar apartment en Spark QA Ciudad»: la ficha nombra el inmueble con su tipo en inglés, y el motor de citas
 * se quedaba con el turno y respondía la lista de servicios (visita, asesoría, avalúo) en vez de dejar que el agente
 * atendiera la reserva del inmueble con sus herramientas o lo pasara a una persona.
 */
describe('real estate: the booking engine yields when the customer names a property', () => {
    const service: any = Object.create(ConversationsService.prototype);
    const config = { tools: { realEstate: { enabled: true } } };
    const yields = (text: string, services: Array<{ name: string }> = []) =>
        service.shouldYieldToVerticalTools(config, text, { step: 'idle', services });

    it.each([
        'Quiero reservar apartment en Spark QA Ciudad',
        'I want to book the apartment downtown',
        'Quiero apartar la oficina del centro',
        'Je veux réserver l’appartement',
    ])('yields for «%s»', text => {
        expect(yields(text)).toBe(true);
    });

    it('keeps the engine when the message names a seeded service, or nothing of the vertical', () => {
        expect(yields('Quiero agendar una visita guiada al apartamento', [{ name: 'Visita guiada' }])).toBe(false);
        expect(yields('Quiero agendar una cita')).toBe(false);
    });

    it('keeps the engine when the agent has no real estate tool', () => {
        expect(service.shouldYieldToVerticalTools({ tools: {} }, 'Quiero reservar apartment en Spark QA Ciudad', { step: 'idle' })).toBe(false);
    });
});
