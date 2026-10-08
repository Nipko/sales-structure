import { claimsCompletedAction } from './outcome-claim.util';

/**
 * A reply that states the booking outcome in any wording must be caught when no booking tool ran. Production-adjacent:
 * «¡Cita confirmada!» (a headline, no verb) at the confirmation re-ask went out untouched.
 */
describe('claimsCompletedAction: the booking outcome in any wording', () => {
    it.each([
        '¡Cita confirmada! Su cita de Corte y estilo es el 5 de enero a las 16:00.',
        'Cita confirmada.',
        'Perfecto, cita agendada para el sábado.',
        'Listo, reserva confirmada.',
        'Su cita quedó agendada para el 5 de enero a las 16:00.',
        'Listo, reservé su cita de Corte y estilo para el 5 de enero.',
        'Su cita está lista, Joaquin.',
        'He reservado su cita para el lunes.',
        'Ya le agendé la cita.',
        'Appointment confirmed! See you on Monday.',
        'Great, your appointment is booked for January 5.',
        'Your booking is all set.',
        "I've booked your appointment for 4 PM.",
        'You are booked for Monday, Joaquin.',
        'O seu agendamento foi confirmado para 5 de janeiro.',
        'Agendamento confirmado!',
        'Pronto, agendei o seu horário.',
        "C'est fait, j'ai réservé votre rendez-vous pour le 5 janvier.",
        'Rendez-vous confirmé !',
        'Votre rendez-vous est confirmé pour lundi.',
    ])('claims: %s', text => {
        expect(claimsCompletedAction(text)).toBe(true);
    });

    it.each([
        '¿Confirmo la cita? Responda sí o no.',
        'Por favor confirme:\nCorte y estilo el 2027-01-05 a las 16:00\n¿Lo agendo?',
        'Su cita todavía no está confirmada: falta su respuesta.',
        'Your appointment is not confirmed yet: I am waiting for your answer.',
        'O seu agendamento ainda não está confirmado: falta a sua resposta.',
        "Votre rendez-vous n'est pas encore confirmé : j'attends votre réponse.",
        'Para dejar su cita confirmada, responda sí.',
        '¿Cita confirmada?',
        'Si desea, puedo reservar su cita.',
        '¿Desea que le reserve la cita?',
        'Si quiere que la deje agendada, dígame sí.',
        'El horario de las 16:00 ya está reservado por otra persona.',
        'He confirmado que hay cupo el sábado.',
        'Confirmamos su disponibilidad: hay cupo a las 16:00.',
        'I can book it for you. Shall I?',
        // order / ticket / payment STATUS and FAQ headlines are true without a write this turn
        'Su pedido está listo para recoger en tienda.',
        'Su orden está lista: puede pasar por ella.',
        'Su solicitud está registrada con el número 123.',
        'Su reserva está asegurada con el depósito que pagó ayer.',
        "You're all set to visit us any day from 9 to 6.",
        'Reserva confirmada: se requiere un depósito del 30% del valor.',
        'Cita confirmada: llegue 10 minutos antes.',
        'Appointment confirmed: please arrive 10 minutes early.',
        '¡Pago confirmado!',
        'Pedido confirmado.',
        'Your order is ready for pickup.',
        'Votre commande est confirmée.',
        'Seu pedido está pronto para retirada.',
        'Le aviso que abrimos a las 9:00.',
    ])('does not claim: %s', text => {
        expect(claimsCompletedAction(text)).toBe(false);
    });
});
