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

    it('reconoce como respaldo a los escritores que no empiezan por un verbo conocido', () => {
        // El prefijo `^(create|cancel|…)_` dejaba fuera a place_order,
        // book_class, enroll_student, register_pet, file_claim y apply_discount:
        // es decir, la forma en que cierran la venta casi todas las verticales.
        // Una venta real quedaba auditada como mentira y se reescribía diciéndole
        // al cliente que faltaba confirmar algo que ya estaba hecho.
        for (const name of [
            'place_order', 'book_class', 'enroll_student', 'register_pet',
            'file_claim', 'apply_discount', 'freeze_membership', 'calculate_quote',
        ]) {
            const audit = auditTurnClaim('Listo, quedó reservado', [{ name, result: { success: true } }]);
            expect({ name, falseClaim: audit.falseClaim }).toEqual({ name, falseClaim: false });
        }
    });

    it('acepta el predicado canónico del registro cuando el llamador lo aporta', () => {
        const isBackingTool = (name: string) => name === 'place_order';

        expect(auditTurnClaim(
            'Tu pedido quedó confirmado',
            [{ name: 'place_order', result: { success: true } }],
            { isBackingTool },
        ).falseClaim).toBe(false);

        // Con el mismo predicado, una lectura sigue sin respaldar nada.
        expect(auditTurnClaim(
            'Tu pedido quedó confirmado',
            [{ name: 'get_menu', result: { success: true } }],
            { isBackingTool },
        ).falseClaim).toBe(true);
    });

    it('cree al backend cuando la herramienta es opaca y tuvo éxito', () => {
        // Negarle al cliente una reserva que SÍ ocurrió lo devuelve al bucle de
        // confirmación; dejar pasar una frase de una tool MCP desconocida cuesta
        // una oración. La dirección segura acá es creerle al backend.
        const isBackingTool = (name: string) => name.startsWith('mcp__');
        const audit = auditTurnClaim(
            'Tu reserva está confirmada',
            [{ name: 'mcp__pms__create_stay', result: { success: true, id: 'st-9' } }],
            { isBackingTool },
        );
        expect(audit.falseClaim).toBe(false);
    });
    it('una operación escrita pero pendiente de pago NO respalda un "confirmada"', () => {
        // El dueño exigió pago para confirmar y el cupo sigue a la venta. La
        // escritura ocurrió —por eso el resultado dice success— y aun así
        // afirmar que quedó confirmada es exactamente la mentira que la
        // política de pago existe para evitar.
        const audit = auditTurnClaim(
            'Listo, tu reserva quedó confirmada del 13 al 19 de noviembre.',
            [{ name: 'create_property_booking', result: { success: true, awaitingPayment: true, booking: { id: 'b1' } } }],
        );

        expect(audit.claimed).toBe(true);
        expect(audit.backed).toBe(false);
        expect(audit.falseClaim).toBe(true);
    });

    it('la misma operación ya pagada sí lo respalda', () => {
        const audit = auditTurnClaim(
            'Listo, tu reserva quedó confirmada del 13 al 19 de noviembre.',
            [{ name: 'create_property_booking', result: { success: true, awaitingPayment: false, booking: { id: 'b1' } } }],
        );

        expect(audit.falseClaim).toBe(false);
    });
});
