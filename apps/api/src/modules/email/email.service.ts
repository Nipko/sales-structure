import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { fallbackMessageEmail, agentAssignmentEmail } from './email-layouts';

export interface EmailAttachment {
    filename: string;
    content: Buffer;
    contentType?: string;
}

export interface EmailPayload {
    to: string;
    subject: string;
    text?: string;
    html?: string;
    from?: string;
    replyTo?: string;
    attachments?: EmailAttachment[];
}

@Injectable()
export class EmailService implements OnModuleInit {
    private readonly logger = new Logger(EmailService.name);
    private transporter: nodemailer.Transporter | null = null;

    constructor(private config: ConfigService) {
        this.initTransporter();
    }

    /**
     * Authenticate once at boot so a bad credential is loud immediately.
     * Deliberately not awaited into the boot path: SMTP being down must never
     * stop the API from serving. The transport is built once in the
     * constructor, so this also pins the moment the credentials were last
     * known-good — the container start.
     */
    onModuleInit(): void {
        void this.verifyConnection().then(({ ok, error }) => {
            if (ok) this.logger.log('SMTP credentials verified');
            else this.logger.error(`SMTP VERIFY FAILED — no email will be delivered: ${error}`);
        });
    }

    /**
     * Google DISPLAYS an App Password as four space-separated groups
     * ("abcd efgh ijkl mnop"), and the spaces are presentation only — the
     * credential is the 16 characters. Pasted verbatim into a secret they
     * survive the whole path (GitHub secret -> unquoted echo into .env ->
     * compose env_file -> process.env -> SASL, which base64-encodes them
     * happily) and Google answers 535-5.7.8 BadCredentials. That is
     * indistinguishable from a revoked password unless you count the
     * characters, which cost this platform an SMTP outage.
     *
     * Only the exact 4x4 display shape is unpacked, so a provider whose
     * password legitimately contains spaces is left alone. Outer whitespace
     * is always trimmed — that is never part of a credential.
     */
    private static readonly GMAIL_APP_PASSWORD_DISPLAY = /^[a-z]{4}( [a-z]{4}){3}$/i;

    private normalizeSmtpPass(raw: string): string {
        const trimmed = raw.trim();
        if (EmailService.GMAIL_APP_PASSWORD_DISPLAY.test(trimmed)) {
            this.logger.warn(
                'SMTP_PASS looks like a Gmail App Password with its display spaces — ' +
                'stripping them. Store the 16 characters without spaces to silence this.',
            );
            return trimmed.replace(/ /g, '');
        }
        return trimmed;
    }

    private initTransporter() {
        const host = this.config.get<string>('SMTP_HOST');
        const port = this.config.get<number>('SMTP_PORT', 587);
        const user = this.config.get<string>('SMTP_USER')?.trim();
        const rawPass = this.config.get<string>('SMTP_PASS');

        if (!host || !user || !rawPass) {
            this.logger.warn('SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS). Email sending disabled.');
            return;
        }

        const pass = this.normalizeSmtpPass(rawPass);

        this.transporter = nodemailer.createTransport({
            host: host.trim(),
            port,
            secure: port === 465,
            auth: { user, pass },
        });

        this.logger.log(`Email transporter initialized (${host}:${port}) as ${user}`);
    }

    /**
     * Prove the credentials actually authenticate, instead of finding out from
     * a user who never got their verification code. Nothing else in the
     * platform probes SMTP — the Ops Center does not watch it, and send()
     * swallows failures into a boolean, so an auth outage is invisible until
     * someone reads raw logs.
     */
    async verifyConnection(): Promise<{ ok: boolean; error?: string }> {
        if (!this.transporter) return { ok: false, error: 'SMTP not configured' };
        try {
            await this.transporter.verify();
            return { ok: true };
        } catch (err: any) {
            return { ok: false, error: err?.message?.substring(0, 300) || 'unknown error' };
        }
    }

    async send(payload: EmailPayload): Promise<boolean> {
        if (!this.transporter) {
            this.logger.warn('Email not sent — SMTP not configured');
            return false;
        }

        const defaultFrom = this.config.get<string>('SMTP_FROM')
            || `Parallly <${this.config.get<string>('SMTP_USER', 'no-reply@parallext.com')}>`;

        try {
            const info = await this.transporter.sendMail({
                from: payload.from || defaultFrom,
                to: payload.to,
                subject: payload.subject,
                text: payload.text,
                html: payload.html,
                replyTo: payload.replyTo,
                attachments: payload.attachments,
            });

            this.logger.log(`Email sent to ${payload.to} — messageId: ${info.messageId}`);
            return true;
        } catch (error: any) {
            this.logger.error(`Failed to send email to ${payload.to}: ${error.message}`, error.stack);
            return false;
        }
    }

    async sendFallbackMessage(to: string, leadName: string, message: string): Promise<boolean> {
        return this.send({
            to,
            subject: `Nuevo mensaje de ${leadName} — Parallly`,
            html: fallbackMessageEmail(leadName, message),
        });
    }

    async notifyAgentAssignment(agentEmail: string, leadName: string, stage: string): Promise<boolean> {
        return this.send({
            to: agentEmail,
            subject: `Nuevo lead asignado: ${leadName} — Parallly`,
            html: agentAssignmentEmail(leadName, stage),
        });
    }
}
