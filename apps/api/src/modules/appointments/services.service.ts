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

    async create(schemaName: string, data: {
        name: string; description?: string; durationMinutes: number;
        bufferMinutes?: number; price?: number; currency?: string;
        color?: string;
    }): Promise<BookableService> {
        const id = randomUUID();
        await this.prisma.executeInTenantSchema(schemaName,
            `INSERT INTO services (id, name, description, duration_minutes, buffer_minutes, price, currency, color, created_at, updated_at)
             VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
            [id, data.name, data.description || null, data.durationMinutes,
             data.bufferMinutes || 0, data.price || 0, data.currency || 'COP', data.color || '#6c5ce7'],
        );
        return this.getById(schemaName, id);
    }

    async update(schemaName: string, serviceId: string, data: Partial<{
        name: string; description: string; durationMinutes: number;
        bufferMinutes: number; price: number; currency: string;
        color: string; isActive: boolean; sortOrder: number;
    }>): Promise<BookableService> {
        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (data.name !== undefined) { sets.push(`name = $${idx++}`); params.push(data.name); }
        if (data.description !== undefined) { sets.push(`description = $${idx++}`); params.push(data.description); }
        if (data.durationMinutes !== undefined) { sets.push(`duration_minutes = $${idx++}`); params.push(data.durationMinutes); }
        if (data.bufferMinutes !== undefined) { sets.push(`buffer_minutes = $${idx++}`); params.push(data.bufferMinutes); }
        if (data.price !== undefined) { sets.push(`price = $${idx++}`); params.push(data.price); }
        if (data.currency !== undefined) { sets.push(`currency = $${idx++}`); params.push(data.currency); }
        if (data.color !== undefined) { sets.push(`color = $${idx++}`); params.push(data.color); }
        if (data.isActive !== undefined) { sets.push(`is_active = $${idx++}`); params.push(data.isActive); }
        if (data.sortOrder !== undefined) { sets.push(`sort_order = $${idx++}`); params.push(data.sortOrder); }
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
        };
    }
}
