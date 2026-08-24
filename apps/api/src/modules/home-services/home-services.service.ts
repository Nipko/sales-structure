import {
    Injectable,
    Logger,
    BadRequestException,
    ConflictException,
    NotFoundException,
} from '@nestjs/common';
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
import {
    HomeServiceCatalogUnavailableError,
    HomeServiceSlotUnavailableError,
    inspectHomeServiceCapacity,
    lockAndAssertHomeServiceCapacity,
} from './home-service-capacity';

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

    async listCapacityServices(schemaName: string): Promise<Array<{
        id: string;
        name: string;
        category: string;
        durationMinutes: number;
        maxConcurrent: number;
    }>> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, name, COALESCE(category, 'otro') AS category,
                    duration_minutes::int,
                    COALESCE(max_concurrent, 1)::int AS max_concurrent
               FROM services
              WHERE is_active = true
                AND duration_minutes > 0
              ORDER BY sort_order, name`,
            [],
        );
        return rows.map(row => ({
            id: row.id,
            name: row.name,
            category: row.category,
            durationMinutes: Number(row.duration_minutes),
            maxConcurrent: Math.max(1, Number(row.max_concurrent) || 1),
        }));
    }

    async checkAvailability(schemaName: string, input: {
        serviceId: string;
        startAt: string;
        assignedTechnicianId?: string | null;
    }) {
        return inspectHomeServiceCapacity(
            <T>(sql: string, params: unknown[] = []) => (
                this.prisma.executeInTenantSchema<T>(schemaName, sql, params)
            ),
            { schemaName, ...input },
        );
    }

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
        const scheduledAt = data.scheduledAt === undefined || data.scheduledAt === null
            ? null
            : this.validateScheduledAt(data.scheduledAt);
        const status = data.status || (scheduledAt ? 'scheduled' : 'pending');
        if (status === 'scheduled' && !scheduledAt) {
            throw new BadRequestException('scheduledAt is required when status is scheduled');
        }
        if (status === 'scheduled' && !data.serviceId) {
            throw new BadRequestException('serviceId is required when status is scheduled');
        }
        let estimatedDurationMinutes = optionalPositiveIntegerUnit(
            data.estimatedDurationMinutes,
            'estimatedDurationMinutes',
        );
        const currency = normalizeCurrencyCode(data.currency);
        const contactId = assertOptionalContactId(data.contactId);
        const sql = `INSERT INTO service_requests (
                contact_id, opportunity_id, conversation_id, service_id, service_type, urgency,
                customer_name, customer_phone, address, address_notes, city,
                issue_description, preferred_date, preferred_time_window,
                estimated_duration_minutes, estimated_cost, currency,
                scheduled_at, status
             ) VALUES (
                 $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10, $11, $12,
                 $13::date, $14, $15, $16, $17, $18::timestamp, $19
             ) RETURNING *,
                 to_char(scheduled_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS scheduled_at_text,
                 to_char(completed_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS completed_at_text`;
        let effectiveServiceType = data.serviceType;
        const buildParams = (canonicalContactId: string | null, opportunityId: string | null) => [
                canonicalContactId,
                opportunityId,
                data.conversationId || null,
                data.serviceId || null,
                effectiveServiceType,
                data.urgency || 'normal',
                data.customerName || null, data.customerPhone || null,
                data.address || null, data.addressNotes || null, data.city || null,
                data.issueDescription || null,
                data.preferredDate || null, data.preferredTimeWindow || null,
                estimatedDurationMinutes, data.estimatedCost ?? null, currency,
                scheduledAt, status,
            ];

        let rows: any[];
        try {
            rows = contactId || data.opportunityId || status === 'scheduled'
                ? await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
                const canonicalContactId = await requireTenantContact(query, contactId);
                const opportunityId = await resolveNativeEvidenceOpportunity(query, {
                    contactId: canonicalContactId,
                    conversationId: data.conversationId,
                    trustedOpportunityId: data.opportunityId,
                });
                if (status === 'scheduled') {
                    const capacity = await lockAndAssertHomeServiceCapacity(query, {
                        schemaName,
                        serviceId: data.serviceId,
                        startAt: scheduledAt!,
                        assignedTechnicianId: data.assignedTechnicianId || null,
                    });
                    estimatedDurationMinutes = capacity.service.durationMinutes;
                    effectiveServiceType = capacity.service.category;
                }
                return query<any[]>(sql, buildParams(canonicalContactId, opportunityId));
            })
                : await this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    sql,
                    buildParams(null, null),
                );
        } catch (error) {
            this.rethrowCapacityError(error);
        }
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
        const map: Record<string, string> = {
            serviceId: 'service_id',
            serviceType: 'service_type',
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
        if (!Object.keys(map).some(key => key in data)) return this.getRequestById(schemaName, id);

        let request: any;
        try {
            request = await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const existing = await query<Array<{
                status: string;
                scheduled_at: string | Date | null;
                scheduled_at_text: string | null;
                service_id: string | null;
                service_type: string;
                assigned_technician_id: string | null;
            }>>(
                `SELECT status, scheduled_at,
                        to_char(scheduled_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS scheduled_at_text,
                        service_id, service_type, assigned_technician_id
                   FROM service_requests
                  WHERE id = $1::uuid
                  FOR UPDATE`,
                [id],
            );
            if (!existing.length) throw new NotFoundException('Request not found');

            const finalStatus = data.status !== undefined ? data.status : existing[0].status;
            const finalScheduledAt = data.scheduledAt !== undefined
                ? data.scheduledAt
                : existing[0].scheduled_at_text || existing[0].scheduled_at;
            const finalServiceId = data.serviceId !== undefined
                ? data.serviceId
                : existing[0].service_id;
            if (finalStatus === 'scheduled' && !finalScheduledAt) {
                throw new BadRequestException('scheduledAt is required when status is scheduled');
            }
            if (finalStatus === 'scheduled' && !finalServiceId) {
                throw new BadRequestException('serviceId is required when status is scheduled');
            }

            let effectiveData = { ...data };
            if (finalStatus === 'scheduled') {
                const capacity = await lockAndAssertHomeServiceCapacity(query, {
                    schemaName,
                    serviceId: finalServiceId,
                    startAt: String(finalScheduledAt),
                    assignedTechnicianId: data.assignedTechnicianId !== undefined
                        ? data.assignedTechnicianId
                        : existing[0].assigned_technician_id,
                    excludeRequestId: id,
                });
                effectiveData = {
                    ...effectiveData,
                    serviceId: capacity.service.id,
                    serviceType: capacity.service.category,
                    estimatedDurationMinutes: capacity.service.durationMinutes,
                };
            }

            const fields: string[] = [];
            const values: any[] = [];
            let i = 1;
            for (const [key, column] of Object.entries(map)) {
                if (key in effectiveData) {
                    fields.push(`${column} = $${i++}`);
                    values.push(effectiveData[key]);
                }
            }
            fields.push('updated_at = NOW()');
            values.push(id);

            const rows = await query<any[]>(
                `UPDATE service_requests SET ${fields.join(', ')} WHERE id = $${i}::uuid
                 RETURNING *,
                    to_char(scheduled_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS scheduled_at_text,
                    to_char(completed_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS completed_at_text`,
                values,
            );
            return rows[0];
        });
        } catch (error) {
            this.rethrowCapacityError(error);
        }
        return serializeLocalTimestampFields(request, HOME_SERVICE_LOCAL_TIMESTAMPS);
    }

    private rethrowCapacityError(error: unknown): never {
        if (error instanceof HomeServiceSlotUnavailableError) {
            throw new ConflictException({ error: error.code, message: error.message });
        }
        if (error instanceof HomeServiceCatalogUnavailableError) {
            throw new BadRequestException({ error: error.code, message: error.message });
        }
        throw error;
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
