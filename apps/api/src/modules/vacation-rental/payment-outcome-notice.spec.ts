import { BookingPaymentListener } from './booking-payment.listener';
import { PENDING_PAYMENT_STATUS } from '../../common/utils/payment-policy.util';

/**
 * El pago se informa y sigue el proceso de confirmación.
 *
 * Hasta ahora el cobro confirmaba la reserva en la base y emitía un evento que
 * NADIE escuchaba. El huésped pagaba, Wompi le decía "listo", y de nosotros no
 * recibía una palabra: iba a asumir que falló. Y el caso caro —cobrado sin
 * lugar— dejaba como única huella una línea de log.
 */

const bookingId = '3f1d0f5a-1111-4a2b-9c3d-000000000001';

function build(booking: any, conflicts: any[] = []) {
    const executeInTenantSchema = jest.fn(async (_s: string, sql: string) => {
        if (sql.includes('SELECT id, property_id')) return booking ? [booking] : [];
        if (sql.includes(') c LIMIT 1')) return conflicts;
        if (sql.includes('UPDATE property_bookings')) return [{ id: bookingId }];
        return [];
    });
    const prisma: any = { getTenantSchemaName: jest.fn(async () => 'tenant_x'), executeInTenantSchema };
    const events: any = { emit: jest.fn() };
    const notifier: any = { notifyCustomer: jest.fn(async () => true) };
    const push: any = { sendToTenantRole: jest.fn(async () => 1) };
    return {
        listener: new BookingPaymentListener(prisma, events, notifier, push),
        notifier, push, events,
    };
}

const BOOKING = {
    id: bookingId,
    property_id: 'aaaaaaaa-1111-4a2b-9c3d-000000000002',
    check_in: '2026-12-01',
    check_out: '2026-12-05',
    status: PENDING_PAYMENT_STATUS,
    contact_id: 'cccccccc-1111-4a2b-9c3d-000000000003',
    conversation_id: 'dddddddd-1111-4a2b-9c3d-000000000004',
};

const EVENT = { tenantId: 'ten-1', kind: 'property', entityId: bookingId };

describe('cuando el pago entra y hay lugar', () => {
    it('le avisa al huésped por el canal donde venía hablando', async () => {
        const { listener, notifier } = build({ ...BOOKING });

        await listener.onPaid(EVENT as any);

        expect(notifier.notifyCustomer).toHaveBeenCalledTimes(1);
        const arg = notifier.notifyCustomer.mock.calls[0][0];
        expect(arg.conversationId).toBe(BOOKING.conversation_id);
        expect(arg.text).toContain('confirmada');
    });

    it('el aviso es idempotente: el webhook llega varias veces', async () => {
        // Sin un dedupeId atado a la reserva, el huésped recibiría el mismo
        // "quedó confirmada" una vez por reintento del proveedor.
        const { listener, notifier } = build({ ...BOOKING });

        await listener.onPaid(EVENT as any);

        expect(notifier.notifyCustomer.mock.calls[0][0].dedupeId).toBe(`pay-ok-property-${bookingId}`);
    });
});

describe('cuando el pago entra y ya no hay lugar', () => {
    const conflicto = [{ '?column?': 1 }];

    it('le avisa al dueño, que es quien decide', async () => {
        const { listener, push } = build({ ...BOOKING }, conflicto);

        await listener.onPaid(EVENT as any);

        expect(push.sendToTenantRole).toHaveBeenCalledTimes(1);
        const [tenantId, role, payload] = push.sendToTenantRole.mock.calls[0];
        expect(tenantId).toBe('ten-1');
        expect(role).toBe('tenant_admin');
        expect(payload.body).toContain('2026-12-01');
    });

    it('NO le escribe al huésped por su cuenta', async () => {
        // Reubicar o devolver es una decisión de negocio. Un mensaje automático
        // acá comprometería al dueño con algo que no eligió.
        const { listener, notifier } = build({ ...BOOKING }, conflicto);

        await listener.onPaid(EVENT as any);

        expect(notifier.notifyCustomer).not.toHaveBeenCalled();
    });

    it('no confirma la reserva', async () => {
        const { listener, events } = build({ ...BOOKING }, conflicto);

        await listener.onPaid(EVENT as any);

        expect(events.emit).toHaveBeenCalledWith('property_booking.paid_but_unavailable', expect.anything());
        expect(events.emit).not.toHaveBeenCalledWith('property_booking.confirmed_by_payment', expect.anything());
    });
});
