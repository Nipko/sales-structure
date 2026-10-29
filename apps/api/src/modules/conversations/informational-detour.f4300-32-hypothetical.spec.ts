import { bookingActKind, hasExplicitBookingRequest } from './informational-detour';

/**
 * F4300-32 (production QA 29-oct, dental): «How much total time is required if I schedule a general consultation immediately followed
 * by a follow-up control?» named a service and the verb «schedule», so it was a booking act and the engine answered «Consulta general
 * selected. What date works for you?». A how-long / how-much question whose booking verb is its hypothesis asks, it does not book.
 */
describe('F4300-32 · «if I schedule…» inside a how-long / how-much question is not a request to book', () => {
    it.each([
        'How much total time is required if I schedule a general consultation immediately followed by a follow-up control?',
        'How much would it cost if I book two follow-up appointments?',
        '¿Cuánto tiempo total se ocupa si agendo una consulta general seguida de un control?',
        '¿Cuánto me costaría si reservo dos controles?',
        'Quanto tempo total leva se eu marcar uma consulta geral seguida de um controle?',
        'Combien de temps faut-il si je réserve une consultation générale suivie d’un contrôle ?',
    ])('«%s» asks', text => {
        expect(hasExplicitBookingRequest(text)).toBe(false);
        expect(bookingActKind(text, { intent: 'select_service', serviceMentioned: 'Consulta general' } as any, 'idle')).toBe('none');
    });

    it.each([
        'I want to schedule a general consultation',
        'Quiero agendar una consulta general',
        'Can I book a general consultation for tomorrow? How much is it?',
        'Si, agendo la consulta general',
    ])('«%s» still books', text => {
        expect(hasExplicitBookingRequest(text)).toBe(true);
    });
});
