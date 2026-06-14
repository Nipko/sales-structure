import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { OutboundQueueService } from '../channels/outbound-queue.service';
import { ChannelTokenService } from '../channels/channel-token.service';
import { EmailTemplatesService } from '../email-templates/email-templates.service';
import type { OutboundMessage } from '@parallext/shared';

/**
 * Listens for appointment events and sends WhatsApp/channel notifications.
 * Emits 'appointment.ws' event for WebSocket relay to dashboard.
 */
@Injectable()
export class AppointmentNotificationsService {
    private readonly logger = new Logger(AppointmentNotificationsService.name);

    constructor(
        private prisma: PrismaService,
        private eventEmitter: EventEmitter2,
        private outboundQueue: OutboundQueueService,
        private channelToken: ChannelTokenService,
        private emailTemplates: EmailTemplatesService,
    ) {}

    @OnEvent('appointment.created')
    async onAppointmentCreated(payload: { schemaName: string; appointment: any }) {
        const { schemaName, appointment } = payload;

        try {
            const contact = await this.getContactInfo(schemaName, appointment.contactId);
            if (!contact?.phone) return;

            const tenantId = await this.getTenantId(schemaName);
            if (!tenantId) return;

            const startDate = new Date(appointment.startAt);
            const dateStr = startDate.toLocaleDateString('es-CO', {
                weekday: 'long', day: 'numeric', month: 'long',
            });
            const timeStr = startDate.toLocaleTimeString('es-CO', {
                hour: '2-digit', minute: '2-digit', hour12: true,
            });

            const text = [
                `✅ *Cita confirmada*`,
                ``,
                `Hola ${contact.name || ''}! Tu cita ha sido agendada:`,
                ``,
                `📋 *${appointment.serviceName}*`,
                `🗓️ ${dateStr}`,
                `⏰ ${timeStr}`,
                appointment.location ? `📍 ${appointment.location}` : null,
                appointment.meetingUrl ? `💻 Enlace de reunión: ${appointment.meetingUrl}` : null,
                ``,
                `Si necesitas cancelar o reprogramar, escríbenos con anticipación.`,
            ].filter(Boolean).join('\n');

            await this.sendMessage(tenantId, contact, text, {
                source: 'appointment_confirmation',
                appointmentId: appointment.id,
            });

            // Also send email confirmation if contact has an email address (fire-and-forget)
            try {
                if (contact?.email) {
                    // Check if confirmation emails are enabled for appointments
                    let emailConfirmationsEnabled = true;
                    try {
                        const personaRows = await this.prisma.executeInTenantSchema<any[]>(
                            schemaName,
                            `SELECT config_json FROM agent_personas WHERE is_active = true LIMIT 1`,
                            []
                        );
                        if (personaRows && personaRows.length > 0) {
                            const config = personaRows[0].config_json || {};
                            const appointmentsTool = config.tools?.appointments;
                            if (appointmentsTool && appointmentsTool.emailConfirmations === false) {
                                emailConfirmationsEnabled = false;
                            }
                        }
                    } catch (err) {
                        this.logger.error(`Error checking persona settings for appointments: ${err.message}`);
                    }

                    if (emailConfirmationsEnabled) {
                        // Resolve the tenant's configured language for the template
                        // (falls back to 'es'). Per-customer detected-language is a
                        // future improvement — TODO: thread the conversation's
                        // detected language through to here when available.
                        const lang = await this.getTenantLanguage(tenantId);
                        await this.emailTemplates.renderAndSend(schemaName, 'appointment_confirmation_email', contact.email, {
                            customer_name: contact.name || 'Cliente',
                            service_name: appointment.serviceName,
                            appointment_date: new Date(appointment.startAt).toLocaleDateString('es-CO'),
                            appointment_time: new Date(appointment.startAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
                            location: appointment.location || '',
                        }, lang);
                    }
                }
            } catch { /* non-critical — channel notification already sent */ }

            // Emit event for WebSocket relay to dashboard (handled by ConversationsGateway)
            this.eventEmitter.emit('appointment.ws', { tenantId, type: 'created', appointment });

            this.logger.log(`Sent confirmation for appointment ${appointment.id}`);
        } catch (err: any) {
            this.logger.error(`Failed to send appointment confirmation: ${err.message}`);
        }
    }

    @OnEvent('appointment.cancelled')
    async onAppointmentCancelled(payload: { schemaName: string; appointment: any; reason?: string }) {
        const { schemaName, appointment, reason } = payload;

        try {
            const contact = await this.getContactInfo(schemaName, appointment.contactId);
            if (!contact?.phone) return;

            const tenantId = await this.getTenantId(schemaName);
            if (!tenantId) return;

            const startDate = new Date(appointment.startAt);
            const dateStr = startDate.toLocaleDateString('es-CO', {
                weekday: 'long', day: 'numeric', month: 'long',
            });

            const text = [
                `❌ *Cita cancelada*`,
                ``,
                `Tu cita de *${appointment.serviceName}* del ${dateStr} ha sido cancelada.`,
                reason ? `Motivo: ${reason}` : null,
                ``,
                `Si deseas reprogramar, no dudes en escribirnos.`,
            ].filter(Boolean).join('\n');

            await this.sendMessage(tenantId, contact, text, {
                source: 'appointment_cancellation',
                appointmentId: appointment.id,
            });

            this.logger.log(`Sent cancellation notice for appointment ${appointment.id}`);
        } catch (err) {
            this.logger.error(`Failed to send cancellation notice: ${err.message}`);
        }
    }

    private async getContactInfo(schemaName: string, contactId: string | null) {
        if (!contactId) return null;
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT name, phone, email, channel_type FROM contacts WHERE id = $1::uuid`,
            [contactId],
        );
        return rows?.[0] || null;
    }

    private async getTenantId(schemaName: string): Promise<string | null> {
        const rows = await this.prisma.$queryRaw<any[]>`
            SELECT id FROM tenants WHERE schema_name = ${schemaName} LIMIT 1
        `;
        return rows?.[0]?.id || null;
    }

    /**
     * Tenant's configured language as a short code (es/en/pt/fr), falling back
     * to 'es'. `tenant.language` is stored as a full locale (e.g. 'es-CO'), so
     * we strip the region — matching the convention in persona.service.
     */
    private async getTenantLanguage(tenantId: string): Promise<string> {
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { language: true },
            });
            return (tenant?.language || 'es-CO').split('-')[0];
        } catch {
            return 'es';
        }
    }

    private async sendMessage(
        tenantId: string,
        contact: { phone: string; channel_type?: string },
        text: string,
        metadata: Record<string, unknown>,
    ) {
        const channelType = (contact.channel_type || 'whatsapp') as 'whatsapp' | 'instagram' | 'messenger' | 'telegram';

        let credentials: { accessToken: string; accountId: string };
        try {
            const creds = await this.channelToken.getChannelToken(tenantId, channelType);
            credentials = { accessToken: creds.accessToken, accountId: creds.accountId };
        } catch {
            this.logger.warn(`No ${channelType} credentials for tenant ${tenantId}`);
            return;
        }

        const outbound: OutboundMessage = {
            tenantId,
            to: contact.phone,
            channelType,
            channelAccountId: credentials.accountId,
            content: { type: 'text', text },
            metadata,
        };

        await this.outboundQueue.enqueue(outbound, credentials.accessToken);
    }
}
