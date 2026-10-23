import { buildUnverifiedPriceReply, enforceVerifiedPriceReply, ResponseValidatorService } from './response-validator.service';

/**
 * Production QA (travel tenant): the persona addressed the customer as «usted» («¿Le gustaría…?») and, when the model gave
 * no verified price, the server fallback said «Puedo ayudarte a confirmarlo con el equipo» — the register switched
 * mid-conversation. The fallback now follows the turn's form of address, resolved like the transition-engine texts.
 */
describe('unverified-price fallback follows the persona form of address', () => {
    const USTED = 'No tengo un precio verificado en la información disponible. Puedo ayudarle a confirmarlo con el equipo.';
    const TU = 'No tengo un precio verificado en la información disponible. Puedo ayudarte a confirmarlo con el equipo.';
    const es = '<language>es</language>';

    it('an «usted» persona gets «ayudarle»', () => {
        expect(buildUnverifiedPriceReply(es, 'usted')).toBe(USTED);
        expect(buildUnverifiedPriceReply(`${es}<regional><address_form>usted</address_form></regional>`)).toBe(USTED);
    });

    it('a «tú» persona gets «ayudarte»; «vos» is addressed with «tú» like every server text', () => {
        expect(buildUnverifiedPriceReply(es, 'tu')).toBe(TU);
        expect(buildUnverifiedPriceReply(es, 'vos')).toBe(TU);
        expect(buildUnverifiedPriceReply(`${es}<regional>\n    <address_form>tu</address_form>\n</regional>`)).toBe(TU);
    });

    it('an unknown form of address defaults to «usted»', () => {
        expect(buildUnverifiedPriceReply(es)).toBe(USTED);
        expect(buildUnverifiedPriceReply(es, undefined)).toBe(USTED);
        expect(buildUnverifiedPriceReply(es, 'formal-ish')).toBe(USTED);
        expect(buildUnverifiedPriceReply('')).toBe(USTED);
    });

    it('the explicit turn form wins over the prompt tag', () => {
        expect(buildUnverifiedPriceReply(`${es}<address_form>tu</address_form>`, 'usted')).toBe(USTED);
    });

    it.each([
        ['en', 'I do not have a verified price in the available information. I can help you confirm it with the team.'],
        ['pt', 'Não tenho um preço verificado nas informações disponíveis. Posso ajudar a confirmá-lo com a equipe.'],
        ['fr', 'Je ne dispose pas d’un prix vérifié dans les informations disponibles. Je peux vous aider à le confirmer auprès de l’équipe.'],
    ])('%s keeps its single register whatever the form', (language, expected) => {
        for (const form of ['tu', 'usted', undefined]) {
            expect(buildUnverifiedPriceReply(`<language>${language}</language>`, form)).toBe(expected);
        }
    });

    it('the fail-closed boundary after the corrective pass uses the same form', () => {
        const service = new ResponseValidatorService();
        const prompt = `${es}<service price="10" currency="USD">Consulta</service>`;
        expect(enforceVerifiedPriceReply('Cuesta 20 USD.', prompt, prompt, service, undefined, 'tu').reply).toBe(TU);
        expect(enforceVerifiedPriceReply('Cuesta 20 USD.', prompt, prompt, service).reply).toBe(USTED);
    });
});
