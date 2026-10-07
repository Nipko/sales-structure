import { authorizesEffect, normalizeCustomerIntent } from './intent-normalizer';

/**
 * Production 2026-10-08: at the confirmation of a booking, «sí, confírmala», «si, agéndala», «dale, agéndala» were not
 * read as consent (only the bare «sí» was), so the customer was shown the same summary again and the model, with no
 * tool that turn, improvised «estoy gestionando la confirmación». An affirmative followed by the verb that carries
 * out the very thing being asked IS the whole consent.
 */
const consents = (text: string, country = 'CO') =>
    authorizesEffect(normalizeCustomerIntent(text, { country, answeringExplicitQuestion: true }), 'transactional', { answeringExplicitQuestion: true });

describe('an affirmative plus the verb that carries it out is consent', () => {
    it.each([
        'sí', 'sí por favor', 'dale',
        'sí, confírmala', 'Sí, confírmala.', 'si, confírmala', 'sí, confírmalo', 'sí, confírmela', 'sí, confírmelo', 'sí confirma',
        'si, agéndala', 'si, agendala', 'sí, agéndala', 'sí, agéndela', 'dale, agéndala', 'dale agéndala', 'sí, agéndala por favor',
        'sí, resérvala', 'sí, resérvela', 'dale, resérvala', 'sí, hazla', 'sí, hágala', 'claro, márcala', 'ok, agéndala', 'listo, confírmala',
        'yes, book it', 'yes, confirm it', 'yes, go ahead and book', 'yes please go ahead', 'sure, schedule it', 'yes confirm',
        'sim, pode marcar', 'sim, pode agendar', 'sim, pode confirmar', 'sim, confirma', 'sim, marca',
        'oui, réservez', 'oui, confirmez', 'oui, allez-y', 'oui, réservez-la'.replace('-la', ' la'), 'oui, confirmez la',
    ])('"%s"', text => {
        expect(consents(text)).toBe(true);
    });

    it.each([
        'sí, pero mañana', 'sí, pero a las 5', 'sí, confírmala pero mañana', 'no, confírmala después', 'no confírmala', 'no, agéndala',
        'sí? cuánto cuesta', 'sí, ¿cuánto cuesta?', 'sí, confírmala mañana', 'sí, agéndala el sábado', 'sí, agéndala si hay descuento',
        'sí, confírmala cuando pague', 'dale si me confirmas el precio', 'confírmala', 'agéndala',
        'yes, but tomorrow', 'no, book it later', 'yes, book it tomorrow', 'sim, mas amanhã', 'não, pode marcar depois', 'oui, mais demain',
        'gracias', 'hola', 'mejor cámbiala a color y tratamiento', 'sí, cámbiala a color y tratamiento',
    ])('"%s" is NOT consent', text => {
        expect(consents(text)).toBe(false);
    });

    it('the verb makes the affirmative explicit (high confidence), so it also covers a stricter effect than a bare ok', () => {
        const intent = normalizeCustomerIntent('sí, confírmala', { country: 'CO', answeringExplicitQuestion: true });
        expect(intent).toMatchObject({ intent: 'affirm', confidence: 'high', consentEligible: true });
    });
});
