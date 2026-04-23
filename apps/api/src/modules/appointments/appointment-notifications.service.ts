import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { OutboundQueueService } from '../channels/outbound-queue.service';
import { ChannelTokenService } from '../channels/channel-token.service';
import { ConversationsGateway } from '../conversations/conversations.gateway';
import type { OutboundMessage } from '@parallext/shared';

/**
 * Listens for appointment events and sends WhatsApp/channel notifications.
 * Also emits WebSocket events for live dashboard calendar updates.
 */
@Injectable()
export class AppointmentNotificationsService {
    private readonly logger = new Logger(AppointmentNotificationsService.name);

    constructor(
        private prisma: PrismaService,
        private outboundQueue: OutboundQueueService,
        private channelToken: ChannelTokenService,
        private gateway: ConversationsGateway,
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

            // Emit WebSocket event for live calendar update in dashboard
            this.gateway.emitAppointmentCreated(tenantId, appointment);

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
            `SELECT name, phone, channel_type FROM contacts WHERE id = $1::uuid`,
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
