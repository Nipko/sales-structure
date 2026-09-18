import { ensureOperationalNoticeOutbox, enqueueOperationalNotice, operationalContactWasErased } from '../operational-notices/operational-notice-outbox';
import { assertServedAgentAuthority, type ServedAgentAuthority } from '../persona/served-agent-authority';
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OperationConfirmationService } from '../email-templates/operation-confirmation.service';
import { normalizePhoneE164 } from '../../common/utils/phone.util';
import {
    requirePositiveIntegerUnit,
} from '../../common/utils/commercial-units.util';
import { resolveWriteCurrency, type OperatingCurrencySource } from '../../common/utils/write-currency.util';
import { RegionalProfileService } from '../tenants/regional-profile.service';
import { resolvePriceStatusInput } from '../appointments/services.service';
import { servicePriceStatus, storedPriceAmount, type ServicePriceStatus } from '../appointments/service-price-status';

function hasPriceValue(value: unknown): boolean {
    return value !== undefined && value !== null && value !== '';
}

/**
 * The price status an owner's write leaves on a plan: the services rule
 * (`resolvePriceStatusInput`), the same function, applied to plans.
 *
 *   · a CHANGED price is a confirmation;
 *   · the same price coming back with the rest of the form is not ("Usar así"
 *     never confirms anything), and neither is the placeholder 0 coming back;
 *   · the owner may send `priceStatus` 'confirmed' or 'quote', never 'example',
 *     which is provenance only the seed writes;
 *   · a price that does not exist cannot be confirmed. `membership_plans.price`
 *     is `NOT NULL DEFAULT 0` (tenant-schema.sql), so where D17 has no example
 *     amount the seed writes 0 + 'example', and "se cotiza" stores 0 + 'quote':
 *     placeholders, not "free" (`decidablePriceAmount` reads them as no amount);
 *   · FX1: a free plan is an EXPLICIT choice, `free: true` ("Es gratis"),
 *     exactly like a free service. Before, a deliberate 0 on a placeholder was
 *     refused as `price_missing` and there was no other way to say "free".
 */
export function resolvePlanPriceStatus(
    data: any,
    current?: { price?: unknown; price_status?: unknown },
): ServicePriceStatus {
    const row = current ? { priceStatus: servicePriceStatus(current), price: storedPriceAmount(current.price) } : undefined;
    try {
        return resolvePriceStatusInput(data, row);
    } catch (error) {
        const response = error instanceof BadRequestException ? error.getResponse() : null;
        if (response && typeof response === 'object' && (response as { error?: unknown }).error === 'price_missing') {
            throw new BadRequestException({
                error: 'price_missing',
                message: 'Este plan todavía no tiene precio. Escribe el monto para confirmarlo; si no se cobra, márcalo como gratis, o como "se cotiza".',
            });
        }
        throw error;
    }
}

/**
 * The amount a plan row stores. `price` is NOT NULL, so a plan the business
 * quotes case by case keeps 0 (never shown: its status is 'quote'), and any
 * other plan needs a real, non-negative number.
 */
function planPriceToStore(value: unknown, status: ServicePriceStatus): number {
    if (!hasPriceValue(value)) {
        if (status === 'quote') return 0;
        throw new BadRequestException({
            error: 'price_required',
            message: 'Escribe el precio del plan, o márcalo como "se cotiza".',
        });
    }
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) {
        throw new BadRequestException({ error: 'price_invalid', message: 'El precio del plan tiene que ser un número mayor o igual a cero.' });
    }
    return amount;
}

/** Every plan row the API returns says where its price stands. */
function withPlanPriceStatus<T extends Record<string, any> | null | undefined>(row: T): T {
    return row ? { ...row, price_status: servicePriceStatus(row) } : row;
}

/**
 * Gyms / Fitness vertical service.
 *
 * Three core entities:
 *  - membership_plans: catalog (mensual/trimestral/anual + drop-in)
 *  - members: contact-bound subscriptions with period + credits
 *  - fitness_classes + class_bookings: class schedule + reservations
 *
 * Membership freeze model: while frozen, current_period_end is NOT
 * shifted on the fly — instead frozen_days_used tracks consumption
 * and the period is extended on unfreeze. This makes the membership
 * window deterministic for billing reconciliation.
 */
@Injectable()
export class GymsService {
    private readonly logger = new Logger(GymsService.name);

    constructor(
        private readonly prisma: PrismaService,
        /**
         * ═══ THE CLASS CONFIRMATION `gyms.emailConfirmations` PROMISED ═══
         *
         * The control was declared by the contract, drawn as a switch by the
         * editor — which names `gym_class_confirmation` as the template it
         * governs — and read by NOTHING.
         *
         * Only a booking that comes out `confirmed` produces it. A `waitlist`
         * booking is not a place in the class, and telling somebody their spot
         * is confirmed while they are third in line is the kind of lie this
         * whole audit exists to remove. The promotion off the waitlist already
         * has its own notice lane (`gym.waitlist_promoted` on the operational
         * outbox); it is not duplicated here.
         */
        private readonly confirmations?: OperationConfirmationService,
        /**
         * D17 — de dónde sale la moneda de un plan. Opcional en la FIRMA sólo
         * para los fixtures que construyen este servicio a mano; sin
         * `@Optional()`, Nest sigue exigiendo el proveedor global.
         */
        private readonly regional?: RegionalProfileService,
    ) {}

    /** D17: explícito → moneda operativa del negocio → NULL. */
    private writeCurrency(requested: unknown, tenantId?: string): Promise<string | null> {
        return resolveWriteCurrency(requested, tenantId, this.regional as OperatingCurrencySource | undefined);
    }

    // ── Plans ─────────────────────────────────────────────────────

    async listPlans(schemaName: string, includeInactive = false): Promise<any[]> {
        const where = includeInactive ? '' : 'WHERE is_active = true';
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM membership_plans ${where} ORDER BY sort_order, price`,
        );
        return (rows || []).map((row) => withPlanPriceStatus(row));
    }

    async createPlan(schemaName: string, data: {
        name: string;
        description?: string;
        durationDays: number;
        price?: number | null;
        /** 'confirmed' or 'quote'. Typing a price already confirms it. */
        priceStatus?: ServicePriceStatus;
        /** "Es gratis": a confirmed price of 0, said explicitly (FX1). */
        free?: boolean;
        currency?: string;
        classCreditsPerPeriod?: number;
        personalTrainingCredits?: number;
        guestPasses?: number;
        freezeAllowanceDays?: number;
        perks?: string[];
    }, tenantId?: string): Promise<any> {
        if (!data.name || data.durationDays === undefined || data.durationDays === null) {
            throw new BadRequestException('name and durationDays are required');
        }
        const durationDays = requirePositiveIntegerUnit(data.durationDays, 'durationDays');
        // A plan the owner creates is theirs: its price is confirmed as typed,
        // free ("Es gratis" writes the 0), or 'quote'. Written explicitly,
        // never left to the column default (the column has none).
        const priceStatus = resolvePlanPriceStatus(data);
        const price = planPriceToStore(data.free === true ? 0 : data.price, priceStatus);
        const currency = await this.writeCurrency(data.currency, tenantId);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO membership_plans (
                name, description, duration_days, price, currency,
                class_credits_per_period, personal_training_credits, guest_passes,
                freeze_allowance_days, perks, price_status
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
             RETURNING *`,
            [
                data.name, data.description || null, durationDays,
                price, currency,
                data.classCreditsPerPeriod ?? null,
                data.personalTrainingCredits ?? 0,
                data.guestPasses ?? 0,
                data.freezeAllowanceDays ?? 0,
                JSON.stringify(data.perks || []),
                priceStatus,
            ],
        );
        return withPlanPriceStatus(rows[0]);
    }

    async updatePlan(schemaName: string, id: string, data: any, tenantId?: string): Promise<any> {
        const currentRows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT price, price_status FROM membership_plans WHERE id = $1::uuid`,
            [id],
        );
        const current = currentRows?.[0];
        if (!current) throw new NotFoundException('Plan not found');
        const currentStatus = servicePriceStatus(current);
        // Correcting the monthly price confirms it; "Confirmar precio" confirms
        // it without retyping; "Se cotiza" withdraws the number from the agent.
        // Without this the owner saved the right amount and the agent kept
        // refusing to say it, forever.
        const nextStatus = resolvePlanPriceStatus(data, current);
        // "Es gratis" writes the 0 itself, in the same statement as the status.
        if (data?.free === true) data = { ...data, price: 0 };
        if ('price' in data) {
            data = { ...data, price: planPriceToStore(data.price, nextStatus) };
        }
        if (data.durationDays !== undefined) {
            data = { ...data, durationDays: requirePositiveIntegerUnit(data.durationDays, 'durationDays') };
        }
        if (data.currency !== undefined) {
            data = { ...data, currency: await this.writeCurrency(data.currency, tenantId) };
        }
        const fields: string[] = [];
        const values: any[] = [];
        let i = 1;
        const map: Record<string, { col: string; cast?: string }> = {
            name: { col: 'name' }, description: { col: 'description' },
            durationDays: { col: 'duration_days' }, price: { col: 'price' },
            currency: { col: 'currency' },
            classCreditsPerPeriod: { col: 'class_credits_per_period' },
            personalTrainingCredits: { col: 'personal_training_credits' },
            guestPasses: { col: 'guest_passes' },
            freezeAllowanceDays: { col: 'freeze_allowance_days' },
            perks: { col: 'perks', cast: '::jsonb' },
            isActive: { col: 'is_active' },
            sortOrder: { col: 'sort_order' },
        };
        for (const [k, def] of Object.entries(map)) {
            if (k in data) {
                let value = data[k];
                if (def.cast === '::jsonb') value = JSON.stringify(value || []);
                fields.push(`${def.col} = $${i}${def.cast || ''}`);
                values.push(value);
                i++;
            }
        }
        if (nextStatus !== currentStatus) {
            fields.push(`price_status = $${i}`);
            values.push(nextStatus);
            i++;
        }
        if (!fields.length) return null;
        // Always, in the same statement as the status: `updated_at = created_at`
        // is how the seeded-price backfill (tenant-schema.sql,
        // verticals/seeded-price-backfill.ts) tells a row nobody touched.
        fields.push(`updated_at = NOW()`);
        values.push(id);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE membership_plans SET ${fields.join(', ')} WHERE id = $${i}::uuid RETURNING *`,
            values,
        );
        if (!rows.length) throw new NotFoundException('Plan not found');
        return withPlanPriceStatus(rows[0]);
    }

    async deletePlan(schemaName: string, id: string): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE membership_plans SET is_active = false, updated_at = NOW() WHERE id = $1::uuid`,
            [id],
        );
    }

    // ── Members ───────────────────────────────────────────────────

    async listMembers(schemaName: string, opts: { status?: string; search?: string; limit?: number } = {}): Promise<any[]> {
        const where: string[] = [];
        const params: any[] = [];
        let i = 1;
        if (opts.status) { where.push(`m.status = $${i++}`); params.push(opts.status); }
        if (opts.search) {
            where.push(`(c.name ILIKE $${i} OR c.phone ILIKE $${i} OR m.member_number ILIKE $${i})`);
            params.push(`%${opts.search}%`);
            i++;
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const limit = Math.min(opts.limit || 100, 500);
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT m.*, c.name as contact_name, c.phone as contact_phone,
                    p.name as plan_name, p.duration_days as plan_duration_days
             FROM members m
             LEFT JOIN contacts c ON c.id = m.contact_id
             LEFT JOIN membership_plans p ON p.id = m.plan_id
             ${whereSql}
             ORDER BY m.created_at DESC
             LIMIT ${limit}`,
            params,
        );
    }

    async getMemberById(schemaName: string, id: string): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT m.*, c.name as contact_name, c.phone as contact_phone,
                    c.email as contact_email,
                    p.name as plan_name, p.duration_days as plan_duration_days,
                    p.class_credits_per_period as plan_class_credits,
                    p.freeze_allowance_days as plan_freeze_allowance
             FROM members m
             LEFT JOIN contacts c ON c.id = m.contact_id
             LEFT JOIN membership_plans p ON p.id = m.plan_id
             WHERE m.id = $1::uuid`,
            [id],
        );
        return rows[0] || null;
    }

    async getMemberByContact(schemaName: string, contactId: string): Promise<any | null> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT m.*, p.name as plan_name, p.class_credits_per_period as plan_class_credits
             FROM members m
             LEFT JOIN membership_plans p ON p.id = m.plan_id
             WHERE m.contact_id = $1::uuid AND m.status IN ('active', 'frozen')
             ORDER BY m.created_at DESC LIMIT 1`,
            [contactId],
        );
        return rows[0] || null;
    }

    /**
     * Alta de socio desde una fila de planilla.
     *
     * `createMember` exige `contactId` y `planId`, que son UUIDs internos: el
     * padrón de un gimnasio trae nombre, teléfono y "Mensual". Sin esta capa el
     * import masivo existiría y sería inusable — el dueño no tiene forma de
     * conocer esos ids, así que las 200 filas fallarían todas.
     *
     * Resuelve el contacto por teléfono normalizado (y lo crea si no está) y el
     * plan por nombre. Después delega en `createMember`, que sigue siendo el
     * único lugar donde se calcula el período y se siembran los créditos.
     */
    async createMemberFromRow(schemaName: string, row: {
        /** País del negocio. Null = no declarado; el número queda crudo. */
        phoneRegion?: string | null;
        name?: string;
        phone?: string;
        email?: string;
        planName?: string;
        memberNumber?: string;
        joinedAt?: string;
    }): Promise<any> {
        const phone = String(row.phone || '').trim();
        if (!phone) throw new BadRequestException('El teléfono es obligatorio para identificar al socio.');

        // `phone_normalized` es con lo que después el canal reconoce al
        // socio. Un `+57` inventado lo vuelve irreconocible cuando escribe.
        const normalized = normalizePhoneE164(phone, row.phoneRegion) || phone;

        // Buscar por teléfono normalizado: es el único dato que un padrón trae
        // siempre y el que después usa el canal para reconocerlo.
        const existing = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id FROM contacts WHERE phone_normalized = $1 LIMIT 1`,
            [normalized],
        );

        let contactId: string = existing?.[0]?.id;
        if (!contactId) {
            // `external_id` es NOT NULL y tiene índice único con channel_type.
            // Se usa el teléfono normalizado: si mañana ese mismo número escribe
            // por WhatsApp, cae sobre el contacto ya cargado en vez de crear un
            // duplicado.
            const created = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `INSERT INTO contacts (external_id, channel_type, name, phone, phone_normalized, email)
                 VALUES ($1, 'whatsapp', $2, $3, $1, $4)
                 ON CONFLICT (channel_type, external_id) DO UPDATE SET updated_at = NOW()
                 RETURNING id`,
                [normalized, row.name || null, phone, row.email || null],
            );
            contactId = created?.[0]?.id;
        }
        if (!contactId) throw new BadRequestException('No se pudo crear el contacto del socio.');

        let planId: string | undefined;
        if (row.planName) {
            const plan = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT id FROM membership_plans WHERE lower(name) = lower($1) LIMIT 1`,
                [String(row.planName).trim()],
            );
            if (!plan?.length) {
                // Decirlo, no ignorarlo: un socio sin plan no tiene vencimiento
                // ni créditos, y el dueño creería que quedó bien cargado.
                throw new BadRequestException(`No existe un plan llamado "${row.planName}".`);
            }
            planId = plan[0].id;
        }

        return this.createMember(schemaName, {
            contactId,
            planId,
            memberNumber: row.memberNumber,
            joinedAt: row.joinedAt,
        });
    }

    async createMember(schemaName: string, data: {
        contactId: string;
        planId?: string;
        memberNumber?: string;
        joinedAt?: string;
    }): Promise<any> {
        if (!data.contactId) throw new BadRequestException('contactId is required');

        // If a plan is provided, compute the period and seed credits
        let periodStart: string | null = null;
        let periodEnd: string | null = null;
        let credits: number | null = null;
        let ptCredits = 0;
        let guestPasses = 0;
        if (data.planId) {
            const planRows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT * FROM membership_plans WHERE id = $1::uuid`,
                [data.planId],
            );
            const plan = planRows[0];
            if (!plan) throw new BadRequestException('Plan not found');
            const start = new Date();
            const end = new Date(start);
            end.setDate(end.getDate() + plan.duration_days);
            periodStart = start.toISOString().slice(0, 10);
            periodEnd = end.toISOString().slice(0, 10);
            credits = plan.class_credits_per_period;
            ptCredits = plan.personal_training_credits || 0;
            guestPasses = plan.guest_passes || 0;
        }

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO members (
                contact_id, plan_id, member_number, joined_at,
                current_period_start, current_period_end,
                class_credits_remaining, personal_training_remaining, guest_passes_remaining
             ) VALUES (
                $1::uuid, $2::uuid, $3, $4::date,
                $5::date, $6::date,
                $7, $8, $9
             ) RETURNING *`,
            [
                data.contactId, data.planId || null, data.memberNumber || null,
                data.joinedAt || new Date().toISOString().slice(0, 10),
                periodStart, periodEnd,
                credits, ptCredits, guestPasses,
            ],
        );
        return rows[0];
    }

    /**
     * Freeze a membership for N days. Deterministic model: the period
     * end is NOT shifted yet; we record the freeze window and consume
     * from freeze_allowance_days. unfreezeMember() recomputes the
     * period_end based on actual frozen days used.
     */
    async freezeMember(schemaName: string, id: string, days: number): Promise<any> {
        if (days < 1 || days > 180) throw new BadRequestException('days must be 1-180');
        const member = await this.getMemberById(schemaName, id);
        if (!member) throw new NotFoundException('Member not found');
        if (member.status !== 'active') throw new BadRequestException('Only active memberships can be frozen');

        const allowance = member.plan_freeze_allowance || 0;
        const used = member.frozen_days_used || 0;
        if (allowance > 0 && used + days > allowance) {
            throw new BadRequestException(`Freeze allowance exceeded — plan allows ${allowance} days, ${used} already used`);
        }

        const start = new Date();
        const end = new Date(start);
        end.setDate(end.getDate() + days);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE members SET
                status = 'frozen',
                frozen_from = $1::date,
                frozen_until = $2::date,
                updated_at = NOW()
             WHERE id = $3::uuid RETURNING *`,
            [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), id],
        );
        return rows[0];
    }

    async unfreezeMember(schemaName: string, id: string): Promise<any> {
        const member = await this.getMemberById(schemaName, id);
        if (!member || member.status !== 'frozen') throw new BadRequestException('Member is not frozen');

        // Compute days actually frozen and shift period_end forward
        const frozenFrom = new Date(member.frozen_from);
        const now = new Date();
        const daysFrozen = Math.max(0, Math.ceil((now.getTime() - frozenFrom.getTime()) / 86_400_000));
        const newPeriodEnd = new Date(member.current_period_end);
        newPeriodEnd.setDate(newPeriodEnd.getDate() + daysFrozen);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE members SET
                status = 'active',
                frozen_from = NULL,
                frozen_until = NULL,
                frozen_days_used = COALESCE(frozen_days_used, 0) + $1,
                current_period_end = $2::date,
                updated_at = NOW()
             WHERE id = $3::uuid RETURNING *`,
            [daysFrozen, newPeriodEnd.toISOString().slice(0, 10), id],
        );
        return rows[0];
    }

    async checkInMember(schemaName: string, memberId: string, classId?: string): Promise<any> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO member_check_ins (member_id, class_id, method)
             VALUES ($1::uuid, $2::uuid, 'manual') RETURNING *`,
            [memberId, classId || null],
        );
        return rows[0];
    }

    // ── Classes ───────────────────────────────────────────────────

    async listClasses(schemaName: string, opts: { from?: string; to?: string; classType?: string; limit?: number } = {}): Promise<any[]> {
        const where: string[] = ['fc.is_cancelled = false'];
        const params: any[] = [];
        let i = 1;
        if (opts.from) { where.push(`fc.scheduled_at >= $${i++}::timestamp`); params.push(opts.from); }
        if (opts.to) { where.push(`fc.scheduled_at <= $${i++}::timestamp`); params.push(opts.to); }
        if (opts.classType) { where.push(`fc.class_type = $${i++}`); params.push(opts.classType); }
        const limit = Math.min(opts.limit || 100, 500);
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT fc.*
             FROM fitness_classes fc
             WHERE ${where.join(' AND ')}
             ORDER BY fc.scheduled_at
             LIMIT ${limit}`,
            params,
        );
    }

    async createClass(schemaName: string, data: {
        name: string;
        description?: string;
        classType?: string;
        instructorName?: string;
        scheduledAt: string;
        durationMinutes?: number;
        maxCapacity: number;
        room?: string;
        level?: string;
        creditsRequired?: number;
        /**
         * Repetir semanalmente. Una grilla de gimnasio es la MISMA clase todas
         * las semanas: sin esto el dueño tenía que cargar "Spinning, martes
         * 19:00" una vez por semana, para siempre, por cada clase de la grilla.
         * Es la fatiga de carga que mata la adopción del módulo entero.
         */
        repeatWeeks?: number;
    }): Promise<any> {
        if (!data.name || !data.scheduledAt || !data.maxCapacity) {
            throw new BadRequestException('name, scheduledAt and maxCapacity are required');
        }
        const durationMinutes = requirePositiveIntegerUnit(data.durationMinutes ?? 60, 'durationMinutes');
        // Tope de 52: un año. Más que eso es una grilla que el dueño va a querer
        // cambiar antes de que llegue, y son filas que después hay que cancelar
        // una por una.
        const weeks = Math.min(Math.max(Math.floor(Number(data.repeatWeeks) || 1), 1), 52);

        const created: any[] = [];
        for (let i = 0; i < weeks; i++) {
            // La fecha se corre en UTC sobre la cadena recibida. Sumar 7 días con
            // setDate() sobre la hora LOCAL del servidor movería la hora de la
            // clase al cruzar un cambio de horario de verano.
            const at = new Date(`${data.scheduledAt.replace(' ', 'T')}${data.scheduledAt.length <= 16 ? ':00' : ''}Z`);
            at.setUTCDate(at.getUTCDate() + i * 7);
            const scheduledAt = at.toISOString().slice(0, 19);

            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `INSERT INTO fitness_classes (
                    name, description, class_type, instructor_name,
                    scheduled_at, duration_minutes, max_capacity, available_spots,
                    room, level, credits_required
                 ) VALUES (
                    $1, $2, $3, $4, $5::timestamp, $6, $7, $7, $8, $9, $10
                 ) RETURNING *`,
                [
                    data.name, data.description || null, data.classType || null,
                    data.instructorName || null,
                    scheduledAt,
                    durationMinutes,
                    data.maxCapacity,
                    data.room || null, data.level || null,
                    data.creditsRequired ?? 1,
                ],
            );
            created.push(rows[0]);
        }
        // Se devuelve la primera para no romper a quien esperaba una sola clase,
        // con el total al lado para que la UI pueda decir "se crearon 8".
        return { ...created[0], createdCount: created.length };
    }

    async cancelClass(schemaName: string, id: string, reason?: string): Promise<any> {
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            const [klass] = await query<any[]>('SELECT * FROM fitness_classes WHERE id = $1::uuid FOR UPDATE', [id]);
            if (!klass) throw new NotFoundException('Class not found');
            if (klass.is_cancelled) return klass;
            const bookings = await query<any[]>("SELECT * FROM class_bookings WHERE class_id = $1::uuid AND status IN ('confirmed', 'waitlist') ORDER BY member_id FOR UPDATE", [id]);
            for (const booking of bookings) {
                if (booking.status === 'confirmed') {
                    await query('UPDATE members SET class_credits_remaining = class_credits_remaining + $1 WHERE id = $2::uuid AND class_credits_remaining IS NOT NULL', [booking.credits_used ?? 1, booking.member_id]);
                }
            }
            await query("UPDATE class_bookings SET status = 'cancelled', cancelled_at = NOW() WHERE class_id = $1::uuid AND status IN ('confirmed', 'waitlist')", [id]);
            const [cancelled] = await query<any[]>(
                `UPDATE fitness_classes SET is_cancelled = true, cancellation_reason = $2,
                    available_spots = available_spots + $3, updated_at = NOW() WHERE id = $1::uuid RETURNING *`,
                [id, reason || 'cancelled by staff', bookings.filter(b => b.status === 'confirmed').length],
            );
            return cancelled;
        });
    }

    /**
     * Book a class for a member. Decrements class credits if the plan
     * has a credit allowance; refuses if no credits and the plan is
     * not unlimited. Decrements available_spots on the class atomically.
     */
    /**
     * `conversationId` is the thread the booking was taken in, when there is
     * one. It is what names the connection — and therefore the agent whose
     * `emailConfirmations` switch decides the receipt. A booking made at the
     * front desk has none, which the policy reads as "the owner switched
     * nothing off" rather than guessing at an agent.
     */
    async bookClass(schemaName: string, classId: string, memberId: string, operationalScope?: ServedAgentAuthority, conversationId?: string | null): Promise<any> {
        let receipt: { booking: any; klass: any; contactId: string | null } | null = null;
        const booked = await this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text',[`agent-privacy:${schemaName}`]);
            await assertServedAgentAuthority(query, schemaName, operationalScope);
            // Every class transition locks the class before its members/bookings.
            const [klass] = await query<any[]>(
                'SELECT * FROM fitness_classes WHERE id = $1::uuid FOR UPDATE', [classId],
            );
            if (!klass) throw new NotFoundException('Class not found');
            if (klass.is_cancelled) throw new BadRequestException('Class is cancelled');
            if (klass.scheduled_at && new Date(klass.scheduled_at).getTime() <= Date.now()) {
                throw new BadRequestException('Class has already started');
            }
            const [member] = await query<any[]>(
                'SELECT * FROM members WHERE id = $1::uuid FOR UPDATE', [memberId],
            );
            if (!member) throw new NotFoundException('Member not found');
            if (await operationalContactWasErased(query,member.contact_id)) throw new BadRequestException('Contact unavailable');
            const [existing] = await query<any[]>(
                "SELECT * FROM class_bookings WHERE class_id = $1::uuid AND member_id = $2::uuid AND status IN ('confirmed', 'waitlist', 'attended')",
                [classId, memberId],
            );
            if (existing) return this.withWaitlistPosition(query, { ...existing, idempotentReplay: true });
            if (member.status !== 'active') throw new BadRequestException('Member is not active');
            const credits = member.class_credits_remaining;
            const required = klass.credits_required ?? 1;
            if (credits !== null && credits < required) throw new BadRequestException('Insufficient credits');
            const waitlisted = klass.available_spots <= 0;
            if (!waitlisted) {
                await query('UPDATE fitness_classes SET available_spots = available_spots - 1 WHERE id = $1::uuid', [classId]);
                if (credits !== null) {
                    await query('UPDATE members SET class_credits_remaining = class_credits_remaining - $1 WHERE id = $2::uuid', [required, memberId]);
                }
            }
            const [booking] = await query<any[]>(
                `INSERT INTO class_bookings (class_id, member_id, contact_id, credits_used, status, conversation_id)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid) RETURNING *`,
                [classId, memberId, member.contact_id, required, waitlisted ? 'waitlist' : 'confirmed',
                    conversationId || null],
            );
            if (!waitlisted) receipt = { booking, klass, contactId: member.contact_id };
            return this.withWaitlistPosition(query, booking);
        });
        // After the commit. A replay returns early above and sets no receipt,
        // so a retried booking cannot produce a second email.
        if (receipt) await this.confirmBooking(schemaName, receipt);
        return booked;
    }

    /** The receipt for one confirmed class booking. */
    private async confirmBooking(
        schemaName: string,
        receipt: { booking: any; klass: any; contactId: string | null },
    ): Promise<void> {
        const at = receipt.klass?.scheduled_at instanceof Date
            ? receipt.klass.scheduled_at.toISOString().slice(0, 19)
            : String(receipt.klass?.scheduled_at ?? '').replace(' ', 'T').slice(0, 19);
        await this.confirmations?.send({
            schemaName,
            families: ['gyms'],
            slug: 'gym_class_confirmation',
            conversationId: receipt.booking?.conversation_id ?? null,
            contactId: receipt.contactId,
            operation: `class booking ${receipt.booking?.id}`,
            variables: {
                service_name: String(receipt.klass?.name ?? ''),
                appointment_date: at.slice(0, 10),
                appointment_time: at.slice(11, 16),
                location: String(receipt.klass?.room ?? ''),
                agent_name: String(receipt.klass?.instructor_name ?? ''),
            },
        });
    }

    private async withWaitlistPosition(query: <T = any[]>(sql: string, params?: any[]) => Promise<T>, booking: any): Promise<any> {
        if (booking.status !== 'waitlist') return booking;
        const [position] = await query<any[]>(
            `SELECT COUNT(*)::int AS n FROM class_bookings
             WHERE class_id = $1::uuid AND status = 'waitlist'
               AND (booked_at, id) <= (SELECT booked_at, id FROM class_bookings WHERE id = $2::uuid)`,
            [booking.class_id, booking.id],
        );
        return { ...booking, waitlisted: true, waitlistPosition: Number(position?.n || 1) };
    }

    async cancelBooking(schemaName: string, bookingId: string, contactId?: string, operationalScope?: ServedAgentAuthority): Promise<any> {
        await ensureOperationalNoticeOutbox(this.prisma,schemaName);
        return this.prisma.transactionInTenantSchema(schemaName, async (query) => {
            await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text',[`agent-privacy:${schemaName}`]);
            await assertServedAgentAuthority(query, schemaName, operationalScope);
            const [reference] = await query<any[]>('SELECT class_id FROM class_bookings WHERE id = $1::uuid', [bookingId]);
            if (!reference) throw new NotFoundException('Booking not found');
            const [klass] = await query<any[]>('SELECT * FROM fitness_classes WHERE id = $1::uuid FOR UPDATE', [reference.class_id]);
            if (!klass) throw new NotFoundException('Class not found');
            const [booking] = await query<any[]>('SELECT * FROM class_bookings WHERE id = $1::uuid FOR UPDATE', [bookingId]);
            if (contactId && booking.contact_id !== contactId) throw new BadRequestException('You can only cancel your own bookings');
            if (booking.status === 'cancelled') return { success: true, bookingId, status: 'cancelled', alreadyCancelled: true, creditsRestored: 0 };
            if (!['confirmed', 'waitlist'].includes(booking.status)) throw new BadRequestException('This booking cannot be cancelled');
            if (klass.scheduled_at && new Date(klass.scheduled_at).getTime() <= Date.now()) throw new BadRequestException('Class has already started');
            await query("UPDATE class_bookings SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1::uuid", [bookingId]);
            let creditsRestored = 0;
            if (booking.status === 'confirmed') {
                await query('UPDATE fitness_classes SET available_spots = available_spots + 1 WHERE id = $1::uuid', [booking.class_id]);
                const restored = await query<any[]>(
                    `UPDATE members SET class_credits_remaining = class_credits_remaining + $1
                     WHERE id = $2::uuid AND class_credits_remaining IS NOT NULL RETURNING id`,
                    [booking.credits_used ?? 1, booking.member_id],
                );
                creditsRestored = restored.length ? (booking.credits_used ?? 1) : 0;
                if (!klass.is_cancelled) await this.promoteFromWaitlist(query, schemaName, booking.class_id);
            }
            return { success: true, bookingId, status: 'cancelled', previousStatus: booking.status, creditsRestored };
        });
    }

    /** The caller holds the class lock; a failed promotion rolls back cancellation too. */
    private async promoteFromWaitlist(query: <T = any[]>(sql: string, params?: any[]) => Promise<T>, schemaName: string, classId: string): Promise<void> {
        const [next] = await query<any[]>(
            `SELECT b.*, m.class_credits_remaining
             FROM class_bookings b JOIN members m ON m.id = b.member_id
             WHERE b.class_id = $1::uuid AND b.status = 'waitlist' AND m.status = 'active'
               AND (m.class_credits_remaining IS NULL OR m.class_credits_remaining >= b.credits_used)
               ORDER BY b.booked_at, b.id LIMIT 1 FOR UPDATE OF b, m`, [classId],
        );
        if (!next) return;
        if (await operationalContactWasErased(query,next.contact_id)) {
            await query("UPDATE class_bookings SET status='cancelled',cancelled_at=NOW() WHERE id=$1::uuid",[next.id]);
            return this.promoteFromWaitlist(query,schemaName,classId);
        }
        await query("UPDATE class_bookings SET status = 'confirmed' WHERE id = $1::uuid", [next.id]);
        await query('UPDATE fitness_classes SET available_spots = available_spots - 1 WHERE id = $1::uuid', [classId]);
        await enqueueOperationalNotice(query,schemaName,{kind:'gym.waitlist_promoted',entityId:next.id,contactId:next.contact_id});
        if (next.class_credits_remaining !== null) {
            await query('UPDATE members SET class_credits_remaining = class_credits_remaining - $1 WHERE id = $2::uuid', [next.credits_used ?? 1, next.member_id]);
        }
    }

    async listContactBookings(schemaName: string, contactId: string): Promise<any[]> {
        return this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT b.id AS booking_id, b.status, b.credits_used, fc.id AS class_id,
                    fc.name, fc.scheduled_at, fc.instructor_name
             FROM class_bookings b JOIN fitness_classes fc ON fc.id = b.class_id
             WHERE b.contact_id = $1::uuid AND b.status IN ('confirmed', 'waitlist')
               AND fc.is_cancelled = false AND fc.scheduled_at >= NOW()
             ORDER BY fc.scheduled_at LIMIT 30`, [contactId],
        );
    }

    /** AI tool — list upcoming classes available for booking. */
    async upcomingClasses(schemaName: string, daysAhead = 7, classType?: string): Promise<any[]> {
        const now = new Date();
        const until = new Date();
        until.setDate(until.getDate() + daysAhead);
        const where: string[] = [
            'fc.is_cancelled = false',
            'fc.scheduled_at >= NOW()',
            'fc.scheduled_at <= $1::timestamp',
        ];
        const params: any[] = [until.toISOString()];
        let i = 2;
        if (classType) { where.push(`fc.class_type ILIKE $${i++}`); params.push(`%${classType}%`); }
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, name, class_type, instructor_name, scheduled_at,
                    duration_minutes, available_spots, max_capacity, room, level, credits_required
             FROM fitness_classes fc
             WHERE ${where.join(' AND ')}
             ORDER BY scheduled_at
             LIMIT 30`,
            params,
        );
    }
}
