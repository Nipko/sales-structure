import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappMessagingService } from '../whatsapp/services/whatsapp-messaging.service';
import { WhatsappTemplateService } from '../whatsapp/services/whatsapp-template.service';
import { AppointmentsService } from './appointments.service';
import { normalizeMetaLanguage } from '../whatsapp/seed-templates.config';
import { CronLockService } from '../redis/cron-lock.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';
import { EmailTemplatesService } from '../email-templates/email-templates.service';
import { APPOINTMENT_EMAIL_SLUGS } from '../email-templates/appointment-email-layout';
import { formatDuration, normaliseLang, LANG_LOCALE } from './appointment-notifications-i18n';
import { servedEmailConfirmationsEnabled } from '../../common/utils/served-confirmation-policy.util';
import { appointmentConfirmationFamilies } from './appointment-confirmation-subject';
import {
    ProactiveDispatchService, producerMayAdvance, type ProactiveSendResult,
} from '../channels/proactive-dispatch.service';

/**
 * Nothing durable was written, so the appointment must stay unflagged.
 *
 * An exception rather than a return value because the flag is written by the
 * CALLER, after this. A quiet `return` leaves that write happening for a
 * message that was refused — which is precisely the defect: the customer never
 * hears, and the record says they were told.
 */
class ReminderNotDispatched extends Error {
    constructor(readonly appointmentId: string, readonly result: ProactiveSendResult) {
        super(`reminder_not_dispatched:${result.kind}:${appointmentId}`);
        this.name = 'ReminderNotDispatched';
    }
}
import { RegionalProfileService } from '../tenants/regional-profile.service';
import { whatsappSenderFrom } from '../channels/whatsapp-sender-origin';
import {
    buildAppointmentIcs,
    durationMinutes,
    formatWallClockDate,
    formatWallClockTime,
    timezoneLabel,
} from './appointment-ics.util';

/**
 * Which of the tenant's WhatsApp numbers sends — and therefore pays.
 *
 * Both reminder queries carry `conversation_account_id`, LEFT-joined from the
 * conversation the appointment was booked in. `undefined` when the appointment
 * has no conversation (created by hand, or through the public booking page):
 * that is a real absence, and it is passed on as one rather than filled in. The
 * resolver serves an unnamed request on a single-number tenant and refuses
 * `connection_ambiguous` on a multi-number one, which is the only honest answer
 * when nobody said whose account pays Meta for the delivery.
 */
function senderOf(appointment: {
    conversation_account_id?: string | null;
    conversation_channel?: string | null;
}): string | undefined {
    // Only a WhatsApp conversation lends its connection. An appointment
    // booked over Instagram carries an Instagram id in the same column, and
    // handing that to the WhatsApp resolver attributes the reminder to an
    // account that is not a WhatsApp account at all.
    return whatsappSenderFrom({
        channelType: appointment.conversation_channel,
        channelAccountId: appointment.conversation_account_id,
    });
}

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
        private readonly emailTemplates: EmailTemplatesService,
        private readonly regionalProfile: RegionalProfileService,
        /**
         * The durable lane, which a reminder could not use until it learned to
         * carry an effect nobody asked for.
         *
         * Before this, both reminders went straight to `sendTemplate`: no row,
         * no lease, no receipt of their own. A restart between "this
         * appointment needs a reminder" and the POST either lost it — the
         * customer simply never heard — or, if the flag had not been written
         * yet, sent it again on the next pass. From October each repeat is a
         * charge.
         */
        private readonly proactive: ProactiveDispatchService,
    ) {}

    /**
     * Hand one reminder to the durable lane.
     *
     * ═══ THE FLAG FOLLOWS THE EFFECT, NEVER THE ATTEMPT ═══
     *
     * `reminder_24h_sent` means "the customer was told". Writing it for a
     * message that never left is how a reminder disappears with the record
     * saying it happened — and this method used to return a boolean the caller
     * then ignored, so an appointment with no sender was marked reminded.
     *
     * It returns the lane's own five-way answer now, and the caller advances
     * only on the three that mean "nothing further is owed":
     *
     *   · prepared / already_present — the durable effect exists;
     *   · suppressed — the policy says it must NOT be sent, so nothing is owed.
     *     Leaving the flag unset there would retry every fifteen minutes for
     *     ever against an appointment that was cancelled;
     *   · deferred / refused — nothing was written. The flag stays false.
     */
    private async dispatchTemplate(tenantId: string, schemaName: string, appt: any, input: {
        readonly originKey: string;
        readonly producer: string;
        readonly sender: string | undefined;
        readonly templateName: string;
        readonly language: string;
        readonly components: any[];
    }): Promise<ProactiveSendResult> {
        const channelType = (appt.contact_channel || 'whatsapp') as string;
        // ONLY what `senderOf` allowed. Falling back to the raw column would
        // undo the check it exists to make: that column holds whichever account
        // the customer wrote to, and an Instagram id is a perfectly well-formed
        // string to bill a WhatsApp reminder to.
        const sender = String(input.sender ?? '').trim();
        if (!sender) {
            // Without a sender there is no account to bill and no number to send
            // from. Refused rather than deferred: nobody is going to pick a
            // number on the platform's behalf, and retrying every fifteen
            // minutes would only repeat the same refusal. The configuration
            // task `ProactiveSendConnection` raises is what moves this.
            this.logger.warn(`[Reminders] appointment ${appt.id} has no sender — nothing dispatched`);
            return { kind: 'refused', reason: 'no_sender' };
        }
        const conversationId = appt.conversation_id
            ?? await this.proactive.conversationFor(schemaName, {
                contactId: String(appt.contact_id ?? ''),
                channelType, channelAccountId: sender,
            });
        if (!conversationId || !appt.contact_id) {
            this.logger.warn(`[Reminders] appointment ${appt.id} has no thread to write into `
                + '— nothing dispatched');
            return { kind: 'refused', reason: 'no_conversation' };
        }
        // ── THE AUTHORITY, READ FROM THE ROW RATHER THAN ASSERTED ───────────
        //
        // Built by reading the appointment, so the revision it carries
        // describes the appointment as it IS. The store revalidates it inside
        // the transaction that grants the lease, which is what makes a
        // cancellation between preparing and sending a suppression rather than
        // a message about a turn that no longer exists.
        const operationalScope = await this.proactive.policyAuthority(schemaName, {
            tenantId, producer: input.producer, channelType,
            channelAccountId: sender, entityId: String(appt.id),
        });
        if (!operationalScope) {
            // The appointment no longer justifies this message — cancelled,
            // completed, gone. Nothing is owed, so the caller advances.
            this.logger.log(`[Reminders] appointment ${appt.id} no longer justifies `
                + `${input.producer} — suppressed`);
            return { kind: 'suppressed', reason: 'entity_no_longer_eligible' };
        }
        return this.proactive.send(tenantId, {
            originKey: input.originKey,
            conversationId: String(conversationId),
            contactId: String(appt.contact_id),
            channelType, channelAccountId: sender,
            recipient: String(appt.contact_phone ?? ''),
            items: [{ kind: 'template', payload: {
                templateName: input.templateName,
                language: input.language,
                components: input.components,
            } }],
            operationalScope,
        });
    }

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
                if (!await this.canSendTenantWork(tenant.id)) continue;
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
                if (!await this.canSendTenantWork(tenant.id)) continue;
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
                if (!await this.canSendTenantWork(tenant.id)) continue;
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
            `SELECT a.id, a.service_name, a.start_at, a.end_at, a.location, a.metadata,
                    a.contact_id, a.assigned_to, a.customer_name, a.customer_email,
                    c.name as contact_name, c.phone as contact_phone, c.email as contact_email,
                    c.channel_type as contact_channel,
                    cv.channel_account_id AS conversation_account_id,
                    cv.channel_type AS conversation_channel,
                    u.first_name || ' ' || u.last_name AS staff_name
             FROM appointments a
             LEFT JOIN contacts c ON c.id = a.contact_id
             -- Which of the tenant's numbers this appointment was booked
             -- through. Meta bills the business per delivered service message
             -- from 1 October 2026, so a reminder has to name its sender or the
             -- resolver picks the oldest connection and that account pays.
             -- LEFT, because an appointment created by hand or through the
             -- public booking page has no conversation and therefore no sender
             -- identity; that stays NULL rather than becoming a guess.
             LEFT JOIN conversations cv ON cv.id = a.conversation_id
             LEFT JOIN public.tenants tenant_owner
               ON tenant_owner.schema_name = $1
              AND tenant_owner.is_active = true
             LEFT JOIN public.users u
               ON u.id = a.assigned_to::uuid
              AND u.tenant_id = tenant_owner.id
              AND u.is_active = true
             WHERE a.status IN ('pending', 'confirmed')
               AND a.${flagColumn} = false
               AND a.start_at > (NOW() AT TIME ZONE '${tz}')
               AND a.start_at <= (NOW() AT TIME ZONE '${tz}') + interval '${maxHours} hours'
               AND a.start_at >= (NOW() AT TIME ZONE '${tz}') + interval '${minHours} hours'
               AND (c.phone IS NOT NULL OR c.email IS NOT NULL OR a.customer_email IS NOT NULL)`,
            [schemaName],
        );

        if (!appointments?.length) return;
        this.logger.log(`Found ${appointments.length} appointments needing ${type} reminder for tenant ${tenantId}`);

        for (const appt of appointments) {
            try {
                if (appt.contact_phone) {
                    await this.sendReminderTemplate(tenantId, schemaName, appt, type);
                }
                // Email only on the 24h pass: a second copy two hours out is noise,
                // and by then nobody is reading mail to decide whether to show up.
                if (type === '24h') {
                    await this.sendReminderEmail(tenantId, schemaName, appt);
                }
                await this.prisma.executeInTenantSchema(schemaName,
                    `UPDATE appointments SET ${flagColumn} = true, updated_at = NOW() WHERE id = $1::uuid`,
                    [appt.id],
                );
            } catch (err: any) {
                this.logger.error(`Failed to send ${type} reminder for appointment ${appt.id}: ${err.message}`);
            }
        }
    }

    /**
     * Email reminder with the same branding and .ics as the confirmation.
     *
     * The `appointment_reminder_email` template has existed since May 2026 and
     * nothing ever sent it — the reminder path was WhatsApp-template-only, so a
     * customer who booked by email heard nothing until the appointment itself.
     */
    private async sendReminderEmail(tenantId: string, schemaName: string, appt: any): Promise<void> {
        const to = (appt.contact_email || appt.customer_email || '').trim();
        if (!to) return;

        try {
            await this.assertTenantCanSend(tenantId);
            // Same switch the confirmation honours: a tenant who turned appointment
            // emails off must not keep getting reminders through the back door.
            if (!await this.appointmentEmailsEnabled(schemaName, appt)) return;
            // getTenantLanguage returns the full locale ('es-CO'); template lookup
            // and the i18n maps are keyed by the 2-char code.
            const lang = normaliseLang(await this.getTenantLanguage(tenantId));
            const locale = LANG_LOCALE[lang] ?? 'es-CO';
            const tz = await this.getTenantTimezone(tenantId);

            const startAt = this.toNaive(appt.start_at);
            const endAt = this.toNaive(appt.end_at);
            if (!startAt) return;

            const tzSuffix = timezoneLabel(startAt, tz, locale);
            const timeStr = formatWallClockTime(startAt, locale);
            const meetingUrl = appt.metadata?.meetingUrl || '';

            let attachments;
            if (endAt) {
                try {
                    const ics = buildAppointmentIcs({
                        uid: `appointment-${appt.id}@parallly-chat.cloud`,
                        method: 'REQUEST',
                        status: 'CONFIRMED',
                        sequence: 0,
                        startAt,
                        endAt,
                        timezone: tz,
                        stamp: new Date(),
                        summary: appt.service_name || '',
                        location: appt.location || undefined,
                        url: meetingUrl || undefined,
                        attendeeName: appt.contact_name || appt.customer_name || undefined,
                        attendeeEmail: to,
                    });
                    attachments = [{
                        filename: 'cita.ics',
                        content: Buffer.from(ics, 'utf8'),
                        contentType: 'text/calendar; charset=utf-8; method=REQUEST',
                    }];
                } catch (err: any) {
                    this.logger.warn(`Could not build .ics for reminder ${appt.id}: ${err?.message}`);
                }
            }

            await this.emailTemplates.renderAndSend(
                schemaName,
                APPOINTMENT_EMAIL_SLUGS.reminder,
                to,
                {
                    customer_name: appt.contact_name || appt.customer_name || '',
                    service_name: appt.service_name || '',
                    appointment_date: formatWallClockDate(startAt, locale),
                    appointment_time: tzSuffix ? `${timeStr} (${tzSuffix})` : timeStr,
                    appointment_duration: endAt ? formatDuration(lang, durationMinutes(startAt, endAt)) : '',
                    staff_name: (appt.staff_name || '').trim(),
                    location: appt.location || '',
                    meeting_url: meetingUrl,
                },
                lang,
                { attachments },
            );
            this.logger.log(`Sent 24h email reminder to ${to} for appointment ${appt.id}`);
        } catch (err: any) {
            // Non-critical: the WhatsApp reminder (if any) already went out.
            this.logger.warn(`Reminder email failed for appointment ${appt.id}: ${err?.message}`);
        }
    }

    /**
     * `agent_personas.config_json.tools.<family>.emailConfirmations` — opt-out
     * only, read from the agent that served the connection the appointment was
     * BOOKED on, under the family whose operation the appointment IS.
     *
     * The sweep already joins that connection in — `conversation_channel` and
     * `conversation_account_id` are how the WhatsApp reminder names its sender
     * — so the same origin decides the email, and no second read is needed.
     * It used to be `is_active = true LIMIT 1`: an unordered pick among the
     * tenant's agents, which is not the agent that took the booking.
     */
    private appointmentEmailsEnabled(schemaName: string, appt: any): Promise<boolean> {
        const channelType = String(appt?.conversation_channel ?? '').trim();
        return servedEmailConfirmationsEnabled(
            <T>(sql: string, params: any[] = []) =>
                this.prisma.executeInTenantSchema<T>(schemaName, sql, params),
            // A test-drive reminder is a `vehicles` operation, a property-visit
            // reminder a `realEstate` one and a veterinary reminder a `pets`
            // one: that family's own switch decides them when the owner set
            // one, and the reminder must read the SAME switch the confirmation
            // of the same booking read. `a.metadata` is already in the sweep's
            // SELECT list, so the subject costs no extra query.
            appointmentConfirmationFamilies(appt?.metadata),
            // No conversation means no serving agent to ask — booked by hand or
            // through the public page. The helper reads that as "not switched
            // off" rather than guessing at an agent.
            channelType
                ? {
                    channelType,
                    channelAccountId: String(appt?.conversation_account_id ?? '').trim() || null,
                }
                : null,
        );
    }

    /** start_at/end_at are naive wall clocks — see appointment-ics.util.ts. */
    private toNaive(value: any): string | null {
        if (!value) return null;
        if (value instanceof Date) return value.toISOString().slice(0, 19);
        return String(value).replace(' ', 'T').slice(0, 19);
    }

    private async sendReminderTemplate(tenantId: string, schemaName: string, appt: any, type: '24h' | '2h') {
        await this.assertTenantCanSend(tenantId);
        if ((appt.contact_channel || 'whatsapp') !== 'whatsapp') {
            this.logger.debug(`Skipping template for non-WhatsApp contact ${appt.contact_phone}`);
            return;
        }

        // The catalogue belongs to the SENDER's WABA, so the sender is resolved
        // before the template rather than after: a template approved on a
        // sibling WABA is not a template this number may send. An appointment
        // that arrived through no conversation lends no sender, and the lookup
        // then answers only while the tenant has one WABA.
        const sender = senderOf(appt);
        const template = await this.getApprovedTemplate(schemaName, 'appointment_reminder', sender);
        if (!template) {
            this.logger.warn(`No approved appointment_reminder template on the WABA of `
                + `${sender ?? 'this tenant'} (${tenantId}) — skipping`);
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

        // ── THE DURABLE LANE, WHICH THIS COULD NOT USE BEFORE ───────────────
        //
        // The origin is the appointment and WHICH reminder, so the 24h and the
        // 2h are two different effects of one appointment and a retry of either
        // finds its own row.
        // The origin is the appointment and WHICH reminder, so the 24h and the
        // 2h are two different effects of one appointment and a retry of either
        // finds its own row.
        const result = await this.dispatchTemplate(tenantId, schemaName, appt, {
            originKey: `appointment_reminder:${appt.id}:${type}`,
            producer: 'appointment_reminder',
            sender, templateName: 'appointment_reminder',
            language: normalizeMetaLanguage(lang), components,
        });
        // Thrown, not returned: the caller writes the flag after this call, and
        // an exception is the only thing that reliably stops it. A `return` here
        // would leave the flag being written for a message that was refused,
        // which is the defect this whole change is about.
        if (!producerMayAdvance(result)) {
            throw new ReminderNotDispatched(String(appt.id), result);
        }
        this.logger.log(`${result.kind} the ${type} reminder for appointment ${appt.id}`);
    }

    private async processAttendanceChecks(tenantId: string, schemaName: string) {
        const tz = await this.getTenantTimezone(tenantId);
        const appointments = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT a.id, a.service_name, a.contact_id, a.start_at,
                    c.name as contact_name, c.phone as contact_phone,
                    c.channel_type as contact_channel,
                    cv.channel_account_id AS conversation_account_id,
                    cv.channel_type AS conversation_channel
             FROM appointments a
             LEFT JOIN contacts c ON c.id = a.contact_id
             LEFT JOIN conversations cv ON cv.id = a.conversation_id
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
        await this.assertTenantCanSend(tenantId);
        if ((appt.contact_channel || 'whatsapp') !== 'whatsapp') {
            return;
        }

        const sender = senderOf(appt);
        const template = await this.getApprovedTemplate(schemaName, 'attendance_check', sender);
        if (!template) {
            this.logger.warn(`No approved attendance_check template on the WABA of `
                + `${sender ?? 'this tenant'} (${tenantId}) — skipping`);
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

        const result = await this.dispatchTemplate(tenantId, schemaName, appt, {
            originKey: `attendance_check:${appt.id}`,
            producer: 'attendance_check',
            sender, templateName: 'attendance_check',
            language: normalizeMetaLanguage(lang), components,
        });
        if (!producerMayAdvance(result)) {
            throw new ReminderNotDispatched(String(appt.id), result);
        }
        this.logger.log(`${result.kind} the attendance check for appointment ${appt.id}`);
    }

    private async canSendTenantWork(tenantId: string): Promise<boolean> {
        const access = await resolveTenantSubscriptionAccess(this.prisma, tenantId, 'write');
        if (access.allowed) return true;
        this.logger.warn(
            `[AppointmentReminders] Skipping tenant=${tenantId}: `
            + `${access.error ?? 'subscription_restricted'}`,
        );
        return false;
    }

    private async assertTenantCanSend(tenantId: string): Promise<void> {
        const access = await resolveTenantSubscriptionAccess(this.prisma, tenantId, 'write');
        if (access.allowed) return;
        throw new Error(
            access.restrictionLevel === 'unavailable'
                ? `subscription_entitlement_unavailable:${access.error ?? 'unknown'}`
                : access.error ?? 'subscription_restricted',
        );
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

    /**
     * ═══ AN APPROVED TEMPLATE, ON THE CATALOGUE THAT WILL SEND IT ═══
     *
     * Approval belongs to a WhatsApp Business Account. A tenant with two WABAs
     * — a second brand, a migration in progress — can have
     * `appointment_reminder` approved on one and rejected on the other, and
     * this returned whichever row came back first. The reminder then went out
     * from a number whose WABA had never had that template approved, Meta
     * refused it at the door, and the failure looked like a transport problem
     * rather than the wrong catalogue.
     *
     * ── AND WHEN NOBODY NAMED A SENDER ──────────────────────────────────────
     *
     * A booking made by hand or through the public page arrived through no
     * conversation, so there is no connection to inherit. That is not a reason
     * to refuse: it is the same question the connection resolver answers, and
     * it has an answer exactly when the tenant has ONE WABA. With one, "the
     * catalogue" is unambiguous. With two, it is not, and returning a row from
     * either is picking which brand's template a customer receives.
     */
    private async getApprovedTemplate(schemaName: string, templateName: string,
        phoneNumberId?: string | null): Promise<any | null> {
        const sender = String(phoneNumberId ?? '').trim();
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT t.id, t.name, t.language, t.approval_status
               FROM whatsapp_templates t
               JOIN whatsapp_channels c ON c.id = t.channel_id
              WHERE t.name = $1 AND t.approval_status = 'APPROVED'
                AND c.meta_waba_id IS NOT NULL
                AND c.meta_waba_id = CASE
                    WHEN $2 <> '' THEN (
                        SELECT meta_waba_id FROM whatsapp_channels
                         WHERE phone_number_id = $2 LIMIT 1)
                    -- Unnamed: only while "the tenant's WABA" has one referent.
                    ELSE (
                        SELECT MIN(meta_waba_id) FROM whatsapp_channels
                         WHERE meta_waba_id IS NOT NULL
                        HAVING COUNT(DISTINCT meta_waba_id) = 1)
                    END
              LIMIT 1`,
            [templateName, sender],
        );
        return rows?.[0] || null;
    }

    private async getTenantTimezone(tenantId: string): Promise<string> {
        // Este probaba las horas de atención ANTES que `settings.timezone`, al
        // revés que el servicio de notificaciones. El mismo tenant calculaba el
        // recordatorio en una zona y escribía el mensaje en otra.
        return this.regionalProfile.timezoneFor(tenantId);
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
