import {
    buildUnverifiedPriceReply,
    enforceVerifiedPriceReply,
    ResponseValidatorService,
} from './response-validator.service';

describe('ResponseValidatorService', () => {
    const service = new ResponseValidatorService();

    /**
     * El caso real del 19-ago: el guardrail descartó la respuesta que confirmaba
     * una reserva por "precio inventado" — y el precio venía de nuestro backend.
     *
     * El directivo de una operación ya ejecutada lleva los importes como texto
     * plano (`- nightPrice: 180000`), y el validador sólo reconoce los que están
     * dentro de regiones `<...>` / `{...}` o con la clave entrecomillada. Era
     * estructuralmente imposible aprobarlo, así que la respuesta correcta se
     * tiraba y el fail-closed terminaba contándole la reserva al huésped sin su
     * precio. Se arregla metiendo al corpus el RESULTADO de la herramienta, que
     * es la fuente de verdad del importe.
     */
    const DIRECTIVO = [
        'Operación ejecutada: create_property_booking',
        '- id: 8250c251-67f1-4bc2-b42f-f0ecbac76cc2',
        '- nightPrice: 180000',
        '- totalPrice: 1080000',
        '- currency: COP',
    ].join('\n');

    const RESULTADO_TOOL = JSON.stringify([{
        name: 'create_property_booking',
        result: {
            success: true,
            booking: {
                id: '8250c251-67f1-4bc2-b42f-f0ecbac76cc2',
                nights: 6, nightPrice: 180000, cleaningFee: 0,
                totalPrice: 1080000, currency: 'COP', status: 'confirmed',
            },
        },
    }]);

    const RESPUESTA = '¡Listo! Tu reserva quedó confirmada: 6 noches a $180.000 por noche, total $1.080.000 COP.';

    it('el directivo por sí solo NO alcanza — así se rompía', () => {
        const result = service.validatePrices(RESPUESTA, DIRECTIVO);

        // Se documenta el límite real del validador en vez de fingir que no existe:
        // el formato del directivo no es parseable, y por eso el arreglo va en el corpus.
        expect(result.ok).toBe(false);
        expect(result.hallucinatedPrices).toContain(180000);
    });

    it('con el resultado de la herramienta en el corpus, el precio real se aprueba', () => {
        const result = service.validatePrices(RESPUESTA, `${DIRECTIVO}\n${RESULTADO_TOOL}`);

        expect(result).toEqual({ ok: true, hallucinatedPrices: [] });
    });

    it('y sigue atrapando un precio que ninguna herramienta devolvió', () => {
        const inventado = 'Te lo dejo en $95.000 la noche.';

        const result = service.validatePrices(inventado, `${DIRECTIVO}\n${RESULTADO_TOOL}`);

        expect(result.ok).toBe(false);
        expect(result.hallucinatedPrices).toContain(95000);
    });

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
