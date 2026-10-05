import { isInformationalDetour } from './informational-detour';

describe('isInformationalDetour', () => {
    it.each([
        '¿A qué hora abren?',
        'a qué hora abren los sábados',
        'Hola, ¿cuál es el horario de atención?',
        'Me puede decir el horario del salón, a qué hora empiezan y a qué hora terminan.',
        '¿Hasta qué hora atienden hoy?',
        "Quels sont vos horaires d'ouverture ?",
        'What are your opening hours?',
        '¿Cuánto cuesta el corte y estilo?',
        'cuanto vale el manicure',
        'How much is the haircut?',
        '¿Qué servicios ofrecen?',
        '¿Dónde están ubicados?',
        '¿Cuál es la política de cancelación?',
        '¿Qué métodos de pago aceptan?',
        'Hola cuanto cuesta el corte',
        '¿abren a las 9?',
        'cierran los domingos?',
        '¿Cuál es el horario de funcionamiento?',
        'what are your business hours',
        'no, ¿a qué hora cierran?',
        'ok pero ¿dónde quedan?',
        'quiero conocer los precios',
        'necesito la dirección',
        'quiero preguntar a qué hora abren',
        '¿Cuánto cuesta? Necesito decidir hoy',
        'me gustaría saber a qué hora abren',
        'i would like to know your opening hours',
        'Vous ouvrez à quelle heure ?',
        '¿atienden los domingos?',
        '¿a qué hora atienden?',
    ])('treats %s as a question about the business', text => {
        expect(isInformationalDetour(text)).toBe(true);
    });

    it.each([
        'el 2',
        'sí',
        'ok, dale',
        'Juan Pérez',
        'mañana a las 10:00',
        'el horario de las 10:00',
        'horario 15:30',
        'Corte y estilo',
        'cancelar mi cita',
        'Hola, quiero reservar un corte mañana. ¿Cuánto cuesta?',
        'Agéndame el sábado y dime el precio',
        'confirmo la cita',
        'mi correo es ana@example.test',
        // "horario" is the engine's word for a free slot, not for opening hours.
        '¿tienen horario para mañana?',
        '¿qué horarios tienen el viernes?',
        '¿qué horarios hay disponibles?',
        '¿hay horario el sábado?',
        '¿me puedes dar horarios para el jueves?',
        '¿qué horario me puedes dar?',
        'what hours do you have on friday?',
        '¿el horario de las 10 está libre?',
        // a booking datum travels with the question: the engine must read it
        'quiero el corte, ¿cuánto cuesta?',
        'sí, ¿y cuánto cuesta?',
        'quiero cancelar, ¿cuál es la política de cancelación?',
        // "atender" is about being served, not about opening hours
        '¿me atiende Carlos?',
        '¿me atienden mañana a las 3?',
        '¿atienden el sábado a las 10?',
        '¿quién me atiende?',
    ])('leaves %s to the booking flow', text => {
        expect(isInformationalDetour(text)).toBe(false);
    });
});

describe('isInformationalDetour with what the interpreter already extracted', () => {
    it('leaves a question that carries a date to the engine', () => {
        expect(isInformationalDetour('¿el corte cuánto cuesta? lo quiero para mañana', { dateMentioned: '2026-10-06' })).toBe(false);
        expect(isInformationalDetour('¿cuánto cuesta el corte el sábado?', { dateMentioned: '2026-10-10' })).toBe(false);
    });
    it('still answers a pure price question that names the service', () => {
        expect(isInformationalDetour('¿Cuánto cuesta el corte y estilo?', { serviceMentioned: 'Corte y estilo', dateMentioned: null })).toBe(true);
    });
    it('an opening-hours question wins over a weekday it mentions', () => {
        expect(isInformationalDetour('a qué hora abren los sábados', { dateMentioned: '2026-10-10' })).toBe(true);
    });
});

describe('isInformationalDetour with a clock time or a datum from the interpreter', () => {
    it('an hours question that carries a concrete time is an availability request', () => {
        expect(isInformationalDetour('¿abren a las 9?', { timeMentioned: '09:00' })).toBe(false);
    });
    it('an hours question without a time stays informational', () => {
        expect(isInformationalDetour('¿abren los sábados?', { timeMentioned: null })).toBe(true);
    });
});
