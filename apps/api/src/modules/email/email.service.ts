import { Injectable, Logger } from '@nestjs/common';
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
export class EmailService {
    private readonly logger = new Logger(EmailService.name);
    private transporter: nodemailer.Transporter | null = null;

    constructor(private config: ConfigService) {
        this.initTransporter();
    }

    private initTransporter() {
        const host = this.config.get<string>('SMTP_HOST');
        const port = this.config.get<number>('SMTP_PORT', 587);
        const user = this.config.get<string>('SMTP_USER');
        const pass = this.config.get<string>('SMTP_PASS');

        if (!host || !user || !pass) {
            this.logger.warn('SMTP not configured (SMTP_HOST, SMTP_USER, SMTP_PASS). Email sending disabled.');
            return;
        }

        this.transporter = nodemailer.createTransport({
            host,
            port,
            secure: port === 465,
            auth: { user, pass },
        });

        this.logger.log(`Email transporter initialized (${host}:${port})`);
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
