import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class StaffSchedulingService {
    private readonly logger = new Logger(StaffSchedulingService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {}

    async ensureTables(schemaName: string): Promise<void> {
        const exists = await this.prisma.$queryRawUnsafe<any[]>(
            `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'staff_members'`,
            schemaName,
        );
        if (exists.length > 0) return;

        await this.prisma.$queryRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "${schemaName}".staff_members (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name TEXT NOT NULL,
                email TEXT,
                phone TEXT,
                role TEXT DEFAULT 'stylist',
                avatar_url TEXT,
                specialties TEXT[] DEFAULT '{}',
                is_active BOOLEAN DEFAULT true,
                sort_order INT DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now()
            )
        `);

        await this.prisma.$queryRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "${schemaName}".staff_schedules (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                staff_id UUID NOT NULL REFERENCES "${schemaName}".staff_members(id) ON DELETE CASCADE,
                day_of_week INT NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
                start_time TIME NOT NULL,
                end_time TIME NOT NULL,
                is_active BOOLEAN DEFAULT true,
                UNIQUE(staff_id, day_of_week)
            )
        `);

        await this.prisma.$queryRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "${schemaName}".staff_service_links (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                staff_id UUID NOT NULL REFERENCES "${schemaName}".staff_members(id) ON DELETE CASCADE,
                service_id UUID NOT NULL,
                duration_override_min INT,
                price_override INT,
                UNIQUE(staff_id, service_id)
            )
        `);

        await this.prisma.$queryRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "${schemaName}".staff_breaks (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                staff_id UUID NOT NULL REFERENCES "${schemaName}".staff_members(id) ON DELETE CASCADE,
                date DATE NOT NULL,
                start_time TIME NOT NULL,
                end_time TIME NOT NULL,
                reason TEXT
            )
        `);

        this.logger.log(`Staff scheduling tables created for schema ${schemaName}`);
    }

    async listStaff(schemaName: string): Promise<any[]> {
        await this.ensureTables(schemaName);
        return this.prisma.$queryRawUnsafe(`
            SELECT s.*,
                COALESCE(json_agg(json_build_object(
                    'dayOfWeek', sc.day_of_week,
                    'startTime', sc.start_time::text,
                    'endTime', sc.end_time::text,
                    'isActive', sc.is_active
                )) FILTER (WHERE sc.id IS NOT NULL), '[]') as schedules,
                COALESCE(json_agg(DISTINCT sl.service_id) FILTER (WHERE sl.service_id IS NOT NULL), '[]') as service_ids
            FROM "${schemaName}".staff_members s
            LEFT JOIN "${schemaName}".staff_schedules sc ON sc.staff_id = s.id
            LEFT JOIN "${schemaName}".staff_service_links sl ON sl.staff_id = s.id
            WHERE s.is_active = true
            GROUP BY s.id
            ORDER BY s.sort_order, s.name
        `);
    }

    async createStaff(schemaName: string, data: {
        name: string; email?: string; phone?: string;
        role?: string; specialties?: string[];
    }): Promise<any> {
        await this.ensureTables(schemaName);
        const rows = await this.prisma.$queryRawUnsafe<any[]>(`
            INSERT INTO "${schemaName}".staff_members (name, email, phone, role, specialties)
            VALUES ($1, $2, $3, $4, $5::text[])
            RETURNING *
        `, data.name, data.email || null, data.phone || null,
           data.role || 'stylist', data.specialties || []);
        return rows[0];
    }

    async updateStaff(schemaName: string, staffId: string, data: Partial<{
        name: string; email: string; phone: string; role: string;
        specialties: string[]; isActive: boolean; sortOrder: number;
    }>): Promise<any> {
        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (data.name !== undefined) { sets.push(`name = $${idx++}`); params.push(data.name); }
        if (data.email !== undefined) { sets.push(`email = $${idx++}`); params.push(data.email); }
        if (data.phone !== undefined) { sets.push(`phone = $${idx++}`); params.push(data.phone); }
        if (data.role !== undefined) { sets.push(`role = $${idx++}`); params.push(data.role); }
        if (data.specialties !== undefined) { sets.push(`specialties = $${idx++}::text[]`); params.push(data.specialties); }
        if (data.isActive !== undefined) { sets.push(`is_active = $${idx++}`); params.push(data.isActive); }
        if (data.sortOrder !== undefined) { sets.push(`sort_order = $${idx++}`); params.push(data.sortOrder); }

        if (!sets.length) throw new BadRequestException('No fields to update');
        sets.push('updated_at = now()');
        params.push(staffId);

        const rows = await this.prisma.$queryRawUnsafe<any[]>(
            `UPDATE "${schemaName}".staff_members SET ${sets.join(', ')} WHERE id = $${idx}::uuid RETURNING *`,
            ...params,
        );
        if (!rows.length) throw new NotFoundException('Staff member not found');
        return rows[0];
    }

    async deleteStaff(schemaName: string, staffId: string): Promise<void> {
        await this.prisma.$queryRawUnsafe(
            `UPDATE "${schemaName}".staff_members SET is_active = false WHERE id = $1::uuid`,
            staffId,
        );
    }

    async setSchedule(schemaName: string, staffId: string, schedules: Array<{
        dayOfWeek: number; startTime: string; endTime: string; isActive?: boolean;
    }>): Promise<void> {
        await this.prisma.$queryRawUnsafe(
            `DELETE FROM "${schemaName}".staff_schedules WHERE staff_id = $1::uuid`,
            staffId,
        );

        for (const s of schedules) {
            await this.prisma.$queryRawUnsafe(`
                INSERT INTO "${schemaName}".staff_schedules (staff_id, day_of_week, start_time, end_time, is_active)
                VALUES ($1::uuid, $2, $3::time, $4::time, $5)
            `, staffId, s.dayOfWeek, s.startTime, s.endTime, s.isActive ?? true);
        }
    }

    async linkServices(schemaName: string, staffId: string, serviceIds: string[]): Promise<void> {
        await this.prisma.$queryRawUnsafe(
            `DELETE FROM "${schemaName}".staff_service_links WHERE staff_id = $1::uuid`,
            staffId,
        );

        for (const sid of serviceIds) {
            await this.prisma.$queryRawUnsafe(`
                INSERT INTO "${schemaName}".staff_service_links (staff_id, service_id)
                VALUES ($1::uuid, $2::uuid)
            `, staffId, sid);
        }
    }

    async getAvailableStaff(schemaName: string, serviceId: string, date: string, time: string): Promise<any[]> {
        await this.ensureTables(schemaName);
        const dayOfWeek = new Date(date).getDay();

        return this.prisma.$queryRawUnsafe(`
            SELECT sm.id, sm.name, sm.specialties, sm.avatar_url
            FROM "${schemaName}".staff_members sm
            JOIN "${schemaName}".staff_service_links sl ON sl.staff_id = sm.id AND sl.service_id = $1::uuid
            JOIN "${schemaName}".staff_schedules ss ON ss.staff_id = sm.id
                AND ss.day_of_week = $2 AND ss.is_active = true
                AND $3::time >= ss.start_time AND $3::time < ss.end_time
            WHERE sm.is_active = true
            AND sm.id NOT IN (
                SELECT sb.staff_id FROM "${schemaName}".staff_breaks sb
                WHERE sb.date = $4::date AND $3::time >= sb.start_time AND $3::time < sb.end_time
            )
            AND sm.id NOT IN (
                SELECT a.staff_id FROM "${schemaName}".appointments a
                WHERE a.staff_id IS NOT NULL
                AND a.appointment_date = $4::date
                AND a.appointment_time::time = $3::time
                AND a.status NOT IN ('cancelled', 'no_show')
            )
            ORDER BY sm.sort_order, sm.name
        `, serviceId, dayOfWeek, time, date);
    }

    async addBreak(schemaName: string, staffId: string, data: {
        date: string; startTime: string; endTime: string; reason?: string;
    }): Promise<any> {
        const rows = await this.prisma.$queryRawUnsafe<any[]>(`
            INSERT INTO "${schemaName}".staff_breaks (staff_id, date, start_time, end_time, reason)
            VALUES ($1::uuid, $2::date, $3::time, $4::time, $5)
            RETURNING *
        `, staffId, data.date, data.startTime, data.endTime, data.reason || null);
        return rows[0];
    }
}
