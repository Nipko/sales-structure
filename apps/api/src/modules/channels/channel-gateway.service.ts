import { Injectable, Logger } from '@nestjs/common';
import { NormalizedMessage, ChannelType, OutboundMessage } from '@parallext/shared';
import { WebhookTapService } from './webhook-tap.service';

/**
 * Abstract interface that all channel adapters must implement.
 * This is the core of the unified messaging gateway.
 */
export interface IChannelAdapter {
    readonly channelType: ChannelType;
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
    async sendMessage(outbound: OutboundMessage, accessToken: string): Promise<string | null> {
        const adapter = this.adapters.get(outbound.channelType);
        if (!adapter) {
            this.logger.warn(`No adapter for channel: ${outbound.channelType}`);
            return null;
        }

        try {
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
                    // Flow rejected by Meta (draft/unpublished/bad id) — don't leave the
                    // customer with nothing: fall through to the text body below.
                    this.logger.warn(`Flow send failed (${e?.message}); falling back to text`);
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
                return await adapter.sendMediaMessage(
                    outbound.to,
                    outbound.content.mediaUrl,
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
            return null;
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
