import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IChannelAdapter } from '../channel-gateway.service';
import { NormalizedMessage, ChannelType } from '@parallext/shared';
import { v4 as uuid } from 'uuid';

/**
 * Instagram DM Adapter
 * 
 * Handles incoming DMs via Instagram Messaging API (part of Meta Graph API).
 * Uses the same Facebook App as WhatsApp — requires Instagram Business Account
 * linked to a Facebook Page with the Messaging permission.
 * 
 * Webhook events: instagram → messaging → message
 * API: https://graph.facebook.com/v21.0/{ig-user-id}/messages
 */
@Injectable()
export class InstagramAdapter implements IChannelAdapter {
    readonly channelType: ChannelType = 'instagram';
    private readonly logger = new Logger(InstagramAdapter.name);
    private readonly apiUrl = 'https://graph.facebook.com/v21.0';

    constructor(private configService: ConfigService) { }

    /**
     * Verify webhook subscription (same Meta verification pattern)
     */
    verifyWebhook(query: any): string | null {
        const mode = query['hub.mode'];
        const token = query['hub.verify_token'];
        const challenge = query['hub.challenge'];

        const verifyToken = this.configService.get<string>('INSTAGRAM_VERIFY_TOKEN')
            || this.configService.get<string>('WHATSAPP_VERIFY_TOKEN'); // Shared token OK

        if (mode === 'subscribe' && token === verifyToken) {
            this.logger.log('Instagram webhook verified');
            return challenge;
        }

        this.logger.warn('Instagram webhook verification failed');
        return null;
    }

    /**
     * Parse incoming Instagram DM webhook into normalized message
     * 
     * Instagram webhook payload structure:
     * { object: "instagram", entry: [{ id: IG_USER_ID, messaging: [{ sender, recipient, timestamp, message }] }] }
     */
    async handleWebhook(payload: any, accountId: string): Promise<NormalizedMessage | null> {
        try {
            const entry = payload?.entry?.[0];
            const messaging = entry?.messaging?.[0];

            if (!messaging?.message) {
                // Could be a read receipt, echo, or reaction — skip
                return null;
            }

            const message = messaging.message;
            const senderId = messaging.sender?.id;
            const recipientId = messaging.recipient?.id;

            if (!senderId || message.is_echo) return null;

            const normalized: NormalizedMessage = {
                id: uuid(),
                tenantId: '', // Resolved by gateway controller
                channelType: 'instagram',
                channelAccountId: recipientId || accountId,
                contactId: senderId,
                conversationId: '', // Resolved by conversation service
                direction: 'inbound',
                content: this.parseMessageContent(message),
                timestamp: new Date(messaging.timestamp),
                status: 'pending',
                metadata: {
                    igMessageId: message.mid,
                    igSenderId: senderId,
                    igRecipientId: recipientId,
                },
            };

            return normalized;
        } catch (error) {
            this.logger.error(`Error parsing Instagram webhook: ${error}`);
            return null;
        }
    }

    /**
     * Send a text message via Instagram Messaging API
     */
    async sendTextMessage(to: string, text: string, igUserId: string, accessToken: string): Promise<string> {
        const url = `${this.apiUrl}/${igUserId}/messages`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                recipient: { id: to },
                message: { text },
            }),
        });

        const data = await response.json() as any;

        if (!response.ok) {
            this.logger.error(`Instagram send failed: ${JSON.stringify(data)}`);
            throw new Error(`Instagram API error: ${data.error?.message || 'Unknown error'}`);
        }

        return data.message_id || '';
    }

    /**
     * Send a media message via Instagram Messaging API
     */
    async sendMediaMessage(to: string, mediaUrl: string, caption: string | undefined, igUserId: string, accessToken: string): Promise<string> {
        const url = `${this.apiUrl}/${igUserId}/messages`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                recipient: { id: to },
                message: {
                    attachment: {
                        type: 'image',
                        payload: { url: mediaUrl, is_reusable: true },
                    },
                },
            }),
        });

        const data = await response.json() as any;

        if (!response.ok) {
            throw new Error(`Instagram API error: ${data.error?.message || 'Unknown error'}`);
        }

        return data.message_id || '';
    }

    /**
     * Parse Instagram message content types
     */
    private parseMessageContent(message: any) {
        // Text message
        if (message.text) {
            return { type: 'text' as const, text: message.text };
        }

        // Attachments (image, video, audio, file)
        if (message.attachments?.[0]) {
            const attachment = message.attachments[0];
            const type = attachment.type === 'image' ? 'image'
                : attachment.type === 'video' ? 'video'
                    : attachment.type === 'audio' ? 'audio'
                        : 'document';

            return {
                type: type as 'image' | 'video' | 'audio' | 'document',
                mediaUrl: attachment.payload?.url,
                mimeType: attachment.type,
            };
        }

        // Story mention or reply
        if (message.reply_to?.story) {
            return { type: 'text' as const, text: '[Respuesta a tu historia de Instagram]' };
        }

        return { type: 'text' as const, text: '[Tipo de mensaje no soportado]' };
    }
}
