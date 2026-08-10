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

const HOME_SERVICE_LOCAL_TIMESTAMPS = ['scheduled_at', 'completed_at'] as const;

/**
 * Home services dispatch service for plomería / electricidad /
 * fumigación / limpieza tenants. Uses the per-tenant service_requests
 * table to track field-dispatch jobs from inbound (pending) through
 * scheduled → dispatched → in_progress → completed.
 *
 * Distinct from appointments: home services are field jobs with
 * urgency, address, photo evidence, technician assignment, and a
 * status workflow that doesn't fit the appointment model.
 */
@Injectable()
export class HomeServicesService {
    private readonly logger = new Logger(HomeServicesService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    async listRequests(schemaName: string, opts: { status?: string; urgency?: string; limit?: number } = {}): Promise<any[]> {
        const where: string[] = [];
        const params: any[] = [];
        let i = 1;
        if (opts.status) { where.push(`status = $${i++}`); params.push(opts.status); }
        if (opts.urgency) { where.push(`urgency = $${i++}`); params.push(opts.urgency); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const limit = Math.min(opts.limit || 100, 500);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT service_requests.*,
                    to_char(scheduled_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS scheduled_at_text,
                    to_char(completed_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS completed_at_text
               FROM service_requests ${whereSql} ORDER BY
                CASE urgency
                    WHEN 'emergencia' THEN 1
                    WHEN 'alta' THEN 2
                    WHEN 'normal' THEN 3
                    WHEN 'flexible' THEN 4
                    ELSE 5
                END,
                COALESCE(scheduled_at, created_at) DESC
             LIMIT ${limit}`,
            params,
        );
        return serializeLocalTimestampRows(rows, HOME_SERVICE_LOCAL_TIMESTAMPS);
    }

    async getRequestById(schemaName: string, id: string): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT service_requests.*,
                    to_char(scheduled_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS scheduled_at_text,
                    to_char(completed_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS completed_at_text
               FROM service_requests WHERE id = $1::uuid`,
            [id],
        );
        return serializeLocalTimestampFields(rows[0], HOME_SERVICE_LOCAL_TIMESTAMPS);
    }

    async createRequest(schemaName: string, data: any): Promise<any> {
        if (!data.serviceType) throw new BadRequestException('serviceType is required');
        const status = data.status || 'pending';
        const scheduledAt = data.scheduledAt === undefined || data.scheduledAt === null
            ? null
            : this.validateScheduledAt(data.scheduledAt);
        if (status === 'scheduled' && !scheduledAt) {
            throw new BadRequestException('scheduledAt is required when status is scheduled');
        }
        const estimatedDurationMinutes = optionalPositiveIntegerUnit(
            data.estimatedDurationMinutes,
            'estimatedDurationMinutes',
        );
        const currency = normalizeCurrencyCode(data.currency);
        const contactId = assertOptionalContactId(data.contactId);
        const sql = `INSERT INTO service_requests (
                contact_id, opportunity_id, conversation_id, service_type, urgency,
                customer_name, customer_phone, address, address_notes, city,
                issue_description, preferred_date, preferred_time_window,
                estimated_duration_minutes, estimated_cost, currency,
                scheduled_at, status
             ) VALUES (
                 $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11,
                 $12::date, $13, $14, $15, $16, $17::timestamp, $18
             ) RETURNING *,
                 to_char(scheduled_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS scheduled_at_text,
                 to_char(completed_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS completed_at_text`;
        const baseParams = [
                data.serviceType, data.urgency || 'normal',
                data.customerName || null, data.customerPhone || null,
                data.address || null, data.addressNotes || null, data.city || null,
                data.issueDescription || null,
                data.preferredDate || null, data.preferredTimeWindow || null,
                estimatedDurationMinutes, data.estimatedCost ?? null, currency,
                scheduledAt, status,
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
        const request = rows[0];
        if (!request) throw new Error('Service request was not created');
        try {
            this.eventEmitter.emit('service_request.created', {
                requestId: request.id,
                tenantSchemaName: schemaName,
                schemaName,
                contactId,
                conversationId: data.conversationId || null,
                urgency: request.urgency,
                serviceType: request.service_type,
            });
        } catch (error: any) {
            this.logger.error(`service_request.created listener failed after commit: ${error.message}`);
        }
        return serializeLocalTimestampFields(request, HOME_SERVICE_LOCAL_TIMESTAMPS);
    }

    async updateRequest(schemaName: string, id: string, data: any): Promise<any> {
        if (data.estimatedDurationMinutes !== undefined && data.estimatedDurationMinutes !== null) {
            data = {
                ...data,
                estimatedDurationMinutes: optionalPositiveIntegerUnit(
                    data.estimatedDurationMinutes,
                    'estimatedDurationMinutes',
                ),
            };
        }
        if (data.currency !== undefined) {
            data = { ...data, currency: normalizeCurrencyCode(data.currency) };
        }
        if (data.scheduledAt !== undefined && data.scheduledAt !== null) {
            data = { ...data, scheduledAt: this.validateScheduledAt(data.scheduledAt) };
        }
        const fields: string[] = [];
        const values: any[] = [];
        let i = 1;
        const map: Record<string, string> = {
            urgency: 'urgency', address: 'address', addressNotes: 'address_notes',
            city: 'city', issueDescription: 'issue_description',
            preferredDate: 'preferred_date', preferredTimeWindow: 'preferred_time_window',
            estimatedDurationMinutes: 'estimated_duration_minutes',
            estimatedCost: 'estimated_cost',
            currency: 'currency',
            assignedTechnicianId: 'assigned_technician_id',
            assignedTechnicianName: 'assigned_technician_name',
            scheduledAt: 'scheduled_at', completedAt: 'completed_at',
            status: 'status',
        };
        for (const [k, col] of Object.entries(map)) {
            if (k in data) { fields.push(`${col} = $${i++}`); values.push(data[k]); }
        }
        if (!fields.length) return this.getRequestById(schemaName, id);
        fields.push(`updated_at = NOW()`);
        values.push(id);
        const request = await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            // Lock the row while deriving the final state. The invariant must be
            // checked against the persisted scheduled_at when an update only
            // advances the status, without a new scheduledAt value.
            const existing = await query<Array<{ status: string; scheduled_at: string | Date | null }>>(
                `SELECT status, scheduled_at
                   FROM service_requests
                  WHERE id = $1::uuid
                  FOR UPDATE`,
                [id],
            );
            if (!existing.length) throw new NotFoundException('Request not found');

            const finalStatus = data.status !== undefined ? data.status : existing[0].status;
            const finalScheduledAt = data.scheduledAt !== undefined
                ? data.scheduledAt
                : existing[0].scheduled_at;
            if (finalStatus === 'scheduled' && !finalScheduledAt) {
                throw new BadRequestException('scheduledAt is required when status is scheduled');
            }

            const rows = await query<any[]>(
                `UPDATE service_requests SET ${fields.join(', ')} WHERE id = $${i}::uuid
                 RETURNING *,
                    to_char(scheduled_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS scheduled_at_text,
                    to_char(completed_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS completed_at_text`,
                values,
            );
            return rows[0];
        });
        return serializeLocalTimestampFields(request, HOME_SERVICE_LOCAL_TIMESTAMPS);
    }

    /**
     * Store exactly the submitted wall-clock components. The column is a
     * TIMESTAMP WITHOUT TIME ZONE, so a suffix must never turn 09:00 Bogotá
     * into a different hour through the database/session timezone.
     */
    private validateScheduledAt(value: unknown): string {
        if (typeof value !== 'string') {
            throw new BadRequestException('scheduledAt must be a valid ISO date-time');
        }
        const normalized = value.trim();
        const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?$/.exec(normalized);
        if (!match) {
            throw new BadRequestException('scheduledAt must be a valid ISO date-time');
        }

        const [, rawYear, rawMonth, rawDay, rawHour, rawMinute, rawSecond = '0'] = match;
        const year = Number(rawYear);
        const month = Number(rawMonth);
        const day = Number(rawDay);
        const hour = Number(rawHour);
        const minute = Number(rawMinute);
        const second = Number(rawSecond);
        const daysInMonth = month >= 1 && month <= 12
            ? new Date(Date.UTC(year, month, 0)).getUTCDate()
            : 0;
        if (
            day < 1 || day > daysInMonth
            || hour > 23 || minute > 59 || second > 59
        ) {
            throw new BadRequestException('scheduledAt must be a valid ISO date-time');
        }
        return `${rawYear}-${rawMonth}-${rawDay}T${rawHour}:${rawMinute}:${rawSecond.padStart(2, '0')}`;
    }
}
