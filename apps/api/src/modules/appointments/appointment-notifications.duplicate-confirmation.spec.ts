import { AppointmentNotificationsService } from './appointment-notifications.service';
import { apptMsg } from './appointment-notifications-i18n';
import { appointmentReferenceLine } from '../conversations/booking-engine.service';

/**
 * Production 2026-10-08: the agent confirmed the booking inside the conversation («¡Cita confirmada!…») and, a moment
 * later, the appointment.created listener sent a second «✅ Cita confirmada» to the same chat. The channel message is skipped
 * when the agent itself booked it from a conversation on that same channel; the e-mail is a different channel and stays.
 */
function service(opts: { thread: any }) {
    const s: any = Object.create(AppointmentNotificationsService.prototype);
    s.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    s.eventEmitter = { emit: jest.fn() };
    s.getTenantId = jest.fn().mockResolvedValue('tenant-1');
    s.getContactInfo = jest.fn().mockResolvedValue({ name: 'Joaquin', phone: '+573001112233', email: 'j@example.com', channel_type: 'telegram' });
    s.getAppointmentFacts = jest.fn().mockResolvedValue({ id: 'apt-1', conversationId: 'conv-1', serviceName: 'Corte', startAt: '2027-01-05T16:00:00', location: null, meetingUrl: null });
    s.getContactLanguage = jest.fn().mockResolvedValue('es');
    s.getTenantTimezone = jest.fn().mockResolvedValue('America/Bogota');
    s.bookingThread = jest.fn().mockResolvedValue(opts.thread);
    s.dispatchConfirmation = jest.fn().mockResolvedValue({ kind: 'sent' });
    s.sendAppointmentEmail = jest.fn().mockResolvedValue(undefined);
    return s as AppointmentNotificationsService & Record<string, jest.Mock>;
}
const created = (over: Record<string, unknown> = {}) => ({
    schemaName: 'tenant_x',
    appointment: { id: 'apt-1', status: 'confirmed', contactId: 'contact-1', serviceName: 'Corte', startAt: '2027-01-05T16:00:00', conversationId: 'conv-1', ...over },
});

describe('the channel confirmation is not duplicated when the agent already confirmed in the conversation', () => {
    it('skips the channel message for an AI booking made from a live conversation on the same channel, and keeps the e-mail', async () => {
        const s = service({ thread: { id: 'conv-1', channelAccountId: 'acc-1' } });
        await s.onAppointmentCreated(created({ source: 'ai' }));
        expect((s as any).dispatchConfirmation).not.toHaveBeenCalled();
        expect((s as any).sendAppointmentEmail).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['a manual booking from the dashboard', { source: 'manual' }, { id: 'conv-1', channelAccountId: 'acc-1' }],
        ['an AI booking with no live thread on that channel (other channel, closed or missing)', { source: 'ai' }, null],
        ['a booking from the API', { source: 'api' }, { id: 'conv-1', channelAccountId: 'acc-1' }],
        ['a booking with no source', {}, { id: 'conv-1', channelAccountId: 'acc-1' }],
    ])('still sends it for %s', async (_label, over, thread) => {
        const s = service({ thread });
        await s.onAppointmentCreated(created(over));
        expect((s as any).dispatchConfirmation).toHaveBeenCalledTimes(1);
        expect((s as any).sendAppointmentEmail).toHaveBeenCalledTimes(1);
    });
});

describe('usted voice in the Spanish appointment notices', () => {
    it.each(['confirmGreeting', 'confirmFooter', 'cancelBody', 'cancelFooter', 'reminderBody', 'reminderStaff', 'reminderFooter'])('%s', key => {
        const text = apptMsg('es', key, { name: 'Ana', service: 'Corte', date: 'lunes', time: '10:00', staff: 'Luis' });
        expect(text).not.toMatch(/\b(?:tu|tus|te|puedes|necesitas|deseas|escríbenos|dudes)\b/i);
        expect(text).not.toMatch(/Te recordamos|Te atenderá|Tu cita|Si necesitas|Si deseas|Si no puedes|escríbenos/);
    });
    it('uses su / le / escríbanos', () => {
        expect(apptMsg('es', 'confirmGreeting', { name: 'Ana' })).toBe('Hola Ana! Su cita ha sido agendada:');
        expect(apptMsg('es', 'confirmFooter')).toBe('Si necesita cancelar o reprogramar, escríbanos con anticipación.');
        expect(apptMsg('es', 'reminderBody', { name: 'Ana', service: 'Corte', date: 'lunes', time: '10:00' })).toContain('Le recordamos su cita');
    });
});

describe('the booked confirmation carries a short reference', () => {
    it('is the first 8 characters of the appointment id, upper case, in each language', () => {
        expect(appointmentReferenceLine('es', '3f9a1c2b-0000-4000-8000-000000000000')).toBe('\nReferencia: 3F9A1C2B');
        expect(appointmentReferenceLine('en', '3f9a1c2b-0000-4000-8000-000000000000')).toBe('\nReference: 3F9A1C2B');
        expect(appointmentReferenceLine('pt', '3f9a1c2b-0000-4000-8000-000000000000')).toBe('\nReferência: 3F9A1C2B');
        expect(appointmentReferenceLine('fr', '3f9a1c2b-0000-4000-8000-000000000000')).toBe('\nRéférence : 3F9A1C2B');
        expect(appointmentReferenceLine('es', undefined)).toBe('');
    });
});
