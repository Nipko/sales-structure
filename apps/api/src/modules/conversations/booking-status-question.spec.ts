import { isBookingStatusQuestion } from './booking-status-question';

describe('isBookingStatusQuestion', () => {
    it.each([
        '¿En qué quedó mi cita?', 'en que quedo mi cita', '¿ya está?', '¿quedó?', 'ya quedó?', 'y mi cita? ya quedó?', '¿Cómo va mi reserva?',
        '¿Qué pasó con mi cita?', '¿Ya me agendaste?', '¿Está confirmada mi cita?', '¿Alguna novedad?',
        'What happened with my booking?', 'Is it booked?', 'Any news?', 'Já ficou agendado?', "C'est bon ?",
    ])('"%s" is a status question', text => {
        expect(isBookingStatusQuestion(text)).toBe(true);
    });

    it.each([
        'sí', 'sí, confírmala', 'ya está', 'ok', 'me quedo con las 5', '¿me quedo con las 5?', '¿cuánto cuesta?', '¿a qué hora abren?',
        '¿en qué quedó el precio de mi cita?', '¿ya está abierto?', '¿cómo va el clima?', '¿qué pasó con mi pedido?', '¿ya está todo?', 'is it open?', '¿qué pasó con mi pago?', '¿ya quedó mi cita y cuánto cuesta?', 'what happened with my booking, how much is it?', '¿quedó pago?', 'quiero cambiar la hora', '¿tienen estacionamiento?', '',
        'Quedó muy bien el corte que me hicieron la última vez y quisiera saber si puedo repetirlo con el mismo estilista de siempre',
    ])('"%s" is not', text => {
        expect(isBookingStatusQuestion(text)).toBe(false);
    });
});
