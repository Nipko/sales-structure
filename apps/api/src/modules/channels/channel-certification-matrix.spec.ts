import { CERTIFIED_SELF_SERVICE_CHANNELS } from '@parallext/shared';
import { buildChannelCertificationMatrix, summariseChannelCertification,
    CHANNEL_CAPABILITIES } from './channel-certification-matrix';
import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter';
import { InstagramAdapter } from './instagram/instagram.adapter';
import { MessengerAdapter } from './messenger/messenger.adapter';
import { TelegramAdapter } from './telegram/telegram.adapter';
import { WidgetChannelAdapter } from './widget.adapter';

/**
 * What each channel is allowed to be said to do.
 *
 * The rule for this matrix is a prohibition rather than a target: *no
 * certifiques alcance inexistente*. Email has an internal inbound adapter and an
 * admin screen calling tenant routes that do not exist; SMS is a one-way
 * notification bought in credits. Both have appeared in capability lists beside
 * WhatsApp, and a list is exactly where scope nobody can configure gets
 * certified by adjacency.
 *
 * The derived half is fed here from the real adapters, so a declaration that
 * drifts from the code fails instead of shipping as a claim.
 */
describe('what each channel may be said to do', () => {
    /** The runtime's own answer to "does this adapter send strictly?" — the same
     *  question `ChannelGatewayService.getStrictTransport` asks. */
    const strictTransports = Object.entries({
        whatsapp: WhatsAppAdapter, instagram: InstagramAdapter, messenger: MessengerAdapter,
        telegram: TelegramAdapter, web_widget: WidgetChannelAdapter,
    }).filter(([, adapter]) => typeof (adapter.prototype as any).sendStrict === 'function')
        .map(([channel]) => channel);

    const runtime = {
        strictTransports,
        durableDispatchChannels: strictTransports,
        // The widget has no provider to accept a message, so its admission is
        // the delivery. A missing strict transport there is the design.
        localAdmissionChannels: ['web_widget'],
        inboundChannels: ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'],
        deliveryStatusProducers: ['whatsapp', 'instagram', 'messenger', 'web_widget'],
        readStatusProducers: ['whatsapp', 'instagram', 'messenger'],
    };
    const matrix = () => buildChannelCertificationMatrix(runtime);
    const row = (channelType: string) => matrix().find(entry => entry.channelType === channelType)!;

    it('never reports a conversational capability for a channel that is not self-service', () => {
        for (const channelType of ['email', 'sms']) {
            const retained = row(channelType);
            expect(retained.selfService).toBe(false);
            expect(retained.retainedScope).toEqual(expect.any(String));
            // Not one capability, in any state. A row of ticks is how scope that
            // does not exist gets read as supported.
            expect(retained.capabilities.every(cell => cell.basis === 'out_of_scope')).toBe(true);
            expect(retained.pending).toEqual([]);
        }
    });

    it('says what a retained channel actually is, in a sentence', () => {
        expect(row('email').retainedScope).toContain('routes that do not exist');
        expect(row('sms').retainedScope).toContain('One-way');
    });

    it('covers every certified self-service channel and nothing else as self-service', () => {
        expect(matrix().filter(entry => entry.selfService).map(entry => entry.channelType).sort())
            .toEqual([...CERTIFIED_SELF_SERVICE_CHANNELS].sort());
    });

    it('derives the transport from the adapters rather than from a declaration', () => {
        // Every certified channel WITH A PROVIDER implements the strict
        // transport today; if one stops, this says so before the matrix claims
        // otherwise. The widget is deliberately absent: there is nobody to hand
        // the message to, so it admits locally instead.
        expect(strictTransports.sort())
            .toEqual(CERTIFIED_SELF_SERVICE_CHANNELS.filter(channel => channel !== 'web_widget').sort());
        for (const channelType of CERTIFIED_SELF_SERVICE_CHANNELS) {
            const cell = row(channelType).capabilities.find(entry => entry.capability === 'outbound_text')!;
            expect(cell).toMatchObject({ basis: 'derived', state: 'operating' });
        }
        expect(row('web_widget').capabilities.find(cell => cell.capability === 'outbound_text')?.evidence)
            .toContain('local admission');
    });

    it('reports a missing status producer as pending instead of assuming it', () => {
        const telegram = row('telegram');
        expect(telegram.capabilities.find(cell => cell.capability === 'delivery_receipt'))
            .toMatchObject({ basis: 'derived', state: 'pending' });
        expect(telegram.pending).toContain('delivery_receipt');
        // And a channel that does have one is not dragged down by its neighbour.
        expect(row('whatsapp').capabilities.find(cell => cell.capability === 'delivery_receipt')?.state)
            .toBe('operating');
    });

    it('separates "this channel does not offer it" from "this channel is missing it"', () => {
        const telegram = row('telegram');
        const flow = telegram.capabilities.find(cell => cell.capability === 'flow')!;
        expect(flow.basis).toBe('out_of_scope');
        // A Telegram without Flow is not a Telegram with a gap.
        expect(telegram.pending).not.toContain('flow');
        expect(row('whatsapp').capabilities.find(cell => cell.capability === 'flow'))
            .toMatchObject({ basis: 'declared', state: 'prepared' });
    });

    it('gives every declared capability something a reader can go and look at', () => {
        for (const entry of matrix().filter(row => row.selfService)) {
            for (const cell of entry.capabilities.filter(cell => cell.basis === 'declared')) {
                expect(cell.evidence.length).toBeGreaterThan(20);
                expect(cell.evidence).not.toBe('nothing declared');
            }
        }
    });

    it('refuses to call a channel complete while anything in scope is pending', () => {
        const summary = summariseChannelCertification(matrix());
        expect(summary.selfService).toBe(5);
        expect(summary.retained).toBe(2);
        // Telegram and the widget have no provider read receipt, so nothing is
        // complete yet — and the summary names the capability, not just a count.
        expect(summary.pendingByCapability.read_receipt).toEqual(['telegram', 'web_widget']);
        expect(summary.complete).toBeLessThan(summary.selfService);
    });

    it('rolls a channel up to the least advanced thing in its scope', () => {
        // `prepared` beats nothing and loses to nothing: a declared capability
        // with evidence is not the same as one shown working end to end.
        expect(row('telegram').state).toBe('pending');
        expect(row('whatsapp').state).toBe('prepared');
    });

    it('keeps one cell per capability per channel, in a stable order', () => {
        for (const entry of matrix()) {
            expect(entry.capabilities.map(cell => cell.capability)).toEqual([...CHANNEL_CAPABILITIES]);
        }
    });
});
