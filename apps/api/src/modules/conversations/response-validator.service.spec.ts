import {
    buildUnverifiedPriceReply,
    enforceVerifiedPriceReply,
    ResponseValidatorService,
} from './response-validator.service';

describe('ResponseValidatorService', () => {
    const service = new ResponseValidatorService();

    it('does not authorize a price from an unrelated rule number', () => {
        const result = service.validatePrices('El precio es $15.', 'Reglas universales 1 a 15. Disponible 24/7.');

        expect(result).toEqual({ ok: false, hallucinatedPrices: [15] });
    });

    it('accepts a price encoded by the structured turn context', () => {
        const result = service.validatePrices(
            'La consulta cuesta 50.000 COP.',
            '<service id="s1" price="50000" currency="COP">Consulta</service>',
        );

        expect(result).toEqual({ ok: true, hallucinatedPrices: [] });
    });

    it('accepts a price supplied by a JSON tool result', () => {
        const result = service.validatePrices(
            'The total is 49 USD.',
            '{"name":"Starter","price":49,"currency":"USD"}',
        );

        expect(result).toEqual({ ok: true, hallucinatedPrices: [] });
    });

    it('rejects a currency mismatch when both currencies are explicit', () => {
        const result = service.validatePrices(
            'The total is 49 EUR.',
            '<product price="49" currency="USD">Plan</product>',
        );

        expect(result).toEqual({ ok: false, hallucinatedPrices: [49] });
    });

    it('allows the assistant to repeat a price explicitly provided by the customer', () => {
        const result = service.validatePrices('Sí, mencionaste $1.200.', 'Cliente: Mi presupuesto es $1.200.');

        expect(result).toEqual({ ok: true, hallucinatedPrices: [] });
    });

    it.each([
        ['<language>es</language>', 'No tengo un precio verificado'],
        ['<language>en</language>', 'I do not have a verified price'],
        ['<language>pt</language>', 'Não tenho um preço verificado'],
        ['<language>fr</language>', 'Je ne dispose pas d’un prix vérifié'],
    ])('builds a deterministic localized fail-closed reply for %s', (prompt, expected) => {
        expect(buildUnverifiedPriceReply(prompt)).toContain(expected);
    });

    it('fails closed after a corrective pass that still contains an unsupported price', () => {
        const prompt = '<language>en</language><service price="10" currency="USD">Consultation</service>';

        const result = enforceVerifiedPriceReply('Actually, it costs 20 USD.', prompt, prompt, service);

        expect(result.blocked).toBe(true);
        expect(result.validation.hallucinatedPrices).toEqual([20]);
        expect(result.reply).toContain('I do not have a verified price');
    });

    it('allows a corrected price only when it is present in the source corpus', () => {
        const prompt = '<language>en</language><service price="10" currency="USD">Consultation</service>';

        const result = enforceVerifiedPriceReply('The verified price is 10 USD.', prompt, prompt, service);

        expect(result).toEqual({
            reply: 'The verified price is 10 USD.',
            validation: { ok: true, hallucinatedPrices: [] },
            blocked: false,
        });
    });
});
