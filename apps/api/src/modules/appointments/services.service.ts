import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'crypto';

export interface BookableService {
    id: string;
    name: string;
    description: string | null;
    durationMinutes: number;
    bufferMinutes: number;
    price: number;
    currency: string;
    color: string;
    isActive: boolean;
    sortOrder: number;
    category: string | null;
    maxConcurrent: number;
    requiredFields: string[];
}

@Injectable()
export class ServicesService {
    private readonly logger = new Logger(ServicesService.name);

    constructor(private prisma: PrismaService) {}

    async list(schemaName: string, activeOnly = false): Promise<BookableService[]> {
        let sql = `SELECT * FROM services`;
        if (activeOnly) sql += ` WHERE is_active = true`;
        sql += ` ORDER BY sort_order ASC, name ASC`;

        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName, sql, []);
        return (rows || []).map(this.mapRow);
    }

    async getById(schemaName: string, serviceId: string): Promise<BookableService> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT * FROM services WHERE id = $1::uuid`, [serviceId],
        );
        if (!rows?.[0]) throw new NotFoundException('Service not found');
        return this.mapRow(rows[0]);
    }

    async create(schemaName: string, data: any): Promise<BookableService> {
        const id = randomUUID();
        const duration = data.durationMinutes || data.duration || 30;
        const buffer = data.bufferMinutes || data.buffer || 0;
        await this.prisma.executeInTenantSchema(schemaName,
            `INSERT INTO services (id, name, description, duration_minutes, buffer_minutes, price, currency, color, category, max_concurrent, required_fields, created_at, updated_at)
             VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, NOW(), NOW())`,
            [id, data.name, data.description || null, duration,
             buffer, data.price || 0, data.currency || 'COP', data.color || '#6c5ce7',
             data.category || null, data.maxConcurrent || 1,
             JSON.stringify(data.requiredFields || [])],
        );
        return this.getById(schemaName, id);
    }

    async update(schemaName: string, serviceId: string, data: any): Promise<BookableService> {
        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (data.name !== undefined) { sets.push(`name = $${idx++}`); params.push(data.name); }
        if (data.description !== undefined) { sets.push(`description = $${idx++}`); params.push(data.description); }
        const dur = data.durationMinutes ?? data.duration;
        if (dur !== undefined) { sets.push(`duration_minutes = $${idx++}`); params.push(dur); }
        const buf = data.bufferMinutes ?? data.buffer;
        if (buf !== undefined) { sets.push(`buffer_minutes = $${idx++}`); params.push(buf); }
        if (data.price !== undefined) { sets.push(`price = $${idx++}`); params.push(data.price); }
        if (data.currency !== undefined) { sets.push(`currency = $${idx++}`); params.push(data.currency); }
        if (data.color !== undefined) { sets.push(`color = $${idx++}`); params.push(data.color); }
        const active = data.isActive ?? data.active;
        if (active !== undefined) { sets.push(`is_active = $${idx++}`); params.push(active); }
        if (data.sortOrder !== undefined) { sets.push(`sort_order = $${idx++}`); params.push(data.sortOrder); }
        if (data.category !== undefined) { sets.push(`category = $${idx++}`); params.push(data.category || null); }
        if (data.maxConcurrent !== undefined) { sets.push(`max_concurrent = $${idx++}`); params.push(data.maxConcurrent); }
        if (data.requiredFields !== undefined) { sets.push(`required_fields = $${idx++}::jsonb`); params.push(JSON.stringify(data.requiredFields)); }
        sets.push(`updated_at = NOW()`);

        params.push(serviceId);
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE services SET ${sets.join(', ')} WHERE id = $${idx}::uuid`, params,
        );
        return this.getById(schemaName, serviceId);
    }

    async delete(schemaName: string, serviceId: string): Promise<void> {
        await this.prisma.executeInTenantSchema(schemaName,
            `DELETE FROM services WHERE id = $1::uuid`, [serviceId],
        );
    }

    // ── Service-Staff Assignment ────────────────────────────────

    async getStaff(schemaName: string, serviceId: string): Promise<any[]> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT ss.id, ss.user_id, ss.is_primary, ss.sort_order,
                    u.first_name, u.last_name, u.email
             FROM service_staff ss
             JOIN public.users u ON u.id = ss.user_id
             WHERE ss.service_id = $1::uuid
             ORDER BY ss.sort_order ASC, u.first_name ASC`,
            [serviceId],
        );
        return (rows || []).map(r => ({
            id: r.id,
            userId: r.user_id,
            isPrimary: r.is_primary,
            sortOrder: r.sort_order,
            firstName: r.first_name,
            lastName: r.last_name,
            email: r.email,
        }));
    }

    async assignStaff(schemaName: string, serviceId: string, userId: string, isPrimary = false): Promise<void> {
        const id = randomUUID();
        await this.prisma.executeInTenantSchema(schemaName,
            `INSERT INTO service_staff (id, service_id, user_id, is_primary)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
             ON CONFLICT (service_id, user_id) DO UPDATE SET is_primary = $4`,
            [id, serviceId, userId, isPrimary],
        );
    }

    async removeStaff(schemaName: string, serviceId: string, userId: string): Promise<void> {
        await this.prisma.executeInTenantSchema(schemaName,
            `DELETE FROM service_staff WHERE service_id = $1::uuid AND user_id = $2::uuid`,
            [serviceId, userId],
        );
    }

    // ── Public: list active services by tenant slug ─────────────

    async listPublicBySlug(tenantSlug: string): Promise<BookableService[]> {
        const tenant = await this.prisma.$queryRaw<any[]>`
            SELECT schema_name FROM tenants WHERE slug = ${tenantSlug} AND is_active = true LIMIT 1
        `;
        if (!tenant?.[0]) return [];
        return this.list(tenant[0].schema_name, true);
    }

    private mapRow(row: any): BookableService {
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            durationMinutes: row.duration_minutes,
            bufferMinutes: row.buffer_minutes,
            price: parseFloat(row.price || '0'),
            currency: row.currency,
            color: row.color,
            isActive: row.is_active,
            sortOrder: row.sort_order,
            category: row.category || null,
            maxConcurrent: row.max_concurrent || 1,
            requiredFields: row.required_fields || [],
        };
    }
}
