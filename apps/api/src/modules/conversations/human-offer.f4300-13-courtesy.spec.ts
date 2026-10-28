import { isCourtesyClose, isOfferAcceptance } from './human-offer';

/**
 * F4300-13 (production QA 28-oct): «That's fine, thanks for checking» and «D'accord, merci» answered the offer of a person and were
 * taken as a yes: the conversation was handed off and later returned with stacked notices (F4300-23).
 */
describe('F4300-13 · thanks or «that\'s fine» after the offer of a person is no yes', () => {
    it.each([
        "That's fine, thanks for checking.", "D'accord, merci.", 'Ok, gracias', 'Vale, muchas gracias', 'Entendi, obrigado.',
        'Got it, thanks!', "It's fine, thank you", "C'est bon, merci", 'Tudo bem, obrigada', 'Está bien así, gracias', 'No hace falta',
    ])('«%s» closes the exchange', text => {
        expect(isCourtesyClose(text)).toBe(true);
        expect(isOfferAcceptance(text)).toBe(false);
    });

    it.each([
        'Sí, gracias', 'Yes please', 'Oui, merci', 'Sim, obrigado', 'ok', "d'accord", 'Sí, por favor pídalo.', 'Yes, please check with the team.',
        'dale', 'claro que sí',
    ])('«%s» still accepts', text => {
        expect(isOfferAcceptance(text)).toBe(true);
    });
});
