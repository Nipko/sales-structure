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

            const senderName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ');

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
                    tgSenderName: senderName,
                    tgUsername: message.from?.username,
                    contactName: senderName, // Used by ConversationsService for CRM lead name
                    updateId: payload.update_id?.toString(),
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
     * Send media via Telegram Bot API.
     * Detects type from mimeType and routes to the correct API method.
     */
    async sendMediaMessage(to: string, mediaUrl: string, caption: string | undefined, _botId: string, botToken: string): Promise<string> {
        // Determine the correct Telegram method based on URL or default to photo
        const method = this.resolveMediaMethod(mediaUrl);
        const url = `${this.apiUrl}/bot${botToken}/${method}`;
        const mediaField = this.resolveMediaField(method);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: to,
                [mediaField]: mediaUrl,
                caption: caption || '',
                parse_mode: 'HTML',
            }),
        });

        const data = await response.json() as any;

        if (!data.ok) {
            this.logger.error(`Telegram media send failed: ${JSON.stringify(data)}`);
            throw new Error(`Telegram API error: ${data.description || 'Unknown error'}`);
        }

        return data.result?.message_id?.toString() || '';
    }

    /**
     * Send typing indicator (sendChatAction with action=typing)
     */
    async sendTypingIndicator(_botId: string, to: string, botToken: string): Promise<void> {
        const url = `${this.apiUrl}/bot${botToken}/sendChatAction`;

        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: to,
                action: 'typing',
            }),
        }).catch(() => { /* fire-and-forget */ });
    }

    /**
     * Resolve a Telegram file_id to a downloadable URL.
     * Calls getFile → constructs https://api.telegram.org/file/bot{token}/{file_path}
     */
    async resolveFileUrl(fileId: string, botToken: string): Promise<string | null> {
        try {
            const url = `${this.apiUrl}/bot${botToken}/getFile?file_id=${fileId}`;
            const response = await fetch(url);
            const data = await response.json() as any;

            if (!data.ok || !data.result?.file_path) {
                this.logger.warn(`Could not resolve Telegram file: ${fileId}`);
                return null;
            }

            return `${this.apiUrl}/file/bot${botToken}/${data.result.file_path}`;
        } catch (error) {
            this.logger.error(`Error resolving Telegram file: ${error}`);
            return null;
        }
    }

    /**
     * Set webhook URL for a bot via Telegram API.
     * Called when connecting a bot from the dashboard.
     */
    async setWebhook(botToken: string, webhookUrl: string): Promise<{ ok: boolean; description?: string }> {
        const url = `${this.apiUrl}/bot${botToken}/setWebhook`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: webhookUrl,
                allowed_updates: ['message', 'edited_message', 'callback_query'],
                drop_pending_updates: false,
            }),
        });

        const data = await response.json() as any;
        return { ok: data.ok, description: data.description };
    }

    /**
     * Validate bot token by calling getMe.
     * Returns bot info if valid, null otherwise.
     */
    async validateBotToken(botToken: string): Promise<{ id: number; username: string; firstName: string } | null> {
        try {
            const url = `${this.apiUrl}/bot${botToken}/getMe`;
            const response = await fetch(url);
            const data = await response.json() as any;

            if (!data.ok) return null;

            return {
                id: data.result.id,
                username: data.result.username,
                firstName: data.result.first_name,
            };
        } catch {
            return null;
        }
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
                mediaUrl: photo.file_id, // Resolved via resolveFileUrl when needed
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

        // Contact shared
        if (message.contact) {
            return {
                type: 'text' as const,
                text: `Contacto: ${message.contact.first_name} ${message.contact.last_name || ''} — ${message.contact.phone_number}`,
            };
        }

        // Sticker
        if (message.sticker) {
            return { type: 'text' as const, text: `[Sticker: ${message.sticker.emoji || ''}]` };
        }

        return { type: 'text' as const, text: '[Tipo de mensaje no soportado]' };
    }

    /**
     * Determine the Telegram API method based on media URL extension/pattern
     */
    private resolveMediaMethod(mediaUrl: string): string {
        const lower = mediaUrl.toLowerCase();
        if (lower.match(/\.(mp4|mov|avi|mkv)$/)) return 'sendVideo';
        if (lower.match(/\.(mp3|ogg|wav|m4a|opus)$/)) return 'sendAudio';
        if (lower.match(/\.(pdf|doc|docx|xls|xlsx|zip|rar|txt|csv)$/)) return 'sendDocument';
        return 'sendPhoto';
    }

    /**
     * Map Telegram method to the correct body field name
     */
    private resolveMediaField(method: string): string {
        switch (method) {
            case 'sendVideo': return 'video';
            case 'sendAudio': return 'audio';
            case 'sendDocument': return 'document';
            default: return 'photo';
        }
    }
}
