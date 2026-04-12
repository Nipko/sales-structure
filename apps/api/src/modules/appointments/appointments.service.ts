import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
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

    constructor(private prisma: PrismaService) {}

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
        return this.getById(schemaName, id);
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
            `UPDATE appointments SET status = 'cancelled', notes = COALESCE(notes, '') || $2, updated_at = NOW()
             WHERE id = $1::uuid`,
            [appointmentId, reason ? `\n[Cancelado: ${reason}]` : ''],
        );
        return this.getById(schemaName, appointmentId);
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
        };
    }
}
