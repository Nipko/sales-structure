import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PAYMENT_REFERENCE_TARGETS } from '../tenant-payments/tenant-payment-reference';

/**
 * Tours: el cupo funciona AL REVÉS que las fechas.
 *
 * Una estadía impaga no ocupaba nada y se liberaba sola por reloj. Un asiento se
 * descuenta de `tour_inventory` al crear la reserva, así que queda tomado desde
 * el minuto cero: no hay que retenerlo, hay que DEVOLVERLO si nadie paga.
 *
 * La consecuencia importante: acá el barrido SÍ es necesario. Si no corre, el
 * cupo se pierde de verdad — al revés que en alojamiento, donde el cron es sólo
 * higiene.
 */

describe('el cobro de un tour', () => {
    const tour = PAYMENT_REFERENCE_TARGETS.tour;

    it('cobra el anticipo, no el total', () => {
        // Sin el COALESCE, un "anticipo del 30%" cobraba el 100%. Es el mismo
        // defecto que ya se corrigió en alojamiento y citas.
        expect(tour.amountExpression).toBe('COALESCE(target.amount_due, target.total_price)');
    });

    it('rechaza pagar una retención vencida', () => {
        // El asiento ya volvió al inventario: aceptar la plata sería vender algo
        // que ya no está.
        expect(tour.rejectedStatuses).toContain('expired');
    });
});

describe('las otras verticales también rechazan lo vencido', () => {
    it.each(['property', 'appointment'])('%s no acepta pago sobre una retención vencida', (kind) => {
        // Sutil y caro: el listener del pago sólo confirma filas en
        // `pending_payment`, así que cobrar sobre una vencida se llevaría la
        // plata sin confirmar nada y sin hacer ruido.
        expect(PAYMENT_REFERENCE_TARGETS[kind].rejectedStatuses).toContain('expired');
    });
});

describe('el barrido devuelve el asiento', () => {
    const SRC = readFileSync(
        resolve(__dirname, '../conversations/expired-hold-sweeper.service.ts'), 'utf8',
    );

    it('suma de nuevo los cupos al inventario', () => {
        expect(SRC).toContain('SET available_seats = available_seats + $1');
    });

    it('marcar y devolver van en la MISMA transacción', () => {
        // Soltar el asiento sin marcar la reserva lo devolvería otra vez en el
        // siguiente barrido, inflando el inventario con cupos que no existen.
        const metodo = SRC.slice(SRC.indexOf('private async expireTourHolds'));
        expect(metodo).toContain('transactionInTenantSchema');
        const update = metodo.indexOf('UPDATE tour_bookings');
        const devolver = metodo.indexOf('available_seats + $1');
        expect(update).toBeGreaterThan(0);
        expect(devolver).toBeGreaterThan(update);
    });

    it('una reserva sin inventario no rompe el barrido', () => {
        // `inventory_id` es opcional: un tour sin cupo configurado no tiene nada
        // que devolver, y saltarlo no puede abortar al resto.
        const metodo = SRC.slice(SRC.indexOf('private async expireTourHolds'));
        expect(metodo).toContain('if (!b.inventory_id) continue;');
    });
});

describe('la reserva nace pendiente', () => {
    const SRC = readFileSync(resolve(__dirname, 'tours.service.ts'), 'utf8');

    it('con estado, anticipo y reloj', () => {
        expect(SRC).toContain('policy.requiresPayment ? PENDING_PAYMENT_STATUS');
        expect(SRC).toContain('PAYMENT_HOLD_MS');
        expect(SRC).toContain('status, amountDue, holdExpiresAt,');
    });
});
