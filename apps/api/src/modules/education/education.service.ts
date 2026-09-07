import { EducationEnrollmentCommands, type EnrollmentCommand } from './education-enrollment-commands';
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
    normalizeCurrencyCode,
    optionalPositiveIntegerUnit,
} from '../../common/utils/commercial-units.util';
import {
    assertOptionalContactId,
    requireTenantContact,
} from '../../common/utils/tenant-contact.util';

/**
 * Education service — courses, cohorts, enrollments, placement tests.
 *
 * Domain model:
 *   - course (catalog): the abstract program (e.g. "English A2")
 *   - course_cohort (instance): a specific group with start date,
 *     instructor, schedule, capacity. A course has many cohorts.
 *   - enrollment: links a student (contact) to a cohort with payment
 *     and progress fields.
 *   - placement_test: pre-enrollment level assessment. Used by language
 *     schools and certification programs.
 *
 * Cohorts are the bookable unit — when the AI agent enrolls someone,
 * it operates on a cohort_id, not a course_id.
 */
@Injectable()
export class EducationService {
    private readonly logger = new Logger(EducationService.name);

    constructor(private readonly prisma: PrismaService) {}

    // ── Courses ───────────────────────────────────────────────────

    async listCourses(schemaName: string, opts: { subject?: string; level?: string; modality?: string } = {}): Promise<any[]> {
        const where: string[] = ['is_active = true'];
        const params: any[] = [];
        let i = 1;
        if (opts.subject) { where.push(`subject ILIKE $${i++}`); params.push(`%${opts.subject}%`); }
        if (opts.level) { where.push(`level ILIKE $${i++}`); params.push(`%${opts.level}%`); }
        if (opts.modality) { where.push(`modality = $${i++}`); params.push(opts.modality); }
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM courses WHERE ${where.join(' AND ')} ORDER BY subject, level, name`,
            params,
        );
    }

    async getCourseById(schemaName: string, id: string): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName, `SELECT * FROM courses WHERE id = $1::uuid`, [id],
        );
        return rows[0] || null;
    }

    async createCourse(schemaName: string, data: any): Promise<any> {
        if (!data.name) throw new BadRequestException('name is required');
        const durationHours = optionalPositiveIntegerUnit(data.durationHours, 'durationHours');
        const durationWeeks = optionalPositiveIntegerUnit(data.durationWeeks, 'durationWeeks');
        const currency = normalizeCurrencyCode(data.currency);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO courses (
                name, description, subject, level, modality,
                duration_hours, duration_weeks, price, currency,
                certification, prerequisites, syllabus_url, image_url
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             RETURNING *`,
            [
                data.name, data.description || null, data.subject || null,
                data.level || null, data.modality || 'presencial',
                durationHours, durationWeeks,
                data.price ?? 0, currency,
                data.certification || null, data.prerequisites || null,
                data.syllabusUrl || null, data.imageUrl || null,
            ],
        );
        return rows[0];
    }

    async updateCourse(schemaName: string, id: string, data: any): Promise<any> {
        if (data.durationHours !== undefined && data.durationHours !== null) {
            data = { ...data, durationHours: optionalPositiveIntegerUnit(data.durationHours, 'durationHours') };
        }
        if (data.durationWeeks !== undefined && data.durationWeeks !== null) {
            data = { ...data, durationWeeks: optionalPositiveIntegerUnit(data.durationWeeks, 'durationWeeks') };
        }
        if (data.currency !== undefined) {
            data = { ...data, currency: normalizeCurrencyCode(data.currency) };
        }
        const fields: string[] = [];
        const values: any[] = [];
        let i = 1;
        const map: Record<string, string> = {
            name: 'name', description: 'description', subject: 'subject', level: 'level',
            modality: 'modality', durationHours: 'duration_hours', durationWeeks: 'duration_weeks',
            price: 'price', currency: 'currency', certification: 'certification',
            prerequisites: 'prerequisites', syllabusUrl: 'syllabus_url', imageUrl: 'image_url',
            isActive: 'is_active',
        };
        for (const [k, col] of Object.entries(map)) {
            if (k in data) { fields.push(`${col} = $${i++}`); values.push(data[k]); }
        }
        if (!fields.length) return this.getCourseById(schemaName, id);
        fields.push(`updated_at = NOW()`);
        values.push(id);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE courses SET ${fields.join(', ')} WHERE id = $${i}::uuid RETURNING *`,
            values,
        );
        if (!rows.length) throw new NotFoundException('Course not found');
        return rows[0];
    }

    async deleteCourse(schemaName: string, id: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE courses SET is_active = false, updated_at = NOW() WHERE id = $1::uuid`,
            [id],
        );
    }

    // ── Cohorts ───────────────────────────────────────────────────

    async listCohorts(schemaName: string, opts: { courseId?: string; status?: string } = {}): Promise<any[]> {
        const where: string[] = [];
        const params: any[] = [];
        let i = 1;
        if (opts.courseId) { where.push(`co.course_id = $${i++}::uuid`); params.push(opts.courseId); }
        if (opts.status) { where.push(`co.status = $${i++}`); params.push(opts.status); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT co.*, c.name as course_name, c.subject as course_subject,
                    c.level as course_level, c.price as course_price, c.currency as course_currency
             FROM course_cohorts co
             LEFT JOIN courses c ON c.id = co.course_id
             ${whereSql}
             ORDER BY co.starts_at DESC LIMIT 200`,
            params,
        );
    }

    async createCohort(schemaName: string, data: any): Promise<any> {
        if (!data.courseId || !data.startsAt || !data.maxCapacity) {
            throw new BadRequestException('courseId, startsAt and maxCapacity are required');
        }
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO course_cohorts (
                course_id, cohort_code, instructor_name, starts_at, ends_at,
                schedule, max_capacity, available_seats, room, meeting_url
             ) VALUES ($1::uuid, $2, $3, $4::date, $5::date, $6, $7, $7, $8, $9)
             RETURNING *`,
            [
                data.courseId, data.cohortCode || null, data.instructorName || null,
                data.startsAt, data.endsAt || null, data.schedule || null,
                data.maxCapacity, data.room || null, data.meetingUrl || null,
            ],
        );
        return rows[0];
    }

    async cancelCohort(schemaName: string, id: string): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE course_cohorts SET status = 'cancelled', updated_at = NOW()
             WHERE id = $1::uuid RETURNING *`,
            [id],
        );
        return rows[0];
    }

    /** AI tool — open cohorts in the next N days. */
    async upcomingCohorts(schemaName: string, opts: { subject?: string; level?: string; modality?: string; daysAhead?: number }): Promise<any[]> {
        const days = Math.min(opts.daysAhead || 60, 180);
        const where: string[] = [
            "co.status IN ('open','full')",
            "co.starts_at >= CURRENT_DATE",
            "co.starts_at <= CURRENT_DATE + ($1::int * INTERVAL '1 day')",
        ];
        const params: any[] = [days];
        let i = 2;
        if (opts.subject) { where.push(`c.subject ILIKE $${i++}`); params.push(`%${opts.subject}%`); }
        if (opts.level) { where.push(`c.level ILIKE $${i++}`); params.push(`%${opts.level}%`); }
        if (opts.modality) { where.push(`c.modality = $${i++}`); params.push(opts.modality); }
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT co.id as cohort_id, co.starts_at, co.ends_at, co.schedule,
                    co.available_seats, co.max_capacity, co.status as cohort_status,
                    c.id as course_id, c.name as course_name, c.subject, c.level,
                    c.price, c.currency, c.modality, c.duration_hours, c.duration_weeks,
                    c.certification
             FROM course_cohorts co
             JOIN courses c ON c.id = co.course_id
             WHERE c.is_active = true AND ${where.join(' AND ')}
             ORDER BY co.starts_at LIMIT 30`,
            params,
        );
    }

    // ── Enrollments ───────────────────────────────────────────────

    async listEnrollments(schemaName: string, opts: { cohortId?: string; contactId?: string; status?: string } = {}): Promise<any[]> {
        const where: string[] = [];
        const params: any[] = [];
        let i = 1;
        if (opts.cohortId) { where.push(`e.cohort_id = $${i++}::uuid`); params.push(opts.cohortId); }
        if (opts.contactId) { where.push(`e.contact_id = $${i++}::uuid`); params.push(opts.contactId); }
        if (opts.status) { where.push(`e.status = $${i++}`); params.push(opts.status); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT e.*, c.name as course_name, co.cohort_code, co.starts_at as cohort_starts_at
             FROM enrollments e
             LEFT JOIN courses c ON c.id = e.course_id
             LEFT JOIN course_cohorts co ON co.id = e.cohort_id
             ${whereSql}
             ORDER BY e.created_at DESC LIMIT 200`,
            params,
        );
    }

    getEnrollmentTerms(schemaName: string, cohortId: string) {
        return new EducationEnrollmentCommands(this.prisma).getTerms(schemaName,cohortId);
    }
    enrollStudent(schemaName: string, data: EnrollmentCommand): Promise<any> {
        return new EducationEnrollmentCommands(this.prisma).enroll(schemaName,data);
    }
    cancelEnrollment(schemaName: string, id: string, input: {contactId?: string; reason?: string} = {}): Promise<any> {
        return new EducationEnrollmentCommands(this.prisma).cancel(schemaName,id,input);
    }
    async updateEnrollment(schemaName: string, id: string, data: any): Promise<any> {
        // Dashboard status changes use the same transition as conversational tools.
        if (data.status === 'dropped') {
            return this.cancelEnrollment(schemaName, id, { reason: data.notes });
        }
        if (data.status && !['active','completed','refunded'].includes(data.status)) {
            throw new BadRequestException('Use the enrollment command to allocate a seat');
        }
        const requiresAllocatedSeat = data.status !== undefined || data.paymentStatus !== undefined || data.amountPaid !== undefined;
        const fields: string[] = [];
        const values: any[] = [];
        let i = 1;
        const map: Record<string, string> = {
            status: 'status', paymentStatus: 'payment_status',
            amountPaid: 'amount_paid', completionPercent: 'completion_percent',
            finalGrade: 'final_grade', notes: 'notes',
        };
        for (const [k, col] of Object.entries(map)) {
            if (k in data) { fields.push(`${col} = $${i++}`); values.push(data[k]); }
        }
        if (!fields.length) return null;
        fields.push(`updated_at = NOW()`);
        values.push(id);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE enrollments SET ${fields.join(', ')} WHERE id = $${i}::uuid ${requiresAllocatedSeat ? "AND status IN ('enrolled','active')" : ''} RETURNING *`,
            values,
        );
        if (!rows[0] && requiresAllocatedSeat) throw new BadRequestException('Enrollment has no allocated seat or its status changed');
        return rows[0];
    }

    // ── Placement tests ───────────────────────────────────────────

    async createPlacementTest(schemaName: string, data: { contactId?: string; subject?: string; testUrl?: string }): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO placement_tests (contact_id, subject, test_url, status)
             VALUES ($1::uuid, $2, $3, 'pending') RETURNING *`,
            [data.contactId || null, data.subject || null, data.testUrl || null],
        );
        return rows[0];
    }

    async getPlacementTestForContact(schemaName: string, contactId: string): Promise<any | null> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM placement_tests WHERE contact_id = $1::uuid
             ORDER BY created_at DESC LIMIT 1`,
            [contactId],
        );
        return rows[0] || null;
    }
}
