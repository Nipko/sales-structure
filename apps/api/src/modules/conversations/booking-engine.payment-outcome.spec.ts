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
/**
 * Un importe escrito como lo escribe cada idioma (D17).
 *
 * Estas aserciones decían `100000 COP`: el motor imprimía el número crudo o lo
 * agrupaba siempre `es-CO`. Un precio mexicano confirmado salía con separadores
 * colombianos, y el mismo importe cambiaba de aspecto entre la propuesta y el
 * aviso de pago. Se afirma el separador de cada idioma; en francés se afirma
 * que hay *un espacio*, porque su ancho exacto depende de la versión de ICU.
 */
const grouped = (lang: string, digits: string) => {
    const sep: Record<string, string> = { es: '\\.', pt: '\\.', en: ',', fr: '\\s' };
    return new RegExp(digits.replace(/\B(?=(\d{3})+(?!\d))/g, `§`).split('§').join(sep[lang] ?? '\\.') + ' COP');
};

describe('booking engine communicates persisted outcome', () => {
    it.each(['es', 'en', 'pt', 'fr'])('renews changed terms without discarding collected fields or reusing the old button (%s)', async lang => {
        const current = appointmentServiceTerms({ id: 'service', name: 'Consulta', price: 150000, currency: 'COP', duration_minutes: 30, payment_policy: 'deposit', deposit_percent: 40 });
        const h = harness([], appointmentTermsReviewResult(current)); const oldButton = h.state.confirmationId;
        const outcome = await h.engine.createBooking('tenant_test', 'tenant', 'contact', h.state, lang, 'conversation', authorityFor('create_appointment'), 'confirm_yes');
        expect(outcome.state).toMatchObject({ step: 'confirm', customerName: 'Ana', customerEmail: 'ana@example.test', date: '2027-01-01', time: '10:00' });
        expect(outcome.state.confirmationId).not.toBe(oldButton);
        expect(outcome.text).toMatch(grouped(lang, '150000')); expect(outcome.text).toMatch(grouped(lang, '60000'));
        expect(outcome.text).not.toContain('appointment_terms_changed');
        expect(h.redis.del).toHaveBeenCalledWith('booking:services:tenant');
        expect(h.executor.execute).toHaveBeenCalledTimes(1);
    });
    it.each(['es', 'en', 'pt', 'fr'])('discloses the price and deposit before confirmation in %s', lang => {
        const h = harness(); const proposal = h.engine.collectMissingInfo(h.state, lang);
        expect(proposal.text).toMatch(grouped(lang, '100000'));
        expect(proposal.text).toMatch(grouped(lang, '30000'));
        expect(proposal.buttonMessage.body).toMatch(grouped(lang, '30000'));
    });
    it.each(['es', 'en', 'pt', 'fr'])('does not call a payment hold confirmed in %s', async lang => {
        const h = harness([], { success: true, appointment: { id: 'apt', status: 'pending_payment', awaitingPayment: true, amountDueToConfirm: 30000, currency: 'COP', payableReference: 'appointment:apt' } });
        const outcome = await h.engine.createBooking('tenant_test', 'tenant', 'contact', h.state, lang, 'conversation', authorityFor('create_appointment'), 'confirm_yes');
        expect(outcome.text).toMatch(grouped(lang, '30000'));
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
