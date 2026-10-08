import { promisesActionWithoutTool } from './outcome-claim.util';

/**
 * `promisesActionWithoutTool` replaces a reply with the engine's text (or a fixed one) when no tool ran, so it has to
 * stay narrow: only «the booking work is under way» or «I will tell you when it is done».
 */
describe('promisesActionWithoutTool', () => {
    it.each([
        'Estoy gestionando la confirmación de su cita del 5 de enero a las 16:00. Le avisaré en cuanto esté lista.',
        'Estoy gestionando la confirmación… Te avisaré.',
        'Le aviso apenas quede registrada.',
        'Estoy procesando su reserva.',
        'Estoy agendando su cita, un momento.',
        "I'm processing your booking. I'll let you know as soon as it is done.",
        'I will notify you once it is confirmed.',
        'Estou processando o seu agendamento. Vou avisar quando estiver pronto.',
        'Je suis en train de confirmer votre rendez-vous. Je vous préviendrai.',
    ])('catches: %s', text => {
        expect(promisesActionWithoutTool(text)).toBe(true);
    });

    it.each([
        'Su cita de Corte y estilo es el 5 de enero a las 16:00. ¿La confirmo?',
        '¿Confirmo la cita? Responda sí o no.',
        'Atendemos de lunes a viernes de 9 a 18.',
        'Puede avisarnos si necesita cambiarla.',
        'Let me know if you need anything else.',
        // information, not a promise of work
        'Le aviso que abrimos a las 9:00.',
        'Te aviso que no tenemos stock de ese color.',
        'Les aviso: mañana cerramos temprano.',
        'Le informaré que el horario es de 9 a 6.',
        'Le avisaremos por correo cuando su pedido se envíe.',
        'Le notificaremos cuando el pago se acredite.',
        'Estoy confirmando que tenemos disponibilidad el sábado a las 9:00. ¿Le sirve?',
        'Estoy revisando la agenda: hay cupo a las 10:00.',
        'Te escribiré los pasos a continuación: 1) abra la app 2) pulse reservar.',
        "I'll let you know the price is 50 USD.",
        "I'm confirming we have it in stock.",
        'Vou te avisar que o horário é das 9 às 18.',
        'Una vez que se confirme el pago le aviso por este medio.',
        'Recibirá un correo de confirmación.',
        'Le llegará un recordatorio un día antes.',
        'Preavisaremos a todos los clientes.',
    ])('leaves alone: %s', text => {
        expect(promisesActionWithoutTool(text)).toBe(false);
    });
});
