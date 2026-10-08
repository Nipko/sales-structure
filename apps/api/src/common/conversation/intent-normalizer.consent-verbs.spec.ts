import { authorizesEffect, classifyConfirmation, normalizeCustomerIntent } from './intent-normalizer';

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

    it('«sí» plus the verb stays a strong yes (the «sí» carries it)', () => {
        const intent = normalizeCustomerIntent('sí, confírmala', { country: 'CO', answeringExplicitQuestion: true });
        expect(intent).toMatchObject({ intent: 'affirm', confidence: 'high', consentEligible: true });
        expect(classifyConfirmation('sí, agéndala', { country: 'CO', effect: 'high_impact', answeringExplicitQuestion: true })).toBe('confirmed');
    });

    it('«vale» counts like «ok»', () => {
        expect(consents('vale, confírmala')).toBe(true);
        expect(consents('vale, agéndala')).toBe(true);
        expect(consents('vale')).toBe(consents('ok'));
    });
});

/**
 * The booking verbs make a contextual opener enough for a BOOKING summary, never for what gates payments, penalised
 * cancellations or media consent: those need an unambiguous yes («sí», «confirmo»), exactly as «ok» or «dale» alone.
 */
describe('a booking verb after a contextual opener never authorises a high-impact effect', () => {
    const highImpact = (text: string) =>
        classifyConfirmation(text, { country: 'CO', effect: 'high_impact', answeringExplicitQuestion: true });

    it.each([
        'ok, agéndala', 'listo, márcala', 'dale, resérvala', 'perfecto, hazla', 'ok, book it', 'ok, márcalo',
        'vale, confírmala', 'dale, confírmala', 'claro, agéndala',
    ])('"%s" is not a high-impact yes but still books at the summary', text => {
        expect(highImpact(text)).toBe('unclear');
        expect(consents(text)).toBe(true);
    });

    it.each(['sí', 'sí, agéndala', 'sí, confírmala', 'ok confirmo', 'dale, confirmo', 'yes, book it', 'sim, pode marcar', 'oui, réservez'])(
        '"%s" is still a high-impact yes',
        text => {
            expect(highImpact(text)).toBe('confirmed');
        },
    );
});
