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
    ])('leaves %s to the booking flow', text => {
        expect(isInformationalDetour(text)).toBe(false);
    });
});
