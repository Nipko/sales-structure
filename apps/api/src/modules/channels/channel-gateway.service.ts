import { Injectable, Logger } from '@nestjs/common';
import { NormalizedMessage, ChannelType, OutboundMessage, isScopedAddressKey } from '@parallext/shared';
import { WebhookTapService } from './webhook-tap.service';
import { channelSafeImageUrl } from '../../common/utils/media-url.util';
import type { StrictDispatchTransport } from './strict-dispatch-transport';
import { classifyFlowFailure } from './flow-fallback';

/**
 * A recipient no channel endpoint can address.
 *
 * Thrown rather than returned as `null`, and the asymmetry is the point.
 * This gateway turns every transport failure into `null`, and a `null`
 * means "no answer came back": the legacy processor records the
 * reservation as a TIMEOUT, which RETAINS the money for a message provably
 * never posted, and then throws — burning the job's attempts. Neither is
 * true here. Nothing was sent, nothing can be, and waiting does not turn a
 * business-scoped id into a phone number.
 *
 * Every caller of `sendMessage` asks the spend authority first, and that
 * authority refuses this by name (`recipient_not_addressable`), so this
 * should never fire. It exists because the five legacy senders on the
 * WhatsApp adapter POST whatever string they are handed — only `sendStrict`
 * checked, and `sendStrict` is the lane the rollout switch leaves OFF by
 * default, so the guard was on the road nobody is driving. "Every caller
 * remembers to ask" is a list somebody maintains; this is a property of the
 * code.
 */
export class UnaddressableRecipient extends Error {
    constructor(readonly channelType: string) {
        super('recipient_not_addressable');
        this.name = 'UnaddressableRecipient';
    }
}

/**
 * What the gateway must ask its caller before doing something the caller did
 * not authorise.
 *
 * There is exactly one such thing today: a text message sent because a Flow was
 * conclusively refused. That is a second remote effect with its own charge, and
 * the reservation the caller holds covers the first one.
 */
export interface GatewaySendHooks {
    /**
     * May a text fallback be sent as a NEW effect? Returning false sends
     * nothing, which is the safe answer when the money authority cannot be
     * reached.
     *
     * NOT optional, and the hooks argument is not optional either. A caller
     * that omits it is a caller whose Flow can quietly become a second POST
     * with a second charge under a reservation that can only settle once — and
     * "every caller remembers" is a list somebody maintains, while a required
     * parameter is a property of the code. A caller that genuinely never sends
     * a Flow still has to say what it would do, which takes one line and is the
     * line that documents the decision.
     */
    readonly admitFallback: (errorCode: string) => Promise<boolean>;
    /**
     * What the provider said when it refused, handed to whoever can act on it.
     *
     * This gateway returns `string | null` and swallows the error — which is
     * right for transport, and wrong for one specific refusal: Meta's 131042
     * means the business has no usable payment method, so every subsequent
     * message from that number will fail the same way until a person adds a
     * card. Without this hook the loose lane learned that only from a status
     * webhook minutes later, and spent the interval retrying into a wall.
     *
     * Deliberately a hook rather than a changed return type: the gateway has no
     * business knowing about money, and the caller is the one that knows which
     * tenant and which number this was.
     */
    readonly observeFailure?: (error: unknown) => Promise<void> | void;
}

/**
 * Abstract interface that all channel adapters must implement.
 * This is the core of the unified messaging gateway.
 */
export interface IChannelAdapter {
    readonly channelType: ChannelType;
    /** Local persisted transports retain tenant/conversation scope from the full envelope. */
    sendOutbound?(outbound: OutboundMessage): Promise<string>;
    handleWebhook(payload: any, accountId: string): Promise<NormalizedMessage | null>;
    sendTextMessage(to: string, text: string, accountId: string, accessToken: string): Promise<string>;
    sendMediaMessage(to: string, mediaUrl: string, caption: string | undefined, accountId: string, accessToken: string, mediaType?: 'image' | 'document' | 'audio' | 'video', filename?: string): Promise<string>;
    verifyWebhook(query: any): string | null;
    /** Optional — best-effort "typing…" indicator. SMS/email don't implement it. */
    sendTypingIndicator?(channelAccountId: string, to: string, accessToken: string): Promise<void>;
    /** Optional — interactive WhatsApp Flow message (opt-in one-step booking). WhatsApp only. */
    sendFlowMessage?(
        to: string,
        channelAccountId: string,
        accessToken: string,
        flowId: string,
        flowToken: string,
        body: string,
        opts?: {
            headerText?: string;
            footerText?: string;
            flowCta?: string;
            mode?: 'published' | 'draft';
            initialScreen?: string;
            initialData?: Record<string, unknown>;
        },
    ): Promise<string>;
}

@Injectable()
export class ChannelGatewayService {
    private readonly logger = new Logger(ChannelGatewayService.name);
    private adapters: Map<ChannelType, IChannelAdapter> = new Map();

    constructor(private readonly webhookTap?: WebhookTapService) {}

    /**
     * Register a channel adapter
     */
    registerAdapter(adapter: IChannelAdapter): void {
        this.adapters.set(adapter.channelType, adapter);
        this.logger.log(`Channel adapter registered: ${adapter.channelType}`);
    }

    /**
     * Get adapter for a channel type
     */
    getAdapter(channelType: ChannelType): IChannelAdapter | undefined {
        return this.adapters.get(channelType);
    }

    /**
     * The strict transport for a channel, or undefined when its adapter has not
     * been migrated. Undefined is a refusal, never an invitation to fall back to
     * `sendMessage`: that method turns every failure into null, which is exactly
     * what the durable dispatch states exist to distinguish.
     */
    getStrictTransport(channelType: ChannelType): StrictDispatchTransport | undefined {
        const adapter = this.adapters.get(channelType) as Partial<StrictDispatchTransport> | undefined;
        return typeof adapter?.sendStrict === 'function' ? adapter as StrictDispatchTransport : undefined;
    }

    /**
     * Process an incoming webhook from any channel
     */
    async processIncomingWebhook(channelType: ChannelType, payload: any, accountId: string): Promise<NormalizedMessage | null> {
        const adapter = this.adapters.get(channelType);
        if (!adapter) {
            this.logger.warn(`No adapter registered for channel: ${channelType}`);
            this.webhookTap?.record({ channelType, accountId, status: 'rejected', error: 'no_adapter' }).catch(() => {});
            return null;
        }

        try {
            const normalized = await adapter.handleWebhook(payload, accountId);
            // Build a non-PII summary for the live tail
            const summary = normalized
                ? `${normalized.contactId?.slice(0, 8) || '?'} → ${(normalized.content?.text || '').slice(0, 50) || `[${normalized.content?.type}]`}`
                : 'no message extracted';
            this.webhookTap?.record({
                channelType,
                accountId,
                status: normalized ? 'parsed' : 'ignored',
                summary,
            }).catch(() => {});
            return normalized;
        } catch (error: any) {
            this.logger.error(`Error processing ${channelType} webhook: ${error}`);
            this.webhookTap?.record({
                channelType,
                accountId,
                status: 'error',
                error: String(error?.message || error).substring(0, 200),
            }).catch(() => {});
            return null;
        }
    }

    /**
     * Send an outbound message to any channel
     */
    async sendMessage(outbound: OutboundMessage, accessToken: string,
        hooks: GatewaySendHooks): Promise<string | null> {
        const adapter = this.adapters.get(outbound.channelType);
        if (!adapter) {
            this.logger.warn(`No adapter for channel: ${outbound.channelType}`);
            return null;
        }

        // ── A DESTINATION NO ENDPOINT UNDERSTANDS ───────────────────────
        //
        // One question — is this stored address a business-scoped id rather
        // than something a provider takes in a destination field — and the
        // answer is the same for every channel that arrives here. WhatsApp
        // is where such a key is minted; Telegram, Instagram, Messenger and
        // the widget would not know what to do with one either. So it is
        // not gated on the channel.
        //
        // Deliberately BEFORE `sendOutbound` and the five legacy senders,
        // and deliberately OUTSIDE the try below: that catch turns every
        // exception into `null`, which is the one answer this refusal must
        // never be confused with.
        if (isScopedAddressKey(outbound.to)) {
            this.logger.error(`[Gateway] refusing ${outbound.channelType}: the recipient is a `
                + 'business-scoped id, which no channel endpoint accepts as a destination');
            throw new UnaddressableRecipient(outbound.channelType);
        }

        try {
            if (adapter.sendOutbound) return await adapter.sendOutbound(outbound);
            // Opt-in WhatsApp Flow: routed by metadata.flowId. If the adapter can't send
            // it (non-WhatsApp), fall through to the text body so the booking never stalls.
            const meta = outbound.metadata as any;
            if (meta?.flowId && adapter.sendFlowMessage) {
                try {
                    return await adapter.sendFlowMessage(
                        outbound.to,
                        outbound.channelAccountId,
                        accessToken,
                        String(meta.flowId),
                        String(meta.flowToken || ''),
                        outbound.content.text || '',
                        {
                            headerText: meta.headerText,
                            footerText: meta.footerText,
                            flowCta: meta.flowCta,
                            mode: meta.flowMode,
                            initialScreen: meta.initialScreen,
                            initialData: meta.initialData,
                        },
                    );
                } catch (e: any) {
                    // ── A SECOND POST NEEDS PROOF AND PERMISSION ───────────
                    //
                    // This used to catch everything and send text. A 400 for an
                    // unpublished flow and a ten-second timeout took the same
                    // branch — and on a timeout the Flow may well have been
                    // delivered, so the customer got two messages and the
                    // business two charges, under one reservation that can only
                    // settle once.
                    const verdict = classifyFlowFailure(e);
                    // Before deciding about the fallback: a Flow refused for
                    // want of a payment method is the same signal as a text
                    // refused for it, and the account has to be paused either
                    // way — otherwise the very next message tries again.
                    await this.observeFailure(hooks, e);
                    if (!verdict.mayFallBack) {
                        this.logger.warn(`Flow send is ${verdict.kind} (${verdict.errorCode}); `
                            + `NOT falling back — a second message would be a guess`);
                        return null;
                    }
                    // Conclusively refused: nothing was delivered, so a text is
                    // honest. It is a NEW remote effect, so it needs its own
                    // authorisation — and if the caller cannot give one, it does
                    // not happen.
                    if (!(await hooks.admitFallback(verdict.errorCode))) {
                        this.logger.warn(`Flow rejected (${verdict.errorCode}) and the text fallback `
                            + `was not authorised; sending nothing`);
                        return null;
                    }
                    this.logger.warn(`Flow conclusively rejected (${verdict.errorCode}); `
                        + `falling back to text as a separate effect`);
                }
            }

            if (outbound.content.type === 'text' && outbound.content.text) {
                return await adapter.sendTextMessage(
                    outbound.to,
                    outbound.content.text,
                    outbound.channelAccountId,
                    accessToken,
                );
            }

            if (outbound.content.mediaUrl) {
                const mt = outbound.content.type;
                const mediaType = (mt === 'document' || mt === 'audio' || mt === 'video') ? mt : 'image';
                // Único borde por el que TODOS los canales reciben la URL, y por
                // eso el lugar donde se corrige el formato: guardamos WebP y
                // ningún canal de Meta lo acepta en un mensaje de imagen. Se
                // hace acá y no en quien arma la URL porque los que la arman son
                // varios y uno solo alcanza para que el cliente no reciba nada.
                const mediaUrl = mediaType === 'image'
                    ? (channelSafeImageUrl(outbound.content.mediaUrl) || outbound.content.mediaUrl)
                    : outbound.content.mediaUrl;
                return await adapter.sendMediaMessage(
                    outbound.to,
                    mediaUrl,
                    outbound.content.caption,
                    outbound.channelAccountId,
                    accessToken,
                    mediaType,
                    (outbound.content as any).filename,
                );
            }

            this.logger.warn('Unsupported message content type');
            return null;
        } catch (error) {
            this.logger.error(`Error sending ${outbound.channelType} message: ${error}`);
            // The caller gets `null` as before — nothing about transport
            // changes — but it also gets a chance to read WHY, which is the
            // difference between pausing a number once and retrying into a
            // wall for as long as the queue has work.
            await this.observeFailure(hooks, error);
            return null;
        }
    }

    /** Never lets the observer's own failure become the send's failure. */
    private async observeFailure(hooks: GatewaySendHooks, error: unknown): Promise<void> {
        if (!hooks.observeFailure) return;
        try {
            await hooks.observeFailure(error);
        } catch (observerError: any) {
            this.logger.warn(`[Gateway] failure observer raised: ${observerError?.message}`);
        }
    }

    /**
     * Send typing indicator to show the customer that the agent/AI is composing a response.
     * Fire-and-forget — never blocks the response pipeline.
     */
    async sendTypingIndicator(channelType: ChannelType, channelAccountId: string, to: string, accessToken: string): Promise<void> {
        try {
            const adapter = this.adapters.get(channelType);
            if (adapter?.sendTypingIndicator) {
                await adapter.sendTypingIndicator(channelAccountId, to, accessToken);
            }
        } catch (e: any) {
            this.logger.debug(`Typing indicator failed (non-blocking): ${e.message}`);
        }
    }

    /**
     * List registered adapters
     */
    getRegisteredChannels(): ChannelType[] {
        return Array.from(this.adapters.keys());
    }
}
