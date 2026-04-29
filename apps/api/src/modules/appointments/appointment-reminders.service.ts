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

    /**
     * Every hour: auto-complete confirmed appointments that ended 2+ hours ago.
     * Runs AFTER no-show detection (which checks at 30min), giving a safe window.
     * If the appointment wasn't marked as no-show by then, it's assumed completed.
     */
    @Cron('20 * * * *')
    async autoCompleteAppointments() {
        this.logger.debug('Checking for auto-complete appointments...');
        try {
            const tenants = await this.prisma.$queryRaw<any[]>`
                SELECT id, schema_name FROM tenants WHERE is_active = true
            `;
            if (!tenants?.length) return;

            for (const tenant of tenants) {
                await this.processAutoComplete(tenant.id, tenant.schema_name);
            }
        } catch (err) {
            this.logger.error('Error in auto-complete cron', err);
        }
    }

    private async processAutoComplete(tenantId: string, schemaName: string) {
        const tz = await this.getTenantTimezone(tenantId);
        // Auto-complete confirmed appointments that ended 2+ hours ago
        const completed = await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE appointments
             SET status = 'completed', completed_at = NOW(), completed_by = 'auto', updated_at = NOW()
             WHERE status = 'confirmed'
               AND end_at < (NOW() AT TIME ZONE '${tz}') - interval '2 hours'
             RETURNING id, service_name`,
            [],
        );

        const count = (completed as any[])?.length || 0;
        if (count > 0) {
            this.logger.log(`[AutoComplete] Marked ${count} appointment(s) as completed for tenant ${tenantId}`);
        }
    }

    /**
     * Every hour: send CSAT survey for appointments completed 1-2 hours ago.
     */
    @Cron('10 * * * *')
    async sendPostAppointmentCSAT() {
        try {
            const tenants = await this.prisma.$queryRaw<any[]>`
                SELECT id, schema_name FROM tenants WHERE is_active = true
            `;
            if (!tenants?.length) return;

            for (const tenant of tenants) {
                await this.processCSAT(tenant.id, tenant.schema_name);
            }
        } catch (err) {
            this.logger.error('Error in CSAT cron', err);
        }
    }

    private async processCSAT(tenantId: string, schemaName: string) {
        const tz = await this.getTenantTimezone(tenantId);
        // Find completed appointments from 1-2 hours ago that haven't been rated
        const appointments = await this.prisma.executeInTenantSchema(schemaName,
            `SELECT a.id, a.service_name, a.contact_id,
                    c.name as contact_name, c.phone as contact_phone, c.channel_type as contact_channel
             FROM appointments a
             LEFT JOIN contacts c ON c.id = a.contact_id
             WHERE a.status = 'completed'
               AND a.rating IS NULL
               AND a.end_at > (NOW() AT TIME ZONE '${tz}') - interval '2 hours'
               AND a.end_at <= (NOW() AT TIME ZONE '${tz}') - interval '1 hour'
               AND c.phone IS NOT NULL`,
            [],
        );

        if (!(appointments as any[])?.length) return;

        for (const appt of (appointments as any[])) {
            try {
                const channelType = (appt.contact_channel || 'whatsapp') as 'whatsapp' | 'instagram' | 'messenger' | 'telegram' | 'sms';
                let credentials: { accessToken: string; accountId: string };
                try {
                    const creds = await this.channelToken.getChannelToken(tenantId, channelType);
                    credentials = { accessToken: creds.accessToken, accountId: creds.accountId };
                } catch { continue; }

                const text = `Hola ${appt.contact_name || ''}! Gracias por tu cita de *${appt.service_name}*.\n\n` +
                    `Nos encantaria saber tu opinion. Del 1 al 5, como calificarias tu experiencia?\n\n` +
                    `1 - Muy mala\n2 - Mala\n3 - Regular\n4 - Buena\n5 - Excelente`;

                const outbound = {
                    tenantId,
                    to: appt.contact_phone,
                    channelType,
                    channelAccountId: credentials.accountId,
                    content: { type: 'text' as const, text },
                    metadata: { source: 'appointment_csat', appointmentId: appt.id },
                };

                await this.outboundQueue.enqueue(outbound, credentials.accessToken);
                this.logger.log(`Sent CSAT survey for appointment ${appt.id}`);
            } catch (err) {
                this.logger.error(`Failed CSAT for appointment ${appt.id}: ${err.message}`);
            }
        }
    }

    private async getTenantTimezone(tenantId: string): Promise<string> {
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { settings: true },
            });
            return (tenant?.settings as any)?.timezone || 'America/Bogota';
        } catch {
            return 'America/Bogota';
        }
    }

    private async processReminders(tenantId: string, schemaName: string, type: '24h' | '1h') {
        const flagColumn = type === '24h' ? 'reminder_24h_sent' : 'reminder_1h_sent';
        const minHours = type === '24h' ? 23 : 0.75;
        const maxHours = type === '24h' ? 25 : 1.25;

        // Use tenant timezone for correct reminder timing
        const tz = await this.getTenantTimezone(tenantId);
        const appointments = await this.prisma.executeInTenantSchema(schemaName,
            `SELECT a.id, a.service_name, a.start_at, a.end_at, a.location,
                    a.contact_id, a.assigned_to,
                    c.name as contact_name, c.phone as contact_phone,
                    c.channel_type as contact_channel
             FROM appointments a
             LEFT JOIN contacts c ON c.id = a.contact_id
             WHERE a.status IN ('pending', 'confirmed')
               AND a.${flagColumn} = false
               AND a.start_at > (NOW() AT TIME ZONE '${tz}')
               AND a.start_at <= (NOW() AT TIME ZONE '${tz}') + interval '${maxHours} hours'
               AND a.start_at >= (NOW() AT TIME ZONE '${tz}') + interval '${minHours} hours'
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

        const tz = await this.getTenantTimezone(tenantId);
        const startDate = new Date(appt.start_at);
        const dateStr = startDate.toLocaleDateString('es-CO', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            timeZone: tz,
        });
        const timeStr = startDate.toLocaleTimeString('es-CO', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: tz,
        });

        // Get tenant slug for reschedule link
        const tenantRows = await this.prisma.$queryRaw<any[]>`
            SELECT slug FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1
        `;
        const tenantSlug = tenantRows?.[0]?.slug;
        const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL || 'https://admin.parallly-chat.cloud';
        const rescheduleLink = tenantSlug ? `${dashboardUrl}/book/${tenantSlug}` : '';

        // Build the reminder message
        const reminderText = type === '24h'
            ? `📅 *Recordatorio de cita*\n\nHola ${appt.contact_name || ''}! Te recordamos que tienes una cita mañana:\n\n📋 *${appt.service_name}*\n🗓️ ${dateStr}\n⏰ ${timeStr}${appt.location ? `\n📍 ${appt.location}` : ''}\n\n${rescheduleLink ? `🔄 Reprogramar: ${rescheduleLink}\n\n` : ''}Si necesitas cancelar, avisanos con anticipacion.`
            : `⏰ *Tu cita es en 1 hora*\n\nHola ${appt.contact_name || ''}! Tu cita esta por comenzar:\n\n📋 *${appt.service_name}*\n⏰ ${timeStr}${appt.location ? `\n📍 ${appt.location}` : ''}\n\nTe esperamos!`;

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
        const tz = await this.getTenantTimezone(tenantId);
        // Find appointments that ended 30+ minutes ago, still confirmed, and NOT yet asked
        const pendingConfirmation = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT a.id, a.service_name, a.contact_id, a.start_at,
                    c.name as contact_name, c.phone as contact_phone,
                    c.channel_type as contact_channel
             FROM appointments a
             LEFT JOIN contacts c ON c.id = a.contact_id
             WHERE a.status IN ('pending', 'confirmed')
               AND a.no_show_followed_up = false
               AND a.end_at < (NOW() AT TIME ZONE '${tz}') - interval '30 minutes'
               AND c.phone IS NOT NULL`,
            [],
        );

        if (!(pendingConfirmation as any[])?.length) return;

        this.logger.log(`Sending ${pendingConfirmation.length} attendance confirmation(s) for tenant ${tenantId}`);

        for (const appt of pendingConfirmation) {
            try {
                await this.sendAttendanceConfirmation(tenantId, schemaName, appt);
                // Mark as followed up (don't change status yet — wait for response)
                await this.prisma.executeInTenantSchema(schemaName,
                    `UPDATE appointments SET no_show_followed_up = true, updated_at = NOW() WHERE id = $1::uuid`,
                    [appt.id],
                );
            } catch (err) {
                this.logger.error(`Failed to send attendance confirmation for appointment ${appt.id}`, err);
            }
        }
    }

    private async sendAttendanceConfirmation(tenantId: string, schemaName: string, appt: any) {
        const channelType = (appt.contact_channel || 'whatsapp') as 'whatsapp' | 'instagram' | 'messenger' | 'telegram';
        let credentials: { accessToken: string; accountId: string };
        try {
            const creds = await this.channelToken.getChannelToken(tenantId, channelType);
            credentials = { accessToken: creds.accessToken, accountId: creds.accountId };
        } catch { return; }

        const tz = await this.getTenantTimezone(tenantId);
        const startDate = new Date(appt.start_at);
        const timeStr = startDate.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz });

        const confirmationText = `✅ *Confirmación de asistencia*\n\nHola ${appt.contact_name || ''}! Tu cita de *${appt.service_name}* estaba programada hoy a las ${timeStr}.\n\n¿Pudiste asistir?\n\nResponde *Sí* o *No*`;

        const outbound: OutboundMessage = {
            tenantId,
            to: appt.contact_phone,
            channelType,
            channelAccountId: credentials.accountId || '',
            content: { type: 'text', text: confirmationText },
            metadata: {
                source: 'appointment_attendance_check',
                appointmentId: appt.id,
            },
        };

        await this.outboundQueue.enqueue(outbound, credentials.accessToken);
        this.logger.log(`Sent attendance confirmation to ${appt.contact_phone} for appointment ${appt.id}`);
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
