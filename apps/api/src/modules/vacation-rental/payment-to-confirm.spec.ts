import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PropertiesService } from './properties.service';
import { BookingPaymentListener } from './booking-payment.listener';
import { PENDING_PAYMENT_STATUS } from '../../common/utils/payment-policy.util';

/**
 * El dueño puede exigir pago para confirmar, por ítem.
 *
 * Antes el agente confirmaba al instante y recién después salía a buscar el
 * enlace de pago — le decía al huésped "tu reserva quedó confirmada" y después
 * le pedía que pagara, al revés de como se vende.
 *
 * Decisión del dueño: mientras no se pague **el cupo no se bloquea**. Así que
 * una estadía pendiente no puede aparecer en NINGÚN camino de ocupación
 * (disponibilidad, calendario, export iCal) — si apareciera, cerraría una fecha
 * que todavía está a la venta. Y como no se bloquea, quien paga puede llegar
 * tarde: por eso el cobro revalida antes de confirmar.
 */

const schemaName = 'tenant_pay_to_confirm';
const propertyId = '22222222-2222-4222-8222-222222222222';
const bookingId = '44444444-4444-4444-8444-444444444444';
const tenantId = '11111111-1111-4111-8111-111111111111';

const BASE_PROPERTY = {
    id: propertyId, name: 'Amazon Minimalist', is_active: true,
    max_guests: 4, min_nights: 1, night_price: '100.00', cleaning_fee: '20.00',
    currency: 'COP', check_in_instructions: null,
};

function buildService(property: any) {
    const inserted: any[] = [];
    const query = jest.fn(async (sql: string, params?: any[]) => {
        if (sql.includes('pg_advisory_xact_lock')) return [];
        if (sql.includes('SELECT * FROM properties')) return [property];
        if (sql.includes(') conflicts LIMIT 1')) return [];
        if (sql.includes('INSERT INTO property_bookings')) {
            inserted.push({ sql, params });
            return [{ id: bookingId, status: params?.[15], total_price: '320.00', currency: 'COP', nights: 3 }];
        }
        if (sql.includes('contacts')) return [{ id: 'c1' }];
        return [];
    });
    const prisma = {
        tenant: { findUnique: jest.fn() },
        executeInTenantSchema: jest.fn(async () => []),
        transactionInTenantSchema: jest.fn(async (_s: string, cb: any) => cb(query)),
    };
    const service = new PropertiesService(
        prisma as any, { enforcePlanLimit: jest.fn() } as any, { renderAndSend: jest.fn() } as any,
    );
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    return { service, prisma, query, inserted };
}

describe('la estadía nace pendiente cuando el dueño exige pago', () => {
    it('sin política configurada se confirma como siempre', async () => {
        const { service, inserted } = buildService(BASE_PROPERTY);

        await service.createBooking(schemaName, propertyId, {
            contactId: null, guestName: 'Nir', checkIn: '2026-11-13', checkOut: '2026-11-16',
        } as any);

        expect(inserted[0].params[15]).toBe('confirmed');
    });

    it.each([
        ['full', undefined, undefined],
        ['deposit', 30, undefined],
        ['any', undefined, 50],
    ])("con política '%s' nace pendiente de pago", async (payment_policy, deposit_percent, deposit_amount) => {
        const { service, inserted } = buildService({
            ...BASE_PROPERTY, payment_policy, deposit_percent, deposit_amount,
        });

        await service.createBooking(schemaName, propertyId, {
            contactId: null, guestName: 'Nir', checkIn: '2026-11-13', checkOut: '2026-11-16',
        } as any);

        expect(inserted[0].params[15]).toBe(PENDING_PAYMENT_STATUS);
    });

    it('una estadía pendiente OCUPA la fecha mientras la retención sigue viva', async () => {
        // Invariante invertido a propósito (ago 2026). Antes una estadía impaga
        // no ocupaba nada: gana el que pague primero. El dueño lo revirtió
        // porque así la promesa era vacía — el huésped recibía un enlace, pagaba
        // y podía encontrarse con que las fechas se habían ido mientras pagaba.
        //
        // Ahora ocupa, pero por RELOJ: vencidos los 15 minutos deja de ocupar
        // sin que nadie corra nada.
        const { service, query } = buildService({ ...BASE_PROPERTY, payment_policy: 'full' });

        await service.createBooking(schemaName, propertyId, {
            contactId: null, guestName: 'Nir', checkIn: '2026-11-13', checkOut: '2026-11-16',
        } as any);

        const conflictSql = query.mock.calls.map(([sql]) => sql).find(s => s.includes(') conflicts LIMIT 1'));
        expect(conflictSql).toContain('hold_expires_at > NOW()');
        // La lista de estados ya no decide: si vuelve, la retención se ignora.
        expect(conflictSql).not.toContain(`NOT IN ('cancelled', '${PENDING_PAYMENT_STATUS}')`);
    });

    it('la estadía nace con la retención puesta', async () => {
        const { service, inserted } = buildService({ ...BASE_PROPERTY, payment_policy: 'full' });

        const antes = Date.now();
        await service.createBooking(schemaName, propertyId, {
            contactId: null, guestName: 'Nir', checkIn: '2026-11-13', checkOut: '2026-11-16',
        } as any);

        const hold = inserted[0].params[17] as Date;
        expect(hold).toBeInstanceOf(Date);
        // 20 minutos hacia adelante, con margen para la latencia del test.
        // Son 20 y no 15 por PSE: la transferencia bancaria saca al cliente al
        // sitio del banco y lo devuelve, y quince le quedaban justos.
        const minutos = (hold.getTime() - antes) / 60000;
        expect(minutos).toBeGreaterThan(19);
        expect(minutos).toBeLessThanOrEqual(20.5);
    });

    it('sin pago obligatorio no se retiene nada', async () => {
        // Una reserva que se confirma al instante no necesita reloj: ya ocupa
        // por estado. Ponerle retención sólo confundiría al barrido.
        const { service, inserted } = buildService({ ...BASE_PROPERTY, payment_policy: 'none' });

        await service.createBooking(schemaName, propertyId, {
            contactId: null, guestName: 'Nir', checkIn: '2026-11-13', checkOut: '2026-11-16',
        } as any);

        expect(inserted[0].params[17]).toBeNull();
    });
});

describe('el cobro cierra el lazo', () => {
    function buildListener(booking: any, conflicts: any[] = []) {
        const executeInTenantSchema = jest.fn(async (_s: string, sql: string) => {
            if (sql.includes('SELECT id, property_id')) return booking ? [booking] : [];
            if (sql.includes(') c LIMIT 1')) return conflicts;
            if (sql.includes('UPDATE property_bookings')) return [{ id: bookingId }];
            return [];
        });
        const prisma = { getTenantSchemaName: jest.fn(async () => schemaName), executeInTenantSchema };
        const events = { emit: jest.fn() };
        const listener = new BookingPaymentListener(prisma as any, events as any);
        jest.spyOn((listener as any).logger, 'log').mockImplementation(() => undefined);
        jest.spyOn((listener as any).logger, 'warn').mockImplementation(() => undefined);
        jest.spyOn((listener as any).logger, 'error').mockImplementation(() => undefined);
        return { listener, executeInTenantSchema, events };
    }

    const PENDIENTE = {
        id: bookingId, property_id: propertyId, check_in: '2026-11-13',
        check_out: '2026-11-16', status: PENDING_PAYMENT_STATUS, contact_id: 'c1',
    };

    it('confirma la reserva cuando entra el pago', async () => {
        const { listener, executeInTenantSchema, events } = buildListener(PENDIENTE);

        await listener.onPaid({ tenantId, kind: 'property', entityId: bookingId });

        const update = executeInTenantSchema.mock.calls.find(([, sql]) => sql.includes('UPDATE property_bookings'));
        expect(update).toBeDefined();
        expect(update![1]).toContain("SET status = 'confirmed'");
        expect(events.emit).toHaveBeenCalledWith('property_booking.confirmed_by_payment', expect.any(Object));
    });

    it('no toca lo que ya no está pendiente — el webhook llega varias veces', async () => {
        const { listener, executeInTenantSchema } = buildListener({ ...PENDIENTE, status: 'confirmed' });

        await listener.onPaid({ tenantId, kind: 'property', entityId: bookingId });

        expect(executeInTenantSchema.mock.calls.some(([, sql]) => sql.includes('UPDATE'))).toBe(false);
    });

    it('pagó y las fechas ya se ocuparon: no confirma, escala', async () => {
        // Es la consecuencia de no bloquear el cupo. Hay plata cobrada y no hay
        // dónde alojar: ni confirmar (no existe el lugar) ni cancelar sola
        // (la decisión de reubicar o devolver es del dueño).
        const { listener, executeInTenantSchema, events } = buildListener(PENDIENTE, [{ x: 1 }]);

        await listener.onPaid({ tenantId, kind: 'property', entityId: bookingId });

        expect(executeInTenantSchema.mock.calls.some(([, sql]) => sql.includes('UPDATE'))).toBe(false);
        expect(events.emit).toHaveBeenCalledWith('property_booking.paid_but_unavailable', expect.objectContaining({
            bookingId, propertyId,
        }));
    });

    it('la revalidación se excluye a sí misma', async () => {
        // Sin esto la reserva se encontraría a sí misma... salvo que ya está
        // excluida por ser pending_payment. El `id <> $4` la cubre igual para
        // cuando el estado cambie por otra vía.
        const { listener, executeInTenantSchema } = buildListener(PENDIENTE);

        await listener.onPaid({ tenantId, kind: 'property', entityId: bookingId });

        const check = executeInTenantSchema.mock.calls.find(([, sql]) => sql.includes(') c LIMIT 1'));
        expect(check![1]).toContain('id <> $4::uuid');
    });

    it('ignora los pagos de otras verticales', async () => {
        const { listener, executeInTenantSchema } = buildListener(PENDIENTE);

        await listener.onPaid({ tenantId, kind: 'tour', entityId: bookingId });

        expect(executeInTenantSchema).not.toHaveBeenCalled();
    });
});

describe('el mismo contacto no reserva dos veces lo mismo', () => {
    const contactoUuid = 'cccccccc-2222-4a2b-9c3d-000000000009';

    it('rechaza el duplicado exacto en vez de crear una segunda reserva', async () => {
        // Tours tiene esta guarda desde hace meses; alojamiento nunca la tuvo.
        // El chequeo de conflictos mira la PROPIEDAD, no la persona, así que un
        // reintento del agente —o un "sí" repetido— podía escribir dos veces.
        const { service, query } = buildService({ ...BASE_PROPERTY });
        query.mockImplementation(async (sql: string) => {
            if (sql.includes('FROM contacts WHERE id')) return [{ id: contactoUuid }];
            if (sql.includes('SELECT id FROM property_bookings')) return [{ id: 'ya-existe' }];
            if (sql.includes('FROM properties WHERE id')) return [{ ...BASE_PROPERTY }];
            return [];
        });

        await expect(service.createBooking(schemaName, propertyId, {
            contactId: contactoUuid, guestName: 'Nir', checkIn: '2026-11-13', checkOut: '2026-11-16',
        } as any)).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'duplicate_property_booking' }),
        });
    });

    it('sin contacto no hay a quién deduplicar, y se deja pasar', async () => {
        // Matiz deliberado: una reserva cargada a mano sin contacto no tiene
        // persona por la cual agrupar. La protección ahí es el solapamiento de
        // fechas, no esta guarda.
        const { service, query } = buildService({ ...BASE_PROPERTY });
        query.mockImplementation(async (sql: string) => {
            if (sql.includes('SELECT id FROM property_bookings')) return [{ id: 'no-deberia-consultarse' }];
            if (sql.includes('FROM properties WHERE id')) return [{ ...BASE_PROPERTY }];
            return [];
        });

        // Lo que importa es que NO sea rechazada por duplicado; que la creación
        // termine o no depende del resto del mock y no es lo que se prueba acá.
        const err = await service.createBooking(schemaName, propertyId, {
            contactId: null, guestName: 'Nir', checkIn: '2026-11-13', checkOut: '2026-11-16',
        } as any).catch(e => e);

        expect(err?.response?.error).not.toBe('duplicate_property_booking');
    });

    it('la guarda corre después del lock, si no dos llamadas la esquivan juntas', () => {
        const src = readFileSync(resolve(__dirname, 'properties.service.ts'), 'utf8');
        const lock = src.indexOf('pg_advisory_xact_lock', src.indexOf('const created = await this.prisma.transactionInTenantSchema'));
        const guard = src.indexOf('duplicate_property_booking');
        expect(lock).toBeGreaterThan(0);
        expect(guard).toBeGreaterThan(lock);
    });

    it('una reserva cancelada o vencida no cuenta como duplicado', () => {
        // El huésped tiene que poder volver a reservar lo que canceló.
        const src = readFileSync(resolve(__dirname, 'properties.service.ts'), 'utf8');
        const q = src.slice(src.indexOf('SELECT id FROM property_bookings'), src.indexOf('duplicate_property_booking'));
        expect(q).toContain("status NOT IN ('cancelled', 'expired')");
    });
});
