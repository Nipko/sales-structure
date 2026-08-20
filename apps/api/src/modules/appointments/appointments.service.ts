import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'crypto';
import { CalendarSyncOutboxService } from './calendar-sync-outbox.service';
import { TemporalCapacityContractService } from '../verticals/temporal-capacity-contract.service';
import { assertActiveTenantUser } from './tenant-user-scope.util';
import {
    assertOptionalContactId,
    requireTenantContact,
} from '../../common/utils/tenant-contact.util';
import {
    AppointmentServiceUnavailableError,
    AppointmentSlotConflictError,
    dayOfWeekForLocalDate,
    lockAndAssertAppointmentCapacity,
    wallClockEpoch,
} from './appointment-capacity.util';
import { resolveNativeEvidenceOpportunity } from '../../common/utils/native-evidence-opportunity.util';
import {
    OCCUPANCY_EXCLUDED_SQL,
    PENDING_PAYMENT_STATUS,
    resolvePaymentPolicy,
} from '../../common/utils/payment-policy.util';

export interface Appointment {
    id: string;
    contactId: string | null;
    contactName?: string;
    conversationId: string | null;
    assignedTo: string | null;
    assignedName?: string;
    serviceId?: string | null;
    serviceName: string;
    startAt: string;
    endAt: string;
    status: string;
    location: string | null;
    notes: string | null;
    reminderSent: boolean;
    metadata: Record<string, any>;
    createdAt: string;
    recurringGroupId: string | null;
    recurrenceRule: Record<string, any> | null;
    calendarIntegrationId: string | null;
    calendarOwnerId: string | null;
    calendarProvider: 'google' | 'microsoft' | null;
    calendarEventId: string | null;
    calendarSyncState: string | null;
    calendarSyncError: string | null;
    calendarSyncedAt: string | null;
}

export interface AvailabilitySlot {
    id: string;
    userId: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    isActive: boolean;
}

export interface BlockedDate {
    id: string;
    userId: string | null;
    blockedDate: string;
    reason: string | null;
}

@Injectable()
export class AppointmentsService {
    private readonly logger = new Logger(AppointmentsService.name);
    private readonly temporalContracts = new TemporalCapacityContractService();

    constructor(
        private prisma: PrismaService,
        private eventEmitter: EventEmitter2,
        private calendarOutbox: CalendarSyncOutboxService,
    ) {}

    // ── Reminder Settings ─────────────────────────────────────

    private readonly REMINDER_DEFAULTS = {
        reminder24h: true,
        reminder2h: true,
        attendanceCheck: true,
        autoComplete: true,
    };

    async getReminderSettings(tenantId: string): Promise<{
        reminder24h: boolean; reminder2h: boolean;
        attendanceCheck: boolean; autoComplete: boolean;
    }> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        const saved = (tenant?.settings as any)?.appointmentReminders;
        return { ...this.REMINDER_DEFAULTS, ...saved };
    }

    async updateReminderSettings(tenantId: string, input: Partial<{
        reminder24h: boolean; reminder2h: boolean;
        attendanceCheck: boolean; autoComplete: boolean;
    }>): Promise<typeof this.REMINDER_DEFAULTS> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        const currentSettings = (tenant?.settings as any) || {};
        const currentReminders = currentSettings.appointmentReminders || {};
        const merged = { ...this.REMINDER_DEFAULTS, ...currentReminders, ...input };

        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                settings: {
                    ...currentSettings,
                    appointmentReminders: merged,
                } as any,
            },
        });
        return merged;
    }

    // ── WhatsApp Flows (booking) Settings ─────────────────────
    // Opt-in: when enabled + a published Flow ID is set, the WhatsApp booking flow
    // sends an interactive Meta Flow (one-step form) instead of the step-by-step
    // text/buttons. OFF by default; everything falls back to text if disabled.

    private readonly BOOKING_FLOWS_DEFAULTS = {
        enabled: false,
        flowId: '',
        flowCta: 'Agendar',
        flowMode: 'published' as 'published' | 'draft',
    };

    async getBookingFlowsConfig(tenantId: string): Promise<{
        enabled: boolean; flowId: string; flowCta: string;
        flowMode: 'published' | 'draft';
    }> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        const saved = (tenant?.settings as any)?.bookingFlows;
        return { ...this.BOOKING_FLOWS_DEFAULTS, ...saved };
    }

    async updateBookingFlowsConfig(tenantId: string, input: Partial<{
        enabled: boolean; flowId: string; flowCta: string;
        flowMode: 'published' | 'draft';
    }>): Promise<typeof this.BOOKING_FLOWS_DEFAULTS> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        const currentSettings = (tenant?.settings as any) || {};
        const merged = {
            ...this.BOOKING_FLOWS_DEFAULTS,
            ...(currentSettings.bookingFlows || {}),
            ...input,
        };

        // A Meta Flow ID is a numeric string; require it when enabling so we never
        // ship a 400 to Meta at send time (the engine would then fall back to text).
        if (merged.enabled && !/^\d{6,}$/.test(String(merged.flowId || ''))) {
            throw new BadRequestException(
                'A valid published Flow ID (numeric) is required to enable WhatsApp Flows',
            );
        }

        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: {
                settings: {
                    ...currentSettings,
                    bookingFlows: merged,
                } as any,
            },
        });
        return merged;
    }

    // ── Appointments CRUD ─────────────────────────────────────

    async list(schemaName: string, filters?: {
        status?: string; assignedTo?: string;
        startDate?: string; endDate?: string;
    }): Promise<Appointment[]> {
        if (filters?.assignedTo) {
            await assertActiveTenantUser(this.prisma, schemaName, filters.assignedTo);
        }
        let sql = `
            SELECT a.*, c.name as contact_name, u.id as assigned_user_id,
                   u.first_name || ' ' || u.last_name as assigned_name
            FROM appointments a
            LEFT JOIN contacts c ON c.id = a.contact_id
            LEFT JOIN public.tenants tenant_owner
              ON tenant_owner.schema_name = $1
             AND tenant_owner.is_active = true
            LEFT JOIN public.users u
              ON u.id = a.assigned_to::uuid
             AND u.tenant_id = tenant_owner.id
             AND u.is_active = true
            WHERE 1=1
        `;
        const params: any[] = [schemaName];
        let idx = 2;

        if (filters?.status) {
            sql += ` AND a.status = $${idx++}`;
            params.push(filters.status);
        }
        if (filters?.assignedTo) {
            sql += ` AND a.assigned_to = $${idx++}::uuid`;
            params.push(filters.assignedTo);
        }
        if (filters?.startDate) {
            sql += ` AND a.start_at >= $${idx++}::timestamp`;
            params.push(filters.startDate);
        }
        if (filters?.endDate) {
            sql += ` AND a.start_at <= $${idx++}::timestamp`;
            params.push(filters.endDate);
        }

        sql += ` ORDER BY a.start_at ASC`;

        const rows = await this.prisma.executeInTenantSchema(schemaName, sql, params);
        // Arrow obligatoria: pasar this.mapRow sin bind pierde `this` y
        // toNaiveIso explota con TypeError → el listado devolvía 500 para
        // TODO tenant con al menos una cita.
        return (rows as any[]).map((r) => this.mapRow(r));
    }

    async getById(schemaName: string, appointmentId: string): Promise<Appointment> {
        const rows = await this.prisma.executeInTenantSchema(schemaName,
            `SELECT a.*, c.name as contact_name, u.id as assigned_user_id,
                    u.first_name || ' ' || u.last_name as assigned_name
             FROM appointments a
             LEFT JOIN contacts c ON c.id = a.contact_id
             LEFT JOIN public.tenants tenant_owner
               ON tenant_owner.schema_name = $1
              AND tenant_owner.is_active = true
             LEFT JOIN public.users u
               ON u.id = a.assigned_to::uuid
              AND u.tenant_id = tenant_owner.id
              AND u.is_active = true
             WHERE a.id = $2::uuid`,
            [schemaName, appointmentId],
        );
        const row = (rows as any[])[0];
        if (!row) throw new NotFoundException('Appointment not found');
        return this.mapRow(row);
    }

    async create(schemaName: string, data: {
        contactId?: string;
        conversationId?: string;
        opportunityId?: string;
        assignedTo?: string;
        serviceId?: string;
        serviceName: string;
        startAt: string;
        endAt: string;
        location?: string;
        notes?: string;
        metadata?: Record<string, any>;
        customerName?: string;
        customerPhone?: string;
        customerEmail?: string;
        source?: string;
    }): Promise<Appointment> {
        // Tenant-local appointment rows cannot FK to public.users. Resolve the
        // assignment against the active tenant owner before any conflict/write.
        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const requestedContactId = assertOptionalContactId(data.contactId);
        if (!requestedContactId) {
            throw new BadRequestException({
                error: 'appointment_contact_required',
                message: 'contactId is required',
            });
        }
        const assignedToUuid = data.assignedTo
            ? await assertActiveTenantUser(this.prisma, schemaName, data.assignedTo)
            : null;
        const conversationIdUuid = data.conversationId && uuidRe.test(data.conversationId) ? data.conversationId : null;

        // Auto-resolve serviceId from serviceName if not directly provided
        let serviceIdUuid = data.serviceId && uuidRe.test(data.serviceId) ? data.serviceId : null;
        if (!serviceIdUuid && data.serviceName) {
            try {
                const svcRows = await this.prisma.executeInTenantSchema(schemaName,
                    `SELECT id FROM services WHERE LOWER(name) = $1 AND is_active = true LIMIT 1`,
                    [data.serviceName.toLowerCase()],
                );
                if ((svcRows as any[])?.length > 0) {
                    serviceIdUuid = (svcRows as any[])[0].id;
                }
            } catch (e: any) {
                this.logger.warn(`Failed to resolve serviceId from name "${data.serviceName}": ${e.message}`);
            }
        }
        if (!serviceIdUuid) {
            throw new BadRequestException({
                error: 'appointment_service_unavailable',
                message: 'El servicio no existe o no está activo.',
            });
        }

        // Appointments are fixed wall-clock intervals. An empty/open duration is
        // not coerced to 60 minutes: callers must select the nightly,
        // day-capacity, session or resource contract explicitly.
        const startAt = this.normalizeNaive(data.startAt);
        if (!startAt) {
            throw new BadRequestException('La hora de inicio de la cita no es válida.');
        }
        const endAt = this.normalizeNaive(data.endAt);
        if (!endAt || endAt <= startAt) {
            throw new BadRequestException({
                error: 'ambiguous_or_invalid_appointment_duration',
                message: 'La cita necesita una hora final explícita posterior al inicio.',
            });
        }
        const timezone = await this.resolveTimezoneForSchema(schemaName, data.metadata?.timezone);
        this.temporalContracts.normalize({
            kind: 'appointment',
            startsAtLocal: startAt,
            timezone,
            durationMinutes: this.diffMinutesNaive(startAt, endAt),
        });

        const id = randomUUID();
        let canonicalServiceName = data.serviceName;
        // Se declara fuera de la transacción porque el llamador necesita saber
        // si la cita quedó pendiente de pago: es lo que impide que el agente
        // diga "tu cita quedó confirmada" sobre algo que nadie pagó.
        let policy = resolvePaymentPolicy(null, 0);
        try {
            await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
                const contactIdUuid = await requireTenantContact(query, requestedContactId);
                const opportunityId = await resolveNativeEvidenceOpportunity(query, {
                    contactId: contactIdUuid,
                    conversationId: conversationIdUuid,
                    trustedOpportunityId: data.opportunityId,
                });
                const service = await lockAndAssertAppointmentCapacity(query, {
                    schemaName,
                    serviceId: serviceIdUuid!,
                    staffUserId: assignedToUuid,
                    startAt,
                    endAt,
                });
                canonicalServiceName = service.name;
                // Si el servicio exige pago para confirmarse, la cita nace
                // pendiente y NO ocupa el turno (decisión del dueño: gana quien
                // pague primero). El estado se pasa explícito porque el default
                // de la columna es 'pending', que significa otra cosa —
                // "agendada, falta que el negocio la confirme"— y sí ocupa.
                policy = resolvePaymentPolicy(service, service?.price);
                const status = policy.requiresPayment ? PENDING_PAYMENT_STATUS : 'pending';
                const amountDue = policy.requiresPayment
                    && policy.dueAmount != null
                    && policy.dueAmount < policy.totalAmount
                    ? policy.dueAmount : null;
                await query(
                    `INSERT INTO appointments
                        (id, contact_id, opportunity_id, conversation_id, assigned_to, service_id, service_name,
                         start_at, end_at, location, notes, metadata, customer_name,
                         customer_phone, customer_email, source, status, amount_due, created_at, updated_at)
                     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7,
                             $8::timestamp, $9::timestamp, $10, $11, $12::jsonb, $13,
                             $14, $15, $16, $17, $18, NOW(), NOW())`,
                    [
                        id, contactIdUuid, opportunityId, conversationIdUuid, assignedToUuid, serviceIdUuid,
                        canonicalServiceName, startAt, endAt, data.location || null,
                        data.notes || null, JSON.stringify(data.metadata || {}),
                        data.customerName || null, data.customerPhone || null,
                        data.customerEmail || null, data.source || 'manual',
                        status, amountDue,
                    ],
                );
                // Una cita impaga no se sincroniza al calendario del profesional:
                // taparía su agenda con algo que todavía está a la venta.
                if (!policy.requiresPayment) {
                    await this.calendarOutbox.enqueueWithQuery(query, id, 'upsert');
                }
            });
        } catch (error) {
            if (error instanceof AppointmentSlotConflictError) {
                throw new ConflictException({
                    error: error.code,
                    message: 'Ese horario ya no está disponible.',
                });
            }
            if (error instanceof AppointmentServiceUnavailableError) {
                throw new BadRequestException({
                    error: error.code,
                    message: 'El servicio no existe o no está activo.',
                });
            }
            throw error;
        }

        this.logger.log(`Appointment created: ${id} — ${canonicalServiceName} at ${startAt}`);
        const appointment = await this.getById(schemaName, id);

        // Emit event for WhatsApp confirmation
        this.eventEmitter.emit('appointment.created', { schemaName, appointment });

        // La política viaja con la cita: quien la lee —la herramienta, y a
        // través de ella el agente— tiene que saber que esto NO está confirmado
        // y que el turno sigue disponible para otros hasta que entre el pago.
        return {
            ...appointment,
            awaitingPayment: policy.requiresPayment,
            amountDueToConfirm: policy.requiresPayment ? policy.dueAmount : undefined,
            paymentChoice: policy.customerChooses ? 'deposit_or_full' : undefined,
        } as Appointment;
    }

    async update(schemaName: string, appointmentId: string, data: {
        assignedTo?: string | null; serviceName?: string;
        startAt?: string; endAt?: string; status?: string;
        location?: string; notes?: string;
    }): Promise<Appointment> {
        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (data.assignedTo !== undefined) {
            const assignedTo = data.assignedTo === null
                ? null
                : await assertActiveTenantUser(this.prisma, schemaName, data.assignedTo);
            sets.push(`assigned_to = $${idx++}::uuid`);
            params.push(assignedTo);
        }
        if (data.serviceName !== undefined) { sets.push(`service_name = $${idx++}`); params.push(data.serviceName); }
        if (data.startAt !== undefined || data.endAt !== undefined) {
            const currentRows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT to_char(start_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS start_at,
                        to_char(end_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS end_at
                 FROM appointments WHERE id = $1::uuid LIMIT 1`,
                [appointmentId],
            );
            if (!currentRows?.length) throw new NotFoundException('Appointment not found');
            const startAt = data.startAt === undefined
                ? currentRows[0].start_at : this.normalizeNaive(data.startAt);
            const endAt = data.endAt === undefined
                ? currentRows[0].end_at : this.normalizeNaive(data.endAt);
            if (!startAt || !endAt || endAt <= startAt) {
                throw new BadRequestException({
                    error: 'ambiguous_or_invalid_appointment_duration',
                    message: 'La cita necesita inicio y fin explícitos en orden válido.',
                });
            }
            const timezone = await this.resolveTimezoneForSchema(schemaName);
            this.temporalContracts.normalize({
                kind: 'appointment',
                startsAtLocal: startAt,
                timezone,
                durationMinutes: this.diffMinutesNaive(startAt, endAt),
            });
            sets.push(`start_at = $${idx++}::timestamp`); params.push(startAt);
            sets.push(`end_at = $${idx++}::timestamp`); params.push(endAt);
        }
        if (data.status !== undefined) {
            sets.push(`status = $${idx++}`); params.push(data.status);
            if (data.status === 'completed') {
                sets.push(`completed_at = NOW()`);
                sets.push(`completed_by = 'staff'`);
            }
        }
        if (data.location !== undefined) { sets.push(`location = $${idx++}`); params.push(data.location); }
        if (data.notes !== undefined) { sets.push(`notes = $${idx++}`); params.push(data.notes); }
        sets.push(`updated_at = NOW()`);

        if (sets.length === 1) return this.getById(schemaName, appointmentId);

        params.push(appointmentId);
        await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            await query(
                `UPDATE appointments SET ${sets.join(', ')} WHERE id = $${idx}::uuid`,
                params,
            );
            await this.calendarOutbox.enqueueWithQuery(
                query,
                appointmentId,
                data.status === 'cancelled' ? 'delete' : 'upsert',
            );
        });

        // When marking as completed, propagate to contacts.last_appointment_at
        // so the recall cron can find contacts due for follow-up. We don't
        // touch next_recall_at — that's only set by the recall cron itself
        // after sending a recall message, to avoid hammering the same contact.
        if (data.status === 'completed') {
            try {
                await this.prisma.executeInTenantSchema(schemaName,
                    `UPDATE contacts SET last_appointment_at = NOW(), next_recall_at = NULL
                     WHERE id = (SELECT contact_id FROM appointments WHERE id = $1::uuid)
                       AND id IS NOT NULL`,
                    [appointmentId],
                );
            } catch (e: any) {
                this.logger.warn(`Failed to update contacts.last_appointment_at: ${e.message}`);
            }
        }

        return this.getById(schemaName, appointmentId);
    }

    async cancel(schemaName: string, appointmentId: string, reason?: string): Promise<Appointment> {
        await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            await query(
                `UPDATE appointments SET status = 'cancelled',
                        cancellation_reason = $2, updated_at = NOW()
                 WHERE id = $1::uuid`,
                [appointmentId, reason || null],
            );
            await this.calendarOutbox.enqueueWithQuery(query, appointmentId, 'delete');
        });
        const appointment = await this.getById(schemaName, appointmentId);

        // Emit event for WhatsApp cancellation notification
        this.eventEmitter.emit('appointment.cancelled', { schemaName, appointment, reason });

        return appointment;
    }

    // ── Recurring Appointments ─────────────────────────────────

    async createRecurring(schemaName: string, data: {
        contactId?: string;
        conversationId?: string;
        opportunityId?: string;
        assignedTo?: string;
        serviceId?: string;
        serviceName: string;
        startAt: string;
        endAt: string;
        location?: string;
        notes?: string;
        metadata?: Record<string, any>;
        recurrence: {
            frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
            count: number; // how many total instances (including first)
            endDate?: string; // alternative: stop at date
        };
    }): Promise<{ groupId: string; appointments: Appointment[] }> {
        const requestedContactId = assertOptionalContactId(data.contactId);
        if (!requestedContactId) {
            throw new BadRequestException({
                error: 'appointment_contact_required',
                message: 'contactId is required',
            });
        }
        const groupId = randomUUID();
        const rule = data.recurrence;
        const created: Appointment[] = [];

        const baseStart = new Date(data.startAt);
        const baseEnd = new Date(data.endAt);
        const durationMs = baseEnd.getTime() - baseStart.getTime();

        const maxInstances = Math.min(rule.count || 52, 52); // cap at 52 weeks

        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const assignedToUuid = data.assignedTo
            ? await assertActiveTenantUser(this.prisma, schemaName, data.assignedTo)
            : null;

        // Auto-resolve serviceId from serviceName if not directly provided
        let serviceIdUuid = data.serviceId && uuidRe.test(data.serviceId) ? data.serviceId : null;
        if (!serviceIdUuid && data.serviceName) {
            try {
                const svcRows = await this.prisma.executeInTenantSchema(schemaName,
                    `SELECT id FROM services WHERE LOWER(name) = $1 AND is_active = true LIMIT 1`,
                    [data.serviceName.toLowerCase()],
                );
                if ((svcRows as any[])?.length > 0) {
                    serviceIdUuid = (svcRows as any[])[0].id;
                }
            } catch (e: any) {
                this.logger.warn(`Failed to resolve serviceId from name "${data.serviceName}": ${e.message}`);
            }
        }

        for (let i = 0; i < maxInstances; i++) {
            const instanceStart = new Date(baseStart);
            const instanceEnd = new Date(baseStart);

            switch (rule.frequency) {
                case 'daily': instanceStart.setDate(baseStart.getDate() + i); break;
                case 'weekly': instanceStart.setDate(baseStart.getDate() + i * 7); break;
                case 'biweekly': instanceStart.setDate(baseStart.getDate() + i * 14); break;
                case 'monthly': instanceStart.setMonth(baseStart.getMonth() + i); break;
            }
            instanceEnd.setTime(instanceStart.getTime() + durationMs);

            // Stop if past endDate
            if (rule.endDate && instanceStart.toISOString().split('T')[0] > rule.endDate) break;

            const id = randomUUID();
            const startIso = instanceStart.toISOString();
            const endIso = instanceEnd.toISOString();

            try {
                await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
                    const contactIdUuid = await requireTenantContact(query, requestedContactId);
                    const opportunityId = await resolveNativeEvidenceOpportunity(query, {
                        contactId: contactIdUuid,
                        conversationId: data.conversationId,
                        trustedOpportunityId: data.opportunityId,
                    });
                    await query(
                        `INSERT INTO appointments (id, contact_id, opportunity_id, conversation_id, assigned_to, service_id, service_name, start_at, end_at,
                            location, notes, metadata, recurring_group_id, recurrence_rule, created_at, updated_at)
                         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7, $8::timestamp, $9::timestamp,
                            $10, $11, $12::jsonb, $13::uuid, $14::jsonb, NOW(), NOW())`,
                        [
                            id, contactIdUuid, opportunityId, data.conversationId || null,
                            assignedToUuid, serviceIdUuid,
                            data.serviceName, startIso, endIso,
                            data.location || null, data.notes || null,
                            JSON.stringify(data.metadata || {}),
                            groupId,
                            i === 0 ? JSON.stringify(rule) : null,
                        ],
                    );
                    await this.calendarOutbox.enqueueWithQuery(query, id, 'upsert');
                });
                created.push(await this.getById(schemaName, id));
            } catch (err) {
                // Contact integrity is a request error, never a skippable slot
                // conflict. Propagate it so a foreign/deleted contact cannot
                // turn into a superficially successful empty series.
                if (err instanceof BadRequestException) throw err;
                this.logger.warn(`Skipped recurring instance ${i} due to conflict: ${err.message}`);
            }
        }

        this.logger.log(`Created recurring series ${groupId} with ${created.length} instances`);

        // Emit event only for first instance
        if (created.length > 0) {
            this.eventEmitter.emit('appointment.created', { schemaName, appointment: created[0] });
        }

        return { groupId, appointments: created };
    }

    async cancelSeries(schemaName: string, groupId: string, reason?: string): Promise<number> {
        const result = await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const rows = await query<any[]>(
                `UPDATE appointments SET status = 'cancelled', cancellation_reason = $2, updated_at = NOW()
                 WHERE recurring_group_id = $1::uuid AND status IN ('pending', 'confirmed')
                 RETURNING id`,
                [groupId, reason || null],
            );
            for (const row of rows || []) {
                await this.calendarOutbox.enqueueWithQuery(query, row.id, 'delete');
            }
            return rows;
        });
        const count = (result as any[])?.length || 0;
        this.logger.log(`Cancelled ${count} appointments in recurring series ${groupId}`);
        return count;
    }

    async getSeriesInstances(schemaName: string, groupId: string): Promise<Appointment[]> {
        const rows = await this.prisma.executeInTenantSchema(schemaName,
            `SELECT a.*, c.name as contact_name, u.id as assigned_user_id,
                    u.first_name || ' ' || u.last_name as assigned_name
             FROM appointments a
             LEFT JOIN contacts c ON c.id = a.contact_id
             LEFT JOIN public.tenants tenant_owner
               ON tenant_owner.schema_name = $1
              AND tenant_owner.is_active = true
             LEFT JOIN public.users u
               ON u.id = a.assigned_to::uuid
              AND u.tenant_id = tenant_owner.id
              AND u.is_active = true
             WHERE a.recurring_group_id = $2::uuid
             ORDER BY a.start_at ASC`,
            [schemaName, groupId],
        );
        return (rows as any[]).map((r) => this.mapRow(r));
    }

    // ── Availability ──────────────────────────────────────────

    async getAvailability(schemaName: string, userId?: string): Promise<AvailabilitySlot[]> {
        if (userId) await assertActiveTenantUser(this.prisma, schemaName, userId);
        let sql = `SELECT a.id, a.user_id, a.day_of_week, a.start_time::text,
                          a.end_time::text, a.is_active
                   FROM availability_slots a
                   JOIN public.tenants tenant_owner
                     ON tenant_owner.schema_name = $1
                    AND tenant_owner.is_active = true
                   JOIN public.users u
                     ON u.id = a.user_id
                    AND u.tenant_id = tenant_owner.id
                    AND u.is_active = true`;
        const params: any[] = [schemaName];

        if (userId) {
            sql += ` WHERE a.user_id = $2::uuid`;
            params.push(userId);
        }

        sql += ` ORDER BY a.user_id, a.day_of_week, a.start_time`;

        const rows = await this.prisma.executeInTenantSchema(schemaName, sql, params);
        return (rows as any[]).map(row => ({
            id: row.id,
            userId: row.user_id,
            dayOfWeek: row.day_of_week,
            startTime: row.start_time,
            endTime: row.end_time,
            isActive: row.is_active,
        }));
    }

    async saveAvailability(schemaName: string, userId: string, slots: {
        dayOfWeek: number; startTime: string; endTime: string; isActive?: boolean;
    }[]): Promise<AvailabilitySlot[]> {
        await assertActiveTenantUser(this.prisma, schemaName, userId);
        await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            await query(`DELETE FROM availability_slots WHERE user_id = $1::uuid`, [userId]);
            for (const slot of slots) {
                await query(
                    `INSERT INTO availability_slots
                        (id, user_id, day_of_week, start_time, end_time, is_active, created_at)
                     VALUES ($1::uuid, $2::uuid, $3, $4::time, $5::time, $6, NOW())`,
                    [
                        randomUUID(), userId, slot.dayOfWeek, slot.startTime,
                        slot.endTime, slot.isActive !== false,
                    ],
                );
            }
        });

        return this.getAvailability(schemaName, userId);
    }

    // ── Blocked Dates ─────────────────────────────────────────

    async getBlockedDates(schemaName: string, userId?: string): Promise<BlockedDate[]> {
        if (userId) await assertActiveTenantUser(this.prisma, schemaName, userId);
        let sql = `SELECT b.id, b.user_id, b.blocked_date::text, b.reason
                   FROM blocked_dates b
                   LEFT JOIN public.tenants tenant_owner
                     ON tenant_owner.schema_name = $1
                    AND tenant_owner.is_active = true
                   LEFT JOIN public.users u
                     ON u.id = b.user_id
                    AND u.tenant_id = tenant_owner.id
                    AND u.is_active = true
                   WHERE (b.user_id IS NULL OR u.id IS NOT NULL)`;
        const params: any[] = [schemaName];

        if (userId) {
            sql += ` AND b.user_id = $2::uuid`;
            params.push(userId);
        }

        sql += ` ORDER BY b.blocked_date ASC`;

        const rows = await this.prisma.executeInTenantSchema(schemaName, sql, params);
        return (rows as any[]).map(row => ({
            id: row.id,
            userId: row.user_id,
            blockedDate: row.blocked_date,
            reason: row.reason,
        }));
    }

    async createBlockedDate(schemaName: string, data: {
        userId?: string; blockedDate: string; reason?: string;
    }): Promise<BlockedDate> {
        if (data.userId) await assertActiveTenantUser(this.prisma, schemaName, data.userId);
        const id = randomUUID();
        await this.prisma.executeInTenantSchema(schemaName,
            `INSERT INTO blocked_dates (id, user_id, blocked_date, reason, created_at)
             VALUES ($1::uuid, $2::uuid, $3::date, $4, NOW())`,
            [id, data.userId || null, data.blockedDate, data.reason || null],
        );
        return { id, userId: data.userId || null, blockedDate: data.blockedDate, reason: data.reason || null };
    }

    async deleteBlockedDate(schemaName: string, dateId: string): Promise<void> {
        await this.prisma.executeInTenantSchema(schemaName,
            `DELETE FROM blocked_dates WHERE id = $1::uuid`,
            [dateId],
        );
    }

    // ── Check availability for AI tool ────────────────────────

    async checkAvailableSlots(schemaName: string, date: string, userId?: string): Promise<{
        date: string;
        availableSlots: { startTime: string; endTime: string; agentName: string; userId: string }[];
    }> {
        if (userId) await assertActiveTenantUser(this.prisma, schemaName, userId);
        const dayOfWeek = dayOfWeekForLocalDate(date);

        // Get availability for that day
        let sql = `
            SELECT a.user_id, a.start_time::text, a.end_time::text, u.first_name || ' ' || u.last_name as agent_name
            FROM availability_slots a
            JOIN public.tenants tenant_owner
              ON tenant_owner.schema_name = $2
             AND tenant_owner.is_active = true
            JOIN public.users u
              ON u.id = a.user_id
             AND u.tenant_id = tenant_owner.id
             AND u.is_active = true
            WHERE a.day_of_week = $1 AND a.is_active = true
        `;
        const params: any[] = [dayOfWeek, schemaName];
        let idx = 3;

        if (userId) {
            sql += ` AND a.user_id = $${idx++}::uuid`;
            params.push(userId);
        }

        const slots = await this.prisma.executeInTenantSchema(schemaName, sql, params) as any[];

        // Filter out blocked dates
        const blocked = await this.prisma.executeInTenantSchema(schemaName,
            `SELECT user_id FROM blocked_dates WHERE blocked_date = $1::date`,
            [date],
        ) as any[];
        const blockedUserIds = new Set(blocked.map(b => b.user_id));

        // Filter out existing appointments on that date
        const existing = await this.prisma.executeInTenantSchema(schemaName,
            `SELECT assigned_to, start_at, end_at FROM appointments
             WHERE start_at::date = $1::date AND status NOT IN ('cancelled', ${OCCUPANCY_EXCLUDED_SQL})`,
            [date],
        ) as any[];

        const available = slots
            .filter(s => {
                if (blockedUserIds.has(null) || blockedUserIds.has(s.user_id)) return false;
                const slotStart = wallClockEpoch(`${date.split('T')[0]}T${s.start_time}`);
                const slotEnd = wallClockEpoch(`${date.split('T')[0]}T${s.end_time}`);
                // This legacy endpoint has no service duration/capacity input,
                // so it cannot safely split a window into concrete slots. Fail
                // closed by withholding any window that overlaps an appointment
                // for that staff (or an unassigned business-wide reservation).
                return !(existing || []).some((appointment: any) => {
                    if (appointment.assigned_to && appointment.assigned_to !== s.user_id) return false;
                    const appointmentStart = wallClockEpoch(appointment.start_at);
                    const appointmentEnd = wallClockEpoch(appointment.end_at);
                    return slotStart < appointmentEnd && slotEnd > appointmentStart;
                });
            })
            .map(s => ({
                startTime: s.start_time,
                endTime: s.end_time,
                agentName: s.agent_name || 'Agent',
                userId: s.user_id,
            }));

        return { date, availableSlots: available };
    }

    // ── Private ───────────────────────────────────────────────

    private async checkConflict(schemaName: string, userId: string, startAt: string, endAt: string, excludeId?: string): Promise<boolean> {
        let sql = `
            SELECT COUNT(*) as cnt FROM appointments
            WHERE assigned_to = $1::uuid
              AND status NOT IN ('cancelled', ${OCCUPANCY_EXCLUDED_SQL})
              AND start_at < $3::timestamp
              AND end_at > $2::timestamp
        `;
        const params: any[] = [userId, startAt, endAt];

        if (excludeId) {
            sql += ` AND id != $4::uuid`;
            params.push(excludeId);
        }

        const rows = await this.prisma.executeInTenantSchema(schemaName, sql, params) as any[];
        return Number(rows[0]?.cnt) > 0;
    }

    private toNaiveIso(val: any): string {
        if (!val) return val;
        if (val instanceof Date) {
            const y = val.getUTCFullYear();
            const mo = String(val.getUTCMonth() + 1).padStart(2, '0');
            const d = String(val.getUTCDate()).padStart(2, '0');
            const h = String(val.getUTCHours()).padStart(2, '0');
            const mi = String(val.getUTCMinutes()).padStart(2, '0');
            const s = String(val.getUTCSeconds()).padStart(2, '0');
            return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
        }
        return String(val).replace(/\.000Z$/, '').replace(/Z$/, '');
    }

    /**
     * Parse an incoming date-time into a canonical naive wall-clock string
     * ("YYYY-MM-DDTHH:mm:ss"). Returns null when the value is missing or
     * malformed — e.g. open-duration services book with an empty end time,
     * producing "2026-06-10T:00", which would otherwise crash the ::timestamp
     * cast with a 500. Stored values stay tenant-local (no timezone shift),
     * consistent with toNaiveIso() on read.
     */
    private normalizeNaive(v?: string | null): string | null {
        if (!v) return null;
        const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
        if (!m) return null;
        const [, y, mo, d, h, mi, s] = m;
        return `${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}`;
    }

    /** Add minutes to a naive wall-clock string, rolling hours/days over without timezone drift. */
    private addMinutesNaive(naive: string, minutes: number): string {
        const m = naive.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
        if (!m) return naive;
        const [, y, mo, d, h, mi, s] = m;
        const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
        dt.setUTCMinutes(dt.getUTCMinutes() + minutes);
        return this.toNaiveIso(dt);
    }

    private diffMinutesNaive(startAt: string, endAt: string): number {
        const parse = (value: string) => Date.parse(`${value}Z`);
        return Math.round((parse(endAt) - parse(startAt)) / 60_000);
    }

    private async resolveTimezoneForSchema(schemaName: string, requested?: unknown): Promise<string> {
        if (typeof requested === 'string' && requested.trim()) return requested.trim();
        try {
            const tenant = await this.prisma.tenant.findFirst({
                where: { schemaName },
                select: { settings: true },
            });
            const settings = (tenant?.settings as any) || {};
            return settings.timezone || settings.businessHours?.timezone || 'America/Bogota';
        } catch {
            // A missing global-tenant fixture must not silently weaken the temporal
            // contract. The service still validates this deterministic fallback.
            return 'America/Bogota';
        }
    }

    private mapRow(row: any): Appointment {
        return {
            id: row.id,
            contactId: row.contact_id,
            contactName: row.contact_name,
            conversationId: row.conversation_id,
            assignedTo: row.assigned_user_id || null,
            assignedName: row.assigned_name,
            // serviceId: sin él, el cliente móvil no puede pedir slots para
            // reagendar y depende de un match frágil por nombre de servicio.
            serviceId: row.service_id || null,
            serviceName: row.service_name,
            startAt: this.toNaiveIso(row.start_at),
            endAt: this.toNaiveIso(row.end_at),
            status: row.status,
            location: row.location,
            notes: row.notes,
            reminderSent: row.reminder_sent,
            metadata: row.metadata || {},
            createdAt: row.created_at,
            recurringGroupId: row.recurring_group_id || null,
            recurrenceRule: row.recurrence_rule || null,
            calendarIntegrationId: row.calendar_integration_id || null,
            calendarOwnerId: row.calendar_owner_id || null,
            calendarProvider: row.calendar_provider || null,
            calendarEventId: row.calendar_event_id || null,
            calendarSyncState: row.calendar_sync_state || null,
            calendarSyncError: row.calendar_sync_error || null,
            calendarSyncedAt: row.calendar_synced_at
                ? new Date(row.calendar_synced_at).toISOString()
                : null,
        };
    }

    /**
     * Generate specific time slots for a date, service duration, and agent.
     * Merges: availability - blocked - existing appointments - calendar busy times.
     * Returns concrete bookable slots like ["09:00","09:30","10:00",...].
     */
    async getBookableSlots(
        schemaName: string,
        date: string,
        serviceId: string,
        durationMinutes: number,
        bufferMinutes: number = 0,
        userId?: string,
        calendarBusySlots: { start: string; end: string }[] = [],
        maxConcurrent: number = 1,
    ): Promise<{ time: string; endTime: string; agentId: string; agentName: string }[]> {
        if (userId) await assertActiveTenantUser(this.prisma, schemaName, userId);
        const dayOfWeek = dayOfWeekForLocalDate(date);
        const dateStr = date.split('T')[0]; // YYYY-MM-DD

        // 1. Get availability windows for this day
        let sql = `
            SELECT a.user_id, a.start_time::text, a.end_time::text, u.first_name || ' ' || u.last_name as agent_name
            FROM availability_slots a
            JOIN public.tenants tenant_owner
              ON tenant_owner.schema_name = $2
             AND tenant_owner.is_active = true
            JOIN public.users u
              ON u.id = a.user_id
             AND u.tenant_id = tenant_owner.id
             AND u.is_active = true
            WHERE a.day_of_week = $1 AND a.is_active = true
        `;
        const params: any[] = [dayOfWeek, schemaName];
        if (userId) { sql += ` AND a.user_id = $3::uuid`; params.push(userId); }

        const windows = await this.prisma.executeInTenantSchema(schemaName, sql, params) as any[];

        // 2. Get blocked dates
        const blocked = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT user_id FROM blocked_dates WHERE blocked_date = $1::date`, [dateStr],
        );
        const blockedSet = new Set((blocked || []).map(b => b.user_id));

        // 3. Get existing appointments
        const existing = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT assigned_to, service_id, start_at, end_at FROM appointments
             WHERE start_at::date = $1::date AND status NOT IN ('cancelled', ${OCCUPANCY_EXCLUDED_SQL})`, [dateStr],
        );

        // 4. Generate slots
        const totalMinutes = durationMinutes + bufferMinutes;
        const results: { time: string; endTime: string; agentId: string; agentName: string }[] = [];

        for (const win of windows) {
            if (blockedSet.has(win.user_id)) continue;

            const [startH, startM] = win.start_time.split(':').map(Number);
            const [endH, endM] = win.end_time.split(':').map(Number);
            const windowStart = startH * 60 + startM;
            const windowEnd = endH * 60 + endM;

            // Generate slots every 30 min (or duration if shorter).
            // Piso de 5: un servicio de duración ABIERTA llega con
            // durationMinutes=0 → step 0 congelaba el for de abajo para siempre
            // (event loop bloqueado, resultados sin cota, contenedor a OOM).
            const step = Math.max(5, Math.min(30, durationMinutes || 30));
            for (let m = windowStart; m + totalMinutes <= windowEnd; m += step) {
                const slotStart = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
                const slotEndM = m + durationMinutes;
                const slotEnd = `${String(Math.floor(slotEndM / 60)).padStart(2, '0')}:${String(slotEndM % 60).padStart(2, '0')}`;

                const slotStartISO = `${dateStr}T${slotStart}:00`;
                const slotEndISO = `${dateStr}T${slotEnd}:00`;

                // Check concurrent bookings at this time slot
                const concurrentCount = (existing || []).filter(e => {
                    if (e.service_id !== serviceId) return false;
                    const eStart = wallClockEpoch(e.start_at);
                    const eEnd = wallClockEpoch(e.end_at);
                    const sStart = wallClockEpoch(slotStartISO);
                    const sEnd = wallClockEpoch(slotEndISO);
                    return sStart < eEnd && sEnd > eStart;
                }).length;

                // Check per-agent conflict
                const agentConflict = (existing || []).some(e => {
                    if (e.assigned_to !== win.user_id) return false;
                    const eStart = wallClockEpoch(e.start_at);
                    const eEnd = wallClockEpoch(e.end_at);
                    const sStart = wallClockEpoch(slotStartISO);
                    const sEnd = wallClockEpoch(slotEndISO);
                    return sStart < eEnd && sEnd > eStart;
                });
                if (agentConflict) continue;
                if (concurrentCount >= maxConcurrent) continue;

                // Check conflict with calendar busy times
                const calBusy = calendarBusySlots.some(b => {
                    const bStart = wallClockEpoch(b.start);
                    const bEnd = wallClockEpoch(b.end);
                    const sStart = wallClockEpoch(slotStartISO);
                    const sEnd = wallClockEpoch(slotEndISO);
                    return sStart < bEnd && sEnd > bStart;
                });
                if (calBusy) continue;

                results.push({
                    time: slotStart,
                    endTime: slotEnd,
                    agentId: win.user_id,
                    agentName: win.agent_name || 'Agente',
                });
            }
        }

        return results;
    }

    // ── Public booking config (stored in tenant.settings.publicBooking) ─

    async getPublicBookingConfig(tenantId: string): Promise<{
        enabled: boolean;
        welcomeText: string | null;
        brandColor: string | null;
        bookingUrl: string;
        slug: string;
    }> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { slug: true, settings: true },
        });
        if (!tenant) throw new BadRequestException('Tenant not found');
        const settings = (tenant.settings as any) ?? {};
        const pb = settings.publicBooking ?? {};
        const baseUrl = process.env.DASHBOARD_URL || 'https://admin.parallly-chat.cloud';
        return {
            enabled: pb.enabled === true,
            welcomeText: pb.welcomeText ?? null,
            brandColor: settings.brandColor ?? null,
            bookingUrl: `${baseUrl}/book/${tenant.slug}`,
            slug: tenant.slug,
        };
    }

    async updatePublicBookingConfig(
        tenantId: string,
        input: { enabled?: boolean; welcomeText?: string; brandColor?: string },
    ) {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        if (!tenant) throw new BadRequestException('Tenant not found');
        const settings = (tenant.settings as any) ?? {};
        const pb = { ...(settings.publicBooking ?? {}) };
        if (input.enabled !== undefined) pb.enabled = input.enabled;
        if (input.welcomeText !== undefined) pb.welcomeText = input.welcomeText;
        const next: any = { ...settings, publicBooking: pb };
        if (input.brandColor !== undefined) next.brandColor = input.brandColor;
        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { settings: next },
        });
        return this.getPublicBookingConfig(tenantId);
    }
}
