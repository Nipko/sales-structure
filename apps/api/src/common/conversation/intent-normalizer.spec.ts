import {
    authorizesEffect,
    classifyConfirmation,
    confirmationEffectForPolicy,
    normalizeCustomerIntent,
} from './intent-normalizer';
import { COUNTRY_LANGUAGE_PACKS } from '@parallext/shared';

/**
 * Cuatro listas de afirmación discrepaban en catorce tokens.
 *
 * La más amplia vivía en el intérprete de intención y la más angosta en el
 * guard central — el único que gobierna reservar, cobrar y cancelar. Así que
 * `listo`, el "sí" más común de Colombia, estaba en tres de ellas y NO en esa.
 * El cliente escribía `listo`, el motor de reservas llamaba al writer, y el
 * guard releía la misma palabra, devolvía `unclear` y escalaba: el cliente dijo
 * que sí y le tocó un humano.
 *
 * Ampliar el guard habría sido el error opuesto y más caro: dejaría que `listo`
 * autorice un cobro. La fuerza vive en el alias y el EFECTO decide si alcanza.
 */

describe('la fuerza vive en el alias, el efecto decide si alcanza', () => {
    it('una afirmación explícita autoriza cualquier efecto', () => {
        for (const text of ['sí', 'confirmo', 'acepto', 'autorizo', 'sim', 'oui, je confirme', 'yes']) {
            expect(classifyConfirmation(text, { effect: 'high_impact' })).toBe('confirmed');
            expect(classifyConfirmation(text, { effect: 'transactional' })).toBe('confirmed');
        }
    });

    it('un sí contextual cierra una operación pero NO autoriza dinero', () => {
        for (const text of ['dale', 'listo', 'de una', 'bueno']) {
            expect(classifyConfirmation(text, { effect: 'transactional' })).toBe('confirmed');
            expect(classifyConfirmation(text, { effect: 'high_impact' })).toBe('unclear');
        }
    });

    it('un reconocimiento solo cuenta si responde a la pregunta, y nunca para dinero', () => {
        const ok = normalizeCustomerIntent('perfecto');
        expect(ok.intent).toBe('acknowledge');
        // Un "perfecto" suelto en medio de la charla no autoriza nada.
        expect(authorizesEffect(ok, 'transactional')).toBe(false);
        // Respondiendo al desafío, es como la gente dice que sí a una cita.
        expect(authorizesEffect(ok, 'transactional', { answeringExplicitQuestion: true })).toBe(true);
        // Pero jamás a un cobro.
        expect(authorizesEffect(ok, 'high_impact', { answeringExplicitQuestion: true })).toBe(false);
    });

    it('el verbo explícito después de un abridor contextual sube la fuerza', () => {
        for (const text of ['dale, confirmo', 'ok confirmo', 'listo, autorizo']) {
            expect(classifyConfirmation(text, { effect: 'high_impact' })).toBe('confirmed');
        }
    });
});

describe('negación, condición y corrección le ganan a cualquier afirmación', () => {
    it('un sí matizado no es un sí', () => {
        for (const text of [
            'sí, pero cambiá el monto',
            'dale si me confirmás el precio',
            'listo aunque primero quiero ver otra fecha',
            'yes, but change the amount',
        ]) {
            expect(classifyConfirmation(text, { effect: 'transactional' })).not.toBe('confirmed');
        }
    });

    it('una negación se lee como negación, no como duda', () => {
        for (const text of ['no', 'no gracias', 'mejor no', 'todavía no', 'não', 'melhor não', 'je refuse']) {
            expect(classifyConfirmation(text)).toBe('rejected');
        }
    });

    it('cancelar el flujo se distingue de simplemente decir que no', () => {
        expect(normalizeCustomerIntent('cancela la reserva').intent).toBe('cancel');
        expect(normalizeCustomerIntent('deixa pra lá').intent).toBe('cancel');
        expect(normalizeCustomerIntent('no').intent).toBe('reject');
    });

    it('una corrección reabre el campo en vez de confirmarlo', () => {
        for (const text of ['quise decir el martes', 'me equivoqué, era a las 5', 'na verdade prefiro sexta']) {
            expect(normalizeCustomerIntent(text).intent).toBe('correct');
        }
    });

    it('"siempre no" es una reversión mexicana, no una afirmación', () => {
        expect(classifyConfirmation('siempre no', { country: 'MX' })).toBe('rejected');
    });
});

describe('los packs de país cambian la lectura, no el techo de seguridad', () => {
    it('una expresión nacional se reconoce con su país', () => {
        expect(normalizeCustomerIntent('hágale', { country: 'CO' }).intent).toBe('affirm');
        expect(normalizeCustomerIntent('ya po', { country: 'CL' }).intent).toBe('affirm');
        expect(normalizeCustomerIntent('bora', { country: 'BR' }).intent).toBe('affirm');
    });

    it('ninguna expresión contextual nacional autoriza dinero por sí sola', () => {
        for (const [country, text] of [
            ['CO', 'hágale'], ['CO', 'de una'], ['CL', 'ya po'], ['CL', 'ya'],
            ['MX', 'sale'], ['MX', 'ándale'], ['CR', 'pura vida'], ['CR', 'dele'],
            ['UY', 'ta'], ['VE', 'fino'], ['GT', 'cabal'], ['PE', 'ya pues'],
            ['BR', 'beleza'], ['BR', 'pode ser'], ['DO', 'ta bien'],
        ] as Array<[string, string]>) {
            expect(classifyConfirmation(text, { country, effect: 'high_impact' }))
                .not.toBe('confirmed');
        }
    });

    it('las expresiones que solo evalúan no se leen como aceptación', () => {
        expect(normalizeCustomerIntent('bárbaro', { country: 'AR' }).intent).toBe('acknowledge');
        expect(normalizeCustomerIntent('fino', { country: 'VE' }).intent).toBe('acknowledge');
        expect(normalizeCustomerIntent('pura vida', { country: 'CR' }).intent).toBe('acknowledge');
    });

    it('sin pack de país se usa la base panregional, no un fallback colombiano', () => {
        expect(normalizeCustomerIntent('hágale').intent).not.toBe('affirm');
        expect(normalizeCustomerIntent('sí').intent).toBe('affirm');
    });

    it('los 15 packs LatAm y BR existen y arrancan en draft', () => {
        for (const country of ['CO', 'MX', 'AR', 'CL', 'PE', 'BR', 'UY', 'PY', 'BO', 'EC', 'VE', 'CR', 'PA', 'DO', 'GT']) {
            expect(COUNTRY_LANGUAGE_PACKS[country]).toBeDefined();
            expect(COUNTRY_LANGUAGE_PACKS[country].status).toBe('draft');
        }
        // EE.UU. y Canadá no se resuelven por país solo.
        expect(COUNTRY_LANGUAGE_PACKS.US.status).toBe('fallback_only');
        expect(COUNTRY_LANGUAGE_PACKS.CA.status).toBe('fallback_only');
    });

    it('ningún pack promete registros prohibidos', () => {
        expect(COUNTRY_LANGUAGE_PACKS.CO.prohibitedRegisters).toEqual(
            expect.arrayContaining(['parce', 'bro']),
        );
    });
});

describe('pedir un humano y darse de baja', () => {
    it('reconoce la petición dentro de un mensaje largo', () => {
        for (const text of [
            'esto no funciona, quiero hablar con una persona',
            'necesito que me pase con un asesor por favor',
            'quero falar com um atendente',
            'je veux parler a un humain',
        ]) {
            expect(normalizeCustomerIntent(text, { maxLength: Number.MAX_SAFE_INTEGER }).intent)
                .toBe('request_human');
        }
    });

    it('el opt-out gana sobre cualquier otra lectura', () => {
        for (const text of ['no quiero recibir mensajes', 'dénme de baja', 'unsubscribe me', 'não me contate']) {
            expect(normalizeCustomerIntent(text).intent).toBe('opt_out');
        }
    });
});

describe('el efecto se deriva de la política de la tool', () => {
    it('A4, aprobación humana y escritura sensible son alto impacto', () => {
        expect(confirmationEffectForPolicy({ assurance: 'A4' })).toBe('high_impact');
        expect(confirmationEffectForPolicy({ humanApproval: 'runtime_enforced' })).toBe('high_impact');
        expect(confirmationEffectForPolicy({ effect: 'write', dataClassification: 'sensitive' }))
            .toBe('high_impact');
    });

    it('una escritura común de contacto es transaccional', () => {
        expect(confirmationEffectForPolicy({
            effect: 'write', dataClassification: 'contact', assurance: 'A1',
            humanApproval: 'not_required',
        })).toBe('transactional');
    });

    it('sin política se asume el techo más estricto', () => {
        expect(confirmationEffectForPolicy(null)).toBe('high_impact');
        expect(confirmationEffectForPolicy(undefined)).toBe('high_impact');
    });
});

describe('un mensaje largo es una conversación, no un sí', () => {
    it('no confirma un párrafo aunque empiece con una afirmación', () => {
        const long = 'sí ' + 'a'.repeat(200);
        expect(classifyConfirmation(long, { effect: 'transactional' })).toBe('unclear');
    });

    it('una entrada vacía o no textual nunca confirma', () => {
        expect(classifyConfirmation('')).toBe('unclear');
        expect(classifyConfirmation(null)).toBe('unclear');
        expect(classifyConfirmation(42 as any)).toBe('unclear');
    });
});
