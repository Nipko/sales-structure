import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import {
    normalizeCurrencyCode,
    optionalPositiveIntegerUnit,
} from '../../common/utils/commercial-units.util';
import {
    assertOptionalContactId,
    requireTenantContact,
} from '../../common/utils/tenant-contact.util';
import {
    serializeLocalTimestampFields,
    serializeLocalTimestampRows,
} from '../../common/utils/local-timestamp.util';
import { resolveNativeEvidenceOpportunity } from '../../common/utils/native-evidence-opportunity.util';

const PHOTO_LOCAL_TIMESTAMPS = ['scheduled_at', 'delivered_at'] as const;

const PHOTO_SESSION_STATUSES = [
    'requested',
    'scheduled',
    'in_progress',
    'delivered',
    'cancelled',
] as const;
type PhotoSessionStatus = typeof PHOTO_SESSION_STATUSES[number];

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

    constructor(
        private readonly prisma: PrismaService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

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
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT s.*, c.name AS contact_name, c.phone AS contact_phone,
                    to_char(s.scheduled_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS scheduled_at_text,
                    to_char(s.delivered_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS delivered_at_text
             FROM photo_sessions s
             LEFT JOIN contacts c ON c.id = s.contact_id
             WHERE ${where.join(' AND ')}
             ORDER BY
                CASE s.status
                    WHEN 'requested' THEN 1
                    WHEN 'in_progress' THEN 2
                    WHEN 'scheduled' THEN 3
                    WHEN 'delivered' THEN 4
                    WHEN 'cancelled' THEN 5
                    ELSE 6
                END,
                COALESCE(s.scheduled_at, s.created_at) DESC
             LIMIT ${limit}`,
            params,
        );
        return serializeLocalTimestampRows(rows, PHOTO_LOCAL_TIMESTAMPS);
    }

    async countsByStatus(schemaName: string): Promise<Record<string, number>> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT status, COUNT(*)::int AS n FROM photo_sessions GROUP BY status`,
            [],
        );
        const out: Record<string, number> = {
            requested: 0,
            scheduled: 0,
            in_progress: 0,
            delivered: 0,
            cancelled: 0,
        };
        for (const row of rows || []) out[row.status] = row.n;
        return out;
    }

    async getById(schemaName: string, id: string): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT s.*, c.name AS contact_name, c.phone AS contact_phone,
                    to_char(s.scheduled_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS scheduled_at_text,
                    to_char(s.delivered_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS delivered_at_text
             FROM photo_sessions s
             LEFT JOIN contacts c ON c.id = s.contact_id
             WHERE s.id = $1::uuid`,
            [id],
        );
        return serializeLocalTimestampFields(rows[0], PHOTO_LOCAL_TIMESTAMPS);
    }

    async create(schemaName: string, data: any): Promise<any> {
        if (!data.sessionType) throw new BadRequestException('sessionType is required');
        const durationMinutes = optionalPositiveIntegerUnit(data.durationMinutes, 'durationMinutes');
        const currency = normalizeCurrencyCode(data.currency);
        const contactId = assertOptionalContactId(data.contactId);
        const status = this.assertStatus(data.status ?? 'scheduled');
        if (status === 'scheduled' && !data.scheduledAt) {
            throw new BadRequestException('scheduledAt is required when status is scheduled');
        }
        const sql = `INSERT INTO photo_sessions (
                contact_id, opportunity_id, conversation_id, session_type, package_name,
                package_description, client_name, client_phone, scheduled_at,
                duration_minutes, location, deliverables, deliverable_count,
                delivery_due_at, price, currency, deposit_paid, notes, status
             ) VALUES (
                $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9::timestamp,
                $10, $11, $12::jsonb, $13, $14::date, $15, $16, $17, $18, $19
             ) RETURNING *,
                to_char(scheduled_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS scheduled_at_text,
                to_char(delivered_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS delivered_at_text`;
        const baseParams = [
                data.sessionType,
                data.packageName || null,
                data.packageDescription || null,
                data.clientName || null,
                data.clientPhone || null,
                data.scheduledAt || null,
                durationMinutes,
                data.location || null,
                JSON.stringify(data.deliverables || []),
                data.deliverableCount ?? null,
                data.deliveryDueAt || null,
                data.price ?? null,
                currency,
                data.depositPaid ?? 0,
                data.notes || null,
                status,
            ];
        const rows = contactId || data.opportunityId
            ? await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
                const canonicalContactId = await requireTenantContact(query, contactId);
                const opportunityId = await resolveNativeEvidenceOpportunity(query, {
                    contactId: canonicalContactId,
                    conversationId: data.conversationId,
                    trustedOpportunityId: data.opportunityId,
                });
                return query<any[]>(sql, [
                    canonicalContactId,
                    opportunityId,
                    data.conversationId || null,
                    ...baseParams,
                ]);
            })
            : await this.prisma.executeInTenantSchema<any[]>(schemaName, sql, [
                null,
                null,
                data.conversationId || null,
                ...baseParams,
            ]);
        const session = rows[0];
        if (!session) throw new Error('Photo session was not created');
        if (status === 'requested') {
            try {
                this.eventEmitter.emit('photo_session.requested', {
                    tenantSchemaName: schemaName,
                    schemaName,
                    sessionId: session.id,
                    contactId,
                    conversationId: data.conversationId || null,
                    sessionType: data.sessionType,
                    packageName: data.packageName || null,
                    date: data.scheduledAt || null,
                    location: data.location || null,
                    customerName: data.clientName || null,
                    customerPhone: data.clientPhone || null,
                    specialRequests: data.notes || null,
                });
            } catch (error: any) {
                this.logger.error(`photo_session.requested listener failed after commit: ${error.message}`);
            }
        }
        return serializeLocalTimestampFields(session, PHOTO_LOCAL_TIMESTAMPS);
    }

    async update(schemaName: string, id: string, data: any): Promise<any> {
        if (data.status !== undefined) {
            data = { ...data, status: this.assertStatus(data.status) };
        }
        if (data.durationMinutes !== undefined && data.durationMinutes !== null) {
            data = {
                ...data,
                durationMinutes: optionalPositiveIntegerUnit(data.durationMinutes, 'durationMinutes'),
            };
        }
        if (data.currency !== undefined) {
            data = { ...data, currency: normalizeCurrencyCode(data.currency) };
        }
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
        const session = await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const existing = await query<Array<{ status: string; scheduled_at: string | Date | null }>>(
                `SELECT status, scheduled_at
                   FROM photo_sessions
                  WHERE id = $1::uuid
                  FOR UPDATE`,
                [id],
            );
            if (!existing.length) throw new NotFoundException('Session not found');

            const finalStatus = data.status !== undefined ? data.status : existing[0].status;
            const finalScheduledAt = data.scheduledAt !== undefined
                ? data.scheduledAt
                : existing[0].scheduled_at;
            if (finalStatus === 'scheduled' && !finalScheduledAt) {
                throw new BadRequestException('scheduledAt is required when status is scheduled');
            }

            const rows = await query<any[]>(
                `UPDATE photo_sessions SET ${fields.join(', ')} WHERE id = $${i}::uuid
                 RETURNING *,
                    to_char(scheduled_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS scheduled_at_text,
                    to_char(delivered_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS delivered_at_text`,
                values,
            );
            if (!rows.length) throw new NotFoundException('Session not found');
            return rows[0];
        });
        return serializeLocalTimestampFields(session, PHOTO_LOCAL_TIMESTAMPS);
    }

    async markDelivered(schemaName: string, id: string, galleryUrl: string, galleryPassword?: string): Promise<any> {
        return this.update(schemaName, id, {
            status: 'delivered',
            galleryUrl,
            galleryPassword,
            deliveredAt: new Date().toISOString(),
        });
    }

    private assertStatus(value: unknown): PhotoSessionStatus {
        if (typeof value !== 'string' || !PHOTO_SESSION_STATUSES.includes(value as PhotoSessionStatus)) {
            throw new BadRequestException(`Invalid photo session status: ${String(value ?? '')}`);
        }
        return value as PhotoSessionStatus;
    }
}
