import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter';
import { InstagramAdapter } from './instagram/instagram.adapter';
import { MessengerAdapter } from './messenger/messenger.adapter';
import { TelegramAdapter } from './telegram/telegram.adapter';
import { WidgetChannelAdapter } from './widget.adapter';
import type { ChannelCertificationInput } from './channel-certification-matrix';

/**
 * The runtime's own answers about the channels, assembled once.
 *
 * This used to live inside `channel-certification-matrix.spec.ts`, which meant
 * the matrix could be computed by the test and by nothing else: the only
 * importer of the whole module was its own spec. A capability table that
 * answers "what may this channel be said to do" and that no product surface can
 * ask is not a certification, it is a passing test.
 *
 * The derived half stays derived. `sendStrict` is asked of the real adapter
 * prototypes — the same question `ChannelGatewayService.getStrictTransport`
 * asks — so an adapter that loses its strict transport changes this answer
 * instead of leaving a stale claim behind.
 *
 * The declared half is written down here rather than inferred, and each line
 * says who would have to change for it to move. Inferring it from, say, the
 * presence of a webhook handler would produce a number that looks derived and
 * is not, which is worse than a declaration a reader can check.
 */
export function channelCertificationRuntime(): ChannelCertificationInput {
    const strictTransports = Object.entries({
        whatsapp: WhatsAppAdapter, instagram: InstagramAdapter, messenger: MessengerAdapter,
        telegram: TelegramAdapter, web_widget: WidgetChannelAdapter,
    }).filter(([, adapter]) => typeof (adapter.prototype as any).sendStrict === 'function')
        .map(([channel]) => channel);

    return {
        strictTransports,
        // A batch is only created where the transport can say what happened;
        // the switch cannot make a channel durable that cannot report.
        durableDispatchChannels: strictTransports,
        // The widget has no third party to accept a message, so its admission
        // IS the delivery. A missing strict transport there is the design.
        localAdmissionChannels: ['web_widget'],
        inboundChannels: ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'],
        // Telegram is absent on purpose: its Bot API reports no delivery or read
        // state back, so there is nothing for a producer to feed.
        deliveryStatusProducers: ['whatsapp', 'instagram', 'messenger', 'web_widget'],
        readStatusProducers: ['whatsapp', 'instagram', 'messenger'],
    };
}
