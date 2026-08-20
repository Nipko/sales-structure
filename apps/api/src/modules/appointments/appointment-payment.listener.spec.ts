import { AppointmentPaymentListener } from './appointment-payment.listener';
import { CalendarSyncOutboxService } from './calendar-sync-outbox.service';
import { PENDING_PAYMENT_STATUS } from '../../common/utils/payment-policy.util';

/**
 * Una cita que exige seña no ocupa el turno hasta que se paga (decisión del
 * dueño: gana quien pague primero). Eso tiene una consecuencia que hay que
 * cubrir: dos personas pueden pedir el mismo horario sin pagar y las dos pagar.
 *
 * Y la cita entra a la agenda del profesional acá, no al crearse: sincronizar
 * una cita impaga le taparía el calendario con algo que sigue a la venta.
 */

const schemaName = 'tenant_citas';
const tenantId = '11111111-1111-4111-8111-111111111111';
const appointmentId = '33333333-3333-4333-8333-333333333333';

const PENDIENTE = {
    id: appointmentId, service_id: 's1', assigned_to: 'u1',
    start_at: '2026-11-13T15:00:00', end_at: '2026-11-13T16:00:00',
    status: PENDING_PAYMENT_STATUS, contact_id: 'c1',
};

function buildListener(appointment: any, taken: any[] = []) {
    const txQueries: string[] = [];
    const executeInTenantSchema = jest.fn(async (_s: string, sql: string) => {
        if (sql.includes('FROM appointments WHERE id')) return appointment ? [appointment] : [];
        if (sql.includes('HAVING COUNT(*)')) return taken;
        return [];
    });
    const transactionInTenantSchema = jest.fn(async (_s: string, cb: any) => cb(
        jest.fn(async (sql: string) => {
            txQueries.push(sql);
            if (sql.includes('UPDATE appointments')) return [{ id: appointmentId }];
            return [];
        }),
    ));
    const prisma = {
        getTenantSchemaName: jest.fn(async () => schemaName),
        executeInTenantSchema,
        transactionInTenantSchema,
    };
    const events = { emit: jest.fn() };
    // El encolado real al calendario se espía: acá se prueba el listener,
    // y que la cita entre a la agenda se asegura verificando la llamada.
    const enqueue = jest.spyOn(CalendarSyncOutboxService, 'enqueueWithTransaction')
        .mockResolvedValue(undefined as any);
    const listener = new AppointmentPaymentListener(prisma as any, events as any);
    for (const level of ['log', 'warn', 'error'] as const) {
        jest.spyOn((listener as any).logger, level).mockImplementation(() => undefined);
    }
    return { listener, executeInTenantSchema, txQueries, events, enqueue };
}

describe('la cita se confirma cuando entra la seña', () => {
    afterEach(() => jest.restoreAllMocks());

    it('confirma y recién ahí la manda al calendario del profesional', async () => {
        const { listener, txQueries, events, enqueue } = buildListener(PENDIENTE);

        await listener.onPaid({ tenantId, kind: 'appointment', entityId: appointmentId });

        expect(txQueries.some(q => q.includes("SET status = 'confirmed'"))).toBe(true);
        // Confirmar y encolar van en la MISMA transacción: una cita confirmada
        // que no llegó a la agenda es un turno que nadie ve.
        expect(enqueue).toHaveBeenCalledWith(expect.any(Function), appointmentId, 'upsert');
        expect(events.emit).toHaveBeenCalledWith('appointment.confirmed_by_payment', expect.any(Object));
    });

    it('el webhook repetido no vuelve a tocarla', async () => {
        const { listener, txQueries } = buildListener({ ...PENDIENTE, status: 'confirmed' });

        await listener.onPaid({ tenantId, kind: 'appointment', entityId: appointmentId });

        expect(txQueries).toHaveLength(0);
    });

    it('pagó y el horario ya se ocupó: no confirma, escala', async () => {
        const { listener, txQueries, events } = buildListener(PENDIENTE, [{ x: 1 }]);

        await listener.onPaid({ tenantId, kind: 'appointment', entityId: appointmentId });

        expect(txQueries).toHaveLength(0);
        expect(events.emit).toHaveBeenCalledWith('appointment.paid_but_unavailable', expect.objectContaining({
            appointmentId,
        }));
    });

    it('la revalidación respeta el cupo concurrente del servicio, no asume 1', async () => {
        // Un servicio con max_concurrent 3 puede tener tres citas a la vez; una
        // sola coincidencia no lo llena.
        const { listener, executeInTenantSchema } = buildListener(PENDIENTE);

        await listener.onPaid({ tenantId, kind: 'appointment', entityId: appointmentId });

        const check = executeInTenantSchema.mock.calls.find(([, sql]) => sql.includes('HAVING COUNT(*)'));
        expect(check![1]).toContain('max_concurrent');
        expect(check![1]).toContain('a.id <> $1::uuid');
    });

    it('ignora los pagos de otras verticales', async () => {
        const { listener, executeInTenantSchema } = buildListener(PENDIENTE);

        await listener.onPaid({ tenantId, kind: 'property', entityId: appointmentId });

        expect(executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('un fallo al confirmar no hace fallar al emisor del pago', async () => {
        // El pago YA se registró: tirar acá no lo revierte y sí rompería el
        // webhook, que Wompi reintentaría en loop.
        const { listener } = buildListener(null);
        (listener as any).prisma.executeInTenantSchema = jest.fn(async () => { throw new Error('boom'); });

        await expect(
            listener.onPaid({ tenantId, kind: 'appointment', entityId: appointmentId }),
        ).resolves.toBeUndefined();
    });
});
