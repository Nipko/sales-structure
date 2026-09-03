import { promisesHumanHandoff } from './outcome-claim.util';

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
