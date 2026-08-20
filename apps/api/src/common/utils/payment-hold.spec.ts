import { readFileSync } from 'fs';
import { resolve } from 'path';
import { EXPORT_EXCLUDED_SQL, PAYMENT_HOLD_MS, holdStillAliveSql } from './payment-policy.util';

/**
 * La retención: las fechas quedan guardadas mientras el cliente paga.
 *
 * Revierte la decisión anterior ("no bloquea nada hasta el pago"), que dejaba la
 * promesa vacía: el huésped recibía un enlace, pagaba, y podía encontrarse con
 * que las fechas se habían ido mientras pagaba.
 *
 * Lo importante del diseño es que la retención **caduca por reloj, no por
 * estado**: nadie tiene que correr un cron para liberar el cupo. Si el barrido
 * muere, las fechas se liberan igual.
 */

describe('el predicado de ocupación', () => {
    it('distingue una retención viva de una vencida por tiempo, no por estado', () => {
        const sql = holdStillAliveSql();
        expect(sql).toContain('hold_expires_at > NOW()');
        expect(sql).toContain("status <> 'pending_payment'");
    });

    it('deja pasar el alias sin romper la consulta', () => {
        expect(holdStillAliveSql('a')).toBe(
            "(a.status <> 'pending_payment' OR a.hold_expires_at > NOW())",
        );
    });

    it('una fila sin retención (NULL) nunca ocupa', () => {
        // Es lo que hace segura la migración: las filas `pending_payment` que ya
        // existían siguen sin ocupar cupo, porque NULL > NOW() no es verdadero.
        // El predicado se apoya en esa semántica de SQL a propósito.
        expect(holdStillAliveSql()).not.toContain('COALESCE');
        expect(holdStillAliveSql()).not.toContain('IS NULL');
    });

    it('retiene 15 minutos', () => {
        expect(PAYMENT_HOLD_MS).toBe(15 * 60 * 1000);
    });
});

describe('lo que se publica a las OTAs', () => {
    it('excluye lo impago sin mirar la retención', () => {
        // 15 minutos de bloqueo no salen al feed: Airbnb y Booking releen cada
        // varios minutos, así que llegaría vencido, y ensuciaría el calendario
        // del dueño con huecos que aparecen y desaparecen.
        expect(EXPORT_EXCLUDED_SQL).toContain('pending_payment');
        expect(EXPORT_EXCLUDED_SQL).not.toContain('hold_expires_at');
    });
});

describe('ningún predicado de ocupación quedó atrás', () => {
    const files = [
        'src/modules/vacation-rental/properties.service.ts',
        'src/modules/appointments/appointments.service.ts',
        'src/modules/appointments/appointment-capacity.util.ts',
        'src/modules/appointments/calendar-integration.service.ts',
        'src/modules/vacation-rental/booking-payment.listener.ts',
        'src/modules/appointments/appointment-payment.listener.ts',
    ];

    it('la constante vieja ya no se usa para decidir ocupación', () => {
        // Eran 13 predicados repartidos en 7 archivos. Si uno se queda con la
        // lista de estados, ese camino ignora la retención y vende dos veces la
        // misma fecha.
        for (const f of files) {
            const src = readFileSync(resolve(__dirname, '../../..', f), 'utf8');
            expect(src).not.toContain('OCCUPANCY_EXCLUDED_SQL');
            expect(src).toContain('holdStillAliveSql');
        }
    });
});

describe('la reserva y la cita nacen retenidas', () => {
    it('sólo cuando el pago es obligatorio', () => {
        for (const f of [
            'src/modules/vacation-rental/properties.service.ts',
            'src/modules/appointments/appointments.service.ts',
        ]) {
            const src = readFileSync(resolve(__dirname, '../../..', f), 'utf8');
            expect(src).toContain('policy.requiresPayment');
            expect(src).toContain('PAYMENT_HOLD_MS');
            expect(src).toContain('hold_expires_at');
        }
    });
});
