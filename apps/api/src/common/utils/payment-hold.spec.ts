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
            "(a.status <> 'expired'"
            + " AND (a.status <> 'pending_payment' OR a.hold_expires_at > NOW()))",
        );
    });

    it('una retención VENCIDA no ocupa, y esto casi sale al revés', () => {
        // El barrido marca `expired` las retenciones que nadie pagó. Sin esta
        // condición, esa fila dejaba de ser `pending_payment`, se escapaba de la
        // comparación del reloj y las fechas que el barrido acababa de liberar
        // volvían a contar como OCUPADAS. El barrido hacía lo contrario de lo
        // que promete.
        expect(holdStillAliveSql()).toContain("status <> 'expired'");
    });

    it('una fila sin retención (NULL) nunca ocupa', () => {
        // Es lo que hace segura la migración: las filas `pending_payment` que ya
        // existían siguen sin ocupar cupo, porque NULL > NOW() no es verdadero.
        // El predicado se apoya en esa semántica de SQL a propósito.
        expect(holdStillAliveSql()).not.toContain('COALESCE');
        expect(holdStillAliveSql()).not.toContain('IS NULL');
    });

    it('retiene 20 minutos: PSE saca al cliente al banco y vuelve', () => {
        // Quince le quedaban justos, y una retención que vence MIENTRAS el
        // cliente paga termina en "cobrado sin lugar".
        expect(PAYMENT_HOLD_MS).toBe(20 * 60 * 1000);
    });
});

describe('lo que se publica a las OTAs', () => {
    it('excluye lo impago sin mirar la retención', () => {
        // 20 minutos de bloqueo no salen al feed: Airbnb y Booking releen cada
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

describe('el enlace muere con la retención', () => {
    const SRC = readFileSync(
        resolve(__dirname, '../../modules/tenant-payments/tenant-payments.service.ts'), 'utf8',
    );

    it('lo que retiene cupo usa el reloj de la retención, no 24 horas', () => {
        // Un enlace que sobrevive a la retención invita a pagar algo que ya no
        // existe, y ese pago cae en "cobrado sin lugar": plata real sin nada que
        // entregar.
        expect(SRC).toContain('holdsCapacity ? PAYMENT_HOLD_MS : TENANT_PAYMENT_LINK_TTL_MS');
        expect(SRC).toContain("new Set(['property', 'appointment'])");
    });

    it('lo que no retiene nada conserva las 24 horas', () => {
        // Un pedido o una factura no guardan cupo: acortarlos sólo obligaría al
        // cliente a pedir el enlace de nuevo sin que nadie gane nada.
        expect(SRC).toContain('const TENANT_PAYMENT_LINK_TTL_MS = 24 * 60 * 60 * 1000;');
    });
});

describe('el SQL que se genera es SQL de verdad', () => {
    // Este contrato nació de un defecto real: la migración de los 13 predicados
    // se hizo con un script, y donde la consulta no tenía alias el script
    // escribió el `None` de Python — quedó `AND Nonestatus NOT IN (...)` en
    // ONCE lugares. Habría tumbado en producción cada chequeo de disponibilidad,
    // cada chequeo de capacidad y la sincronización del calendario.
    //
    // No lo atrapó nadie: `tsc` no mira dentro de un template string, y los
    // tests comparaban subcadenas sin ejecutar la consulta.
    const SQL_FILES = [
        'src/modules/vacation-rental/properties.service.ts',
        'src/modules/vacation-rental/booking-payment.listener.ts',
        'src/modules/vacation-rental/ical-sync.service.ts',
        'src/modules/appointments/appointments.service.ts',
        'src/modules/appointments/appointment-capacity.util.ts',
        'src/modules/appointments/appointment-payment.listener.ts',
        'src/modules/appointments/calendar-integration.service.ts',
    ];

    it('no quedó ningún artefacto del script de migración', () => {
        for (const f of SQL_FILES) {
            const src = readFileSync(resolve(__dirname, '../../..', f), 'utf8');
            expect(src).not.toMatch(/\bNone/);
            expect(src).not.toMatch(/undefinedstatus|nullstatus/);
        }
    });

    it('cada predicado de ocupación empieza por una columna válida', () => {
        // `status` a secas o con alias (`a.status`), nunca pegado a otra cosa.
        for (const f of SQL_FILES) {
            const src = readFileSync(resolve(__dirname, '../../..', f), 'utf8');
            for (const m of src.matchAll(/(\S*)status NOT IN \('cancelled'/g)) {
                expect(m[1]).toMatch(/^$|^[a-z_]+\.$/);
            }
        }
    });
});
