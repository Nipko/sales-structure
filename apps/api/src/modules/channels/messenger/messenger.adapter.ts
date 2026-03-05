import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IChannelAdapter } from '../channel-gateway.service';
import { NormalizedMessage, ChannelType } from '@parallext/shared';
import { v4 as uuid } from 'uuid';

/**
 * Facebook Messenger Adapter
 * 
 * Handles incoming messages via Messenger Platform API (Meta Graph API).
 * Requires a Facebook Page connected to the Meta App with the
 * pages_messaging permission.
 * 
 * Webhook events: page → messaging → message
 * API: https://graph.facebook.com/v21.0/me/messages
 */
@Injectable()
export class MessengerAdapter implements IChannelAdapter {
    readonly channelType: ChannelType = 'messenger';
    private readonly logger = new Logger(MessengerAdapter.name);
    private readonly apiUrl = 'https://graph.facebook.com/v21.0';

    constructor(private configService: ConfigService) { }

    /**
     * Verify webhook (same Meta verification challenge pattern)
     */
    verifyWebhook(query: any): string | null {
        const mode = query['hub.mode'];
        const token = query['hub.verify_token'];
        const challenge = query['hub.challenge'];

        const verifyToken = this.configService.get<string>('MESSENGER_VERIFY_TOKEN')
            || this.configService.get<string>('WHATSAPP_VERIFY_TOKEN');

        if (mode === 'subscribe' && token === verifyToken) {
            this.logger.log('Messenger webhook verified');
            return challenge;
        }

        this.logger.warn('Messenger webhook verification failed');
        return null;
    }

    /**
     * Parse Messenger webhook into normalized message
     * 
     * Messenger payload:
     * { object: "page", entry: [{ id: PAGE_ID, messaging: [{ sender, recipient, timestamp, message }] }] }
     */
    async handleWebhook(payload: any, accountId: string): Promise<NormalizedMessage | null> {
        try {
            const entry = payload?.entry?.[0];
            const messaging = entry?.messaging?.[0];

            if (!messaging?.message) {
                // Delivery confirmation, read receipt, or postback
                return null;
            }

            const message = messaging.message;
            const senderId = messaging.sender?.id;
            const recipientId = messaging.recipient?.id;

            if (!senderId || message.is_echo) return null;

            const normalized: NormalizedMessage = {
                id: uuid(),
                tenantId: '', // Resolved by gateway
                channelType: 'messenger',
                channelAccountId: recipientId || accountId,
                contactId: senderId,
                conversationId: '', // Resolved by conversation service
                direction: 'inbound',
                content: this.parseMessageContent(message),
                timestamp: new Date(messaging.timestamp),
                status: 'pending',
                metadata: {
                    fbMessageId: message.mid,
                    fbSenderId: senderId,
                    fbPageId: recipientId,
                },
            };

            return normalized;
        } catch (error) {
            this.logger.error(`Error parsing Messenger webhook: ${error}`);
            return null;
        }
    }

    /**
     * Send a text message via Messenger Send API
     */
    async sendTextMessage(to: string, text: string, _pageId: string, accessToken: string): Promise<string> {
        const url = `${this.apiUrl}/me/messages`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                recipient: { id: to },
                message: { text },
                messaging_type: 'RESPONSE',
            }),
        });

        const data = await response.json() as any;

        if (!response.ok) {
            this.logger.error(`Messenger send failed: ${JSON.stringify(data)}`);
            throw new Error(`Messenger API error: ${data.error?.message || 'Unknown error'}`);
        }

        return data.message_id || '';
    }

    /**
     * Send a media message via Messenger Send API
     */
    async sendMediaMessage(to: string, mediaUrl: string, caption: string | undefined, _pageId: string, accessToken: string): Promise<string> {
        const url = `${this.apiUrl}/me/messages`;

        // Messenger supports attachment + text separately; send both if caption exists
        const messages: any[] = [];

        // Media attachment
        messages.push({
            recipient: { id: to },
            message: {
                attachment: {
                    type: 'image',
                    payload: { url: mediaUrl, is_reusable: true },
                },
            },
            messaging_type: 'RESPONSE',
        });

        // Caption as follow-up text
        if (caption) {
            messages.push({
                recipient: { id: to },
                message: { text: caption },
                messaging_type: 'RESPONSE',
            });
        }

        let lastMessageId = '';
        for (const msg of messages) {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(msg),
            });

            const data = await response.json() as any;
            if (!response.ok) {
                throw new Error(`Messenger API error: ${data.error?.message || 'Unknown error'}`);
            }
            lastMessageId = data.message_id || '';
        }

        return lastMessageId;
    }

    /**
     * Parse Messenger message content types
     */
    private parseMessageContent(message: any) {
        // Text message
        if (message.text) {
            return { type: 'text' as const, text: message.text };
        }

        // Attachments 
        if (message.attachments?.[0]) {
            const attachment = message.attachments[0];

            switch (attachment.type) {
                case 'image':
                    return { type: 'image' as const, mediaUrl: attachment.payload?.url, mimeType: 'image/*' };
                case 'video':
                    return { type: 'video' as const, mediaUrl: attachment.payload?.url, mimeType: 'video/*' };
                case 'audio':
                    return { type: 'audio' as const, mediaUrl: attachment.payload?.url, mimeType: 'audio/*' };
                case 'file':
                    return { type: 'document' as const, mediaUrl: attachment.payload?.url, mimeType: 'application/*' };
                case 'location':
                    return {
                        type: 'location' as const,
                        latitude: attachment.payload?.coordinates?.lat,
                        longitude: attachment.payload?.coordinates?.long,
                        text: `${attachment.payload?.coordinates?.lat},${attachment.payload?.coordinates?.long}`,
                    };
                default:
                    return { type: 'text' as const, text: `[Adjunto: ${attachment.type}]` };
            }
        }

        // Quick reply
        if (message.quick_reply) {
            return { type: 'text' as const, text: message.quick_reply.payload || message.text || '' };
        }

        return { type: 'text' as const, text: '[Tipo de mensaje no soportado]' };
    }
}
