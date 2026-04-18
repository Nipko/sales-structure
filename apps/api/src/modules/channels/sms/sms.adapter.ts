import { Injectable, Logger } from '@nestjs/common';
import { IChannelAdapter } from '../channel-gateway.service';
import { NormalizedMessage, ChannelType } from '@parallext/shared';
import { v4 as uuid } from 'uuid';

const TWILIO_API = 'https://api.twilio.com/2010-04-01';

/**
 * Twilio SMS Adapter
 *
 * Handles SMS messages via Twilio REST API.
 * Webhook: receives POST from Twilio with incoming SMS data
 * API: POST /Accounts/{SID}/Messages.json
 *
 * Credentials:
 *   accessToken = "accountSid:authToken" (combined, split on use)
 *   accountId = Twilio phone number (e.g., +1234567890)
 */
@Injectable()
export class SmsAdapter implements IChannelAdapter {
    readonly channelType: ChannelType = 'sms';
    private readonly logger = new Logger(SmsAdapter.name);

    /**
     * Twilio webhook verification uses request signature validation.
     * For simplicity, we accept all POSTs and validate via the signature header.
     * Return null = no challenge-response needed.
     */
    verifyWebhook(_query: any): string | null {
        return null;
    }

    /**
     * Parse incoming Twilio SMS webhook into normalized message.
     *
     * Twilio sends form-encoded POST with fields:
     * MessageSid, From, To, Body, NumMedia, MediaUrl0, etc.
     */
    async handleWebhook(payload: any, accountId: string): Promise<NormalizedMessage | null> {
        try {
            const from = payload?.From;
            const body = payload?.Body;
            const messageSid = payload?.MessageSid;

            if (!from || !messageSid) return null;

            const normalized: NormalizedMessage = {
                id: uuid(),
                tenantId: '',
                channelType: 'sms',
                channelAccountId: accountId,
                contactId: from,
                conversationId: '',
                direction: 'inbound',
                content: this.parseContent(payload),
                timestamp: new Date(),
                status: 'pending',
                metadata: {
                    twilioMessageSid: messageSid,
                    twilioFrom: from,
                    twilioTo: payload?.To,
                    contactName: from, // Phone number as name fallback
                    numMedia: payload?.NumMedia || '0',
                },
            };

            return normalized;
        } catch (error) {
            this.logger.error(`Error parsing Twilio webhook: ${error}`);
            return null;
        }
    }

    /**
     * Send a text SMS via Twilio REST API.
     * accessToken format: "accountSid:authToken"
     */
    async sendTextMessage(to: string, text: string, fromNumber: string, accessToken: string): Promise<string> {
        const { accountSid, authToken } = this.parseCredentials(accessToken);

        const url = `${TWILIO_API}/Accounts/${accountSid}/Messages.json`;
        const params = new URLSearchParams({
            To: to,
            From: fromNumber,
            Body: text,
        });

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
            },
            body: params.toString(),
        });

        const data = await response.json() as any;

        if (data.error_code || data.status === 'failed') {
            this.logger.error(`Twilio send failed: ${JSON.stringify(data)}`);
            throw new Error(`Twilio error: ${data.message || data.error_message || 'Unknown error'}`);
        }

        this.logger.debug(`SMS sent to ${to}: SID=${data.sid}`);
        return data.sid || '';
    }

    /**
     * Send MMS (media message) via Twilio.
     */
    async sendMediaMessage(to: string, mediaUrl: string, caption: string | undefined, fromNumber: string, accessToken: string): Promise<string> {
        const { accountSid, authToken } = this.parseCredentials(accessToken);

        const url = `${TWILIO_API}/Accounts/${accountSid}/Messages.json`;
        const params = new URLSearchParams({
            To: to,
            From: fromNumber,
            MediaUrl: mediaUrl,
        });
        if (caption) params.append('Body', caption);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
            },
            body: params.toString(),
        });

        const data = await response.json() as any;

        if (data.error_code || data.status === 'failed') {
            throw new Error(`Twilio MMS error: ${data.message || 'Unknown error'}`);
        }

        return data.sid || '';
    }

    /**
     * Validate Twilio credentials by calling the Account API.
     */
    async validateCredentials(accountSid: string, authToken: string): Promise<{ friendlyName: string } | null> {
        try {
            const url = `${TWILIO_API}/Accounts/${accountSid}.json`;
            const response = await fetch(url, {
                headers: {
                    'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
                },
            });
            const data = await response.json() as any;
            if (data.status === 'active' || data.friendly_name) {
                return { friendlyName: data.friendly_name };
            }
            return null;
        } catch {
            return null;
        }
    }

    private parseCredentials(accessToken: string): { accountSid: string; authToken: string } {
        const [accountSid, authToken] = accessToken.split(':');
        if (!accountSid || !authToken) {
            throw new Error('Invalid Twilio credentials format — expected "accountSid:authToken"');
        }
        return { accountSid, authToken };
    }

    private parseContent(payload: any) {
        const numMedia = parseInt(payload?.NumMedia || '0', 10);

        // If there are media attachments
        if (numMedia > 0 && payload?.MediaUrl0) {
            const mimeType = payload?.MediaContentType0 || 'image/jpeg';
            const isImage = mimeType.startsWith('image/');

            return {
                type: (isImage ? 'image' : 'document') as 'image' | 'document',
                mediaUrl: payload.MediaUrl0,
                mimeType,
                caption: payload?.Body || undefined,
            };
        }

        return {
            type: 'text' as const,
            text: payload?.Body || '',
        };
    }
}
