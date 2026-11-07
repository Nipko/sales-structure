import { answerToOffer, bookingActKind, isConditionalSi, isInformationalDetour, isPushingToBook } from './informational-detour';

/**
 * E2w C10 (salon, dental): «Si pido 3 de X, ¿cuánto sería en total?» se leía como un «sí»: la misión tentativa se volvía
 * real y el motor contestaba «Perfecto, agendaremos X» sin dar el total.
 */
describe('E2w C10: conditional «si» is not a yes', () => {
    it.each([
        'Si pido 3 de Manicure y pedicure, ¿cuánto sería en total?',
        'Si pido 3 de Consulta general, ¿cuánto sería en total?',
        'si llevo dos cortes cuanto me sale',
        'Si vamos 4 personas, ¿qué precio tiene?',
    ])('%s opens with a conditional', text => {
        expect(isConditionalSi(text)).toBe(true);
        expect(bookingActKind(text, {}, undefined, { tentative: true })).not.toBe('act');
        expect(isPushingToBook(text, {})).toBe(false);
        expect(answerToOffer(text, {})).not.toBe('yes');
    });

    it('the total question is an informational detour', () => {
        expect(isInformationalDetour('Si pido 3 de Manicure y pedicure, ¿cuánto sería en total?')).toBe(true);
    });

    it.each([
        'sí',
        'si',
        'Sí, ¿cuánto cuesta?',
        'si, a qué hora abren',
        'si por favor',
        'si quiero el de las 10',
        'si el de las 3',
        'sí pido la cita para mañana',
    ])('%s is still a yes (or not a conditional)', text => {
        expect(isConditionalSi(text)).toBe(false);
    });

    it('a plain yes still makes the tentative mission real', () => {
        expect(bookingActKind('si', {}, undefined, { tentative: true })).toBe('act');
        expect(answerToOffer('si por favor', {})).toBe('yes');
    });
});
