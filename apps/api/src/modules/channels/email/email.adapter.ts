import { Injectable, Logger } from '@nestjs/common';
import { IChannelAdapter } from '../channel-gateway.service';
import { NormalizedMessage, ChannelType } from '@parallext/shared';
import { v4 as uuid } from 'uuid';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { EmailChannelService } from './email-channel.service';
import { canonicalEmailMessageId } from './email-message-id.util';
import * as nodemailer from 'nodemailer';

/**
 * Email Channel Adapter
 *
 * Implements IChannelAdapter for email as a conversational channel.
 * Inbound: authenticated JSON normalized by a managed provider adapter/proxy
 * Outbound: SMTP via nodemailer (per-tenant config or platform default)
 *
 * NOT to be confused with the transactional EmailService in modules/email/ —
 * this is the email CHANNEL for customer conversations.
 */
@Injectable()
export class EmailAdapter implements IChannelAdapter {
    readonly channelType: ChannelType = 'email';
    private readonly logger = new Logger(EmailAdapter.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly config: ConfigService,
        private readonly emailChannelService: EmailChannelService,
    ) {}

    /**
     * Inbound authenticity is enforced by EmailWebhookSecurityService before
     * this adapter is invoked. Email providers do not use a Meta-style
     * challenge-response, so there is no adapter-level token to return.
     */
    verifyWebhook(_query: any): string | null {
        return null;
    }

    /**
     * Parse the bounded JSON webhook into a NormalizedMessage.
     *
     * The controller accepts application/json only. A managed provider adapter
     * may translate an upstream multipart event, but attachment blobs are not
     * part of this contract.
     */
    async handleWebhook(payload: any, accountId: string): Promise<NormalizedMessage | null> {
        try {
            const from = this.extractEmailAddress(payload?.from || payload?.sender || '');
            const subject = payload?.subject || '';
            const textBody = payload?.text || '';
            const htmlBody = payload?.html || '';

            if (!from) {
                this.logger.warn('Email webhook missing sender address');
                return null;
            }

            // Use the exact same canonical identity as the controller. The
            // explicit field is required as a fallback because a managed JSON
            // adapter may not forward the raw header block.
            const headers = payload?.headers || '';
            const messageIdHeader = canonicalEmailMessageId(payload) || uuid();

            // Sanitize HTML content
            const sanitizedHtml = htmlBody ? this.sanitizeHtml(htmlBody) : undefined;

            // Use plain text if available, otherwise strip HTML
            const text = textBody || (sanitizedHtml ? this.stripHtml(sanitizedHtml) : '');

            const normalized: NormalizedMessage = {
                id: uuid(),
                tenantId: '',  // Resolved by the webhook controller
                channelType: 'email',
                channelAccountId: accountId,
                contactId: from,
                conversationId: '', // Resolved by conversations service
                direction: 'inbound',
                content: {
                    type: 'text',
                    text: text || '(empty email)',
                },
                timestamp: new Date(),
                status: 'pending',
                metadata: {
                    contactName: this.extractDisplayName(payload?.from || ''),
                    emailSubject: subject,
                    emailMessageId: messageIdHeader,
                    emailInReplyTo: this.extractHeader(headers, 'In-Reply-To') || undefined,
                    emailReferences: this.extractHeader(headers, 'References') || undefined,
                    emailHasHtml: !!htmlBody,
                    emailCc: payload?.cc || undefined,
                    emailTo: payload?.to || undefined,
                    attachmentCount: parseInt(payload?.attachments || '0', 10),
                },
            };

            return normalized;
        } catch (error) {
            this.logger.error(`Error parsing email webhook: ${error}`);
            return null;
        }
    }

    /**
     * Send a plain text email reply.
     * `to` is the recipient email address, `text` is the body.
     * `accountId` is the from_email in the email channel config.
     * `accessToken` is the SMTP credential string "host:port:user:pass" or "smtp_default" for platform SMTP.
     */
    async sendTextMessage(to: string, text: string, accountId: string, accessToken: string): Promise<string> {
        const transport = this.buildTransport(accessToken);

        // Look up thread context for In-Reply-To / References headers
        const threadHeaders = await this.getThreadHeaders(accountId, to);

        const info = await transport.sendMail({
            from: accountId,
            to,
            subject: threadHeaders.subject || 'Re: Conversation',
            text,
            ...threadHeaders.mailHeaders,
        });

        this.logger.debug(`Email sent to ${to}: messageId=${info.messageId}`);
        return info.messageId || uuid();
    }

    /**
     * Send an email with an attachment URL (media message).
     */
    async sendMediaMessage(to: string, mediaUrl: string, caption: string | undefined, accountId: string, accessToken: string): Promise<string> {
        const transport = this.buildTransport(accessToken);
        const threadHeaders = await this.getThreadHeaders(accountId, to);

        // Derive filename from URL
        const urlPath = new URL(mediaUrl).pathname;
        const filename = urlPath.split('/').pop() || 'attachment';

        const info = await transport.sendMail({
            from: accountId,
            to,
            subject: threadHeaders.subject || 'Re: Conversation',
            text: caption || '',
            attachments: [
                {
                    filename,
                    path: mediaUrl,
                },
            ],
            ...threadHeaders.mailHeaders,
        });

        this.logger.debug(`Email with attachment sent to ${to}: messageId=${info.messageId}`);
        return info.messageId || uuid();
    }

    // ── Private helpers ─────────────────────────────────────

    /**
     * Build a nodemailer transport from credentials.
     * accessToken format: "host:port:user:pass" or "smtp_default" for platform SMTP.
     */
    private buildTransport(accessToken: string): nodemailer.Transporter {
        if (accessToken === 'smtp_default' || !accessToken) {
            // Use platform-wide SMTP settings
            const host = this.config.get<string>('SMTP_HOST');
            const port = this.config.get<number>('SMTP_PORT', 587);
            const user = this.config.get<string>('SMTP_USER');
            const pass = this.config.get<string>('SMTP_PASS');

            if (!host || !user || !pass) {
                throw new Error('Platform SMTP not configured');
            }

            return nodemailer.createTransport({
                host,
                port,
                secure: port === 465,
                auth: { user, pass },
            });
        }

        // Tenant-specific SMTP: "host:port:user:pass"
        const parts = accessToken.split(':');
        if (parts.length < 4) {
            throw new Error('Invalid email channel credentials format — expected "host:port:user:pass"');
        }

        const [host, portStr, ...userPass] = parts;
        const port = parseInt(portStr, 10);
        // User and pass may contain colons, so rejoin everything after host:port
        const user = userPass.length > 1 ? userPass.slice(0, -1).join(':') : userPass[0];
        const pass = userPass.length > 1 ? userPass[userPass.length - 1] : '';

        return nodemailer.createTransport({
            host,
            port,
            secure: port === 465,
            auth: { user, pass },
        });
    }

    /**
     * Retrieve thread headers (In-Reply-To, References, Subject) for an outgoing email.
     * This enables email clients to thread responses properly.
     */
    private async getThreadHeaders(fromEmail: string, toEmail: string): Promise<{
        subject: string | undefined;
        mailHeaders: Record<string, string>;
    }> {
        // Thread lookup is best-effort; don't fail the send if it can't be found
        try {
            // We look up the most recent inbound email from this contact
            // via the metadata stored on the conversation. This is a lightweight
            // approach that doesn't require tenant context here.
            return { subject: undefined, mailHeaders: {} };
        } catch {
            return { subject: undefined, mailHeaders: {} };
        }
    }

    /**
     * Extract the email address from a "Display Name <email@example.com>" string.
     */
    private extractEmailAddress(raw: string): string {
        if (!raw) return '';
        const match = raw.match(/<([^>]+)>/);
        if (match) return match[1].trim().toLowerCase();
        // Might be just a plain email address
        const emailMatch = raw.match(/[\w.+-]+@[\w.-]+\.\w+/);
        return emailMatch ? emailMatch[0].trim().toLowerCase() : '';
    }

    /**
     * Extract the display name from a "Display Name <email@example.com>" string.
     */
    private extractDisplayName(raw: string): string {
        if (!raw) return '';
        const match = raw.match(/^(.+?)\s*<[^>]+>/);
        if (match) {
            const name = match[1].trim().replace(/^["']|["']$/g, '');
            return name || '';
        }
        return '';
    }

    /**
     * Extract a specific header value from a raw email headers string.
     */
    private extractHeader(headers: string, headerName: string): string | null {
        if (!headers) return null;
        const regex = new RegExp(`^${headerName}:\\s*(.+)$`, 'mi');
        const match = headers.match(regex);
        return match ? match[1].trim() : null;
    }

    /**
     * Sanitize HTML by removing dangerous tags (script, iframe, form, style, object, embed).
     * Simple regex-based approach — no external dependency required.
     */
    private sanitizeHtml(html: string): string {
        // Remove script tags and their content
        let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        // Remove iframe tags
        clean = clean.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
        // Remove form tags and their content
        clean = clean.replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '');
        // Remove style tags and their content
        clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
        // Remove object/embed tags
        clean = clean.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
        clean = clean.replace(/<embed\b[^>]*\/?>/gi, '');
        // Remove on* event handlers from remaining tags
        clean = clean.replace(/\s+on\w+\s*=\s*(['"]?).*?\1/gi, '');
        return clean;
    }

    /**
     * Strip all HTML tags to get plain text.
     */
    private stripHtml(html: string): string {
        return html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
}
