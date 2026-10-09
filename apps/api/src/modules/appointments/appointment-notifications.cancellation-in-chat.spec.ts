import { AppointmentNotificationsService } from './appointment-notifications.service';
import { apptMsg } from './appointment-notifications-i18n';
import { toPlainText, toTelegramHtml, toWhatsAppFormatting } from '../../common/utils/channel-text-format.util';

/**
 * Production 2026-10-09, Telegram: every cancellation the customer confirmed in the chat («Su cita (Ref. 2F01EC00) quedó
 * cancelada») was followed by a second message with raw markup — «❌ *Cita cancelada* / Su cita de *Corte y estilo* del jueves…»
 * (literal asterisks): the appointment.cancelled listener, written for WhatsApp, sent its own notice into the same thread.
 */
function service(opts: { thread: any; channel?: string }) {
    const s: any = Object.create(AppointmentNotificationsService.prototype);
    s.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    s.eventEmitter = { emit: jest.fn() };
    s.getTenantId = jest.fn().mockResolvedValue('tenant-1');
    s.getContactInfo = jest.fn().mockResolvedValue({ name: 'Joaquin', phone: '1234567', email: 'j@example.com', channel_type: opts.channel ?? 'telegram' });
    s.getAppointmentFacts = jest.fn().mockResolvedValue({ id: 'apt-1', conversationId: 'conv-booking', serviceName: 'Corte y estilo', startAt: '2026-10-15T10:00:00', location: null, meetingUrl: null });
    s.getContactLanguage = jest.fn().mockResolvedValue('es');
    s.getTenantTimezone = jest.fn().mockResolvedValue('America/Bogota');
    s.bookingThread = jest.fn().mockResolvedValue(opts.thread);
    s.dispatchCancellation = jest.fn().mockResolvedValue({ kind: 'sent' });
    s.sendAppointmentEmail = jest.fn().mockResolvedValue(undefined);
    return s as AppointmentNotificationsService & Record<string, jest.Mock>;
}
const cancelled = (over: Record<string, unknown> = {}) => ({
    schemaName: 'tenant_x',
    appointment: { id: 'apt-1', contactId: 'contact-1', serviceName: 'Corte y estilo', startAt: '2026-10-15T10:00:00', status: 'cancelled', ...over },
});

describe('the cancellation notice is not sent into the thread where the customer just cancelled', () => {
    it('skips the channel message when the cancellation was made in a live conversation on the contact\'s channel, and keeps the e-mail', async () => {
        const s = service({ thread: { id: 'conv-chat', channelAccountId: 'acc-1' } });
        await s.onAppointmentCancelled(cancelled({ cancelledInConversationId: 'conv-chat' }));
        expect((s as any).dispatchCancellation).not.toHaveBeenCalled();
        expect((s as any).sendAppointmentEmail).toHaveBeenCalledTimes(1);
        expect((s as any).bookingThread).toHaveBeenCalledWith('tenant_x', 'conv-chat', 'telegram');
    });

    it.each([
        ['a cancellation made from the dashboard (no conversation)', {}, { id: 'conv-chat', channelAccountId: 'acc-1' }],
        ['a conversation that is not a live thread on that channel (other channel, closed or missing)', { cancelledInConversationId: 'conv-chat' }, null],
    ])('still sends it for %s', async (_label, over, thread) => {
        const s = service({ thread });
        await s.onAppointmentCancelled(cancelled(over));
        expect((s as any).dispatchCancellation).toHaveBeenCalledTimes(1);
        expect((s as any).sendAppointmentEmail).toHaveBeenCalledTimes(1);
    });
});

describe('the notices are written once and read correctly on every channel', () => {
    const title = apptMsg('es', 'cancelTitle');
    const body = apptMsg('es', 'cancelBody', { service: 'Corte y estilo', date: 'jueves, 15 de octubre' });

    it('are authored in standard Markdown (every adapter converts it), not in WhatsApp\'s single-asterisk dialect', () => {
        expect(title).toBe('❌ **Cita cancelada**');
        expect(body).toBe('Su cita de **Corte y estilo** del jueves, 15 de octubre ha sido cancelada.');
        for (const lang of ['es', 'en', 'pt', 'fr']) {
            for (const key of ['confirmTitle', 'cancelTitle', 'reminderTitle']) expect(apptMsg(lang, key)).toMatch(/\*\*[^*]+\*\*/);
        }
    });

    it('Telegram shows bold (no literal asterisks), WhatsApp keeps its own bold, plain-text channels drop the markers', () => {
        expect(toTelegramHtml(`${title}\n${body}`)).toBe('❌ <b>Cita cancelada</b>\nSu cita de <b>Corte y estilo</b> del jueves, 15 de octubre ha sido cancelada.');
        expect(toWhatsAppFormatting(`${title}\n${body}`)).toBe('❌ *Cita cancelada*\nSu cita de *Corte y estilo* del jueves, 15 de octubre ha sido cancelada.');
        expect(toPlainText(`${title}\n${body}`)).toBe('❌ Cita cancelada\nSu cita de Corte y estilo del jueves, 15 de octubre ha sido cancelada.');
    });
});
