import { auditTurnClaim, claimsCompletedAction, toolResultSucceeded } from './outcome-claim.util';

describe('claimsCompletedAction', () => {
    it('reconoce la frase exacta que le dijo al cliente que tenía una reserva inexistente', () => {
        // Literal de producción: el guard había devuelto "no se ejecutó nada".
        expect(claimsCompletedAction('¡Tu reserva está confirmada! 🎉 Aquí el detalle...')).toBe(true);
    });

    it('reconoce el hecho consumado en los cuatro idiomas', () => {
        for (const reply of [
            'Listo, quedó reservado para el 18 de agosto',
            'Ya está pagado, te llega el comprobante',
            'Your booking has been confirmed for two nights',
            'The payment was paid successfully',
            'Sua reserva está confirmada',
            'Votre reservation est confirmee',
        ]) {
            expect(claimsCompletedAction(reply)).toBe(true);
        }
    });

    it('no confunde una propuesta ni una pregunta con un hecho', () => {
        // Estas son exactamente las frases sanas del mismo flujo. Si el detector
        // se dispara acá, se vuelve ruido y nadie lo mira.
        for (const reply of [
            '¿Confirmas que deseas realizar esta reserva?',
            'Puedo reservarte el apartamento para esas fechas',
            'Ahora voy a generar el enlace de pago',
            'Necesito tu confirmación explícita para proceder con la reserva',
            'Would you like me to book it for you?',
            'Tenemos disponibilidad para 2 personas',
        ]) {
            expect(claimsCompletedAction(reply)).toBe(false);
        }
    });
});

describe('toolResultSucceeded', () => {
    it('no toma por éxito un resultado que pide confirmación o falla', () => {
        expect(toolResultSucceeded({ error: 'confirmation_required' })).toBe(false);
        expect(toolResultSucceeded({ success: false })).toBe(false);
        expect(toolResultSucceeded(null)).toBe(false);
        expect(toolResultSucceeded({ success: true, bookingId: 'bk-1' })).toBe(true);
    });
});

describe('auditTurnClaim', () => {
    it('marca el turno donde el agente anunció una reserva que el guard había frenado', () => {
        const audit = auditTurnClaim(
            '¡Tu reserva está confirmada! 🎉',
            [{ name: 'create_property_booking', result: { error: 'confirmation_required' } }],
        );
        expect(audit).toEqual({ claimed: true, backed: false, falseClaim: true });
    });

    it('no marca nada cuando la reserva sí se creó', () => {
        const audit = auditTurnClaim(
            '¡Tu reserva está confirmada! 🎉',
            [{ name: 'create_property_booking', result: { success: true, bookingId: 'bk-1' } }],
        );
        expect(audit.falseClaim).toBe(false);
    });

    it('una consulta exitosa no respalda un hecho consumado', () => {
        // Consultar disponibilidad no reserva nada. Contar cualquier tool como
        // respaldo dejaría pasar justo el caso que importa.
        const audit = auditTurnClaim(
            'Listo, quedó reservado',
            [{ name: 'check_property_availability', result: { available: true } }],
        );
        expect(audit.falseClaim).toBe(true);
    });

    it('un turno sin ninguna herramienta que afirma un hecho es una invención', () => {
        // El turno real del log: el modelo respondió sin llamar a nada.
        expect(auditTurnClaim('Tu reserva está confirmada', []).falseClaim).toBe(true);
        expect(auditTurnClaim('Tu reserva está confirmada', undefined).falseClaim).toBe(true);
    });
});
