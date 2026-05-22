import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappMessagingService } from '../whatsapp/services/whatsapp-messaging.service';
import { WhatsappTemplateService } from '../whatsapp/services/whatsapp-template.service';
import { AppointmentsService } from './appointments.service';
import { normalizeMetaLanguage } from '../whatsapp/seed-templates.config';

@Injectable()
export class AppointmentRemindersService {
    private readonly logger = new Logger(AppointmentRemindersService.name);

    constructor(
        private prisma: PrismaService,
        private whatsappMessaging: WhatsappMessagingService,
        private whatsappTemplates: WhatsappTemplateService,
        private appointmentsService: AppointmentsService,
    ) {}

    /**
     * Every 15 minutes: find appointments needing 24h reminders.
     * Sends approved WhatsApp template (works outside 24h window).
     */
    @Cron('*/15 * * * *')
    async send24hReminders() {
        this.logger.debug('Checking for 24h appointment reminders...');
        try {
            const tenants = await this.prisma.$queryRaw<any[]>`
                SELECT id, schema_name, settings FROM tenants WHERE is_active = true
            `;
            if (!tenants?.length) return;

            for (const tenant of tenants) {
                const settings = await this.appointmentsService.getReminderSettings(tenant.id);
                if (!settings.reminder24h) continue;
                await this.processReminders(tenant.id, tenant.schema_name, '24h');
            }
        } catch (err) {
            this.logger.error('Error in 24h reminder cron', err);
        }
    }

    /**
     * Every 15 minutes: find appointments needing 2h reminders.
     * Industry standard: 2h before gives customer time to prepare but not reschedule frivolously.
     */
    @Cron('3,18,33,48 * * * *')
    async send2hReminders() {
        this.logger.debug('Checking for 2h appointment reminders...');
        try {
            const tenants = await this.prisma.$queryRaw<any[]>`
                SELECT id, schema_name, settings FROM tenants WHERE is_active = true
            `;
            if (!tenants?.length) return;

            for (const tenant of tenants) {
                const settings = await this.appointmentsService.getReminderSettings(tenant.id);
                if (!settings.reminder2h) continue;
                await this.processReminders(tenant.id, tenant.schema_name, '2h');
            }
        } catch (err) {
            this.logger.error('Error in 2h reminder cron', err);
        }
    }

    /**
     * Every 30 minutes: send attendance check template for appointments that ended 30+ min ago.
     */
    @Cron('5,35 * * * *')
    async sendAttendanceChecks() {
        this.logger.debug('Checking for attendance confirmations...');
        try {
            const tenants = await this.prisma.$queryRaw<any[]>`
                SELECT id, schema_name FROM tenants WHERE is_active = true
            `;
            if (!tenants?.length) return;

            for (const tenant of tenants) {
                const settings = await this.appointmentsService.getReminderSettings(tenant.id);
                if (!settings.attendanceCheck) continue;
                await this.processAttendanceChecks(tenant.id, tenant.schema_name);
            }
        } catch (err) {
            this.logger.error('Error in attendance check cron', err);
        }
    }

    /**
     * Every hour: auto-complete confirmed appointments that ended 2+ hours ago.
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
                const settings = await this.appointmentsService.getReminderSettings(tenant.id);
                if (!settings.autoComplete) continue;
                await this.processAutoComplete(tenant.id, tenant.schema_name);
            }
        } catch (err) {
            this.logger.error('Error in auto-complete cron', err);
        }
    }

    // ── Private helpers ─────────────────────────────────────────────

    private async processReminders(tenantId: string, schemaName: string, type: '24h' | '2h') {
        const flagColumn = type === '24h' ? 'reminder_24h_sent' : 'reminder_2h_sent';
        const minHours = type === '24h' ? 23 : 1.75;
        const maxHours = type === '24h' ? 25 : 2.25;

        const tz = await this.getTenantTimezone(tenantId);
        const appointments = await this.prisma.executeInTenantSchema<any[]>(schemaName,
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

        if (!appointments?.length) return;
        this.logger.log(`Found ${appointments.length} appointments needing ${type} reminder for tenant ${tenantId}`);

        for (const appt of appointments) {
            try {
                await this.sendReminderTemplate(tenantId, schemaName, appt, type);
                await this.prisma.executeInTenantSchema(schemaName,
                    `UPDATE appointments SET ${flagColumn} = true, updated_at = NOW() WHERE id = $1::uuid`,
                    [appt.id],
                );
            } catch (err: any) {
                this.logger.error(`Failed to send ${type} reminder for appointment ${appt.id}: ${err.message}`);
            }
        }
    }

    private async sendReminderTemplate(tenantId: string, schemaName: string, appt: any, type: '24h' | '2h') {
        if ((appt.contact_channel || 'whatsapp') !== 'whatsapp') {
            this.logger.debug(`Skipping template for non-WhatsApp contact ${appt.contact_phone}`);
            return;
        }

        const template = await this.getApprovedTemplate(schemaName, 'appointment_reminder');
        if (!template) {
            this.logger.warn(`No approved appointment_reminder template for tenant ${tenantId} — skipping`);
            return;
        }

        const tz = await this.getTenantTimezone(tenantId);
        const lang = await this.getTenantLanguage(tenantId);
        const startDate = new Date(appt.start_at);
        const locale = lang === 'pt' ? 'pt-BR' : lang === 'fr' ? 'fr-FR' : lang === 'en' ? 'en-US' : 'es-CO';

        const dateStr = startDate.toLocaleDateString(locale, {
            weekday: 'long', day: 'numeric', month: 'long', timeZone: tz,
        });
        const timeStr = startDate.toLocaleTimeString(locale, {
            hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz,
        });

        const staffName = appt.assigned_to
            ? await this.getStaffName(schemaName, appt.assigned_to)
            : '-';

        const components = [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: appt.contact_name || '' },
                    { type: 'text', text: appt.service_name || '' },
                    { type: 'text', text: dateStr },
                    { type: 'text', text: timeStr },
                    { type: 'text', text: staffName },
                    { type: 'text', text: appt.location || '-' },
                ],
            },
        ];

        await this.whatsappMessaging.sendTemplate(
            schemaName,
            appt.contact_phone,
            'appointment_reminder',
            normalizeMetaLanguage(lang),
            components,
        );
        this.logger.log(`Sent ${type} template reminder to ${appt.contact_phone} for appointment ${appt.id}`);
    }

    private async processAttendanceChecks(tenantId: string, schemaName: string) {
        const tz = await this.getTenantTimezone(tenantId);
        const appointments = await this.prisma.executeInTenantSchema<any[]>(schemaName,
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

        if (!appointments?.length) return;
        this.logger.log(`Sending ${appointments.length} attendance check(s) for tenant ${tenantId}`);

        for (const appt of appointments) {
            try {
                await this.sendAttendanceTemplate(tenantId, schemaName, appt);
                await this.prisma.executeInTenantSchema(schemaName,
                    `UPDATE appointments SET no_show_followed_up = true, updated_at = NOW() WHERE id = $1::uuid`,
                    [appt.id],
                );
            } catch (err: any) {
                this.logger.error(`Failed attendance check for appointment ${appt.id}: ${err.message}`);
            }
        }
    }

    private async sendAttendanceTemplate(tenantId: string, schemaName: string, appt: any) {
        if ((appt.contact_channel || 'whatsapp') !== 'whatsapp') {
            return;
        }

        const template = await this.getApprovedTemplate(schemaName, 'attendance_check');
        if (!template) {
            this.logger.warn(`No approved attendance_check template for tenant ${tenantId} — skipping`);
            return;
        }

        const tz = await this.getTenantTimezone(tenantId);
        const lang = await this.getTenantLanguage(tenantId);
        const startDate = new Date(appt.start_at);
        const locale = lang === 'pt' ? 'pt-BR' : lang === 'fr' ? 'fr-FR' : lang === 'en' ? 'en-US' : 'es-CO';

        const dateStr = startDate.toLocaleDateString(locale, {
            weekday: 'long', day: 'numeric', month: 'long', timeZone: tz,
        });
        const timeStr = startDate.toLocaleTimeString(locale, {
            hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz,
        });

        const components = [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: appt.contact_name || '' },
                    { type: 'text', text: appt.service_name || '' },
                    { type: 'text', text: dateStr },
                    { type: 'text', text: timeStr },
                ],
            },
        ];

        await this.whatsappMessaging.sendTemplate(
            schemaName,
            appt.contact_phone,
            'attendance_check',
            normalizeMetaLanguage(lang),
            components,
        );
        this.logger.log(`Sent attendance check template to ${appt.contact_phone} for appointment ${appt.id}`);
    }

    private async processAutoComplete(tenantId: string, schemaName: string) {
        const tz = await this.getTenantTimezone(tenantId);
        const completed = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `UPDATE appointments
             SET status = 'completed', completed_at = NOW(), completed_by = 'auto', updated_at = NOW()
             WHERE status = 'confirmed'
               AND end_at < (NOW() AT TIME ZONE '${tz}') - interval '2 hours'
             RETURNING id, contact_id, service_name`,
            [],
        );

        const count = completed?.length || 0;
        if (count > 0) {
            this.logger.log(`[AutoComplete] Marked ${count} appointment(s) as completed for tenant ${tenantId}`);
            const contactIds = completed.map(c => c.contact_id).filter(Boolean);
            if (contactIds.length > 0) {
                try {
                    await this.prisma.executeInTenantSchema(schemaName,
                        `UPDATE contacts SET last_appointment_at = NOW(), next_recall_at = NULL
                         WHERE id = ANY($1::uuid[])`,
                        [contactIds],
                    );
                } catch (e: any) {
                    this.logger.warn(`[AutoComplete] Failed to update last_appointment_at for ${tenantId}: ${e.message}`);
                }
            }
        }
    }

    // ── Utility methods ─────────────────────────────────────────────

    private async getApprovedTemplate(schemaName: string, templateName: string): Promise<any | null> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT id, name, language, approval_status FROM whatsapp_templates
             WHERE name = $1 AND approval_status = 'APPROVED'
             LIMIT 1`,
            [templateName],
        );
        return rows?.[0] || null;
    }

    private async getTenantTimezone(tenantId: string): Promise<string> {
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { settings: true },
            });
            return (tenant?.settings as any)?.businessHours?.timezone
                || (tenant?.settings as any)?.timezone
                || 'America/Bogota';
        } catch {
            return 'America/Bogota';
        }
    }

    private async getTenantLanguage(tenantId: string): Promise<string> {
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { language: true },
            });
            return tenant?.language || 'es';
        } catch {
            return 'es';
        }
    }

    private async getStaffName(schemaName: string, userId: string): Promise<string> {
        try {
            const rows = await this.prisma.$queryRawUnsafe<any[]>(
                `SELECT first_name, last_name FROM public.users WHERE id = $1::uuid LIMIT 1`,
                userId,
            );
            if (rows?.[0]) {
                return `${rows[0].first_name || ''} ${rows[0].last_name || ''}`.trim() || '-';
            }
        } catch {}
        return '-';
    }
}
