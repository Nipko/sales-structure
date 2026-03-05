import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IChannelAdapter } from '../channel-gateway.service';
import { NormalizedMessage, ChannelType } from '@parallext/shared';
import { v4 as uuid } from 'uuid';

/**
 * Telegram Bot API Adapter
 * 
 * Handles incoming messages via Telegram Bot API.
 * Uses the standard Bot API (not TDLib) for simplicity.
 * 
 * Webhook: receives Update objects from Telegram
 * API: https://api.telegram.org/bot{token}/sendMessage
 */
@Injectable()
export class TelegramAdapter implements IChannelAdapter {
    readonly channelType: ChannelType = 'telegram';
    private readonly logger = new Logger(TelegramAdapter.name);
    private readonly apiUrl = 'https://api.telegram.org';

    constructor(private configService: ConfigService) { }

    /**
     * Telegram uses a different verification method: setWebhook.
     * This is a no-op because Telegram sets webhooks actively via API call,
     * there's no challenge/response like Meta.
     */
    verifyWebhook(_query: any): string | null {
        // Telegram doesn't use GET verification. Return null to signal no challenge.
        return null;
    }

    /**
     * Parse incoming Telegram Update into normalized message
     * 
     * Telegram Update structure:
     * { update_id, message: { message_id, from, chat, date, text, photo, document, etc } }
     */
    async handleWebhook(payload: any, _accountId: string): Promise<NormalizedMessage | null> {
        try {
            const message = payload?.message || payload?.edited_message;
            if (!message) {
                // Could be callback_query, inline_query, etc. — skip for now
                return null;
            }

            const chatId = message.chat?.id?.toString();
            const senderId = message.from?.id?.toString();

            if (!chatId || !senderId) return null;

            // Skip bot messages
            if (message.from?.is_bot) return null;

            const normalized: NormalizedMessage = {
                id: uuid(),
                tenantId: '', // Resolved by gateway
                channelType: 'telegram',
                channelAccountId: _accountId, // Bot username or ID
                contactId: chatId,
                conversationId: '',  // Resolved by conversation service
                direction: 'inbound',
                content: this.parseMessageContent(message),
                timestamp: new Date(message.date * 1000),
                status: 'pending',
                metadata: {
                    tgMessageId: message.message_id?.toString(),
                    tgChatId: chatId,
                    tgSenderId: senderId,
                    tgSenderName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' '),
                    tgUsername: message.from?.username,
                },
            };

            return normalized;
        } catch (error) {
            this.logger.error(`Error parsing Telegram webhook: ${error}`);
            return null;
        }
    }

    /**
     * Send a text message via Telegram Bot API
     */
    async sendTextMessage(to: string, text: string, _botId: string, botToken: string): Promise<string> {
        const url = `${this.apiUrl}/bot${botToken}/sendMessage`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: to,
                text,
                parse_mode: 'HTML',
            }),
        });

        const data = await response.json() as any;

        if (!data.ok) {
            this.logger.error(`Telegram send failed: ${JSON.stringify(data)}`);
            throw new Error(`Telegram API error: ${data.description || 'Unknown error'}`);
        }

        return data.result?.message_id?.toString() || '';
    }

    /**
     * Send a photo/media via Telegram Bot API
     */
    async sendMediaMessage(to: string, mediaUrl: string, caption: string | undefined, _botId: string, botToken: string): Promise<string> {
        const url = `${this.apiUrl}/bot${botToken}/sendPhoto`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: to,
                photo: mediaUrl,
                caption: caption || '',
                parse_mode: 'HTML',
            }),
        });

        const data = await response.json() as any;

        if (!data.ok) {
            throw new Error(`Telegram API error: ${data.description || 'Unknown error'}`);
        }

        return data.result?.message_id?.toString() || '';
    }

    /**
     * Parse Telegram message content types
     */
    private parseMessageContent(message: any) {
        // Text message
        if (message.text) {
            return { type: 'text' as const, text: message.text };
        }

        // Photo (array of sizes, take the largest)
        if (message.photo) {
            const photo = message.photo[message.photo.length - 1];
            return {
                type: 'image' as const,
                mediaUrl: photo.file_id, // Need to resolve via getFile API
                mimeType: 'image/jpeg',
                caption: message.caption,
            };
        }

        // Document
        if (message.document) {
            return {
                type: 'document' as const,
                mediaUrl: message.document.file_id,
                mimeType: message.document.mime_type,
                filename: message.document.file_name,
                caption: message.caption,
            };
        }

        // Audio
        if (message.audio || message.voice) {
            const audio = message.audio || message.voice;
            return {
                type: 'audio' as const,
                mediaUrl: audio.file_id,
                mimeType: audio.mime_type || 'audio/ogg',
            };
        }

        // Video
        if (message.video || message.video_note) {
            const video = message.video || message.video_note;
            return {
                type: 'video' as const,
                mediaUrl: video.file_id,
                mimeType: video.mime_type || 'video/mp4',
                caption: message.caption,
            };
        }

        // Location
        if (message.location) {
            return {
                type: 'location' as const,
                latitude: message.location.latitude,
                longitude: message.location.longitude,
                text: `${message.location.latitude},${message.location.longitude}`,
            };
        }

        // Contact
        if (message.contact) {
            return {
                type: 'text' as const,
                text: `📱 Contacto: ${message.contact.first_name} ${message.contact.last_name || ''} — ${message.contact.phone_number}`,
            };
        }

        // Sticker
        if (message.sticker) {
            return { type: 'text' as const, text: `[Sticker: ${message.sticker.emoji || '🎨'}]` };
        }

        return { type: 'text' as const, text: '[Tipo de mensaje no soportado]' };
    }
}
