import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { randomUUID } from 'crypto';
import {
    normalizeCurrencyCode,
    optionalPositiveIntegerUnit,
    requirePositiveIntegerUnit,
} from '../../common/utils/commercial-units.util';
import { assertActiveTenantUser } from './tenant-user-scope.util';
import { AGENT_QUALITY_DEPENDENCIES_UPDATED } from '../quality/agent-quality-events';
import { validatePaymentPolicyInput } from '../../common/utils/payment-policy.util';

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
    /** Si confirmar exige pago: none | full | deposit | any. */
    paymentPolicy: string;
    depositPercent: number | null;
    depositAmount: number | null;
    /**
     * De dónde salió el precio (D10): 'example' lo sembró la receta del rubro,
     * 'confirmed' lo puso o confirmó el dueño (0 = gratis), 'quote' se cotiza
     * según el caso. El agente solo dice precios 'confirmed'.
     */
    priceStatus: ServicePriceStatus;
}

export type ServicePriceStatus = 'example' | 'confirmed' | 'quote';
const OWNER_PRICE_STATUSES: readonly ServicePriceStatus[] = ['confirmed', 'quote'];

/**
 * What the owner may say about a price: confirmed or quote-only. 'example' is
 * provenance the recipe writes and a person cannot claim. Typing a price is a
 * confirmation on its own.
 */
export function resolvePriceStatusInput(data: any, current?: { priceStatus?: ServicePriceStatus; price?: number }): ServicePriceStatus {
    if (data?.priceStatus !== undefined && data?.priceStatus !== null) {
        if (!OWNER_PRICE_STATUSES.includes(data.priceStatus)) {
            throw new BadRequestException('priceStatus must be confirmed or quote');
        }
        return data.priceStatus;
    }
    if (data?.price !== undefined && data?.price !== null) {
        // The editor resends the whole form. Only a CHANGED number is a
        // decision; the same example amount coming back untouched is not
        // ("Usar así" never confirms a price).
        if (!current || Number(data.price) !== Number(current.price ?? 0)) return 'confirmed';
    }
    return current?.priceStatus ?? 'confirmed';
}

/**
 * The till derives every charge from the service's price. A deposit on an
 * example price would collect an invented amount, so a payment policy other
 * than 'none' needs a confirmed price first.
 */
export function assertPaymentPolicyNeedsConfirmedPrice(paymentPolicy: string, priceStatus: ServicePriceStatus): void {
    if ((paymentPolicy || 'none') === 'none' || priceStatus === 'confirmed') return;
    throw new BadRequestException({
        error: 'price_not_confirmed',
        message: priceStatus === 'quote'
            ? 'Un servicio que se cotiza según el caso no puede exigir pago para confirmar: fija un precio confirmado primero.'
            : 'Este precio es de ejemplo: confírmalo (o cámbialo) antes de exigir pago para confirmar.',
    });
}

@Injectable()
export class ServicesService {
    private readonly logger = new Logger(ServicesService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        @Optional() private readonly events?: EventEmitter2,
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
        const createPolicy = validatePaymentPolicyInput(data as any);
        if (createPolicy.error) throw new BadRequestException(createPolicy.error);
        const priceStatus = resolvePriceStatusInput(data);
        assertPaymentPolicyNeedsConfirmedPrice(createPolicy.values.payment_policy ?? 'none', priceStatus);
        try {
            await this.prisma.executeInTenantSchema(schemaName,
                `INSERT INTO services (id, name, description, duration_minutes, buffer_minutes, price, currency, color, category, max_concurrent, required_fields, duration_type, duration_minutes_max, rebook_after_days, payment_policy, deposit_percent, deposit_amount, price_status, created_at, updated_at)
                 VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW())`,
                [id, data.name, data.description || null, duration,
                 buffer, data.price || 0, currency, data.color || '#6c5ce7',
                 data.category || null, data.maxConcurrent || 1,
                 JSON.stringify(data.requiredFields || []),
                 durationType, durationMax, data.rebookAfterDays ?? null,
                 // Si el modal muestra la politica al crear, descartarla en
                 // silencio seria mentirle al dueno: cree que configuro una sena
                 // y el agente confirmaria gratis.
                 createPolicy.values.payment_policy ?? 'none',
                 createPolicy.values.deposit_percent ?? null,
                 createPolicy.values.deposit_amount ?? null,
                 priceStatus],
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
        if (tenantId) {
            await this.redis.del(`booking:services:${tenantId}`).catch(() => {});
            this.emitQualityDependency(tenantId);
        }
        return this.getById(schemaName, id);
    }

    async update(schemaName: string, serviceId: string, data: any, tenantId?: string): Promise<BookableService> {
        const current = await this.getById(schemaName, serviceId);
        const nextPriceStatus = resolvePriceStatusInput(data, current);
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
        // Editing the number confirms it; "Confirmar precio" confirms it without
        // retyping; "Se cotiza" withdraws any number from the agent's mouth.
        if (nextPriceStatus !== current.priceStatus) { sets.push(`price_status = $${idx++}`); params.push(nextPriceStatus); }
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
        const policy = validatePaymentPolicyInput(data as any);
        if (policy.error) throw new BadRequestException(policy.error);
        const effectivePolicy = policy.values.payment_policy ?? current.paymentPolicy ?? 'none';
        assertPaymentPolicyNeedsConfirmedPrice(effectivePolicy, nextPriceStatus);
        for (const [dbKey, value] of Object.entries(policy.values)) {
            sets.push(`${dbKey} = $${idx++}`);
            params.push(value);
        }
        sets.push(`updated_at = NOW()`);

        params.push(serviceId);
        // Two editors can race (no row lock here): when this write keeps a
        // paying policy without itself confirming the price, the row must
        // still be confirmed at write time, or the policy would sit on an
        // amount nobody confirmed.
        const settingStatus = nextPriceStatus !== current.priceStatus;
        const guard = effectivePolicy !== 'none' && !settingStatus ? ` AND COALESCE(price_status, 'confirmed') = 'confirmed'` : '';
        const updated = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `UPDATE services SET ${sets.join(', ')} WHERE id = $${idx}::uuid${guard} RETURNING id`, params,
        );
        if (guard && Array.isArray(updated) && updated.length === 0) assertPaymentPolicyNeedsConfirmedPrice(effectivePolicy, 'example');
        // Invalidate booking services cache
        if (tenantId) {
            await this.redis.del(`booking:services:${tenantId}`).catch(() => {});
            this.emitQualityDependency(tenantId);
        }
        return this.getById(schemaName, serviceId);
    }

    async delete(schemaName: string, serviceId: string, tenantId?: string): Promise<void> {
        try {
            // service_requests.service_id owns an ON DELETE RESTRICT FK. The
            // database is the concurrency boundary: if scheduling and deletion
            // race, PostgreSQL serializes the FK locks and permits only a state
            // without orphaned operational history.
            await this.prisma.executeInTenantSchema(schemaName,
                `DELETE FROM services WHERE id = $1::uuid`, [serviceId],
            );
        } catch (error: any) {
            const fingerprint = [
                error?.code,
                error?.meta?.code,
                error?.cause?.code,
                error?.message,
            ].filter(Boolean).join(' ');
            if (fingerprint.includes('23503')) {
                throw new ConflictException({
                    error: 'service_has_operational_history',
                    message: 'No se puede eliminar un servicio con reservas o solicitudes asociadas. Desactívalo para conservar su historial.',
                });
            }
            throw error;
        }
        // Invalidate booking services cache
        if (tenantId) {
            await this.redis.del(`booking:services:${tenantId}`).catch(() => {});
            this.emitQualityDependency(tenantId);
        }
    }

    // ── Service-Staff Assignment ────────────────────────────────

    async getStaff(schemaName: string, serviceId: string): Promise<any[]> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT ss.id, ss.user_id, ss.is_primary, ss.sort_order,
                    u.first_name, u.last_name, u.email
             FROM service_staff ss
             JOIN public.tenants tenant_owner
               ON tenant_owner.schema_name = $1
              AND tenant_owner.is_active = true
             JOIN public.users u
               ON u.id = ss.user_id
              AND u.tenant_id = tenant_owner.id
              AND u.is_active = true
             WHERE ss.service_id = $2::uuid
             ORDER BY ss.sort_order ASC, u.first_name ASC`,
            [schemaName, serviceId],
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
        await assertActiveTenantUser(this.prisma, schemaName, userId);
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
            // Sin esto el panel no puede mostrar lo que el dueno ya configuro y
            // cada guardado lo pisaria con el default.
            paymentPolicy: row.payment_policy || 'none',
            depositPercent: row.deposit_percent ?? null,
            depositAmount: row.deposit_amount != null ? Number(row.deposit_amount) : null,
            priceStatus: row.price_status || 'confirmed',
        };
    }

    private emitQualityDependency(tenantId: string): void {
        this.events?.emit(AGENT_QUALITY_DEPENDENCIES_UPDATED, {
            tenantId,
            source: 'services',
        });
    }
}
