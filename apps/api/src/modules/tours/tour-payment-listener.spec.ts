import { TourPaymentListener } from './tour-payment.listener';
import { PENDING_PAYMENT_STATUS } from '../../common/utils/payment-policy.util';

/**
 * El pago cierra la reserva de tour.
 *
 * Es MÁS simple que alojamiento y citas: el asiento se descontó al crear, así
 * que nunca estuvo a la venta para otro y no hay carrera que revalidar. El único
 * caso que falla es el pago tardío — ahí el barrido ya devolvió el asiento.
 */

const bookingId = 'bbbbbbbb-1111-4a2b-9c3d-000000000001';
const HORA = 60 * 60 * 1000;

function build(booking: any) {
    const executeInTenantSchema = jest.fn(async (_s: string, sql: string) => {
        if (sql.includes('SELECT id, status')) return booking ? [booking] : [];
        if (sql.includes('UPDATE tour_bookings')) return [{ id: bookingId }];
        return [];
    });
    const prisma: any = { getTenantSchemaName: jest.fn(async () => 'tenant_x'), executeInTenantSchema };
    const events: any = { emit: jest.fn() };
    const notifier: any = { notifyCustomer: jest.fn(async () => true) };
    const push: any = { sendToTenantRole: jest.fn(async () => 1) };
    return { listener: new TourPaymentListener(prisma, events, notifier, push), events, notifier, push, executeInTenantSchema };
}

const BASE = {
    id: bookingId,
    status: PENDING_PAYMENT_STATUS,
    contact_id: 'cccccccc-1111-4a2b-9c3d-000000000003',
    conversation_id: 'dddddddd-1111-4a2b-9c3d-000000000004',
    departure_date: '2026-12-15',
    party_size: 2,
};

const EVENT = { tenantId: 'ten-1', kind: 'tour', entityId: bookingId };

describe('pago a tiempo', () => {
    it('deja la reserva firme y avisa al cliente', async () => {
        const { listener, notifier, events } = build({ ...BASE, hold_expires_at: new Date(Date.now() + HORA) });

        await listener.onPaid(EVENT as any);

        expect(notifier.notifyCustomer).toHaveBeenCalledTimes(1);
        expect(events.emit).toHaveBeenCalledWith('tour_booking.confirmed_by_payment', expect.anything());
    });

    it('NO revalida disponibilidad, porque el asiento ya era suyo', async () => {
        // Es la diferencia con alojamiento: allá el cupo seguía a la venta y
        // había que mirar si alguien lo tomó. Acá se descontó al crear.
        const { listener, executeInTenantSchema } = build({ ...BASE, hold_expires_at: new Date(Date.now() + HORA) });

        await listener.onPaid(EVENT as any);

        const consultas = executeInTenantSchema.mock.calls.map(c => String(c[1]));
        expect(consultas.some(q => q.includes('available_seats'))).toBe(false);
    });
});

describe('pago tarde', () => {
    it('no confirma y le avisa al dueño', async () => {
        // El barrido ya devolvió el asiento y pudo tomarlo otro. Hay plata
        // cobrada y puede no haber lugar: la decisión es del negocio.
        const { listener, notifier, push, events } = build({ ...BASE, hold_expires_at: new Date(Date.now() - HORA) });

        await listener.onPaid(EVENT as any);

        expect(push.sendToTenantRole).toHaveBeenCalledTimes(1);
        expect(notifier.notifyCustomer).not.toHaveBeenCalled();
        expect(events.emit).toHaveBeenCalledWith('tour_booking.paid_but_expired', expect.anything());
    });
});

describe('robustez', () => {
    it('no toca lo que ya dejó de estar pendiente', async () => {
        // El webhook llega varias veces por diseño.
        const { listener, notifier } = build({ ...BASE, status: 'reserved', hold_expires_at: null });

        await listener.onPaid(EVENT as any);

        expect(notifier.notifyCustomer).not.toHaveBeenCalled();
    });

    it('ignora los pagos de otras verticales', async () => {
        const { listener, executeInTenantSchema } = build({ ...BASE });

        await listener.onPaid({ ...EVENT, kind: 'property' } as any);

        expect(executeInTenantSchema).not.toHaveBeenCalled();
    });
});
