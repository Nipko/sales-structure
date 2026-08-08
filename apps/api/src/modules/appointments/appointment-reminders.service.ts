import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappMessagingService } from '../whatsapp/services/whatsapp-messaging.service';
import { WhatsappTemplateService } from '../whatsapp/services/whatsapp-template.service';
import { AppointmentsService } from './appointments.service';
import { normalizeMetaLanguage } from '../whatsapp/seed-templates.config';
import { CronLockService } from '../redis/cron-lock.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class AppointmentRemindersService {
    private readonly logger = new Logger(AppointmentRemindersService.name);

    constructor(
        private prisma: PrismaService,
        private whatsappMessaging: WhatsappMessagingService,
        private whatsappTemplates: WhatsappTemplateService,
        private appointmentsService: AppointmentsService,
        private readonly cronLock: CronLockService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    /**
     * Every 15 minutes: find appointments needing 24h reminders.
     * Sends approved WhatsApp template (works outside 24h window).
     */
    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('*/15 * * * *')
    async send24hRemindersCron() {
        await this.cronLock.runExclusive('appointment-reminders.send24hReminders', 300, () => this.send24hReminders());
    }

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
    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('3,18,33,48 * * * *')
    async send2hRemindersCron() {
        await this.cronLock.runExclusive('appointment-reminders.send2hReminders', 300, () => this.send2hReminders());
    }

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
    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('5,35 * * * *')
    async sendAttendanceChecksCron() {
        await this.cronLock.runExclusive('appointment-reminders.sendAttendanceChecks', 600, () => this.sendAttendanceChecks());
    }

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

            // `appointment.completed` — el momento post-visita.
            //
            // El cron ya marcaba las citas como completadas y no avisaba a
            // nadie, asi que la ventana en la que un cliente esta mas dispuesto
            // a dejar una reseña o a volver a agendar pasaba sin que el negocio
            // pudiera engancharse. Con esto el motor de automatizaciones tiene
            // un disparador para la vertical de agenda entera.
            //
            // Va con telefono y lead porque es lo que necesitan las acciones
            // (send_template lee event.phone; add_tag/assign_agent/update_stage
            // leen event.leadId). Se resuelve de una sola vez para toda la tanda.
            await this.emitAppointmentsCompleted(tenantId, schemaName, completed).catch((e: any) =>
                this.logger.warn(`[AutoComplete] No se pudo emitir appointment.completed: ${e.message}`),
            );
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

    /**
     * Emite un `appointment.completed` por cita recién completada, con todo lo
     * que las acciones de automatización necesitan para poder actuar.
     */
    private async emitAppointmentsCompleted(
        tenantId: string,
        schemaName: string,
        completed: Array<{ id: string; contact_id?: string; service_name?: string }>,
    ): Promise<void> {
        const ids = [...new Set(completed.map(c => c.contact_id).filter(Boolean))] as string[];
        if (!ids.length) return;

        // El lead vigente es el más reciente no archivado: un contacto puede
        // tener varios a lo largo del tiempo.
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT DISTINCT ON (c.id) c.id AS contact_id, c.phone, c.name, l.id AS lead_id
             FROM contacts c
             LEFT JOIN leads l ON l.contact_id = c.id AND l.archived_at IS NULL
             WHERE c.id = ANY($1::uuid[])
             ORDER BY c.id, l.created_at DESC NULLS LAST`,
            [ids],
        ).catch(() => [] as any[]);

        const reach = new Map(rows.map(r => [r.contact_id, r]));

        for (const appt of completed) {
            const c = appt.contact_id ? reach.get(appt.contact_id) : null;
            // Sin teléfono no hay a quién escribirle; las acciones fallarían en
            // la cola y ensuciarían el registro de ejecuciones con reintentos.
            if (!c?.phone) continue;
            this.eventEmitter.emit('appointment.completed', {
                tenantId,
                schemaName,
                appointmentId: appt.id,
                serviceName: appt.service_name ?? null,
                contactId: appt.contact_id,
                phone: c.phone,
                name: c.name ?? null,
                leadId: c.lead_id ?? null,
            });
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
            const rows = await this.prisma.$queryRawUnsafe(
                `SELECT u.first_name, u.last_name
                 FROM public.users u
                 JOIN public.tenants tenant_owner
                   ON tenant_owner.id = u.tenant_id
                  AND tenant_owner.schema_name = $2
                  AND tenant_owner.is_active = true
                 WHERE u.id = $1::uuid AND u.is_active = true
                 LIMIT 1`,
                userId,
                schemaName,
            ) as any[];
            if (rows?.[0]) {
                return `${rows[0].first_name || ''} ${rows[0].last_name || ''}`.trim() || '-';
            }
        } catch {}
        return '-';
    }
}
