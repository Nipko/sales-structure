import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { randomUUID } from 'crypto';
import {
    normalizeCurrencyCode,
    optionalPositiveIntegerUnit,
    requirePositiveIntegerUnit,
} from '../../common/utils/commercial-units.util';

export type DurationType = 'fixed' | 'flexible' | 'open';

export interface BookableService {
    id: string;
    name: string;
    description: string | null;
    durationMinutes: number;
    durationMinutesMax: number | null;
    durationType: DurationType;
    bufferMinutes: number;
    price: number;
    currency: string;
    color: string;
    isActive: boolean;
    sortOrder: number;
    category: string | null;
    maxConcurrent: number;
    /** Cada cuantos dias conviene volver por este servicio. null = usa el default. */
    rebookAfterDays: number | null;
    requiredFields: string[];
}

@Injectable()
export class ServicesService {
    private readonly logger = new Logger(ServicesService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) {}

    async list(schemaName: string, activeOnly = false): Promise<BookableService[]> {
        let sql = `SELECT * FROM services`;
        if (activeOnly) sql += ` WHERE is_active = true`;
        sql += ` ORDER BY sort_order ASC, name ASC`;

        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName, sql, []);
        // Arrow por consistencia con appointments.service: mapRow hoy no usa
        // `this`, pero pasarlo sin bind es el patrón exacto que produjo el 500
        // del listado de citas.
        return (rows || []).map((r) => this.mapRow(r));
    }

    async getById(schemaName: string, serviceId: string): Promise<BookableService> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT * FROM services WHERE id = $1::uuid`, [serviceId],
        );
        if (!rows?.[0]) throw new NotFoundException('Service not found');
        return this.mapRow(rows[0]);
    }

    async create(schemaName: string, data: any, tenantId?: string): Promise<BookableService> {
        const id = randomUUID();
        const durationType: DurationType = data.durationType || 'fixed';
        if (!['fixed', 'flexible', 'open'].includes(durationType)) {
            throw new BadRequestException('durationType must be fixed, flexible, or open');
        }
        // `open` deliberately uses 0 as the persisted sentinel for day-level
        // availability. Fixed/flexible services always have a real minute unit.
        const duration = durationType === 'open'
            ? 0
            : requirePositiveIntegerUnit(data.durationMinutes ?? data.duration ?? 30, 'durationMinutes');
        const buffer = data.bufferMinutes || data.buffer || 0;
        const durationMax = durationType === 'flexible'
            ? optionalPositiveIntegerUnit(data.durationMinutesMax, 'durationMinutesMax')
            : null;
        if (durationMax !== null && durationMax < duration) {
            throw new BadRequestException('durationMinutesMax must be greater than or equal to durationMinutes');
        }
        const currency = normalizeCurrencyCode(data.currency);
        try {
            await this.prisma.executeInTenantSchema(schemaName,
                `INSERT INTO services (id, name, description, duration_minutes, buffer_minutes, price, currency, color, category, max_concurrent, required_fields, duration_type, duration_minutes_max, rebook_after_days, created_at, updated_at)
                 VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, NOW(), NOW())`,
                [id, data.name, data.description || null, duration,
                 buffer, data.price || 0, currency, data.color || '#6c5ce7',
                 data.category || null, data.maxConcurrent || 1,
                 JSON.stringify(data.requiredFields || []),
                 durationType, durationMax, data.rebookAfterDays ?? null],
            );
        } catch (e: any) {
            // uidx_services_name (tenant-schema.sql): el motor de reservas lista los
            // servicios por nombre, así que dos con el mismo nombre son indistinguibles
            // para el cliente. Sin este catch el usuario recibía un 500 crudo.
            if (`${e?.code || ''} ${e?.message || ''}`.includes('23505')) {
                throw new ConflictException(`Ya existe un servicio con el nombre "${data.name}"`);
            }
            throw e;
        }
        // Invalidate booking services cache so next conversation gets fresh list
        if (tenantId) await this.redis.del(`booking:services:${tenantId}`).catch(() => {});
        return this.getById(schemaName, id);
    }

    async update(schemaName: string, serviceId: string, data: any, tenantId?: string): Promise<BookableService> {
        const current = await this.getById(schemaName, serviceId);
        const nextDurationType = (data.durationType ?? current.durationType) as DurationType;
        if (!['fixed', 'flexible', 'open'].includes(nextDurationType)) {
            throw new BadRequestException('durationType must be fixed, flexible, or open');
        }
        const requestedDuration = data.durationMinutes ?? data.duration;
        const nextDuration = nextDurationType === 'open'
            ? 0
            : requirePositiveIntegerUnit(requestedDuration ?? current.durationMinutes, 'durationMinutes');
        const nextDurationMax = nextDurationType === 'flexible'
            ? optionalPositiveIntegerUnit(
                data.durationMinutesMax !== undefined
                    ? data.durationMinutesMax
                    : current.durationMinutesMax,
                'durationMinutesMax',
            )
            : null;
        if (nextDurationMax !== null && nextDurationMax < nextDuration) {
            throw new BadRequestException('durationMinutesMax must be greater than or equal to durationMinutes');
        }

        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (data.name !== undefined) { sets.push(`name = $${idx++}`); params.push(data.name); }
        if (data.description !== undefined) { sets.push(`description = $${idx++}`); params.push(data.description); }
        if (requestedDuration !== undefined || data.durationType !== undefined) {
            sets.push(`duration_minutes = $${idx++}`);
            params.push(nextDuration);
        }
        const buf = data.bufferMinutes ?? data.buffer;
        if (buf !== undefined) { sets.push(`buffer_minutes = $${idx++}`); params.push(buf); }
        if (data.price !== undefined) { sets.push(`price = $${idx++}`); params.push(data.price); }
        if (data.currency !== undefined) {
            sets.push(`currency = $${idx++}`);
            params.push(normalizeCurrencyCode(data.currency));
        }
        if (data.color !== undefined) { sets.push(`color = $${idx++}`); params.push(data.color); }
        const active = data.isActive ?? data.active;
        if (active !== undefined) { sets.push(`is_active = $${idx++}`); params.push(active); }
        if (data.sortOrder !== undefined) { sets.push(`sort_order = $${idx++}`); params.push(data.sortOrder); }
        if (data.category !== undefined) { sets.push(`category = $${idx++}`); params.push(data.category || null); }
        if (data.maxConcurrent !== undefined) { sets.push(`max_concurrent = $${idx++}`); params.push(data.maxConcurrent); }
        if (data.requiredFields !== undefined) { sets.push(`required_fields = $${idx++}::jsonb`); params.push(JSON.stringify(data.requiredFields)); }
        if (data.durationType !== undefined) { sets.push(`duration_type = $${idx++}`); params.push(nextDurationType); }
        // `$` obligatorio: sin él se interpolaba el ÍNDICE del parámetro como
        // literal SQL y duration_minutes_max quedaba en 2 o 3 (el índice) en vez
        // del valor real — corrompía las duraciones flexibles del booking engine.
        if (data.durationMinutesMax !== undefined || data.durationType !== undefined) {
            sets.push(`duration_minutes_max = $${idx++}`);
            params.push(nextDurationMax);
        }
        // 0 o vacio = "no aplica" y se guarda NULL, no 0: un 0 haria que el
        // evaluador temporal reclame la re-reserva el mismo dia de la cita.
        if (data.rebookAfterDays !== undefined) { sets.push(`rebook_after_days = $${idx++}`); params.push(Number(data.rebookAfterDays) > 0 ? Number(data.rebookAfterDays) : null); }
        sets.push(`updated_at = NOW()`);

        params.push(serviceId);
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE services SET ${sets.join(', ')} WHERE id = $${idx}::uuid`, params,
        );
        // Invalidate booking services cache
        if (tenantId) await this.redis.del(`booking:services:${tenantId}`).catch(() => {});
        return this.getById(schemaName, serviceId);
    }

    async delete(schemaName: string, serviceId: string, tenantId?: string): Promise<void> {
        await this.prisma.executeInTenantSchema(schemaName,
            `DELETE FROM services WHERE id = $1::uuid`, [serviceId],
        );
        // Invalidate booking services cache
        if (tenantId) await this.redis.del(`booking:services:${tenantId}`).catch(() => {});
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
            durationMinutesMax: row.duration_minutes_max || null,
            durationType: row.duration_type || 'fixed',
            bufferMinutes: row.buffer_minutes,
            price: parseFloat(row.price || '0'),
            currency: row.currency,
            color: row.color,
            isActive: row.is_active,
            sortOrder: row.sort_order,
            category: row.category || null,
            maxConcurrent: row.max_concurrent || 1,
            rebookAfterDays: row.rebook_after_days ?? null,
            requiredFields: row.required_fields || [],
        };
    }
}
