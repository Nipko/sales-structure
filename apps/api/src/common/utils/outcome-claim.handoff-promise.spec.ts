import { offersHumanHandoff, promisesHumanHandoff, removeHandoffPromiseSentences } from './outcome-claim.util';

/**
 * Caso real de producción (2-sep-2026, tenant Amazon Minimalist).
 *
 * El agente ofreció transferir, el cliente dijo "Si" —que para `shouldHandoff`
 * es una confirmación y no un pedido de humano—, y el agente respondió que lo
 * pasaba con el equipo. La conversación quedó en 'active': sin evento, sin
 * correo, sin push. El cliente esperó a alguien que nunca fue notificado.
 */
describe('promisesHumanHandoff', () => {
    it('detecta la promesa exacta que se perdió en producción', () => {
        expect(promisesHumanHandoff(
            'Le paso con nuestro equipo especializado para grupos grandes. Por favor, espere un momento.',
        )).toBe(true);
    });

    // Escalar acá es el error BARATO: al cliente ya se le dijo que hay un equipo
    // detrás. Que el humano llegue un turno antes es mejor que no llegar nunca,
    // y `isInHandoff` impide que se re-escale en los turnos siguientes.
    it('escala también cuando la oferta y la pregunta viajan en el mismo mensaje', () => {
        expect(promisesHumanHandoff(
            'Para grupos mayores a 10 personas, le conecto con nuestro equipo especializado '
            + 'para ofrecerle la mejor atención. ¿Desea que le transfiera ahora?',
        )).toBe(true);
    });

    it.each([
        ['una pregunta sola no es una promesa', '¿Desea que le transfiera con un asesor?'],
        ['ofrecer ayuda no es transferir', 'Puedo ayudarte a reservar ahora mismo.'],
        ['mencionar al equipo no es transferir', 'Nuestro equipo de ventas tiene los mejores precios del mercado.'],
        ['hablar de un humano sin transferencia', 'Soy un asistente virtual, no una persona real.'],
        ['vacío', ''],
    ])('no escala: %s', (_label, text) => {
        expect(promisesHumanHandoff(text)).toBe(false);
    });

    it.each([
        ['es · asesor', 'Lo transfiero con un asesor en este momento.'],
        ['es · futuro', 'Un asesor se comunicará con usted en breve.'],
        ['es · voy a', 'Voy a transferir tu caso a un especialista.'],
        ['en', "I'll connect you with a human agent right away."],
        ['en · futuro', 'One of our advisors will contact you shortly.'],
        ['pt', 'Vou transferir você para um atendente agora.'],
        ['fr', 'Je vous mets en relation avec un conseiller.'],
    ])('escala en %s', (_label, text) => {
        expect(promisesHumanHandoff(text)).toBe(true);
    });

    it('tolera entradas que no son texto', () => {
        expect(promisesHumanHandoff(null)).toBe(false);
        expect(promisesHumanHandoff(undefined)).toBe(false);
        expect(promisesHumanHandoff(42)).toBe(false);
    });
});

/**
 * Regresion 5-oct (C26): "Si quiere, le paso con alguien del equipo..." es una
 * OFERTA condicional, no una promesa. Leerla como promesa escalaba la
 * conversacion a waiting_human y el bot dejaba de contestar.
 */
describe('promisesHumanHandoff — conditional offers are not promises', () => {
    it.each([
        ['es · C26 literal', 'Le cuento: los servicios y horarios los maneja el salón según su agenda. Si quiere, le paso con alguien del equipo para que se la confirme.'],
        ['es · si desea', 'Si desea, le paso con un asesor para que se lo confirme.'],
        ['es · si gusta', 'Si gusta, le conecto con nuestro equipo.'],
        ['es · si prefiere', 'Si prefiere, lo transfiero con un asesor.'],
        ['es · si lo desea', 'Lo transfiero con un asesor si lo desea.'],
        ['en · if you\'d like', "If you'd like, I'll connect you with a human agent."],
        ['en · if you want', 'I can transfer you to our team if you want.'],
        ['en · if you prefer', 'If you prefer, I will transfer you to an advisor.'],
        ['pt · se quiser', 'Se quiser, vou te transferir para um atendente.'],
        ['pt · se preferir', 'Vou te passar para um atendente, se preferir.'],
        ['fr · si vous voulez', 'Si vous voulez, je vous mets en relation avec un conseiller.'],
        ['fr · si vous le souhaitez', 'Je vous passe à un conseiller si vous le souhaitez.'],
        ['es · pregunta', '¿Quiere que le paso con alguien del equipo?'],
        ['en · question', 'Would you like me to connect you with a human agent?'],
    ])('%s', (_label, text) => {
        expect(promisesHumanHandoff(text)).toBe(false);
    });

    it('sigue contando la promesa incondicional que escribio el bot en I09', () => {
        expect(promisesHumanHandoff(
            'Con gusto le ayudo con esa búsqueda en Chapinero. Sin embargo, en este momento no puedo consultar el catálogo '
            + 'de propiedades para mostrarle opciones.\n\nLe paso con nuestro equipo para que le compartan los apartamentos '
            + 'disponibles en Chapinero dentro de su presupuesto.',
        )).toBe(true);
    });

    it('una oferta condicional no tapa una promesa incondicional en otra oracion', () => {
        expect(promisesHumanHandoff('Si quiere, le explico más. Le paso con nuestro equipo ahora mismo.')).toBe(true);
    });
});

describe('offersHumanHandoff — what a later "sí" answers', () => {
    it.each([
        'Si quiere, le paso con alguien del equipo para que se la confirme.',
        '¿Le gustaría que alguien del equipo lo contacte?',
        "If you'd like, I'll connect you with a human agent.",
        'Would you like me to connect you with our team?',
        'Se quiser, vou te transferir para um atendente.',
    ])('es una oferta: %s', text => {
        expect(offersHumanHandoff(text)).toBe(true);
    });

    it.each([
        'Abrimos de 9 a 18.',
        '¿Qué día le conviene?',
        '',
        null,
    ])('no es una oferta: %s', text => {
        expect(offersHumanHandoff(text)).toBe(false);
    });
});

describe('offersHumanHandoff names a PERSON, not any "team" word (H8)', () => {
    it.each([
        '¿Quieres el kit del equipo de fútbol?',
        '¿Desea agendar con el especialista?',
        '¿Le gustaría ver el plan del equipo de ventas?',
        'Would you like the team jersey?',
        '¿Prefiere el agente de viajes que ya conoce, o uno nuevo?',
    ])('no es una oferta de traspaso: %s', text => {
        expect(offersHumanHandoff(text)).toBe(false);
    });
    it.each([
        '¿Quieres que le pida a una persona del equipo que lo confirme?',
        '¿Le gustaría que alguien del equipo lo contacte?',
        '¿Desea que lo comunique con un asesor?',
        'Would you like me to ask someone from the team?',
        'Would you like to talk to a human agent?',
        '¿Quiere que lo conecte con nuestro equipo?',
        'Would you like me to connect you with our team?',
        'Quer que eu peça a alguém da equipe? Posso chamar um atendente.',
        'Souhaitez-vous que je demande à quelqu\'un de l\'équipe ?',
    ])('sí es una oferta de traspaso: %s', text => {
        expect(offersHumanHandoff(text)).toBe(true);
    });
});

describe('removeHandoffPromiseSentences keeps the correct information (H7)', () => {
    it('I09: drops only the promise sentence', () => {
        const kept = removeHandoffPromiseSentences(
            'Con gusto le ayudo con esa búsqueda en Chapinero. Sin embargo, en este momento no puedo consultar el catálogo de propiedades.\n\n'
            + 'Le paso con nuestro equipo para que le compartan los apartamentos disponibles.');
        expect(kept).toBe('Con gusto le ayudo con esa búsqueda en Chapinero. Sin embargo, en este momento no puedo consultar el catálogo de propiedades.');
    });
    it('keeps a conditional offer and a question (they are not promises)', () => {
        const text = 'Abrimos de 9 a 18. Si quiere, le paso con alguien del equipo. ¿Le agendo?';
        expect(removeHandoffPromiseSentences(text)).toBe('Abrimos de 9 a 18. Si quiere, le paso con alguien del equipo. ¿Le agendo?');
    });
    it('a reply that is only the promise leaves nothing', () => {
        expect(removeHandoffPromiseSentences('Le paso con nuestro equipo especializado, espere un momento.')).toBe('');
    });
});
