import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'crypto';

export interface Appointment {
    id: string;
    contactId: string | null;
    contactName?: string;
    conversationId: string | null;
    assignedTo: string | null;
    assignedName?: string;
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

    constructor(
        private prisma: PrismaService,
        private eventEmitter: EventEmitter2,
    ) {}

    // ── Appointments CRUD ─────────────────────────────────────

    async list(schemaName: string, filters?: {
        status?: string; assignedTo?: string;
        startDate?: string; endDate?: string;
    }): Promise<Appointment[]> {
        let sql = `
            SELECT a.*, c.name as contact_name, u.first_name || ' ' || u.last_name as assigned_name
            FROM appointments a
            LEFT JOIN contacts c ON c.id = a.contact_id
            LEFT JOIN public.users u ON u.id = a.assigned_to::uuid
            WHERE 1=1
        `;
        const params: any[] = [];
        let idx = 1;

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
        return (rows as any[]).map(this.mapRow);
    }

    async getById(schemaName: string, appointmentId: string): Promise<Appointment> {
        const rows = await this.prisma.executeInTenantSchema(schemaName,
            `SELECT a.*, c.name as contact_name, u.first_name || ' ' || u.last_name as assigned_name
             FROM appointments a
             LEFT JOIN contacts c ON c.id = a.contact_id
             LEFT JOIN public.users u ON u.id = a.assigned_to::uuid
             WHERE a.id = $1::uuid`,
            [appointmentId],
        );
        const row = (rows as any[])[0];
        if (!row) throw new NotFoundException('Appointment not found');
        return this.mapRow(row);
    }

    async create(schemaName: string, data: {
        contactId?: string;
        conversationId?: string;
        assignedTo?: string;
        serviceName: string;
        startAt: string;
        endAt: string;
        location?: string;
        notes?: string;
        metadata?: Record<string, any>;
    }): Promise<Appointment> {
        // Validate no overlap for assigned agent
        if (data.assignedTo) {
            const conflict = await this.checkConflict(schemaName, data.assignedTo, data.startAt, data.endAt);
            if (conflict) {
                throw new BadRequestException('El agente ya tiene una cita en ese horario');
            }
        }

        const id = randomUUID();
        await this.prisma.executeInTenantSchema(schemaName,
            `INSERT INTO appointments (id, contact_id, conversation_id, assigned_to, service_name, start_at, end_at, location, notes, metadata, created_at, updated_at)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::timestamp, $7::timestamp, $8, $9, $10::jsonb, NOW(), NOW())`,
            [id, data.contactId || null, data.conversationId || null, data.assignedTo || null,
             data.serviceName, data.startAt, data.endAt, data.location || null, data.notes || null,
             JSON.stringify(data.metadata || {})],
        );

        this.logger.log(`Appointment created: ${id} — ${data.serviceName} at ${data.startAt}`);
        const appointment = await this.getById(schemaName, id);

        // Emit event for WhatsApp confirmation
        this.eventEmitter.emit('appointment.created', { schemaName, appointment });

        return appointment;
    }

    async update(schemaName: string, appointmentId: string, data: {
        assignedTo?: string; serviceName?: string;
        startAt?: string; endAt?: string; status?: string;
        location?: string; notes?: string;
    }): Promise<Appointment> {
        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (data.assignedTo !== undefined) { sets.push(`assigned_to = $${idx++}::uuid`); params.push(data.assignedTo); }
        if (data.serviceName !== undefined) { sets.push(`service_name = $${idx++}`); params.push(data.serviceName); }
        if (data.startAt !== undefined) { sets.push(`start_at = $${idx++}::timestamp`); params.push(data.startAt); }
        if (data.endAt !== undefined) { sets.push(`end_at = $${idx++}::timestamp`); params.push(data.endAt); }
        if (data.status !== undefined) { sets.push(`status = $${idx++}`); params.push(data.status); }
        if (data.location !== undefined) { sets.push(`location = $${idx++}`); params.push(data.location); }
        if (data.notes !== undefined) { sets.push(`notes = $${idx++}`); params.push(data.notes); }
        sets.push(`updated_at = NOW()`);

        if (sets.length === 1) return this.getById(schemaName, appointmentId);

        params.push(appointmentId);
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE appointments SET ${sets.join(', ')} WHERE id = $${idx}::uuid`,
            params,
        );
        return this.getById(schemaName, appointmentId);
    }

    async cancel(schemaName: string, appointmentId: string, reason?: string): Promise<Appointment> {
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE appointments SET status = 'cancelled',
                    cancellation_reason = $2, updated_at = NOW()
             WHERE id = $1::uuid`,
            [appointmentId, reason || null],
        );
        const appointment = await this.getById(schemaName, appointmentId);

        // Emit event for WhatsApp cancellation notification
        this.eventEmitter.emit('appointment.cancelled', { schemaName, appointment, reason });

        return appointment;
    }

    // ── Recurring Appointments ─────────────────────────────────

    async createRecurring(schemaName: string, data: {
        contactId?: string;
        assignedTo?: string;
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
        const groupId = randomUUID();
        const rule = data.recurrence;
        const created: Appointment[] = [];

        const baseStart = new Date(data.startAt);
        const baseEnd = new Date(data.endAt);
        const durationMs = baseEnd.getTime() - baseStart.getTime();

        const maxInstances = Math.min(rule.count || 52, 52); // cap at 52 weeks

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
                await this.prisma.executeInTenantSchema(schemaName,
                    `INSERT INTO appointments (id, contact_id, assigned_to, service_name, start_at, end_at,
                        location, notes, metadata, recurring_group_id, recurrence_rule, created_at, updated_at)
                     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::timestamp, $6::timestamp,
                        $7, $8, $9::jsonb, $10::uuid, $11::jsonb, NOW(), NOW())`,
                    [
                        id, data.contactId || null, data.assignedTo || null,
                        data.serviceName, startIso, endIso,
                        data.location || null, data.notes || null,
                        JSON.stringify(data.metadata || {}),
                        groupId,
                        i === 0 ? JSON.stringify(rule) : null, // only store rule on first instance
                    ],
                );
                created.push(await this.getById(schemaName, id));
            } catch (err) {
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
        const result = await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE appointments SET status = 'cancelled', cancellation_reason = $2, updated_at = NOW()
             WHERE recurring_group_id = $1::uuid AND status IN ('pending', 'confirmed')
             RETURNING id`,
            [groupId, reason || null],
        );
        const count = (result as any[])?.length || 0;
        this.logger.log(`Cancelled ${count} appointments in recurring series ${groupId}`);
        return count;
    }

    async getSeriesInstances(schemaName: string, groupId: string): Promise<Appointment[]> {
        const rows = await this.prisma.executeInTenantSchema(schemaName,
            `SELECT a.*, c.name as contact_name, u.first_name || ' ' || u.last_name as assigned_name
             FROM appointments a
             LEFT JOIN contacts c ON c.id = a.contact_id
             LEFT JOIN public.users u ON u.id = a.assigned_to::uuid
             WHERE a.recurring_group_id = $1::uuid
             ORDER BY a.start_at ASC`,
            [groupId],
        );
        return (rows as any[]).map(this.mapRow);
    }

    // ── Availability ──────────────────────────────────────────

    async getAvailability(schemaName: string, userId?: string): Promise<AvailabilitySlot[]> {
        let sql = `SELECT id, user_id, day_of_week, start_time::text, end_time::text, is_active FROM availability_slots`;
        const params: any[] = [];

        if (userId) {
            sql += ` WHERE user_id = $1::uuid`;
            params.push(userId);
        }

        sql += ` ORDER BY user_id, day_of_week, start_time`;

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
        // Delete existing slots for user
        await this.prisma.executeInTenantSchema(schemaName,
            `DELETE FROM availability_slots WHERE user_id = $1::uuid`,
            [userId],
        );

        // Insert new slots
        for (const slot of slots) {
            const id = randomUUID();
            await this.prisma.executeInTenantSchema(schemaName,
                `INSERT INTO availability_slots (id, user_id, day_of_week, start_time, end_time, is_active, created_at)
                 VALUES ($1::uuid, $2::uuid, $3, $4::time, $5::time, $6, NOW())`,
                [id, userId, slot.dayOfWeek, slot.startTime, slot.endTime, slot.isActive !== false],
            );
        }

        return this.getAvailability(schemaName, userId);
    }

    // ── Blocked Dates ─────────────────────────────────────────

    async getBlockedDates(schemaName: string, userId?: string): Promise<BlockedDate[]> {
        let sql = `SELECT id, user_id, blocked_date::text, reason FROM blocked_dates`;
        const params: any[] = [];

        if (userId) {
            sql += ` WHERE user_id = $1::uuid`;
            params.push(userId);
        }

        sql += ` ORDER BY blocked_date ASC`;

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
        const dayOfWeek = new Date(date).getDay();

        // Get availability for that day
        let sql = `
            SELECT a.user_id, a.start_time::text, a.end_time::text, u.first_name || ' ' || u.last_name as agent_name
            FROM availability_slots a
            LEFT JOIN public.users u ON u.id = a.user_id
            WHERE a.day_of_week = $1 AND a.is_active = true
        `;
        const params: any[] = [dayOfWeek];
        let idx = 2;

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
             WHERE start_at::date = $1::date AND status NOT IN ('cancelled')`,
            [date],
        ) as any[];

        const available = slots
            .filter(s => !blockedUserIds.has(s.user_id))
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
              AND status NOT IN ('cancelled')
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

    private mapRow(row: any): Appointment {
        return {
            id: row.id,
            contactId: row.contact_id,
            contactName: row.contact_name,
            conversationId: row.conversation_id,
            assignedTo: row.assigned_to,
            assignedName: row.assigned_name,
            serviceName: row.service_name,
            startAt: row.start_at,
            endAt: row.end_at,
            status: row.status,
            location: row.location,
            notes: row.notes,
            reminderSent: row.reminder_sent,
            metadata: row.metadata || {},
            createdAt: row.created_at,
            recurringGroupId: row.recurring_group_id || null,
            recurrenceRule: row.recurrence_rule || null,
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
        durationMinutes: number,
        bufferMinutes: number = 0,
        userId?: string,
        calendarBusySlots: { start: string; end: string }[] = [],
    ): Promise<{ time: string; endTime: string; agentId: string; agentName: string }[]> {
        const dayOfWeek = new Date(date).getDay();
        const dateStr = date.split('T')[0]; // YYYY-MM-DD

        // 1. Get availability windows for this day
        let sql = `
            SELECT a.user_id, a.start_time::text, a.end_time::text, u.first_name || ' ' || u.last_name as agent_name
            FROM availability_slots a
            LEFT JOIN public.users u ON u.id = a.user_id
            WHERE a.day_of_week = $1 AND a.is_active = true
        `;
        const params: any[] = [dayOfWeek];
        if (userId) { sql += ` AND a.user_id = $2::uuid`; params.push(userId); }

        const windows = await this.prisma.executeInTenantSchema(schemaName, sql, params) as any[];

        // 2. Get blocked dates
        const blocked = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT user_id FROM blocked_dates WHERE blocked_date = $1::date`, [dateStr],
        );
        const blockedSet = new Set((blocked || []).map(b => b.user_id));

        // 3. Get existing appointments
        const existing = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT assigned_to, start_at, end_at FROM appointments
             WHERE start_at::date = $1::date AND status NOT IN ('cancelled')`, [dateStr],
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

            // Generate slots every 30 min (or duration if shorter)
            const step = Math.min(30, durationMinutes);
            for (let m = windowStart; m + totalMinutes <= windowEnd; m += step) {
                const slotStart = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
                const slotEndM = m + durationMinutes;
                const slotEnd = `${String(Math.floor(slotEndM / 60)).padStart(2, '0')}:${String(slotEndM % 60).padStart(2, '0')}`;

                const slotStartISO = `${dateStr}T${slotStart}:00`;
                const slotEndISO = `${dateStr}T${slotEnd}:00`;

                // Check conflict with existing appointments
                const hasConflict = (existing || []).some(e => {
                    if (e.assigned_to !== win.user_id) return false;
                    const eStart = new Date(e.start_at).getTime();
                    const eEnd = new Date(e.end_at).getTime();
                    const sStart = new Date(slotStartISO).getTime();
                    const sEnd = new Date(slotEndISO).getTime();
                    return sStart < eEnd && sEnd > eStart;
                });
                if (hasConflict) continue;

                // Check conflict with calendar busy times
                const calBusy = calendarBusySlots.some(b => {
                    const bStart = new Date(b.start).getTime();
                    const bEnd = new Date(b.end).getTime();
                    const sStart = new Date(slotStartISO).getTime();
                    const sEnd = new Date(slotEndISO).getTime();
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
}
