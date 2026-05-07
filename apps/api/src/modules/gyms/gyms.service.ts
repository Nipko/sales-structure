import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Gyms / Fitness vertical service.
 *
 * Three core entities:
 *  - membership_plans: catalog (mensual/trimestral/anual + drop-in)
 *  - members: contact-bound subscriptions with period + credits
 *  - fitness_classes + class_bookings: class schedule + reservations
 *
 * Membership freeze model: while frozen, current_period_end is NOT
 * shifted on the fly — instead frozen_days_used tracks consumption
 * and the period is extended on unfreeze. This makes the membership
 * window deterministic for billing reconciliation.
 */
@Injectable()
export class GymsService {
    private readonly logger = new Logger(GymsService.name);

    constructor(private readonly prisma: PrismaService) {}

    // ── Plans ─────────────────────────────────────────────────────

    async listPlans(schemaName: string, includeInactive = false): Promise<any[]> {
        const where = includeInactive ? '' : 'WHERE is_active = true';
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM membership_plans ${where} ORDER BY sort_order, price`,
        );
    }

    async createPlan(schemaName: string, data: {
        name: string;
        description?: string;
        durationDays: number;
        price: number;
        currency?: string;
        classCreditsPerPeriod?: number;
        personalTrainingCredits?: number;
        guestPasses?: number;
        freezeAllowanceDays?: number;
        perks?: string[];
    }): Promise<any> {
        if (!data.name || !data.durationDays) {
            throw new BadRequestException('name and durationDays are required');
        }
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO membership_plans (
                name, description, duration_days, price, currency,
                class_credits_per_period, personal_training_credits, guest_passes,
                freeze_allowance_days, perks
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
             RETURNING *`,
            [
                data.name, data.description || null, data.durationDays,
                data.price, data.currency || 'COP',
                data.classCreditsPerPeriod ?? null,
                data.personalTrainingCredits ?? 0,
                data.guestPasses ?? 0,
                data.freezeAllowanceDays ?? 0,
                JSON.stringify(data.perks || []),
            ],
        );
        return rows[0];
    }

    async updatePlan(schemaName: string, id: string, data: any): Promise<any> {
        const fields: string[] = [];
        const values: any[] = [];
        let i = 1;
        const map: Record<string, { col: string; cast?: string }> = {
            name: { col: 'name' }, description: { col: 'description' },
            durationDays: { col: 'duration_days' }, price: { col: 'price' },
            currency: { col: 'currency' },
            classCreditsPerPeriod: { col: 'class_credits_per_period' },
            personalTrainingCredits: { col: 'personal_training_credits' },
            guestPasses: { col: 'guest_passes' },
            freezeAllowanceDays: { col: 'freeze_allowance_days' },
            perks: { col: 'perks', cast: '::jsonb' },
            isActive: { col: 'is_active' },
            sortOrder: { col: 'sort_order' },
        };
        for (const [k, def] of Object.entries(map)) {
            if (k in data) {
                let value = data[k];
                if (def.cast === '::jsonb') value = JSON.stringify(value || []);
                fields.push(`${def.col} = $${i}${def.cast || ''}`);
                values.push(value);
                i++;
            }
        }
        if (!fields.length) return null;
        fields.push(`updated_at = NOW()`);
        values.push(id);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE membership_plans SET ${fields.join(', ')} WHERE id = $${i}::uuid RETURNING *`,
            values,
        );
        if (!rows.length) throw new NotFoundException('Plan not found');
        return rows[0];
    }

    async deletePlan(schemaName: string, id: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE membership_plans SET is_active = false, updated_at = NOW() WHERE id = $1::uuid`,
            [id],
        );
    }

    // ── Members ───────────────────────────────────────────────────

    async listMembers(schemaName: string, opts: { status?: string; search?: string; limit?: number } = {}): Promise<any[]> {
        const where: string[] = [];
        const params: any[] = [];
        let i = 1;
        if (opts.status) { where.push(`m.status = $${i++}`); params.push(opts.status); }
        if (opts.search) {
            where.push(`(c.name ILIKE $${i} OR c.phone ILIKE $${i} OR m.member_number ILIKE $${i})`);
            params.push(`%${opts.search}%`);
            i++;
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const limit = Math.min(opts.limit || 100, 500);
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT m.*, c.name as contact_name, c.phone as contact_phone,
                    p.name as plan_name, p.duration_days as plan_duration_days
             FROM members m
             LEFT JOIN contacts c ON c.id = m.contact_id
             LEFT JOIN membership_plans p ON p.id = m.plan_id
             ${whereSql}
             ORDER BY m.created_at DESC
             LIMIT ${limit}`,
            params,
        );
    }

    async getMemberById(schemaName: string, id: string): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT m.*, c.name as contact_name, c.phone as contact_phone,
                    c.email as contact_email,
                    p.name as plan_name, p.duration_days as plan_duration_days,
                    p.class_credits_per_period as plan_class_credits,
                    p.freeze_allowance_days as plan_freeze_allowance
             FROM members m
             LEFT JOIN contacts c ON c.id = m.contact_id
             LEFT JOIN membership_plans p ON p.id = m.plan_id
             WHERE m.id = $1::uuid`,
            [id],
        );
        return rows[0] || null;
    }

    async getMemberByContact(schemaName: string, contactId: string): Promise<any | null> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT m.*, p.name as plan_name, p.class_credits_per_period as plan_class_credits
             FROM members m
             LEFT JOIN membership_plans p ON p.id = m.plan_id
             WHERE m.contact_id = $1::uuid AND m.status IN ('active', 'frozen')
             ORDER BY m.created_at DESC LIMIT 1`,
            [contactId],
        );
        return rows[0] || null;
    }

    async createMember(schemaName: string, data: {
        contactId: string;
        planId?: string;
        memberNumber?: string;
        joinedAt?: string;
    }): Promise<any> {
        if (!data.contactId) throw new BadRequestException('contactId is required');

        // If a plan is provided, compute the period and seed credits
        let periodStart: string | null = null;
        let periodEnd: string | null = null;
        let credits: number | null = null;
        let ptCredits = 0;
        let guestPasses = 0;
        if (data.planId) {
            const planRows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT * FROM membership_plans WHERE id = $1::uuid`,
                [data.planId],
            );
            const plan = planRows[0];
            if (!plan) throw new BadRequestException('Plan not found');
            const start = new Date();
            const end = new Date(start);
            end.setDate(end.getDate() + plan.duration_days);
            periodStart = start.toISOString().slice(0, 10);
            periodEnd = end.toISOString().slice(0, 10);
            credits = plan.class_credits_per_period;
            ptCredits = plan.personal_training_credits || 0;
            guestPasses = plan.guest_passes || 0;
        }

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO members (
                contact_id, plan_id, member_number, joined_at,
                current_period_start, current_period_end,
                class_credits_remaining, personal_training_remaining, guest_passes_remaining
             ) VALUES (
                $1::uuid, $2::uuid, $3, $4::date,
                $5::date, $6::date,
                $7, $8, $9
             ) RETURNING *`,
            [
                data.contactId, data.planId || null, data.memberNumber || null,
                data.joinedAt || new Date().toISOString().slice(0, 10),
                periodStart, periodEnd,
                credits, ptCredits, guestPasses,
            ],
        );
        return rows[0];
    }

    /**
     * Freeze a membership for N days. Deterministic model: the period
     * end is NOT shifted yet; we record the freeze window and consume
     * from freeze_allowance_days. unfreezeMember() recomputes the
     * period_end based on actual frozen days used.
     */
    async freezeMember(schemaName: string, id: string, days: number): Promise<any> {
        if (days < 1 || days > 180) throw new BadRequestException('days must be 1-180');
        const member = await this.getMemberById(schemaName, id);
        if (!member) throw new NotFoundException('Member not found');
        if (member.status !== 'active') throw new BadRequestException('Only active memberships can be frozen');

        const allowance = member.plan_freeze_allowance || 0;
        const used = member.frozen_days_used || 0;
        if (allowance > 0 && used + days > allowance) {
            throw new BadRequestException(`Freeze allowance exceeded — plan allows ${allowance} days, ${used} already used`);
        }

        const start = new Date();
        const end = new Date(start);
        end.setDate(end.getDate() + days);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE members SET
                status = 'frozen',
                frozen_from = $1::date,
                frozen_until = $2::date,
                updated_at = NOW()
             WHERE id = $3::uuid RETURNING *`,
            [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), id],
        );
        return rows[0];
    }

    async unfreezeMember(schemaName: string, id: string): Promise<any> {
        const member = await this.getMemberById(schemaName, id);
        if (!member || member.status !== 'frozen') throw new BadRequestException('Member is not frozen');

        // Compute days actually frozen and shift period_end forward
        const frozenFrom = new Date(member.frozen_from);
        const now = new Date();
        const daysFrozen = Math.max(0, Math.ceil((now.getTime() - frozenFrom.getTime()) / 86_400_000));
        const newPeriodEnd = new Date(member.current_period_end);
        newPeriodEnd.setDate(newPeriodEnd.getDate() + daysFrozen);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE members SET
                status = 'active',
                frozen_from = NULL,
                frozen_until = NULL,
                frozen_days_used = COALESCE(frozen_days_used, 0) + $1,
                current_period_end = $2::date,
                updated_at = NOW()
             WHERE id = $3::uuid RETURNING *`,
            [daysFrozen, newPeriodEnd.toISOString().slice(0, 10), id],
        );
        return rows[0];
    }

    async checkInMember(schemaName: string, memberId: string, classId?: string): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO member_check_ins (member_id, class_id, method)
             VALUES ($1::uuid, $2::uuid, 'manual') RETURNING *`,
            [memberId, classId || null],
        );
        return rows[0];
    }

    // ── Classes ───────────────────────────────────────────────────

    async listClasses(schemaName: string, opts: { from?: string; to?: string; classType?: string; limit?: number } = {}): Promise<any[]> {
        const where: string[] = ['fc.is_cancelled = false'];
        const params: any[] = [];
        let i = 1;
        if (opts.from) { where.push(`fc.scheduled_at >= $${i++}::timestamp`); params.push(opts.from); }
        if (opts.to) { where.push(`fc.scheduled_at <= $${i++}::timestamp`); params.push(opts.to); }
        if (opts.classType) { where.push(`fc.class_type = $${i++}`); params.push(opts.classType); }
        const limit = Math.min(opts.limit || 100, 500);
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT fc.*
             FROM fitness_classes fc
             WHERE ${where.join(' AND ')}
             ORDER BY fc.scheduled_at
             LIMIT ${limit}`,
            params,
        );
    }

    async createClass(schemaName: string, data: {
        name: string;
        description?: string;
        classType?: string;
        instructorName?: string;
        scheduledAt: string;
        durationMinutes?: number;
        maxCapacity: number;
        room?: string;
        level?: string;
        creditsRequired?: number;
    }): Promise<any> {
        if (!data.name || !data.scheduledAt || !data.maxCapacity) {
            throw new BadRequestException('name, scheduledAt and maxCapacity are required');
        }
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO fitness_classes (
                name, description, class_type, instructor_name,
                scheduled_at, duration_minutes, max_capacity, available_spots,
                room, level, credits_required
             ) VALUES (
                $1, $2, $3, $4, $5::timestamp, $6, $7, $7, $8, $9, $10
             ) RETURNING *`,
            [
                data.name, data.description || null, data.classType || null,
                data.instructorName || null,
                data.scheduledAt,
                data.durationMinutes || 60,
                data.maxCapacity,
                data.room || null, data.level || null,
                data.creditsRequired ?? 1,
            ],
        );
        return rows[0];
    }

    async cancelClass(schemaName: string, id: string, reason?: string): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE fitness_classes SET
                is_cancelled = true,
                cancellation_reason = $1,
                updated_at = NOW()
             WHERE id = $2::uuid RETURNING *`,
            [reason || 'cancelled by staff', id],
        );
        // Also cancel all confirmed bookings for the class
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE class_bookings SET status = 'cancelled', cancelled_at = NOW()
             WHERE class_id = $1::uuid AND status = 'confirmed'`,
            [id],
        );
        return rows[0];
    }

    /**
     * Book a class for a member. Decrements class credits if the plan
     * has a credit allowance; refuses if no credits and the plan is
     * not unlimited. Decrements available_spots on the class atomically.
     */
    async bookClass(schemaName: string, classId: string, memberId: string): Promise<any> {
        // Verify the class exists + has spots
        const classRows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM fitness_classes WHERE id = $1::uuid`,
            [classId],
        );
        const klass = classRows[0];
        if (!klass) throw new NotFoundException('Class not found');
        if (klass.is_cancelled) throw new BadRequestException('Class is cancelled');
        if (klass.available_spots <= 0) throw new BadRequestException('Class is full');

        // Verify the member can book (active + has credits)
        const member = await this.getMemberById(schemaName, memberId);
        if (!member) throw new NotFoundException('Member not found');
        if (member.status !== 'active') throw new BadRequestException('Member is not active');

        const credits = member.class_credits_remaining;
        const required = klass.credits_required || 1;
        if (credits !== null && credits < required) {
            throw new BadRequestException(`Insufficient credits — has ${credits}, needs ${required}`);
        }

        // Insert booking + decrement spots + decrement credits in best-effort sequence
        const bookingRows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO class_bookings (class_id, member_id, contact_id, credits_used)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4) RETURNING *`,
            [classId, memberId, member.contact_id, required],
        );
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE fitness_classes SET available_spots = available_spots - 1
             WHERE id = $1::uuid AND available_spots > 0`,
            [classId],
        );
        if (credits !== null) {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE members SET class_credits_remaining = GREATEST(class_credits_remaining - $1, 0)
                 WHERE id = $2::uuid`,
                [required, memberId],
            );
        }
        return bookingRows[0];
    }

    async cancelBooking(schemaName: string, bookingId: string): Promise<void> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE class_bookings SET status = 'cancelled', cancelled_at = NOW()
             WHERE id = $1::uuid AND status IN ('confirmed', 'waitlist') RETURNING *`,
            [bookingId],
        );
        const b = rows[0];
        if (!b) return;
        // Restore credits + spot
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE fitness_classes SET available_spots = available_spots + 1 WHERE id = $1::uuid`,
            [b.class_id],
        );
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE members SET class_credits_remaining = COALESCE(class_credits_remaining, 0) + $1
             WHERE id = $2::uuid AND class_credits_remaining IS NOT NULL`,
            [b.credits_used || 1, b.member_id],
        );
    }

    /** AI tool — list upcoming classes available for booking. */
    async upcomingClasses(schemaName: string, daysAhead = 7, classType?: string): Promise<any[]> {
        const now = new Date();
        const until = new Date();
        until.setDate(until.getDate() + daysAhead);
        const where: string[] = [
            'fc.is_cancelled = false',
            'fc.scheduled_at >= NOW()',
            'fc.scheduled_at <= $1::timestamp',
            'fc.available_spots > 0',
        ];
        const params: any[] = [until.toISOString()];
        let i = 2;
        if (classType) { where.push(`fc.class_type ILIKE $${i++}`); params.push(`%${classType}%`); }
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, name, class_type, instructor_name, scheduled_at,
                    duration_minutes, available_spots, max_capacity, room, level
             FROM fitness_classes fc
             WHERE ${where.join(' AND ')}
             ORDER BY scheduled_at
             LIMIT 30`,
            params,
        );
    }
}
