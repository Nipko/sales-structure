import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ProactiveSendConnection } from '../channels/proactive-connection';
import { EmailTemplatesService } from '../email-templates/email-templates.service';
import { APPOINTMENT_EMAIL_SLUGS } from '../email-templates/appointment-email-layout';
import { apptMsg, normaliseLang, formatDuration, LANG_LOCALE } from './appointment-notifications-i18n';
import { RegionalProfileService } from '../tenants/regional-profile.service';
import {
    ProactiveDispatchService, effectIsDurable, type ProactiveSendResult,
} from '../channels/proactive-dispatch.service';
import { emailConfirmationsForOperation } from '../../common/utils/served-confirmation-policy.util';
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
    /**
     * The thread this appointment was booked in, when it was booked in one.
     *
     * Read from the row rather than from the event payload because the durable
     * lane writes the outbound message into `messages`, and a message belongs to
     * a thread. It also names the connection the customer actually wrote to —
     * and therefore the account Meta bills for the notice.
     */
    conversationId: string | null;
    /**
     * `metadata.testDrive`, written by `AppointmentsService.create` when the
     * booking carries a vehicle command.
     *
     * It is what makes this appointment a `vehicles` operation and not a plain
     * one, and therefore which of the owner's two switches decides whether the
     * confirmation email goes out.
     */
    testDrive: boolean;
}

/**
 * Everything a customer-facing notice needs, whichever notice it is.
 *
 * The confirmation and the cancellation differ in exactly three things — the
 * policy they send under, the origin that identifies them, and the words — so
 * they share one dispatch and name those three at the top, rather than keeping
 * two copies of the sender, thread and authority resolution in step by hand.
 */
interface AppointmentNoticeInput {
    readonly tenantId: string;
    readonly schemaName: string;
    readonly contactId: string | null;
    readonly contact: { phone: string; channel_type?: string };
    readonly facts: AppointmentFacts;
    readonly text: string;
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
        // Which number a notice leaves from, when the booking thread does not
        // say. It refuses to pick on a multi-number tenant, and raises a task.
        private connections: ProactiveSendConnection,
        private emailTemplates: EmailTemplatesService,
        private regionalProfile: RegionalProfileService,
        /**
         * The durable lane. BOTH notices go out on it now, and nothing in
         * this file reaches the plain outbound queue any more.
         *
         * They went out through `outbound_queue`: a BullMQ job whose only record
         * is Redis. A restart between the appointment committing and the job
         * being taken either lost the notice — the customer books, or is
         * cancelled on, and hears nothing — or, when the acknowledgement was the
         * part that was lost, sent it twice. From October each repeat is a
         * charge, and a second "your appointment is confirmed" is the single
         * most visible duplicate this product can produce.
         */
        private readonly proactive: ProactiveDispatchService,
    ) {}

    @OnEvent('appointment.created')
    async onAppointmentCreated(payload: { schemaName: string; appointment: any }) {
        const { schemaName, appointment } = payload;
        // A recorded request or payment hold is not yet a confirmation.
        if (appointment.status !== 'confirmed' || appointment.metadata?.source === 'eval_gate') return;

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

                // ── ON THE DURABLE LANE, AND NOT ALLOWED TO SINK THE EMAIL ──
                //
                // `resolve` THROWS when the connection could not be read, and
                // this used to propagate out of the whole handler — so a
                // credential store that blinked cost the customer the email as
                // well as the message. The two are independent notices and are
                // now handled independently.
                await this.dispatchConfirmation({
                    tenantId, schemaName, contact,
                    contactId: appointment.contactId, facts, text,
                }).catch((err: any) => {
                    this.logger.error(`[Appointments] the confirmation for ${facts.id} could `
                        + `not be handed to the durable lane: ${err?.message}`);
                });
            }

            await this.sendAppointmentEmail({
                schemaName, tenantId, lang, locale, timezone, facts, contact,
                kind: 'confirmation',
                dateStr, timeStr,
            });

            // Emit event for WebSocket relay to dashboard (handled by ConversationsGateway)
            this.eventEmitter.emit('appointment.ws', { tenantId, type: 'created', appointment });

            // Deliberately not "Sent". Nothing here observed a delivery: the
            // lane's own answer is logged by `dispatchConfirmation`, and saying
            // "sent" beside a refusal is the same class of lie as a flag written
            // for a message that never left.
            this.logger.log(`Handled the confirmation notices for appointment ${facts.id}`);
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

                // Same treatment as the confirmation, and for the same reason:
                // the connection resolver THROWS when it cannot read a
                // connection, and letting that escape would cost the customer
                // the cancellation email as well as the message.
                await this.dispatchCancellation({
                    tenantId, schemaName, contact,
                    contactId: appointment.contactId, facts, text,
                }).catch((err: any) => {
                    this.logger.error(`[Appointments] the cancellation notice for ${facts.id} `
                        + `could not be handed to the durable lane: ${err?.message}`);
                });
            }

            await this.sendAppointmentEmail({
                schemaName, tenantId, lang, locale, timezone, facts, contact,
                kind: 'cancellation',
                dateStr, timeStr, reason,
            });

            // Not "Sent", for the same reason as the confirmation above.
            this.logger.log(`Handled the cancellation notices for appointment ${facts.id}`);
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
            if (!await this.emailNotificationsEnabled(schemaName, facts)) return;

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
            conversationId: appointment.conversationId ?? null,
            testDrive: appointment.metadata?.testDrive === true,
        });

        if (!appointment?.id) return fromPayload();

        try {
            // The staff join is scoped through the owning tenant on purpose:
            // tenant-local tables cannot carry an FK to public.users, so every read
            // of a user must prove the row belongs to this tenant and is active
            // (same contract as AppointmentsService.getById).
            const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT a.id, a.service_name, a.start_at, a.end_at, a.location, a.metadata,
                        a.customer_name, a.customer_email, a.conversation_id,
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
                conversationId: row.conversation_id
                    ? String(row.conversation_id)
                    : (appointment.conversationId ?? null),
                // From the ROW, like every other fact here: the AI executor's
                // payload is a pointer and the marker is written by the INSERT.
                testDrive: row.metadata?.testDrive === true
                    || appointment.metadata?.testDrive === true,
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
     * `agent_personas.config_json.tools.appointments.emailConfirmations`.
     *
     * It gates the EMAIL and only the email. The channel notice above is not
     * switched by it — it goes out on the durable lane for every confirmed
     * appointment — and the header here claimed the two shared this switch,
     * which would have told a reader that switching it off silences both.
     *
     * Asked of the agent that served the connection the appointment was booked
     * on — the same connection the channel confirmation above leaves from. It
     * used to be asked of `is_active = true LIMIT 1`, which on a tenant with
     * two agents is whichever row the planner returned first: the owner who
     * switched confirmations off on their Instagram agent still got them for
     * bookings taken there, and the agent whose switch was read changed between
     * two identical bookings. See `served-confirmation-policy.util.ts`.
     */
    private async emailNotificationsEnabled(
        schemaName: string, facts: AppointmentFacts,
    ): Promise<boolean> {
        return emailConfirmationsForOperation(
            <T>(sql: string, params: any[] = []) =>
                this.prisma.executeInTenantSchema<T>(schemaName, sql, params),
            // A test drive is an appointment the `vehicles` family asked for, so
            // the dealership's own switch decides it when they set one. See
            // `ConfirmationFamilies`.
            facts.testDrive ? ['vehicles', 'appointments'] : ['appointments'],
            facts.conversationId,
        );
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
     * Una sola resolución para toda la plataforma.
     *
     * Este método probaba `settings.timezone` antes que las horas de atención y
     * el de recordatorios lo hacía al revés, así que un tenant con las dos
     * cosas cargadas recibía el recordatorio calculado en una zona y el mensaje
     * de confirmación escrito en otra. Nadie lo veía porque cada servicio era
     * coherente consigo mismo. Y ninguno miraba la zona DECLARADA.
     */
    private async getTenantTimezone(schemaName: string): Promise<string> {
        return this.regionalProfile.timezoneForSchema(schemaName);
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

    /**
     * The booking confirmation.
     *
     * `appointment_notification:<id>:confirmation`. The appointment id is what
     * the domain already keeps durably, so a second `appointment.created` for
     * the same row — a duplicated event, a replayed listener — derives the same
     * origin and collides on the one row that already exists instead of sending
     * a second confirmation.
     */
    private dispatchConfirmation(args: AppointmentNoticeInput): Promise<ProactiveSendResult> {
        return this.dispatchNotice({
            ...args,
            producer: 'appointment_notification',
            originKey: `appointment_notification:${args.facts.id}:confirmation`,
            describes: 'confirmation',
        });
    }

    /**
     * ═══ THE CANCELLATION NOTICE, WHICH COULD NOT MOVE UNTIL NOW ═══
     *
     * It stayed on the legacy queue for one reason, and it was not inertia: the
     * closed registry only knew `appointment_notification`, which reads
     * `appointmentRevision` and answers null for anything outside `pending` and
     * `confirmed` — and `AppointmentsService.cancel` commits `cancelled` BEFORE
     * it emits. Migrating on top of that would have SUPPRESSED every
     * cancellation notice on the platform while looking like working code.
     *
     * `appointment_cancellation` inverts the accepted status and keeps `status`
     * inside the hash, so the notice is authorised BECAUSE the appointment is
     * cancelled, and one re-confirmed between preparing the notice and admitting
     * it makes the prepared notice stale — "your appointment was cancelled" is
     * false about a booking that is back on.
     *
     * The origin is the appointment and nothing else: one cancellation per
     * appointment, so a replayed `appointment.cancelled` collides on the row
     * that already exists. It cannot collide with the confirmation's, which
     * carries its own suffix.
     */
    private dispatchCancellation(args: AppointmentNoticeInput): Promise<ProactiveSendResult> {
        return this.dispatchNotice({
            ...args,
            producer: 'appointment_cancellation',
            originKey: `appointment_cancellation:${args.facts.id}`,
            describes: 'cancellation notice',
        });
    }

    /**
     * ═══ ONE NOTICE, ON THE LANE THAT REMEMBERS IT ═══
     *
     * Both appointment events fire once and nothing retries them, so before
     * this each notice had exactly one chance and no record: the plain queue
     * put it in Redis, and a restart between the appointment committing and the
     * job being taken either lost it or — when the acknowledgement was what got
     * lost — delivered it twice. A customer who books and hears nothing, or who
     * is told twice that their appointment is cancelled, is the two most
     * visible failures of this product.
     *
     * ── THE PAYER IS NAMED, NEVER INHERITED ─────────────────────────────────
     *
     * The thread the appointment was booked in names the number the customer
     * actually wrote to, and that is the account Meta bills. Only when there is
     * no such thread does the resolver choose — and it refuses to choose on a
     * multi-number tenant rather than billing a WABA nobody picked.
     */
    private async dispatchNotice(args: AppointmentNoticeInput & {
        readonly producer: 'appointment_notification' | 'appointment_cancellation';
        readonly originKey: string;
        readonly describes: string;
    }): Promise<ProactiveSendResult> {
        const { tenantId, schemaName, facts } = args;
        const channelType = (args.contact.channel_type || 'whatsapp') as string;
        const contactId = String(args.contactId ?? '').trim();
        if (!contactId) {
            // Without a contact there is no thread and no history row, and the
            // outbox refuses a binding that names neither. Refused rather than
            // faked: a synthesised contact id would merge strangers.
            this.logger.warn(`[Appointments] appointment ${facts.id} has no contact — `
                + `no ${args.describes} dispatched`);
            return { kind: 'refused', reason: 'no_contact' };
        }

        // The thread the appointment was booked in, and only when it belongs to
        // the channel this notice goes out on. An appointment booked over
        // Instagram carries an Instagram thread, and writing a WhatsApp message
        // into it would attribute the spend to an account that is not a
        // WhatsApp account at all.
        const booked = await this.bookingThread(schemaName, facts.conversationId, channelType);
        const credentials = await this.connections.resolve({
            tenantId, schemaName, channelType,
            channelAccountId: booked?.channelAccountId ?? null,
            purpose: 'los avisos de turnos',
        });
        if (!credentials) return { kind: 'refused', reason: 'no_connection' };
        const channelAccountId = String(credentials.accountId ?? '').trim();
        if (!channelAccountId) return { kind: 'refused', reason: 'no_sender' };

        const conversationId = booked?.id
            ?? await this.proactive.conversationFor(schemaName, {
                contactId, channelType, channelAccountId,
            });
        if (!conversationId) {
            this.logger.warn(`[Appointments] appointment ${facts.id} has no thread to write `
                + `into — no ${args.describes} dispatched`);
            return { kind: 'refused', reason: 'no_conversation' };
        }

        // Built by READING the appointment, so the revision describes the row
        // as it is. The store revalidates it in the transaction that grants the
        // lease, and the two policies read the status in opposite directions: a
        // cancellation arriving after a confirmation was prepared suppresses the
        // confirmation, and a re-confirmation arriving after a cancellation
        // notice was prepared suppresses the notice. Each is false about the
        // booking the other now describes.
        const operationalScope = await this.proactive.policyAuthority(schemaName, {
            tenantId, producer: args.producer, channelType,
            channelAccountId, entityId: String(facts.id),
        });
        if (!operationalScope) {
            this.logger.log(`[Appointments] appointment ${facts.id} no longer justifies a `
                + `${args.describes} — suppressed`);
            return { kind: 'suppressed', reason: 'entity_no_longer_eligible' };
        }

        const result = await this.proactive.send(tenantId, {
            originKey: args.originKey,
            conversationId: String(conversationId),
            contactId,
            channelType, channelAccountId,
            recipient: String(args.contact.phone ?? ''),
            items: [{ kind: 'text', payload: { text: args.text } }],
            operationalScope,
        });
        // There is no flag to advance here — the event fires once and nothing
        // retries it — so the only honest thing to do with a non-durable answer
        // is say so loudly rather than log "sent" beside it.
        if (!effectIsDurable(result)) {
            this.logger.error(`[Appointments] the ${args.describes} for ${facts.id} was `
                + `${result.kind}: ${(result as any).reason ?? ''}`);
        } else {
            this.logger.log(`[Appointments] ${result.kind} the ${args.describes} `
                + `for ${facts.id}`);
        }
        return result;
    }

    /**
     * The thread the appointment was booked in, when it is a thread this notice
     * may actually use.
     *
     * `null` for an appointment created by hand or through the public booking
     * page, and equally for one whose thread lives on another channel. Both are
     * real absences and are returned as one rather than filled in.
     */
    private async bookingThread(schemaName: string, conversationId: string | null,
        channelType: string): Promise<{ id: string; channelAccountId: string } | null> {
        if (!conversationId) return null;
        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT id, channel_type, channel_account_id,
                        COALESCE(status, 'active') AS status
                   FROM conversations WHERE id = $1::uuid LIMIT 1`,
                [conversationId]);
            const row = rows?.[0];
            if (!row || String(row.channel_type ?? '') !== channelType) return null;
            // A resolved or archived thread is a closed conversation, and
            // writing into one puts the confirmation where nobody is looking.
            // `conversationFor` opens a live one beside it.
            if (['resolved', 'archived'].includes(String(row.status))) return null;
            const account = String(row.channel_account_id ?? '').trim();
            if (!account) return null;
            return { id: String(row.id), channelAccountId: account };
        } catch (err: any) {
            this.logger.warn(`Could not read the booking thread ${conversationId}: ${err?.message}`);
            return null;
        }
    }
}
