import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { OutboundQueueService } from '../channels/outbound-queue.service';
import { ChannelTokenService } from '../channels/channel-token.service';
import { EmailTemplatesService } from '../email-templates/email-templates.service';
import type { OutboundMessage } from '@parallext/shared';
import { apptMsg, normaliseLang, LANG_LOCALE } from './appointment-notifications-i18n';

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

            const lang = await this.getContactLanguage(schemaName, appointment.contactId, tenantId);
            const locale = LANG_LOCALE[lang] ?? 'es-CO';

            const startDate = new Date(appointment.startAt);
            const dateStr = startDate.toLocaleDateString(locale, {
                weekday: 'long', day: 'numeric', month: 'long',
            });
            const timeStr = startDate.toLocaleTimeString(locale, {
                hour: '2-digit', minute: '2-digit', hour12: true,
            });

            const text = [
                apptMsg(lang, 'confirmTitle'),
                ``,
                apptMsg(lang, 'confirmGreeting', { name: contact.name || '' }),
                ``,
                `📋 *${appointment.serviceName}*`,
                `🗓️ ${dateStr}`,
                `⏰ ${timeStr}`,
                appointment.location ? apptMsg(lang, 'confirmLocation', { location: appointment.location }) : null,
                appointment.meetingUrl ? apptMsg(lang, 'confirmMeeting', { url: appointment.meetingUrl }) : null,
                ``,
                apptMsg(lang, 'confirmFooter'),
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
                        // Reuse the already-resolved customer language (detectedLanguage → tenant.language → 'es').
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

            const lang = await this.getContactLanguage(schemaName, appointment.contactId, tenantId);
            const locale = LANG_LOCALE[lang] ?? 'es-CO';

            const startDate = new Date(appointment.startAt);
            const dateStr = startDate.toLocaleDateString(locale, {
                weekday: 'long', day: 'numeric', month: 'long',
            });

            const text = [
                apptMsg(lang, 'cancelTitle'),
                ``,
                apptMsg(lang, 'cancelBody', { service: appointment.serviceName, date: dateStr }),
                reason ? apptMsg(lang, 'cancelReason', { reason }) : null,
                ``,
                apptMsg(lang, 'cancelFooter'),
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
     * Resolve the language to use for WhatsApp messages sent to a specific contact.
     *
     * Priority:
     *  1. `conversation.metadata.detectedLanguage` — the language the customer has
     *     actually been writing in (persisted per-turn by conversations.service.ts).
     *  2. `tenant.language` — the tenant's configured language.
     *  3. Hard fallback: 'es'.
     *
     * Returns a normalised 2-char code (es/en/pt/fr).
     */
    private async getContactLanguage(
        schemaName: string,
        contactId: string | null,
        tenantId: string,
    ): Promise<string> {
        if (contactId) {
            try {
                const rows = await this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    `SELECT metadata FROM conversations
                     WHERE contact_id = $1::uuid
                     ORDER BY updated_at DESC
                     LIMIT 1`,
                    [contactId],
                );
                const detected = rows?.[0]?.metadata?.detectedLanguage as string | undefined;
                if (detected) return normaliseLang(detected);
            } catch {
                // non-critical — fall through to tenant language
            }
        }
        return this.getTenantLanguage(tenantId);
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
