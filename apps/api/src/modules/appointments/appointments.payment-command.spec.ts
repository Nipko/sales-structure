import { AppointmentsService } from './appointments.service';
import { AIToolExecutorService } from '../conversations/ai-tool-executor.service';
import { AppointmentNotificationsService } from './appointment-notifications.service';

const id = '11111111-1111-4111-8111-111111111111';
const contactId = '22222222-2222-4222-8222-222222222222';
const input = { contactId, serviceId: id, serviceName: 'Consultation', startAt: '2027-09-08T10:00:00', endAt: '2027-09-08T10:30:00' };
function harness(paymentPolicy = 'deposit', suppressEffects = false) {
    let stored: any;
    const serviceRow = { id, name: 'Consultation', duration_minutes: 30, duration_type: 'fixed', max_concurrent: 1, price: 100000, currency: 'COP', payment_policy: paymentPolicy, deposit_percent: 30 };
    const query = jest.fn(async (sql: string, params: any[] = []) => {
        if (sql.includes('FROM contacts')) return [{ id: contactId }];
        if (sql.includes('FROM services')) return [serviceRow];
        if (sql.includes('COUNT(*)')) return [{ occupied: 0 }];
        if (sql.includes('INSERT INTO appointments')) stored = {
            id: params[0], serviceName: params[6], status: params[16], amountDue: params[17], holdExpiresAt: params[18]?.toISOString(), paymentStatus: 'pending',
        };
        return [];
    });
    const prisma = { transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)), $queryRawUnsafe: jest.fn(async () => [serviceRow]) };
    const eventEmitter = { emit: jest.fn() };
    const calendarOutbox = { enqueueWithQuery: jest.fn() };
    const service = new AppointmentsService(prisma as any, eventEmitter as any, calendarOutbox as any, {} as any);
    jest.spyOn(service as any, 'resolveTimezoneForSchema').mockResolvedValue('America/Bogota');
    jest.spyOn(service, 'getById').mockImplementation(async () => stored);
    const executor = Object.create(AIToolExecutorService.prototype) as any;
    Object.assign(executor, { prisma, appointmentsService: service, logger: { log: jest.fn(), warn: jest.fn() },
        temporalContracts: { normalize: () => ({ kind: 'appointment', endsAtLocal: input.endAt }) },
        getTenantTimezone: async () => 'America/Bogota', resolveAppointmentSubject: async () => ({ labels: [], metadata: {} }),
        acquireSlotLock: async () => ({ key: 'lock', token: 'token' }), redis: { releaseLockToken: jest.fn() },
    });
    const createTool = () => executor.createAppointment('tenant_test', id, contactId,
        { serviceId: id, date: '2027-09-08', time: '10:00', customerName: 'Ana' }, undefined, suppressEffects);
    return { service, createTool, eventEmitter, calendarOutbox, query, stored: () => stored };
}

describe('canonical appointment payment command', () => {
    it.each([false, true])('retains the 30%% deposit and hold through the tool (eval=%s)', async (evalMode) => {
        const h = harness('deposit', evalMode);
        const result = await h.createTool();
        expect(result).toMatchObject({ success: true, operationStatus: 'awaiting_payment', appointment: {
            status: 'pending_payment', awaitingPayment: true, amountDueToConfirm: 30000, currency: 'COP',
        } });
        expect(h.stored()).toMatchObject({ status: 'pending_payment', amountDue: 30000 });
        expect(Date.parse(result.appointment.holdExpiresAt)).toBeGreaterThan(Date.now());
        expect(result.appointment.payableReference).toBe('appointment:' + result.appointment.id);
        expect(h.calendarOutbox.enqueueWithQuery).not.toHaveBeenCalled();
        expect(h.eventEmitter.emit).toHaveBeenCalledTimes(evalMode ? 0 : 1);
    });
    it('keeps manual pending and explicitly authorized AI confirmed under the same no-payment policy', async () => {
        const h = harness('none');
        const manual = await h.service.create('tenant_test', input);
        const ai = await h.createTool();
        expect(manual.status).toBe('pending');
        expect(ai.appointment.status).toBe('confirmed');
        expect(ai.appointment.payableReference).toBeNull();
        expect(h.calendarOutbox.enqueueWithQuery).toHaveBeenCalledTimes(2);
    });
    it.each(['pending_payment', 'pending', 'expired'])('does not send confirmation or calendar invitation for %s', async status => {
        const notifications = Object.create(AppointmentNotificationsService.prototype) as any;
        notifications.getTenantId = jest.fn();
        await notifications.onAppointmentCreated({ schemaName: 'tenant_test', appointment: { status } });
        expect(notifications.getTenantId).not.toHaveBeenCalled();
    });
    it('suppresses all notification and outbox effects during evaluation even for free bookings', async () => {
        const h = harness('none', true);
        expect((await h.createTool()).appointment.status).toBe('confirmed');
        expect(h.eventEmitter.emit).not.toHaveBeenCalled();
        expect(h.calendarOutbox.enqueueWithQuery).not.toHaveBeenCalled();
    });
    it('preserves evaluation isolation when a caller only provides metadata.source', async () => {
        const h = harness('none');
        await h.service.create('tenant_test', { ...input, metadata: { source: 'eval_gate' } }, { confirmWithoutPayment: true });
        expect(h.eventEmitter.emit).not.toHaveBeenCalled();
        expect(h.calendarOutbox.enqueueWithQuery).not.toHaveBeenCalled();
        const notifications = Object.create(AppointmentNotificationsService.prototype) as any;
        notifications.getTenantId = jest.fn();
        await notifications.onAppointmentCreated({ schemaName: 'tenant_test', appointment: { status: 'confirmed', metadata: { source: 'eval_gate' } } });
        expect(notifications.getTenantId).not.toHaveBeenCalled();
    });
});
