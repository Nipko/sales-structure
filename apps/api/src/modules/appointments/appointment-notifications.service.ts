import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { OutboundQueueService } from '../channels/outbound-queue.service';
import { ChannelTokenService } from '../channels/channel-token.service';
import { EmailTemplatesService } from '../email-templates/email-templates.service';
import { APPOINTMENT_EMAIL_SLUGS } from '../email-templates/appointment-email-layout';
import type { OutboundMessage } from '@parallext/shared';
import { apptMsg, normaliseLang, formatDuration, LANG_LOCALE } from './appointment-notifications-i18n';
import {
    buildAppointmentIcs,
    durationMinutes,
    formatWallClockDate,
    formatWallClockShortDate,
    formatWallClockTime,
    timezoneLabel,
} from './appointment-ics.util';

/**
 * Everything we need to write a customer-facing notification, read straight from
 * the appointment row. The two `appointment.created` emitters (manual CRUD and
 * the AI tool executor) hand over different shapes, and the AI one has omitted
 * `location` since it was written — so the payload is treated as a pointer and
 * the facts come from the table.
 */
interface AppointmentFacts {
    id: string;
    serviceName: string;
    startAt: string;
    endAt: string | null;
    location: string | null;
    meetingUrl: string | null;
    staffName: string | null;
    customerName: string | null;
    customerEmail: string | null;
}

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
            const tenantId = await this.getTenantId(schemaName);
            if (!tenantId) return;

            const contact = await this.getContactInfo(schemaName, appointment.contactId);
            const facts = await this.getAppointmentFacts(schemaName, appointment);
            const lang = await this.getContactLanguage(schemaName, appointment.contactId, tenantId);
            const locale = LANG_LOCALE[lang] ?? 'es-CO';
            const timezone = await this.getTenantTimezone(schemaName);

            const dateStr = formatWallClockDate(facts.startAt, locale);
            const timeStr = formatWallClockTime(facts.startAt, locale);

            // Channel confirmation still needs a phone; the email no longer does.
            if (contact?.phone) {
                const shortDate = formatWallClockShortDate(facts.startAt, locale);
                const text = [
                    apptMsg(lang, 'confirmTitle'),
                    ``,
                    apptMsg(lang, 'confirmGreeting', { name: contact.name || '' }),
                    ``,
                    `📋 *${facts.serviceName}*`,
                    `🗓️ ${shortDate}`,
                    `⏰ ${timeStr}`,
                    facts.location ? apptMsg(lang, 'confirmLocation', { location: facts.location }) : null,
                    facts.meetingUrl ? apptMsg(lang, 'confirmMeeting', { url: facts.meetingUrl }) : null,
                    ``,
                    apptMsg(lang, 'confirmFooter'),
                ].filter(Boolean).join('\n');

                await this.sendMessage(tenantId, contact, text, {
                    source: 'appointment_confirmation',
                    appointmentId: facts.id,
                });
            }

            await this.sendAppointmentEmail({
                schemaName, tenantId, lang, locale, timezone, facts, contact,
                kind: 'confirmation',
                dateStr, timeStr,
            });

            // Emit event for WebSocket relay to dashboard (handled by ConversationsGateway)
            this.eventEmitter.emit('appointment.ws', { tenantId, type: 'created', appointment });

            this.logger.log(`Sent confirmation for appointment ${facts.id}`);
        } catch (err: any) {
            this.logger.error(`Failed to send appointment confirmation: ${err.message}`);
        }
    }

    @OnEvent('appointment.cancelled')
    async onAppointmentCancelled(payload: { schemaName: string; appointment: any; reason?: string }) {
        const { schemaName, appointment, reason } = payload;

        try {
            const tenantId = await this.getTenantId(schemaName);
            if (!tenantId) return;

            const contact = await this.getContactInfo(schemaName, appointment.contactId);
            const facts = await this.getAppointmentFacts(schemaName, appointment);
            const lang = await this.getContactLanguage(schemaName, appointment.contactId, tenantId);
            const locale = LANG_LOCALE[lang] ?? 'es-CO';
            const timezone = await this.getTenantTimezone(schemaName);

            const dateStr = formatWallClockDate(facts.startAt, locale);
            const timeStr = formatWallClockTime(facts.startAt, locale);

            if (contact?.phone) {
                const shortDate = formatWallClockShortDate(facts.startAt, locale);
                const text = [
                    apptMsg(lang, 'cancelTitle'),
                    ``,
                    apptMsg(lang, 'cancelBody', { service: facts.serviceName, date: shortDate }),
                    reason ? apptMsg(lang, 'cancelReason', { reason }) : null,
                    ``,
                    apptMsg(lang, 'cancelFooter'),
                ].filter(Boolean).join('\n');

                await this.sendMessage(tenantId, contact, text, {
                    source: 'appointment_cancellation',
                    appointmentId: facts.id,
                });
            }

            await this.sendAppointmentEmail({
                schemaName, tenantId, lang, locale, timezone, facts, contact,
                kind: 'cancellation',
                dateStr, timeStr, reason,
            });

            this.logger.log(`Sent cancellation notice for appointment ${facts.id}`);
        } catch (err) {
            this.logger.error(`Failed to send cancellation notice: ${err.message}`);
        }
    }

    /**
     * Send the customer-facing email. Independent of the channel message on
     * purpose: a contact captured through a web form has an email and no phone,
     * and the old code returned before reaching this point, so that customer got
     * nothing at all.
     */
    private async sendAppointmentEmail(args: {
        schemaName: string;
        tenantId: string;
        lang: string;
        locale: string;
        timezone: string;
        facts: AppointmentFacts;
        contact: { name?: string; email?: string } | null;
        kind: 'confirmation' | 'cancellation';
        dateStr: string;
        timeStr: string;
        reason?: string;
    }): Promise<void> {
        const { schemaName, lang, locale, timezone, facts, contact, kind } = args;

        try {
            // The address the customer dictated during the booking is as valid as
            // the one on the contact record — and is often the only one there is.
            const to = (contact?.email || facts.customerEmail || '').trim();
            if (!to) return;
            if (!await this.emailNotificationsEnabled(schemaName)) return;

            const endAt = facts.endAt;
            const duration = endAt ? formatDuration(lang, durationMinutes(facts.startAt, endAt)) : '';
            const tzSuffix = timezoneLabel(facts.startAt, timezone, locale);

            const variables: Record<string, string> = {
                customer_name: contact?.name || facts.customerName || apptMsg(lang, 'customerFallback'),
                service_name: facts.serviceName,
                appointment_date: args.dateStr,
                appointment_time: tzSuffix ? `${args.timeStr} (${tzSuffix})` : args.timeStr,
                appointment_duration: duration,
                staff_name: facts.staffName || '',
                location: facts.location || '',
                meeting_url: facts.meetingUrl || '',
            };
            if (kind === 'cancellation') variables.cancellation_reason = args.reason || '';

            const attachments = this.buildIcsAttachment(args);

            await this.emailTemplates.renderAndSend(
                schemaName,
                APPOINTMENT_EMAIL_SLUGS[kind],
                to,
                variables,
                lang,
                { attachments },
            );
        } catch (err: any) {
            // Non-critical: the channel notification (when there was a phone) already went out.
            this.logger.warn(`Appointment ${kind} email failed for ${facts.id}: ${err?.message}`);
        }
    }

    /**
     * A .ics so the appointment lands in the customer's own calendar in one tap.
     * The UID is derived from the appointment id, so the cancellation replaces the
     * original event instead of adding a second one next to it.
     */
    private buildIcsAttachment(args: {
        timezone: string;
        facts: AppointmentFacts;
        contact: { name?: string; email?: string } | null;
        kind: 'confirmation' | 'cancellation';
    }) {
        const { facts, kind, timezone } = args;
        if (!facts.endAt) return undefined;

        try {
            const cancelled = kind === 'cancellation';
            const ics = buildAppointmentIcs({
                uid: `appointment-${facts.id}@parallly-chat.cloud`,
                method: cancelled ? 'CANCEL' : 'REQUEST',
                status: cancelled ? 'CANCELLED' : 'CONFIRMED',
                // The cancellation must outrank the invite it replaces, otherwise
                // calendars keep showing the original event.
                sequence: cancelled ? 1 : 0,
                startAt: facts.startAt,
                endAt: facts.endAt,
                timezone,
                stamp: new Date(),
                summary: facts.serviceName,
                location: facts.location || undefined,
                url: facts.meetingUrl || undefined,
                attendeeName: args.contact?.name || facts.customerName || undefined,
                attendeeEmail: (args.contact?.email || facts.customerEmail || '').trim() || undefined,
            });

            return [{
                filename: cancelled ? 'cita-cancelada.ics' : 'cita.ics',
                content: Buffer.from(ics, 'utf8'),
                contentType: `text/calendar; charset=utf-8; method=${cancelled ? 'CANCEL' : 'REQUEST'}`,
            }];
        } catch (err: any) {
            this.logger.warn(`Could not build .ics for appointment ${facts.id}: ${err?.message}`);
            return undefined;
        }
    }

    /**
     * Read the appointment as stored. Falls back to the event payload only when
     * the row cannot be read, so a notification is never lost over a bad join.
     */
    private async getAppointmentFacts(schemaName: string, appointment: any): Promise<AppointmentFacts> {
        const fromPayload = (): AppointmentFacts => ({
            id: appointment.id,
            serviceName: appointment.serviceName,
            startAt: appointment.startAt,
            endAt: appointment.endAt ?? null,
            location: appointment.location ?? null,
            meetingUrl: appointment.meetingUrl ?? appointment.metadata?.meetingUrl ?? null,
            staffName: appointment.assignedName ?? null,
            customerName: appointment.customerName ?? null,
            customerEmail: appointment.customerEmail ?? null,
        });

        if (!appointment?.id) return fromPayload();

        try {
            // The staff join is scoped through the owning tenant on purpose:
            // tenant-local tables cannot carry an FK to public.users, so every read
            // of a user must prove the row belongs to this tenant and is active
            // (same contract as AppointmentsService.getById).
            const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT a.id, a.service_name, a.start_at, a.end_at, a.location, a.metadata,
                        a.customer_name, a.customer_email,
                        u.first_name || ' ' || u.last_name AS staff_name
                   FROM appointments a
                   LEFT JOIN public.tenants tenant_owner
                     ON tenant_owner.schema_name = $1
                    AND tenant_owner.is_active = true
                   LEFT JOIN public.users u
                     ON u.id = a.assigned_to::uuid
                    AND u.tenant_id = tenant_owner.id
                    AND u.is_active = true
                  WHERE a.id = $2::uuid
                  LIMIT 1`,
                [schemaName, appointment.id],
            );
            const row = rows?.[0];
            if (!row) return fromPayload();

            return {
                id: row.id,
                serviceName: row.service_name || appointment.serviceName || '',
                startAt: this.toNaive(row.start_at) || appointment.startAt,
                endAt: this.toNaive(row.end_at),
                location: row.location || null,
                meetingUrl: row.metadata?.meetingUrl || appointment.meetingUrl || null,
                staffName: (row.staff_name || '').trim() || null,
                customerName: row.customer_name || appointment.customerName || null,
                customerEmail: row.customer_email || appointment.customerEmail || null,
            };
        } catch (err: any) {
            this.logger.warn(`Could not read appointment ${appointment.id}: ${err?.message}`);
            return fromPayload();
        }
    }

    /**
     * start_at/end_at are naive wall clocks. The driver may hand them back as a
     * Date (already carrying those digits in UTC fields) or as a string; both are
     * normalised to `YYYY-MM-DDTHH:mm:ss` so the formatters stay deterministic.
     */
    private toNaive(value: any): string | null {
        if (!value) return null;
        if (value instanceof Date) return value.toISOString().slice(0, 19);
        return String(value).replace(' ', 'T').slice(0, 19);
    }

    /**
     * Appointment emails follow the same switch as the channel confirmation:
     * `agent_personas.config_json.tools.appointments.emailConfirmations`.
     */
    private async emailNotificationsEnabled(schemaName: string): Promise<boolean> {
        try {
            const personaRows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT config_json FROM agent_personas WHERE is_active = true LIMIT 1`,
                [],
            );
            const config = personaRows?.[0]?.config_json || {};
            return config.tools?.appointments?.emailConfirmations !== false;
        } catch (err: any) {
            this.logger.error(`Error checking persona settings for appointments: ${err.message}`);
            return true;
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

    /** Same resolution order as AppointmentsService: settings.timezone → business hours → Bogotá. */
    private async getTenantTimezone(schemaName: string): Promise<string> {
        try {
            const tenant = await this.prisma.tenant.findFirst({
                where: { schemaName },
                select: { settings: true },
            });
            const settings = (tenant?.settings as any) || {};
            return settings.timezone || settings.businessHours?.timezone || 'America/Bogota';
        } catch {
            return 'America/Bogota';
        }
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
