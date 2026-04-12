import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IChannelAdapter } from '../channel-gateway.service';
import { NormalizedMessage, ChannelType } from '@parallext/shared';
import { v4 as uuid } from 'uuid';

/**
 * WhatsApp Cloud API adapter
 * Handles incoming webhooks and outbound messages via Meta's Cloud API
 */
@Injectable()
export class WhatsAppAdapter implements IChannelAdapter {
    readonly channelType: ChannelType = 'whatsapp';
    private readonly logger = new Logger(WhatsAppAdapter.name);
    private readonly apiUrl = 'https://graph.facebook.com/v21.0';

    constructor(private configService: ConfigService) {}

    /**
     * Mark a message as read (blue checks) via Meta API.
     * Call this immediately when receiving a webhook, before processing.
     * Blueprint Paso 6: Read receipts.
     */
    async markAsRead(phoneNumberId: string, messageId: string, accessToken: string): Promise<void> {
        if (!messageId || !phoneNumberId) return;

        try {
            const url = `${this.apiUrl}/${phoneNumberId}/messages`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    status: 'read',
                    message_id: messageId,
                }),
            });

            if (!response.ok) {
                const data = await response.json() as any;
                this.logger.warn(`markAsRead failed for ${messageId}: ${data.error?.message || response.status}`);
            }
        } catch (e: any) {
            // Fire-and-forget: don't block message processing
            this.logger.warn(`markAsRead error: ${e.message}`);
        }
    }

    /**
     * Send typing indicator ("escribiendo...") to the customer.
     * Call before generating AI response so the user sees activity.
     */
    async sendTypingIndicator(phoneNumberId: string, to: string, accessToken: string): Promise<void> {
        if (!phoneNumberId || !to) return;

        try {
            const url = `${this.apiUrl}/${phoneNumberId}/messages`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to,
                    type: 'typing_indicator',
                    typing_indicator: {
                        type: 'text',
                    },
                }),
            });

            if (!response.ok) {
                const data = await response.json().catch(() => ({})) as any;
                this.logger.debug(`Typing indicator response: ${response.status} — ${data.error?.message || 'unknown'}`);
            }
        } catch (e: any) {
            this.logger.debug(`Typing indicator failed (non-blocking): ${e.message}`);
        }
    }

    /**
     * Verify webhook subscription (Meta verification challenge)
     */
    verifyWebhook(query: any): string | null {
        const mode = query['hub.mode'];
        const token = query['hub.verify_token'];
        const challenge = query['hub.challenge'];

        const verifyToken = this.configService.get<string>('META_VERIFY_TOKEN')
            || this.configService.get<string>('WHATSAPP_VERIFY_TOKEN');

        if (mode === 'subscribe' && token === verifyToken) {
            this.logger.log('WhatsApp webhook verified');
            return challenge;
        }

        this.logger.warn('WhatsApp webhook verification failed');
        return null;
    }

    /**
     * Parse incoming WhatsApp webhook into normalized message
     */
    async handleWebhook(payload: any, accountId: string): Promise<NormalizedMessage | null> {
        try {
            const entry = payload?.entry?.[0];
            const changes = entry?.changes?.[0];
            const value = changes?.value;

            if (!value?.messages?.[0]) {
                return null; // Status update or other non-message event
            }

            const message = value.messages[0];
            const contact = value.contacts?.[0];
            const metadata = value.metadata;

            const normalized: NormalizedMessage = {
                id: uuid(),
                tenantId: '', // Will be resolved by the gateway controller
                channelType: 'whatsapp',
                channelAccountId: metadata?.phone_number_id || accountId,
                contactId: message.from,
                conversationId: '', // Will be resolved/created by conversation service
                direction: 'inbound',
                content: this.parseMessageContent(message),
                timestamp: new Date(parseInt(message.timestamp) * 1000),
                status: 'pending',
                metadata: {
                    waMessageId: message.id,
                    contactName: contact?.profile?.name,
                    phoneNumberId: metadata?.phone_number_id,
                },
            };

            return normalized;
        } catch (error) {
            this.logger.error(`Error parsing WhatsApp webhook: ${error}`);
            return null;
        }
    }

    /**
     * Send a text message via WhatsApp Cloud API
     */
    async sendTextMessage(to: string, text: string, phoneNumberId: string, accessToken: string): Promise<string> {
        const url = `${this.apiUrl}/${phoneNumberId}/messages`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to,
                type: 'text',
                text: { body: text },
            }),
        });

        const data = await response.json() as any;

        if (!response.ok) {
            this.logger.error(`WhatsApp send failed: ${JSON.stringify(data)}`);
            throw new Error(`WhatsApp API error: ${data.error?.message || 'Unknown error'}`);
        }

        return data.messages?.[0]?.id || '';
    }

    /**
     * Send a media message via WhatsApp Cloud API
     */
    async sendMediaMessage(to: string, mediaUrl: string, caption: string | undefined, phoneNumberId: string, accessToken: string): Promise<string> {
        const url = `${this.apiUrl}/${phoneNumberId}/messages`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to,
                type: 'image',
                image: {
                    link: mediaUrl,
                    caption: caption || '',
                },
            }),
        });

        const data = await response.json() as any;

        if (!response.ok) {
            throw new Error(`WhatsApp API error: ${data.error?.message || 'Unknown error'}`);
        }

        return data.messages?.[0]?.id || '';
    }

    /**
     * Parse different WhatsApp message types into normalized content
     */
    private parseMessageContent(message: any) {
        switch (message.type) {
            case 'text':
                return { type: 'text' as const, text: message.text?.body || '' };

            case 'image':
                return {
                    type: 'image' as const,
                    mediaUrl: message.image?.id, // Need to download via media endpoint
                    mimeType: message.image?.mime_type,
                    caption: message.image?.caption,
                };

            case 'audio':
                return {
                    type: 'audio' as const,
                    mediaUrl: message.audio?.id,
                    mimeType: message.audio?.mime_type,
                };

            case 'video':
                return {
                    type: 'video' as const,
                    mediaUrl: message.video?.id,
                    mimeType: message.video?.mime_type,
                    caption: message.video?.caption,
                };

            case 'document':
                return {
                    type: 'document' as const,
                    mediaUrl: message.document?.id,
                    mimeType: message.document?.mime_type,
                    filename: message.document?.filename,
                    caption: message.document?.caption,
                };

            case 'location':
                return {
                    type: 'location' as const,
                    latitude: message.location?.latitude,
                    longitude: message.location?.longitude,
                    text: message.location?.name || `${message.location?.latitude},${message.location?.longitude}`,
                };

            default:
                return { type: 'text' as const, text: `[Unsupported message type: ${message.type}]` };
        }
    }
}
