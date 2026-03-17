import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface EmailPayload {
    to: string;
    subject: string;
    text?: string;
    html?: string;
    from?: string;
    replyTo?: string;
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

        const defaultFrom = this.config.get<string>('SMTP_FROM', 'no-reply@parallext.com');

        try {
            const info = await this.transporter.sendMail({
                from: payload.from || defaultFrom,
                to: payload.to,
                subject: payload.subject,
                text: payload.text,
                html: payload.html,
                replyTo: payload.replyTo,
            });

            this.logger.log(`Email sent to ${payload.to} — messageId: ${info.messageId}`);
            return true;
        } catch (error: any) {
            this.logger.error(`Failed to send email to ${payload.to}: ${error.message}`, error.stack);
            return false;
        }
    }

    /**
     * Fallback: send a message via email when WhatsApp is unavailable
     */
    async sendFallbackMessage(to: string, leadName: string, message: string): Promise<boolean> {
        return this.send({
            to,
            subject: `Nuevo mensaje de ${leadName} — Parallly CRM`,
            html: `
                <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
                    <div style="background: linear-gradient(135deg, #6c5ce7, #9b59b6); padding: 24px; border-radius: 12px 12px 0 0; color: white;">
                        <h2 style="margin: 0; font-size: 20px;">Parallly CRM</h2>
                        <p style="margin: 4px 0 0; opacity: 0.85; font-size: 14px;">Notificación de mensaje</p>
                    </div>
                    <div style="background: #1a1a2e; padding: 24px; border-radius: 0 0 12px 12px; color: #e0e0e0;">
                        <p style="margin: 0 0 12px; font-size: 14px; color: #aaa;">De: <strong style="color: white;">${leadName}</strong></p>
                        <div style="background: #16213e; padding: 16px; border-radius: 8px; border-left: 3px solid #6c5ce7;">
                            <p style="margin: 0; font-size: 15px; line-height: 1.6;">${message}</p>
                        </div>
                        <p style="margin: 16px 0 0; font-size: 12px; color: #666;">
                            Este mensaje fue enviado como fallback porque WhatsApp no estuvo disponible.
                        </p>
                    </div>
                </div>
            `,
        });
    }

    /**
     * Send a notification to a sales agent about a new lead assignment
     */
    async notifyAgentAssignment(agentEmail: string, leadName: string, stage: string): Promise<boolean> {
        return this.send({
            to: agentEmail,
            subject: `Nuevo lead asignado: ${leadName}`,
            html: `
                <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
                    <h2 style="color: #6c5ce7;">🎯 Nuevo Lead Asignado</h2>
                    <p><strong>${leadName}</strong> ha sido asignado a ti en etapa <strong>${stage}</strong>.</p>
                    <p>Accede al CRM para ver el perfil completo y tomar acción.</p>
                    <a href="https://app.parallext.com/admin/contacts" style="display: inline-block; padding: 10px 24px; background: #6c5ce7; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">Ver en CRM</a>
                </div>
            `,
        });
    }
}
