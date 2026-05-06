import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Treatment Plans — multi-session treatments (orthodontics, physiotherapy,
 * aesthetic series, etc.) with per-session tracking and progress reporting
 * surface for the AI agent and the dashboard.
 *
 * Sessions can either:
 *  - exist as standalone scheduled rows (no appointment_id) — useful when
 *    the patient hasn't picked a specific date yet
 *  - link to a real appointment via appointment_id — when they're booked
 *
 * Completion of a session bumps completed_sessions on the parent plan;
 * when completed === total, the plan auto-marks as 'completed'.
 */
@Injectable()
export class TreatmentPlansService {
    private readonly logger = new Logger(TreatmentPlansService.name);

    constructor(private readonly prisma: PrismaService) {}

    // ── Plans ────────────────────────────────────────────────────

    async listForContact(schemaName: string, contactId: string): Promise<any[]> {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM treatment_plans WHERE contact_id = $1::uuid ORDER BY created_at DESC`,
            [contactId],
        );
    }

    async getById(schemaName: string, planId: string): Promise<any | null> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM treatment_plans WHERE id = $1::uuid`,
            [planId],
        );
        return rows?.[0] || null;
    }

    async create(schemaName: string, data: {
        contactId: string;
        name: string;
        planType?: string;
        totalSessions: number;
        frequencyDays?: number;
        totalCost?: number;
        currency?: string;
        startedAt?: string;
        notes?: string;
    }): Promise<any> {
        if (!data.contactId || !data.name || !data.totalSessions) {
            throw new BadRequestException('contactId, name and totalSessions are required');
        }
        if (data.totalSessions < 1) {
            throw new BadRequestException('totalSessions must be at least 1');
        }

        const expectedEnd = data.startedAt && data.frequencyDays
            ? this.addDays(data.startedAt, data.frequencyDays * data.totalSessions)
            : null;

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO treatment_plans (
                contact_id, name, plan_type, total_sessions, frequency_days,
                total_cost, currency, started_at, expected_end_at, notes
             ) VALUES (
                $1::uuid, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10
             ) RETURNING *`,
            [
                data.contactId, data.name, data.planType || null,
                data.totalSessions, data.frequencyDays || null,
                data.totalCost || null, data.currency || 'COP',
                data.startedAt || null, expectedEnd, data.notes || null,
            ],
        );
        return rows?.[0];
    }

    async update(schemaName: string, planId: string, data: any): Promise<any> {
        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;

        const fields: Record<string, string> = {
            name: 'name', planType: 'plan_type', totalSessions: 'total_sessions',
            frequencyDays: 'frequency_days', totalCost: 'total_cost',
            currency: 'currency', notes: 'notes', status: 'status',
        };
        for (const [jsKey, dbKey] of Object.entries(fields)) {
            if (data[jsKey] !== undefined) {
                sets.push(`"${dbKey}" = $${idx}`);
                params.push(data[jsKey]);
                idx++;
            }
        }
        const dateFields: Record<string, string> = {
            startedAt: 'started_at', expectedEndAt: 'expected_end_at', completedAt: 'completed_at',
        };
        for (const [jsKey, dbKey] of Object.entries(dateFields)) {
            if (data[jsKey] !== undefined) {
                sets.push(`"${dbKey}" = $${idx}::date`);
                params.push(data[jsKey]);
                idx++;
            }
        }

        if (sets.length === 0) return this.getById(schemaName, planId);
        sets.push(`updated_at = NOW()`);
        params.push(planId);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE treatment_plans SET ${sets.join(', ')} WHERE id = $${idx}::uuid RETURNING *`,
            params,
        );
        return rows?.[0];
    }

    async delete(schemaName: string, planId: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE treatment_plans SET status = 'cancelled', updated_at = NOW() WHERE id = $1::uuid`,
            [planId],
        );
    }

    // ── Sessions ─────────────────────────────────────────────────

    async listSessions(schemaName: string, planId: string): Promise<any[]> {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM treatment_sessions WHERE plan_id = $1::uuid ORDER BY session_number`,
            [planId],
        );
    }

    async addSession(schemaName: string, planId: string, data: {
        scheduledAt?: string;
        appointmentId?: string;
        notes?: string;
    }): Promise<any> {
        const plan = await this.getById(schemaName, planId);
        if (!plan) throw new NotFoundException('Plan not found');

        // Auto-assign session number based on existing sessions
        const counts = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT COUNT(*)::int AS n FROM treatment_sessions WHERE plan_id = $1::uuid`,
            [planId],
        );
        const nextNumber = (counts?.[0]?.n || 0) + 1;
        if (nextNumber > plan.total_sessions) {
            throw new BadRequestException({
                error: 'plan_full',
                message: `Plan already has ${plan.total_sessions} sessions. Increase total_sessions before adding more.`,
            });
        }

        const status = data.scheduledAt ? 'scheduled' : 'pending';
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO treatment_sessions (plan_id, appointment_id, session_number, scheduled_at, status, notes)
             VALUES ($1::uuid, $2::uuid, $3, $4::timestamp, $5, $6) RETURNING *`,
            [planId, data.appointmentId || null, nextNumber, data.scheduledAt || null, status, data.notes || null],
        );
        return rows?.[0];
    }

    async completeSession(schemaName: string, sessionId: string): Promise<any> {
        const sessionRows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE treatment_sessions
             SET status = 'completed', completed_at = NOW(), updated_at = NOW()
             WHERE id = $1::uuid AND status != 'completed'
             RETURNING *`,
            [sessionId],
        );
        const session = sessionRows?.[0];
        if (!session) throw new NotFoundException('Session not found or already completed');

        // Bump parent plan's completed counter; auto-complete when full.
        const planRows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE treatment_plans
             SET completed_sessions = completed_sessions + 1,
                 status = CASE
                     WHEN completed_sessions + 1 >= total_sessions THEN 'completed'
                     ELSE status
                 END,
                 completed_at = CASE
                     WHEN completed_sessions + 1 >= total_sessions THEN CURRENT_DATE
                     ELSE completed_at
                 END,
                 updated_at = NOW()
             WHERE id = $1::uuid RETURNING *`,
            [session.plan_id],
        );

        return { session, plan: planRows?.[0] };
    }

    async cancelSession(schemaName: string, sessionId: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE treatment_sessions SET status = 'cancelled', updated_at = NOW() WHERE id = $1::uuid`,
            [sessionId],
        );
    }

    // ── Read helpers for AI tools / dashboard ────────────────────

    /** Active plan summary for one contact, with progress + next session. */
    async summaryForContact(schemaName: string, contactId: string): Promise<any | null> {
        const plans = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM treatment_plans
             WHERE contact_id = $1::uuid AND status = 'active'
             ORDER BY started_at DESC LIMIT 1`,
            [contactId],
        );
        const plan = plans?.[0];
        if (!plan) return null;

        const upcoming = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM treatment_sessions
             WHERE plan_id = $1::uuid AND status IN ('pending','scheduled')
             ORDER BY session_number LIMIT 5`,
            [plan.id],
        );

        return {
            plan,
            sessionsLeft: plan.total_sessions - plan.completed_sessions,
            upcomingSessions: upcoming || [],
        };
    }

    private addDays(dateStr: string, days: number): string {
        const d = new Date(dateStr + 'T00:00:00');
        d.setDate(d.getDate() + days);
        return d.toISOString().split('T')[0];
    }
}
