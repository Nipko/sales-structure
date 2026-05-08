import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Photography sessions service. Differentiates fotografia tenants from
 * generic appointments by tracking session type (wedding/portrait/event/
 * product/family/newborn), package contents, gallery delivery, and a
 * status workflow that ends with delivered (gallery URL shared).
 *
 * Distinct from appointments: photo sessions have a delivery deadline,
 * deliverable count, and a separate "delivered" terminal state. The AI
 * agent uses the AI tools to register inbound bookings; the dashboard
 * tracks delivery progress.
 */
@Injectable()
export class PhotographyService {
    private readonly logger = new Logger(PhotographyService.name);

    constructor(private readonly prisma: PrismaService) {}

    async listSessions(schemaName: string, opts: { status?: string; sessionType?: string; search?: string; limit?: number } = {}): Promise<any[]> {
        const where: string[] = ['1=1'];
        const params: any[] = [];
        let i = 1;
        if (opts.status && opts.status !== 'all') {
            where.push(`s.status = $${i++}`);
            params.push(opts.status);
        }
        if (opts.sessionType && opts.sessionType !== 'all') {
            where.push(`s.session_type = $${i++}`);
            params.push(opts.sessionType);
        }
        if (opts.search) {
            where.push(`(s.client_name ILIKE $${i} OR c.name ILIKE $${i} OR s.package_name ILIKE $${i})`);
            params.push(`%${opts.search}%`);
            i++;
        }
        const limit = Math.min(opts.limit || 100, 500);
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT s.*, c.name AS contact_name, c.phone AS contact_phone
             FROM photo_sessions s
             LEFT JOIN contacts c ON c.id = s.contact_id
             WHERE ${where.join(' AND ')}
             ORDER BY
                CASE s.status
                    WHEN 'in_progress' THEN 1
                    WHEN 'scheduled' THEN 2
                    WHEN 'delivered' THEN 3
                    WHEN 'cancelled' THEN 4
                    ELSE 5
                END,
                COALESCE(s.scheduled_at, s.created_at) DESC
             LIMIT ${limit}`,
            params,
        );
    }

    async countsByStatus(schemaName: string): Promise<Record<string, number>> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT status, COUNT(*)::int AS n FROM photo_sessions GROUP BY status`,
            [],
        );
        const out: Record<string, number> = { scheduled: 0, in_progress: 0, delivered: 0, cancelled: 0 };
        for (const row of rows || []) out[row.status] = row.n;
        return out;
    }

    async getById(schemaName: string, id: string): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT s.*, c.name AS contact_name, c.phone AS contact_phone
             FROM photo_sessions s
             LEFT JOIN contacts c ON c.id = s.contact_id
             WHERE s.id = $1::uuid`,
            [id],
        );
        return rows[0] || null;
    }

    async create(schemaName: string, data: any): Promise<any> {
        if (!data.sessionType) throw new BadRequestException('sessionType is required');
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO photo_sessions (
                contact_id, conversation_id, session_type, package_name,
                package_description, client_name, client_phone, scheduled_at,
                duration_minutes, location, deliverables, deliverable_count,
                delivery_due_at, price, currency, deposit_paid, notes, status
             ) VALUES (
                $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::timestamp,
                $9, $10, $11::jsonb, $12, $13::date, $14, $15, $16, $17, $18
             ) RETURNING *`,
            [
                data.contactId || null,
                data.conversationId || null,
                data.sessionType,
                data.packageName || null,
                data.packageDescription || null,
                data.clientName || null,
                data.clientPhone || null,
                data.scheduledAt || null,
                data.durationMinutes ?? null,
                data.location || null,
                JSON.stringify(data.deliverables || []),
                data.deliverableCount ?? null,
                data.deliveryDueAt || null,
                data.price ?? null,
                data.currency || 'COP',
                data.depositPaid ?? 0,
                data.notes || null,
                data.status || 'scheduled',
            ],
        );
        return rows[0];
    }

    async update(schemaName: string, id: string, data: any): Promise<any> {
        const fields: string[] = [];
        const values: any[] = [];
        let i = 1;
        const map: Record<string, string> = {
            sessionType: 'session_type', packageName: 'package_name',
            packageDescription: 'package_description', clientName: 'client_name',
            clientPhone: 'client_phone', durationMinutes: 'duration_minutes',
            location: 'location', deliverableCount: 'deliverable_count',
            deliveredCount: 'delivered_count', galleryUrl: 'gallery_url',
            galleryPassword: 'gallery_password', price: 'price',
            currency: 'currency', depositPaid: 'deposit_paid',
            status: 'status', notes: 'notes',
        };
        for (const [k, col] of Object.entries(map)) {
            if (k in data) { fields.push(`${col} = $${i++}`); values.push(data[k]); }
        }
        const dateMap: Record<string, string> = {
            scheduledAt: 'scheduled_at', deliveredAt: 'delivered_at',
        };
        for (const [k, col] of Object.entries(dateMap)) {
            if (k in data) { fields.push(`${col} = $${i++}::timestamp`); values.push(data[k]); }
        }
        if ('deliveryDueAt' in data) {
            fields.push(`delivery_due_at = $${i++}::date`);
            values.push(data.deliveryDueAt);
        }
        if ('deliverables' in data) {
            fields.push(`deliverables = $${i++}::jsonb`);
            values.push(JSON.stringify(data.deliverables));
        }
        if (!fields.length) return this.getById(schemaName, id);
        fields.push(`updated_at = NOW()`);
        values.push(id);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE photo_sessions SET ${fields.join(', ')} WHERE id = $${i}::uuid RETURNING *`,
            values,
        );
        if (!rows.length) throw new NotFoundException('Session not found');
        return rows[0];
    }

    async markDelivered(schemaName: string, id: string, galleryUrl: string, galleryPassword?: string): Promise<any> {
        return this.update(schemaName, id, {
            status: 'delivered',
            galleryUrl,
            galleryPassword,
            deliveredAt: new Date().toISOString(),
        });
    }
}
