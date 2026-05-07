import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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

    constructor(private readonly prisma: PrismaService) {}

    async listRequests(schemaName: string, opts: { status?: string; urgency?: string; limit?: number } = {}): Promise<any[]> {
        const where: string[] = [];
        const params: any[] = [];
        let i = 1;
        if (opts.status) { where.push(`status = $${i++}`); params.push(opts.status); }
        if (opts.urgency) { where.push(`urgency = $${i++}`); params.push(opts.urgency); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const limit = Math.min(opts.limit || 100, 500);
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM service_requests ${whereSql} ORDER BY
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
    }

    async getRequestById(schemaName: string, id: string): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName, `SELECT * FROM service_requests WHERE id = $1::uuid`, [id],
        );
        return rows[0] || null;
    }

    async createRequest(schemaName: string, data: any): Promise<any> {
        if (!data.serviceType) throw new BadRequestException('serviceType is required');
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO service_requests (
                contact_id, conversation_id, service_type, urgency,
                customer_name, customer_phone, address, address_notes, city,
                issue_description, preferred_date, preferred_time_window,
                estimated_duration_minutes, estimated_cost
             ) VALUES (
                $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10,
                $11::date, $12, $13, $14
             ) RETURNING *`,
            [
                data.contactId || null, data.conversationId || null,
                data.serviceType, data.urgency || 'normal',
                data.customerName || null, data.customerPhone || null,
                data.address || null, data.addressNotes || null, data.city || null,
                data.issueDescription || null,
                data.preferredDate || null, data.preferredTimeWindow || null,
                data.estimatedDurationMinutes ?? null, data.estimatedCost ?? null,
            ],
        );
        return rows[0];
    }

    async updateRequest(schemaName: string, id: string, data: any): Promise<any> {
        const fields: string[] = [];
        const values: any[] = [];
        let i = 1;
        const map: Record<string, string> = {
            urgency: 'urgency', address: 'address', addressNotes: 'address_notes',
            city: 'city', issueDescription: 'issue_description',
            preferredDate: 'preferred_date', preferredTimeWindow: 'preferred_time_window',
            estimatedDurationMinutes: 'estimated_duration_minutes',
            estimatedCost: 'estimated_cost',
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
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE service_requests SET ${fields.join(', ')} WHERE id = $${i}::uuid RETURNING *`,
            values,
        );
        if (!rows.length) throw new NotFoundException('Request not found');
        return rows[0];
    }
}
