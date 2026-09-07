import { AppointmentPaymentListener } from './appointment-payment.listener';
import { CalendarSyncOutboxService } from './calendar-sync-outbox.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const appointmentId = '33333333-3333-4333-8333-333333333333';
const pending = { id: appointmentId, service_id: 'service', assigned_to: 'staff', start_at: '2027-11-13T15:00:00', end_at: '2027-11-13T16:00:00', status: 'pending_payment', payment_status: 'paid', contact_id: 'contact', metadata: {} };
function harness(options: { staffTaken?: boolean; occupied?: number; maxConcurrent?: number; status?: string; paymentStatus?: string } = {}) {
    let appointment: any = { ...pending, status: options.status || pending.status, payment_status: options.paymentStatus || 'paid', metadata: {} };
    const query = jest.fn(async (sql: string) => {
        if (sql.includes('FROM appointments WHERE id')) return [{ ...appointment }];
        if (sql.includes('FROM services')) return [{ id: 'service', name: 'Consultation', max_concurrent: options.maxConcurrent || 1 }];
        if (sql.includes('COUNT(*)')) return [{ occupied: options.occupied || 0 }];
        if (sql.includes('SELECT id') && sql.includes('FROM appointments')) return options.staffTaken ? [{ id: 'other' }] : [];
        if (sql.includes("SET status = 'confirmed'")) { appointment.status = 'confirmed'; appointment.hold_expires_at = null; return []; }
        if (sql.includes('jsonb_build_object')) { appointment.metadata = { paymentConfirmationIssue: 'availability_requires_review' }; return []; }
        return [];
    });
    const prisma = {
        getTenantSchemaName: async () => 'tenant_test',
        tenant: { findMany: jest.fn().mockResolvedValue([{ id: tenantId, schemaName: 'tenant_test' }]) },
        executeInTenantSchema: jest.fn(async () => [{ id: appointmentId }]),
        transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => {
            const before = JSON.parse(JSON.stringify(appointment));
            try { return await callback(query); } catch (error) { appointment = before; throw error; }
        }),
    };
    const events = { emit: jest.fn() };
    const enqueue = jest.spyOn(CalendarSyncOutboxService, 'enqueueWithTransaction').mockResolvedValue(undefined as any);
    const notifier = { notifyCustomer: jest.fn().mockResolvedValue(true) };
    const push = { sendToTenantRole: jest.fn().mockResolvedValue(1) };
    const listener = new AppointmentPaymentListener(prisma as any, events as any, notifier as any, push as any);
    return { listener, query, events, enqueue, notifier, prisma, state: () => appointment };
}
const event = { tenantId, kind: 'appointment', entityId: appointmentId };
describe('canonical appointment settlement', () => {
    afterEach(() => jest.restoreAllMocks());
    it('locks, rechecks capacity and confirms with the outbox in one transaction', async () => {
        const h = harness(); await h.listener.onPaid(event);
        expect(h.state().status).toBe('confirmed');
        expect(h.prisma.executeInTenantSchema).not.toHaveBeenCalled();
        expect(h.query.mock.calls[0][0]).toContain('FOR UPDATE');
        expect(h.query.mock.calls.some(([sql]) => sql.includes('pg_advisory_xact_lock'))).toBe(true);
        expect(h.enqueue).toHaveBeenCalledWith(expect.any(Function), appointmentId, 'upsert');
        expect(h.notifier.notifyCustomer).toHaveBeenCalledTimes(1);
    });
    it('does not repeat confirmation or outbound work when settlement replays', async () => {
        const h = harness(); await h.listener.onPaid(event); await h.listener.onPaid(event);
        expect(h.enqueue).toHaveBeenCalledTimes(1); expect(h.notifier.notifyCustomer).toHaveBeenCalledTimes(1);
    });
    it('rejects an unpaid row even if an event claims success', async () => {
        const h = harness({ paymentStatus: 'pending' }); await h.listener.onPaid(event);
        expect(h.state().status).toBe('pending_payment'); expect(h.enqueue).not.toHaveBeenCalled();
    });
    it('rejects a busy professional even when the service supports three simultaneous appointments', async () => {
        const h = harness({ staffTaken: true, maxConcurrent: 3 }); await h.listener.onPaid(event);
        expect(h.state().status).toBe('pending_payment'); expect(h.enqueue).not.toHaveBeenCalled();
        expect(h.events.emit).toHaveBeenCalledWith('appointment.paid_but_unavailable', expect.objectContaining({ appointmentId }));
        await h.listener.onPaid(event);
        expect(h.events.emit).toHaveBeenCalledTimes(1);
    });
    it('allows spare concurrent service capacity and refuses a genuinely full service', async () => {
        const spare = harness({ maxConcurrent: 3, occupied: 2 }); await spare.listener.onPaid(event);
        expect(spare.state().status).toBe('confirmed');
        const full = harness({ maxConcurrent: 3, occupied: 3 }); await full.listener.onPaid(event);
        expect(full.state().status).toBe('pending_payment');
    });
    it('rechecks an expired hold after a late verified payment', async () => {
        const h = harness({ status: 'expired' }); await h.listener.onPaid(event);
        expect(h.state().status).toBe('confirmed');
    });
    it('rolls back on outbox failure and reconciliation recovers the paid appointment', async () => {
        const h = harness(); h.enqueue.mockRejectedValueOnce(new Error('outbox_failed'));
        await h.listener.onPaid(event);
        expect(h.state().status).toBe('pending_payment'); expect(h.notifier.notifyCustomer).not.toHaveBeenCalled();
        await h.listener.reconcilePaidAppointments();
        expect(h.state().status).toBe('confirmed'); expect(h.notifier.notifyCustomer).toHaveBeenCalledTimes(1);
    });
    it('ignores payments for other domains', async () => {
        const h = harness(); await h.listener.onPaid({ ...event, kind: 'property' });
        expect(h.prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });
});
