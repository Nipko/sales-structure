import { Injectable, Logger } from '@nestjs/common';
import { toPlainText } from '../../../common/utils/channel-text-format.util';
import { ConfigService } from '@nestjs/config';
import { IChannelAdapter } from '../channel-gateway.service';
import { NormalizedMessage, ChannelType } from '@parallext/shared';
import { v4 as uuid } from 'uuid';
import {
    classifyTransportFailure, metaGraphAnswer, metaGraphClassifier,
    type StrictDispatchOutcome, type StrictDispatchRequest, type StrictDispatchTransport,
} from '../strict-dispatch-transport';

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
export class InstagramAdapter implements IChannelAdapter, StrictDispatchTransport {
    readonly channelType: ChannelType = 'instagram';
    private readonly logger = new Logger(InstagramAdapter.name);
    private readonly apiUrl = 'https://graph.instagram.com/v21.0';

    constructor(private configService: ConfigService) { }

    /**
     * One POST, one classified outcome.
     *
     * Instagram DMs answer with the same Graph envelope as Messenger — an id or
     * an `error` object, never both — so the classification is shared. What is
     * NOT shared is the path: the sender is the Instagram user id, which arrives
     * as the dispatch row's `channelAccountId` rather than a fixed `me`.
     *
     * `sendMediaMessage` above is what this replaces for durable dispatch: it
     * takes a caption it never sends, so a caller who passed one believed it had
     * been delivered. Here a caption is its own dispatch item with its own
     * receipt, and refusing to accept one in this call is what keeps that true.
     */
    async sendStrict(request: StrictDispatchRequest, accessToken: string): Promise<StrictDispatchOutcome> {
        const igUserId = String(request.channelAccountId || '').trim();
        if (!igUserId) {
            return { kind: 'rejected', errorCode: 'instagram_account_missing', retryable: false };
        }
        let message: Record<string, any>;
        try { message = this.strictMessage(request); }
        catch (error: any) {
            return { kind: 'rejected', errorCode: String(error?.message || 'unsupported_payload'), retryable: false };
        }
        let response: Response;
        try {
            response = await fetch(`${this.apiUrl}/${encodeURIComponent(igUserId)}/messages`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ recipient: { id: request.to }, message }),
                signal: AbortSignal.timeout(10_000),
            });
        } catch (error) { return classifyTransportFailure(error); }
        let data: any = null;
        try { data = await response.json(); } catch { data = null; }
        return metaGraphClassifier(metaGraphAnswer(response.status, data, 'message_id'));
    }

    private strictMessage(request: StrictDispatchRequest): Record<string, any> {
        const payload = request.payload || {};
        if (request.itemKind === 'text' || request.itemKind === 'payment_link') {
            const text = String(payload.text ?? '');
            if (!text.trim()) throw new Error('empty_text_payload');
            return { text: toPlainText(text) };
        }
        if (request.itemKind === 'media') {
            const mediaUrl = String(payload.mediaUrl ?? '');
            if (!mediaUrl.trim()) throw new Error('empty_media_payload');
            // Instagram DMs accept image, video and audio attachments; a
            // document has no representation, so it is refused rather than
            // silently downgraded to a picture the customer cannot open.
            const requested = String(payload.mediaType ?? 'image');
            if (!['image', 'video', 'audio'].includes(requested)) {
                throw new Error(`unsupported_media_type:${requested}`);
            }
            // No caption here on purpose: that is the second effect.
            return { attachment: { type: requested, payload: { url: mediaUrl, is_reusable: true } } };
        }
        throw new Error('unsupported_item_kind:flow');
    }

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
                // Not an inbound message. Instagram's read receipt does name a
                // mid (`messaging_seen`) and IS applied now — by the controller,
                // through the shared delivery-status writer, never through this
                // return type. See `meta-messaging-status.ts`.
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
    /** Best-effort "typing…" indicator (Meta sender_action). Never throws. */
    async sendTypingIndicator(igUserId: string, to: string, accessToken: string): Promise<void> {
        try {
            const res = await fetch(`${this.apiUrl}/${igUserId}/messages`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ recipient: { id: to }, sender_action: 'typing_on' }),
                signal: AbortSignal.timeout(5_000),
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({})) as any;
                this.logger.debug(`Instagram typing_on ${res.status}: ${d.error?.message || 'unknown'}`);
            }
        } catch (e: any) {
            this.logger.debug(`Instagram typing_on failed (non-blocking): ${e.message}`);
        }
    }

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
                message: { text: toPlainText(text) },
            }),
            signal: AbortSignal.timeout(10_000),
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
