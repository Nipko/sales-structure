import { Injectable, Logger } from '@nestjs/common';
import { NormalizedMessage, ChannelType, OutboundMessage } from '@parallext/shared';

/**
 * Abstract interface that all channel adapters must implement.
 * This is the core of the unified messaging gateway.
 */
export interface IChannelAdapter {
    readonly channelType: ChannelType;
    handleWebhook(payload: any, accountId: string): Promise<NormalizedMessage | null>;
    sendTextMessage(to: string, text: string, accountId: string, accessToken: string): Promise<string>;
    sendMediaMessage(to: string, mediaUrl: string, caption: string | undefined, accountId: string, accessToken: string): Promise<string>;
    verifyWebhook(query: any): string | null;
}

@Injectable()
export class ChannelGatewayService {
    private readonly logger = new Logger(ChannelGatewayService.name);
    private adapters: Map<ChannelType, IChannelAdapter> = new Map();

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
            return null;
        }

        try {
            return await adapter.handleWebhook(payload, accountId);
        } catch (error) {
            this.logger.error(`Error processing ${channelType} webhook: ${error}`);
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
            if (outbound.content.type === 'text' && outbound.content.text) {
                return await adapter.sendTextMessage(
                    outbound.to,
                    outbound.content.text,
                    outbound.channelAccountId,
                    accessToken,
                );
            }

            if (outbound.content.mediaUrl) {
                return await adapter.sendMediaMessage(
                    outbound.to,
                    outbound.content.mediaUrl,
                    outbound.content.caption,
                    outbound.channelAccountId,
                    accessToken,
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
            const adapter = this.adapters.get(channelType) as any;
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
