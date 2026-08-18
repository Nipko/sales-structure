import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IChannelAdapter } from '../channel-gateway.service';
import { NormalizedMessage, ChannelType } from '@parallext/shared';
import { v4 as uuid } from 'uuid';
import { toWhatsAppFormatting } from '../../../common/utils/channel-text-format.util';

/**
 * WhatsApp Cloud API adapter
 * Handles incoming webhooks and outbound messages via Meta's Cloud API
 *
 * Markdown→WhatsApp conversion lives here, on the last hop before the Cloud API
 * payload, because every producer of customer-facing text converges on this
 * adapter — the AI reply through the outbound queue, the human agent (which
 * calls ChannelGatewayService directly, bypassing the queue), broadcasts and
 * automations. Doing it in the queue would miss the agent path and would have
 * to re-discover the channel; doing it here also keeps the stored `messages`
 * row as the model wrote it, so the inbox and the other channels are untouched.
 * Meta templates are NOT affected: they are sent by WhatsappMessagingService
 * with their own placeholder format.
 */
@Injectable()
export class WhatsAppAdapter implements IChannelAdapter {
    readonly channelType: ChannelType = 'whatsapp';
    private readonly logger = new Logger(WhatsAppAdapter.name);
    private readonly apiUrl = 'https://graph.facebook.com/v25.0';

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
                    // Click-to-WhatsApp ads / Free Entry Point referral (T3.22)
                    referral: message.referral || undefined,
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
                text: { body: toWhatsAppFormatting(text) },
            }),
            signal: AbortSignal.timeout(10_000),
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
    async sendMediaMessage(
        to: string,
        mediaUrl: string,
        caption: string | undefined,
        phoneNumberId: string,
        accessToken: string,
        mediaType: 'image' | 'document' | 'audio' | 'video' = 'image',
        filename?: string,
    ): Promise<string> {
        const url = `${this.apiUrl}/${phoneNumberId}/messages`;

        // Build the per-type media object. Documents carry a filename; audio has no caption.
        const type = ['image', 'document', 'audio', 'video'].includes(mediaType) ? mediaType : 'image';
        const mediaObj: any = { link: mediaUrl };
        if (type !== 'audio' && caption) mediaObj.caption = toWhatsAppFormatting(caption);
        if (type === 'document' && filename) mediaObj.filename = filename;

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
                type,
                [type]: mediaObj,
            }),
            signal: AbortSignal.timeout(10_000),
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

            case 'interactive':
                // User selected a list item or button
                if (message.interactive?.type === 'list_reply') {
                    return {
                        type: 'text' as const,
                        text: message.interactive.list_reply.id, // The ID we set
                        interactiveReply: {
                            type: 'list_reply',
                            id: message.interactive.list_reply.id,
                            title: message.interactive.list_reply.title,
                            description: message.interactive.list_reply.description,
                        },
                    };
                }
                if (message.interactive?.type === 'button_reply') {
                    return {
                        type: 'text' as const,
                        text: message.interactive.button_reply.id,
                        interactiveReply: {
                            type: 'button_reply',
                            id: message.interactive.button_reply.id,
                            title: message.interactive.button_reply.title,
                        },
                    };
                }
                // Completion of a WhatsApp Flow (the opt-in one-step booking form).
                // The submitted fields arrive as a JSON string in nfm_reply.response_json;
                // a sentinel text lets the booking pipeline detect it without changing the
                // shared MessageContentType. Malformed JSON → empty data → falls back to text.
                if (message.interactive?.type === 'nfm_reply') {
                    let flowData: Record<string, unknown> = {};
                    try {
                        flowData = JSON.parse(message.interactive.nfm_reply?.response_json || '{}');
                    } catch { /* malformed Flow payload → empty → text fallback downstream */ }
                    return {
                        type: 'text' as const,
                        text: '__flow_response__',
                        interactiveReply: {
                            type: 'flow_response',
                            // The token we minted round-trips inside response_json when the
                            // Flow echoes it; best-effort anti-replay, never blocks booking.
                            flowToken: (flowData as any)?.flow_token || message.interactive.nfm_reply?.flow_token,
                            data: flowData,
                        },
                    };
                }
                return { type: 'text' as const, text: '[Interactive message]' };

            default:
                return { type: 'text' as const, text: `[Unsupported message type: ${message.type}]` };
        }
    }

    /**
     * Send an interactive list message (up to 10 rows)
     */
    async sendListMessage(
        to: string,
        phoneNumberId: string,
        accessToken: string,
        body: string,
        buttonText: string,
        sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>,
    ): Promise<string> {
        const url = `${this.apiUrl}/${phoneNumberId}/messages`;
        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'interactive',
            interactive: {
                type: 'list',
                header: { type: 'text', text: (sections[0]?.title || 'Options').slice(0, 60) },
                // Row titles/descriptions are deliberately left raw: WhatsApp
                // renders no markup inside list rows, and they come from the
                // deterministic booking engine, not from the model.
                body: { text: toWhatsAppFormatting(body).slice(0, 1024) },
                action: {
                    button: buttonText.slice(0, 20),
                    sections: sections.map(s => ({
                        title: (s.title || 'Options').slice(0, 24),
                        rows: s.rows.map(r => ({
                            id: r.id.slice(0, 200),
                            title: r.title.slice(0, 24),
                            description: r.description?.slice(0, 72),
                        })),
                    })),
                },
            },
        };
        this.logger.log(`[WhatsApp] Sending list message: ${JSON.stringify(payload.interactive.action.sections[0]?.rows?.length || 0)} rows`);
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10_000),
        });
        const data = await response.json() as any;
        if (!response.ok) {
            this.logger.error(`WhatsApp list message failed: ${JSON.stringify(data)}`);
            throw new Error(data.error?.message || 'List message failed');
        }
        this.logger.log(`[WhatsApp] List message sent: ${data.messages?.[0]?.id}`);
        return data.messages?.[0]?.id || '';
    }

    /**
     * Send reply buttons (up to 3 buttons)
     */
    async sendButtonMessage(
        to: string,
        phoneNumberId: string,
        accessToken: string,
        body: string,
        buttons: Array<{ id: string; title: string }>,
    ): Promise<string> {
        const url = `${this.apiUrl}/${phoneNumberId}/messages`;
        this.logger.log(`[WhatsApp] Sending button message with ${buttons.length} buttons`);
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to,
                type: 'interactive',
                interactive: {
                    type: 'button',
                    body: { text: toWhatsAppFormatting(body).slice(0, 1024) },
                    action: {
                        buttons: buttons.slice(0, 3).map(b => ({
                            type: 'reply',
                            reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
                        })),
                    },
                },
            }),
            signal: AbortSignal.timeout(10_000),
        });
        const data = await response.json() as any;
        if (!response.ok) {
            this.logger.error(`WhatsApp button message failed: ${JSON.stringify(data)}`);
            throw new Error(data.error?.message || 'Button message failed');
        }
        return data.messages?.[0]?.id || '';
    }

    /**
     * Send an interactive WhatsApp Flow message (opt-in one-step booking form).
     *
     * Uses a STATIC published Flow (no data-exchange endpoint): the available
     * services travel in `flow_action_payload.data` (navigate), and the user's
     * submitted fields come back in the `nfm_reply.response_json` of the next
     * inbound webhook. `flowToken` is a server-minted correlation id (not Meta's
     * short-lived token), so there's nothing to expire. Caller catches failures
     * and falls back to the text flow.
     */
    async sendFlowMessage(
        to: string,
        phoneNumberId: string,
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
    ): Promise<string> {
        const url = `${this.apiUrl}/${phoneNumberId}/messages`;
        const interactive: any = {
            type: 'flow',
            body: { text: toWhatsAppFormatting(body || '').slice(0, 1024) },
            action: {
                name: 'flow',
                parameters: {
                    flow_message_version: '3',
                    flow_token: flowToken,
                    flow_id: flowId,
                    flow_cta: (opts?.flowCta || 'Agendar').slice(0, 20),
                    mode: opts?.mode || 'published',
                    flow_action: 'navigate',
                    flow_action_payload: {
                        screen: opts?.initialScreen || 'SERVICE_SELECTION',
                        // Meta rejects an empty data object ({}) with a 400 — only attach
                        // data when there's something to send.
                        ...(opts?.initialData && Object.keys(opts.initialData).length
                            ? { data: opts.initialData }
                            : {}),
                    },
                },
            },
        };
        if (opts?.headerText) interactive.header = { type: 'text', text: opts.headerText.slice(0, 60) };
        if (opts?.footerText) interactive.footer = { text: opts.footerText.slice(0, 60) };

        this.logger.log(`[WhatsApp] Sending Flow message (flow_id=${flowId})`);
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to,
                type: 'interactive',
                interactive,
            }),
            signal: AbortSignal.timeout(10_000),
        });
        const data = await response.json() as any;
        if (!response.ok) {
            this.logger.error(`WhatsApp Flow message failed: ${JSON.stringify(data)}`);
            throw new Error(data.error?.message || 'Flow message failed');
        }
        return data.messages?.[0]?.id || '';
    }
}
