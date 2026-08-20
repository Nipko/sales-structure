import { readFileSync } from 'fs';
import { resolve } from 'path';
import { auditTurnClaim } from '../../common/utils/outcome-claim.util';

/**
 * El guardrail tapó una reserva que existía.
 *
 * En producción, el 19-ago, el huésped preguntó por su reserva del 1 al 5 de
 * diciembre —creada por el agente y **confirmada** en la base—, el modelo
 * respondió la verdad, y la auditoría de reclamos la marcó como falsa y la
 * reescribió. Tres turnos seguidos. Desde afuera parecía que el agente no sabía
 * reservar; en realidad nosotros le borrábamos la respuesta correcta.
 *
 * La causa es una interacción entre dos arreglos del mismo día: se hizo que
 * `<recent_actions>` por fin llegara al prompt —así que el modelo PUEDE hablar
 * de lo que hizo dos turnos atrás— sin enseñarle lo mismo al guardrail, que
 * seguía mirando sólo las herramientas del turno actual.
 */

const CLAIM = 'Tu reserva en Amazon Minimalist del 1 al 5 de diciembre está confirmada.';

describe('un "ya quedó hecho" se respalda con lo de este turno y con los anteriores', () => {
    it('sin nada que lo respalde, sigue siendo una mentira', () => {
        expect(auditTurnClaim(CLAIM, []).falseClaim).toBe(true);
    });

    it('una escritura de un turno ANTERIOR lo respalda', () => {
        // Es el caso real: la reserva se creó antes y el huésped vuelve a preguntar.
        const backing = [{ name: 'create_property_booking', result: { success: true, awaitingPayment: false } }];

        expect(auditTurnClaim(CLAIM, backing).falseClaim).toBe(false);
    });

    it('pero una operación pendiente de pago no lo respalda ni tres turnos después', () => {
        const backing = [{ name: 'create_property_booking', result: { success: true, awaitingPayment: true } }];

        expect(auditTurnClaim(CLAIM, backing).falseClaim).toBe(true);
    });

    it('una lectura anterior tampoco lo respalda', () => {
        // Haber listado propiedades no es haber reservado.
        const backing = [{ name: 'list_properties', result: { success: true } }];

        expect(auditTurnClaim(CLAIM, backing).falseClaim).toBe(true);
    });
});

describe('el cableado que lo hace posible', () => {
    const SRC = readFileSync(resolve(__dirname, 'conversations.service.ts'), 'utf8');

    it('el guardrail audita el respaldo combinado, no sólo el turno', () => {
        // Si alguien vuelve a pasarle `executedTools` directo, el agente deja de
        // poder confirmar una reserva en cualquier turno posterior al que la creó
        // — que son casi todos.
        expect(SRC).toContain('const backing = this.backingEvidence(executedTools, priorActions)');
        expect(SRC).toContain('auditTurnClaim(response, backing');
        expect(SRC).not.toContain('auditTurnClaim(response, executedTools');
    });

    it('el matiz de pendiente de pago se persiste entre turnos', () => {
        // Sin esto, una reserva impaga respaldaría un "confirmada" al turno
        // siguiente: justo lo que la política de pago existe para evitar.
        expect(SRC).toContain('awaiting:');
        expect(SRC).toContain('awaitingPayment: a.awaiting === true');
    });
});
