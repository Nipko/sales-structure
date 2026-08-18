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

    /**
     * DDL cannot go through executeInTenantSchema (that helper runs a single
     * statement via $queryRawUnsafe under SET LOCAL search_path, which is no use
     * for CREATE TABLE ... REFERENCES). This is the one path that still
     * interpolates the schema by hand, so it must fail fast on anything that is
     * not a tenant schema name — a tenantId used to reach Postgres verbatim and
     * surface as an unreadable 3F000.
     */
    private async ensureTables(schemaName: string): Promise<void> {
        this.prisma.assertTenantSchemaName(schemaName);

        // Catalog probe: the schema travels as a bound parameter against
        // information_schema, so it is not resolved through search_path.
        const exists: any[] = await this.prisma.$queryRawUnsafe(
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

    async listStaff(tenantId: string): Promise<any[]> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTables(schemaName);
        return this.prisma.executeInTenantSchema<any[]>(schemaName, `
            SELECT s.*,
                COALESCE(json_agg(json_build_object(
                    'dayOfWeek', sc.day_of_week,
                    'startTime', sc.start_time::text,
                    'endTime', sc.end_time::text,
                    'isActive', sc.is_active
                )) FILTER (WHERE sc.id IS NOT NULL), '[]') as schedules,
                COALESCE(json_agg(DISTINCT sl.service_id) FILTER (WHERE sl.service_id IS NOT NULL), '[]') as service_ids
            FROM staff_members s
            LEFT JOIN staff_schedules sc ON sc.staff_id = s.id
            LEFT JOIN staff_service_links sl ON sl.staff_id = s.id
            WHERE s.is_active = true
            GROUP BY s.id
            ORDER BY s.sort_order, s.name
        `);
    }

    async createStaff(tenantId: string, data: {
        name: string; email?: string; phone?: string;
        role?: string; specialties?: string[];
    }): Promise<any> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTables(schemaName);
        const rows: any[] = await this.prisma.executeInTenantSchema(schemaName, `
            INSERT INTO staff_members (name, email, phone, role, specialties)
            VALUES ($1, $2, $3, $4, $5::text[])
            RETURNING *
        `, [data.name, data.email || null, data.phone || null,
            data.role || 'stylist', data.specialties || []]);
        return rows[0];
    }

    async updateStaff(tenantId: string, staffId: string, data: Partial<{
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

        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const rows: any[] = await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE staff_members SET ${sets.join(', ')} WHERE id = $${idx}::uuid RETURNING *`,
            params,
        );
        if (!rows.length) throw new NotFoundException('Staff member not found');
        return rows[0];
    }

    async deleteStaff(tenantId: string, staffId: string): Promise<void> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE staff_members SET is_active = false WHERE id = $1::uuid`,
            [staffId],
        );
    }

    async setSchedule(tenantId: string, staffId: string, schedules: Array<{
        dayOfWeek: number; startTime: string; endTime: string; isActive?: boolean;
    }>): Promise<void> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTables(schemaName);
        if (!Array.isArray(schedules)) {
            throw new BadRequestException('Schedules must be an array');
        }
        for (const schedule of schedules) {
            if (!Number.isInteger(schedule.dayOfWeek) || schedule.dayOfWeek < 0 || schedule.dayOfWeek > 6) {
                throw new BadRequestException('dayOfWeek must be an integer between 0 and 6');
            }
            if (!this.isValidTime(schedule.startTime) || !this.isValidTime(schedule.endTime)) {
                throw new BadRequestException('Schedule times must use HH:mm or HH:mm:ss');
            }
            if (this.timeToSeconds(schedule.startTime) >= this.timeToSeconds(schedule.endTime)) {
                throw new BadRequestException('Schedule endTime must be after startTime');
            }
        }

        // Replacing a weekly schedule is one logical write. Keeping DELETE and all
        // INSERTs on the same tenant transaction prevents a failed row from leaving
        // the staff member with a partially-written (or empty) schedule.
        await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            await query(
                `DELETE FROM staff_schedules WHERE staff_id = $1::uuid`,
                [staffId],
            );

            for (const schedule of schedules) {
                await query(`
                    INSERT INTO staff_schedules (staff_id, day_of_week, start_time, end_time, is_active)
                    VALUES ($1::uuid, $2, $3::time, $4::time, $5)
                `, [staffId, schedule.dayOfWeek, schedule.startTime, schedule.endTime, schedule.isActive ?? true]);
            }
        });
    }

    async linkServices(tenantId: string, staffId: string, serviceIds: string[]): Promise<void> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTables(schemaName);
        if (!Array.isArray(serviceIds)) {
            throw new BadRequestException('serviceIds must be an array');
        }

        // The link set is also a replacement, so it must never expose an
        // intermediate empty/partial state to booking availability reads.
        await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            await query(
                `DELETE FROM staff_service_links WHERE staff_id = $1::uuid`,
                [staffId],
            );

            for (const serviceId of serviceIds) {
                await query(`
                    INSERT INTO staff_service_links (staff_id, service_id)
                    VALUES ($1::uuid, $2::uuid)
                `, [staffId, serviceId]);
            }
        });
    }

    /**
     * Public entry point: callers hold a tenantId, never a schema name.
     */
    async getAvailableStaff(tenantId: string, serviceId: string, date: string, time: string): Promise<any[]> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        return this.getAvailableStaffInSchema(schemaName, serviceId, date, time);
    }

    /**
     * Kept separate so any in-process caller that already resolved the tenant
     * schema (booking engine / AI tools) can reuse the availability rule without
     * a second lookup, and without tempting a controller to pass a raw id here.
     */
    private async getAvailableStaffInSchema(schemaName: string, serviceId: string, date: string, time: string): Promise<any[]> {
        await this.ensureTables(schemaName);
        const dayOfWeek = this.dayOfWeek(date);
        if (!this.isValidTime(time)) {
            throw new BadRequestException('time must use HH:mm or HH:mm:ss');
        }

        return this.prisma.executeInTenantSchema<any[]>(schemaName, `
            SELECT sm.id, sm.name, sm.specialties, sm.avatar_url
            FROM staff_members sm
            JOIN staff_service_links sl ON sl.staff_id = sm.id AND sl.service_id = $1::uuid
            JOIN services svc ON svc.id = sl.service_id AND svc.is_active = true
            JOIN staff_schedules ss ON ss.staff_id = sm.id
                AND ss.day_of_week = $2 AND ss.is_active = true
                AND ($4::date + $3::time) >= ($4::date + ss.start_time)
                AND (
                    $4::date + $3::time
                    + make_interval(mins => GREATEST(1, COALESCE(sl.duration_override_min, svc.duration_minutes, 30)))
                    + make_interval(mins => GREATEST(0, COALESCE(svc.buffer_minutes, 0)))
                ) <= ($4::date + ss.end_time)
            WHERE sm.is_active = true
            AND NOT EXISTS (
                SELECT 1 FROM staff_breaks sb
                WHERE sb.staff_id = sm.id
                  AND sb.date = $4::date
                  AND ($4::date + $3::time) < ($4::date + sb.end_time)
                  AND (
                      $4::date + $3::time
                      + make_interval(mins => GREATEST(1, COALESCE(sl.duration_override_min, svc.duration_minutes, 30)))
                      + make_interval(mins => GREATEST(0, COALESCE(svc.buffer_minutes, 0)))
                  ) > ($4::date + sb.start_time)
            )
            AND NOT EXISTS (
                SELECT 1 FROM appointments a
                WHERE a.assigned_to = sm.id
                  AND a.status NOT IN ('cancelled', 'no_show')
                  AND a.start_at < (
                      $4::date + $3::time
                      + make_interval(mins => GREATEST(1, COALESCE(sl.duration_override_min, svc.duration_minutes, 30)))
                      + make_interval(mins => GREATEST(0, COALESCE(svc.buffer_minutes, 0)))
                  )
                  AND a.end_at > ($4::date + $3::time)
            )
            ORDER BY sm.sort_order, sm.name
        `, [serviceId, dayOfWeek, time, date]);
    }

    async addBreak(tenantId: string, staffId: string, data: {
        date: string; startTime: string; endTime: string; reason?: string;
    }): Promise<any> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const rows: any[] = await this.prisma.executeInTenantSchema(schemaName, `
            INSERT INTO staff_breaks (staff_id, date, start_time, end_time, reason)
            VALUES ($1::uuid, $2::date, $3::time, $4::time, $5)
            RETURNING *
        `, [staffId, data.date, data.startTime, data.endTime, data.reason || null]);
        return rows[0];
    }

    private dayOfWeek(date: string): number {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
        if (!match) throw new BadRequestException('date must use YYYY-MM-DD');

        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const parsed = new Date(Date.UTC(year, month - 1, day));
        if (
            parsed.getUTCFullYear() !== year
            || parsed.getUTCMonth() !== month - 1
            || parsed.getUTCDate() !== day
        ) {
            throw new BadRequestException('date must be a valid calendar date');
        }
        return parsed.getUTCDay();
    }

    private isValidTime(time: string): boolean {
        return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time);
    }

    private timeToSeconds(time: string): number {
        const [hours, minutes, seconds = '0'] = time.split(':');
        return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
    }
}
