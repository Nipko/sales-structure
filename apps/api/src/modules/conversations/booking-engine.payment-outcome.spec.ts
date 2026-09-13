import { BookingEngineService, BookingState } from './booking-engine.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';
import { appointmentServiceTerms, appointmentTermsReviewResult } from '../appointments/appointment-service-terms';

function harness(existing: any[] = [], result: any = {}) {
    const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue(existing) };
    const executor = { execute: jest.fn().mockResolvedValue(result) };
    const redis = { del: jest.fn().mockResolvedValue(undefined) };
    const engine = new BookingEngineService(prisma as any, redis as any, executor as any);
    const state: BookingState = { step: 'confirm', serviceId: 'service', serviceName: 'Consultation', date: '2027-01-01', time: '10:00', customerName: 'Ana', customerEmail: 'ana@example.test',
        services: [{ id: 'service', name: 'Consultation', durationMinutes: 30, price: 100000, currency: 'COP', requiresPaymentToConfirm: true, amountDueToConfirm: 30000 }] };
    (engine as any).collectMissingInfo(state, 'es');
    return { engine: engine as any, executor, state, prisma, redis };
}
describe('booking engine communicates persisted outcome', () => {
    it.each(['es', 'en', 'pt', 'fr'])('renews changed terms without discarding collected fields or reusing the old button (%s)', async lang => {
        const current = appointmentServiceTerms({ id: 'service', name: 'Consulta', price: 150000, currency: 'COP', duration_minutes: 30, payment_policy: 'deposit', deposit_percent: 40 });
        const h = harness([], appointmentTermsReviewResult(current)); const oldButton = h.state.confirmationId;
        const outcome = await h.engine.createBooking('tenant_test', 'tenant', 'contact', h.state, lang, 'conversation', authorityFor('create_appointment'), 'confirm_yes');
        expect(outcome.state).toMatchObject({ step: 'confirm', customerName: 'Ana', customerEmail: 'ana@example.test', date: '2027-01-01', time: '10:00' });
        expect(outcome.state.confirmationId).not.toBe(oldButton);
        expect(outcome.text).toContain('150000 COP'); expect(outcome.text).toContain('60000 COP');
        expect(outcome.text).not.toContain('appointment_terms_changed');
        expect(h.redis.del).toHaveBeenCalledWith('booking:services:tenant');
        expect(h.executor.execute).toHaveBeenCalledTimes(1);
    });
    it.each(['es', 'en', 'pt', 'fr'])('discloses the price and deposit before confirmation in %s', lang => {
        const h = harness(); const proposal = h.engine.collectMissingInfo(h.state, lang);
        expect(proposal.text).toContain('100000 COP');
        expect(proposal.text).toContain('30000 COP');
        expect(proposal.buttonMessage.body).toContain('30000 COP');
    });
    it.each(['es', 'en', 'pt', 'fr'])('does not call a payment hold confirmed in %s', async lang => {
        const h = harness([], { success: true, appointment: { id: 'apt', status: 'pending_payment', awaitingPayment: true, amountDueToConfirm: 30000, currency: 'COP', payableReference: 'appointment:apt' } });
        const outcome = await h.engine.createBooking('tenant_test', 'tenant', 'contact', h.state, lang, 'conversation', authorityFor('create_appointment'), 'confirm_yes');
        expect(outcome.text).toContain('30000 COP');
        expect(outcome.text).not.toMatch(/Cita confirmada|Appointment confirmed|Agendamento confirmado|Rendez-vous confirmé|invite sent|Invitación enviada/i);
        expect(outcome.state).toMatchObject({ appointmentStatus: 'pending_payment', payableReference: 'appointment:apt' });
    });
    it('replays an existing payment hold without creating another or calling it confirmed', async () => {
        const h = harness([{ id: 'apt', status: 'pending_payment', amount_due: 30000, currency: 'COP' }]);
        const outcome = await h.engine.createBooking('tenant_test', 'tenant', 'contact', h.state, 'es', 'conversation', authorityFor('create_appointment'));
        expect(h.executor.execute).not.toHaveBeenCalled();
        expect(outcome.text).toContain('pendiente del pago');
        expect(outcome.executedTools[0].result).toMatchObject({ idempotentReplay: true, appointment: { status: 'pending_payment' } });
        expect(h.prisma.$queryRawUnsafe.mock.calls[0][0]).toContain('hold_expires_at > NOW()');
    });
    it('treats a successful result without a status as pending and never invents an invitation delivery', () => {
        const h = harness();
        expect(h.engine.bookingOutcome(h.state, 'es', { success: true }).text).toContain('pendiente de confirmación');
        const confirmed = h.engine.bookingOutcome(h.state, 'es', { success: true, appointment: { status: 'confirmed' } });
        expect(confirmed.text).toContain('Cita confirmada');
        expect(confirmed.text).not.toContain('Invitación enviada');
    });
});
