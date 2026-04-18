import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { OutboundQueueService } from '../channels/outbound-queue.service';
import { ChannelTokenService } from '../channels/channel-token.service';
import type { OutboundMessage } from '@parallext/shared';

@Injectable()
export class AppointmentRemindersService {
    private readonly logger = new Logger(AppointmentRemindersService.name);

    constructor(
        private prisma: PrismaService,
        private outboundQueue: OutboundQueueService,
        private channelToken: ChannelTokenService,
    ) {}

    /**
     * Every 15 minutes: find appointments needing 24h reminders.
     * Looks for confirmed/pending appointments starting in 23-25 hours.
     */
    @Cron('*/15 * * * *')
    async send24hReminders() {
        this.logger.debug('Checking for 24h appointment reminders...');

        try {
            const tenants = await this.prisma.$queryRaw<any[]>`
                SELECT id, schema_name FROM tenants WHERE is_active = true
            `;
            if (!tenants?.length) return;

            for (const tenant of tenants) {
                await this.processReminders(tenant.id, tenant.schema_name, '24h');
            }
        } catch (err) {
            this.logger.error('Error in 24h reminder cron', err);
        }
    }

    /**
     * Every 15 minutes: find appointments needing 1h reminders.
     * Looks for confirmed/pending appointments starting in 45-75 minutes.
     */
    @Cron('3,18,33,48 * * * *')
    async send1hReminders() {
        this.logger.debug('Checking for 1h appointment reminders...');

        try {
            const tenants = await this.prisma.$queryRaw<any[]>`
                SELECT id, schema_name FROM tenants WHERE is_active = true
            `;
            if (!tenants?.length) return;

            for (const tenant of tenants) {
                await this.processReminders(tenant.id, tenant.schema_name, '1h');
            }
        } catch (err) {
            this.logger.error('Error in 1h reminder cron', err);
        }
    }

    /**
     * Every 30 minutes: auto-mark no-shows for appointments that ended 30+ min ago
     * and are still in confirmed/pending status.
     */
    @Cron('5,35 * * * *')
    async markNoShows() {
        this.logger.debug('Checking for no-show appointments...');

        try {
            const tenants = await this.prisma.$queryRaw<any[]>`
                SELECT id, schema_name FROM tenants WHERE is_active = true
            `;
            if (!tenants?.length) return;

            for (const tenant of tenants) {
                await this.processNoShows(tenant.id, tenant.schema_name);
            }
        } catch (err) {
            this.logger.error('Error in no-show cron', err);
        }
    }

    private async processReminders(tenantId: string, schemaName: string, type: '24h' | '1h') {
        const flagColumn = type === '24h' ? 'reminder_24h_sent' : 'reminder_1h_sent';
        const minHours = type === '24h' ? 23 : 0.75;
        const maxHours = type === '24h' ? 25 : 1.25;

        const appointments = await this.prisma.executeInTenantSchema(schemaName,
            `SELECT a.id, a.service_name, a.start_at, a.end_at, a.location,
                    a.contact_id, a.assigned_to,
                    c.name as contact_name, c.phone as contact_phone,
                    c.channel_type as contact_channel
             FROM appointments a
             LEFT JOIN contacts c ON c.id = a.contact_id
             WHERE a.status IN ('pending', 'confirmed')
               AND a.${flagColumn} = false
               AND a.start_at > NOW()
               AND a.start_at <= NOW() + interval '${maxHours} hours'
               AND a.start_at >= NOW() + interval '${minHours} hours'
               AND c.phone IS NOT NULL`,
            [],
        );

        if (!(appointments as any[])?.length) return;

        this.logger.log(`Found ${(appointments as any[]).length} appointments needing ${type} reminder for tenant ${tenantId}`);

        for (const appt of (appointments as any[])) {
            try {
                await this.sendReminder(tenantId, schemaName, appt, type);

                // Mark reminder as sent
                await this.prisma.executeInTenantSchema(schemaName,
                    `UPDATE appointments SET ${flagColumn} = true, updated_at = NOW() WHERE id = $1::uuid`,
                    [appt.id],
                );
            } catch (err) {
                this.logger.error(`Failed to send ${type} reminder for appointment ${appt.id}`, err);
            }
        }
    }

    private async sendReminder(
        tenantId: string,
        schemaName: string,
        appt: any,
        type: '24h' | '1h',
    ) {
        const channelType = (appt.contact_channel || 'whatsapp') as 'whatsapp' | 'instagram' | 'messenger' | 'telegram';

        // Resolve token for the channel
        let credentials: { accessToken: string; accountId: string };
        try {
            const creds = await this.channelToken.getChannelToken(tenantId, channelType);
            credentials = { accessToken: creds.accessToken, accountId: creds.accountId };
        } catch {
            this.logger.warn(`No credentials for ${channelType} on tenant ${tenantId}, skipping reminder`);
            return;
        }

        const startDate = new Date(appt.start_at);
        const dateStr = startDate.toLocaleDateString('es-CO', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
        });
        const timeStr = startDate.toLocaleTimeString('es-CO', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
        });

        // Build the reminder message
        const reminderText = type === '24h'
            ? `📅 *Recordatorio de cita*\n\nHola ${appt.contact_name || ''}! Te recordamos que tienes una cita mañana:\n\n📋 *${appt.service_name}*\n🗓️ ${dateStr}\n⏰ ${timeStr}${appt.location ? `\n📍 ${appt.location}` : ''}\n\nSi necesitas cancelar o reprogramar, avísanos con anticipación.`
            : `⏰ *Tu cita es en 1 hora*\n\nHola ${appt.contact_name || ''}! Tu cita está por comenzar:\n\n📋 *${appt.service_name}*\n⏰ ${timeStr}${appt.location ? `\n📍 ${appt.location}` : ''}\n\n¡Te esperamos!`;

        const outbound: OutboundMessage = {
            tenantId,
            to: appt.contact_phone,
            channelType,
            channelAccountId: credentials.accountId || '',
            content: { type: 'text', text: reminderText },
            metadata: {
                source: 'appointment_reminder',
                appointmentId: appt.id,
                reminderType: type,
            },
        };

        await this.outboundQueue.enqueue(outbound, credentials.accessToken);
        this.logger.log(`Sent ${type} reminder to ${appt.contact_phone} for appointment ${appt.id}`);
    }

    private async processNoShows(tenantId: string, schemaName: string) {
        // Find appointments that ended 30+ minutes ago and are still pending/confirmed
        const noShows = await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE appointments
             SET status = 'no_show', updated_at = NOW()
             WHERE status IN ('pending', 'confirmed')
               AND end_at < NOW() - interval '30 minutes'
             RETURNING id, service_name, contact_id, start_at`,
            [],
        );

        if (!(noShows as any[])?.length) return;

        this.logger.log(`Marked ${(noShows as any[]).length} no-show appointments for tenant ${tenantId}`);

        // Send follow-up message for no-shows
        for (const appt of (noShows as any[])) {
            try {
                await this.sendNoShowFollowUp(tenantId, schemaName, appt);
            } catch (err) {
                this.logger.error(`Failed to send no-show follow-up for appointment ${appt.id}`, err);
            }
        }
    }

    private async sendNoShowFollowUp(tenantId: string, schemaName: string, appt: any) {
        if (!appt.contact_id) return;

        // Get contact info
        const contacts = await this.prisma.executeInTenantSchema(schemaName,
            `SELECT name, phone, channel_type FROM contacts WHERE id = $1::uuid`,
            [appt.contact_id],
        );
        const contact = (contacts as any[])?.[0];
        if (!contact?.phone) return;

        const channelType = (contact.channel_type || 'whatsapp') as 'whatsapp' | 'instagram' | 'messenger' | 'telegram';
        let credentials: { accessToken: string; accountId: string };
        try {
            const creds = await this.channelToken.getChannelToken(tenantId, channelType);
            credentials = { accessToken: creds.accessToken, accountId: creds.accountId };
        } catch {
            return;
        }

        const outbound: OutboundMessage = {
            tenantId,
            to: contact.phone,
            channelType,
            channelAccountId: credentials.accountId || '',
            content: {
                type: 'text',
                text: `Hola ${contact.name || ''}! Notamos que no pudiste asistir a tu cita de *${appt.service_name}*. ¿Te gustaría reprogramarla? Estamos para ayudarte.`,
            },
            metadata: {
                source: 'no_show_followup',
                appointmentId: appt.id,
            },
        };

        await this.outboundQueue.enqueue(outbound, credentials.accessToken);

        // Mark as followed up
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE appointments SET no_show_followed_up = true WHERE id = $1::uuid`,
            [appt.id],
        );

        this.logger.log(`Sent no-show follow-up for appointment ${appt.id} to ${contact.phone}`);
    }
}
