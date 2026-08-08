import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhoneE164 } from '../../common/utils/phone.util';
import {
    normalizeCurrencyCode,
    requirePositiveIntegerUnit,
} from '../../common/utils/commercial-units.util';

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

    constructor(private readonly prisma: PrismaService) {}

    // ── Plans ─────────────────────────────────────────────────────

    async listPlans(schemaName: string, includeInactive = false): Promise<any[]> {
        const where = includeInactive ? '' : 'WHERE is_active = true';
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM membership_plans ${where} ORDER BY sort_order, price`,
        );
    }

    async createPlan(schemaName: string, data: {
        name: string;
        description?: string;
        durationDays: number;
        price: number;
        currency?: string;
        classCreditsPerPeriod?: number;
        personalTrainingCredits?: number;
        guestPasses?: number;
        freezeAllowanceDays?: number;
        perks?: string[];
    }): Promise<any> {
        if (!data.name || data.durationDays === undefined || data.durationDays === null) {
            throw new BadRequestException('name and durationDays are required');
        }
        const durationDays = requirePositiveIntegerUnit(data.durationDays, 'durationDays');
        const currency = normalizeCurrencyCode(data.currency);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO membership_plans (
                name, description, duration_days, price, currency,
                class_credits_per_period, personal_training_credits, guest_passes,
                freeze_allowance_days, perks
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
             RETURNING *`,
            [
                data.name, data.description || null, durationDays,
                data.price, currency,
                data.classCreditsPerPeriod ?? null,
                data.personalTrainingCredits ?? 0,
                data.guestPasses ?? 0,
                data.freezeAllowanceDays ?? 0,
                JSON.stringify(data.perks || []),
            ],
        );
        return rows[0];
    }

    async updatePlan(schemaName: string, id: string, data: any): Promise<any> {
        if (data.durationDays !== undefined) {
            data = { ...data, durationDays: requirePositiveIntegerUnit(data.durationDays, 'durationDays') };
        }
        if (data.currency !== undefined) {
            data = { ...data, currency: normalizeCurrencyCode(data.currency) };
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
        if (!fields.length) return null;
        fields.push(`updated_at = NOW()`);
        values.push(id);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE membership_plans SET ${fields.join(', ')} WHERE id = $${i}::uuid RETURNING *`,
            values,
        );
        if (!rows.length) throw new NotFoundException('Plan not found');
        return rows[0];
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
        name?: string;
        phone?: string;
        email?: string;
        planName?: string;
        memberNumber?: string;
        joinedAt?: string;
    }): Promise<any> {
        const phone = String(row.phone || '').trim();
        if (!phone) throw new BadRequestException('El teléfono es obligatorio para identificar al socio.');

        const normalized = normalizePhoneE164(phone) || phone;

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
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE fitness_classes SET
                is_cancelled = true,
                cancellation_reason = $1,
                updated_at = NOW()
             WHERE id = $2::uuid RETURNING *`,
            [reason || 'cancelled by staff', id],
        );
        // Also cancel all confirmed bookings for the class
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE class_bookings SET status = 'cancelled', cancelled_at = NOW()
             WHERE class_id = $1::uuid AND status = 'confirmed'`,
            [id],
        );
        return rows[0];
    }

    /**
     * Book a class for a member. Decrements class credits if the plan
     * has a credit allowance; refuses if no credits and the plan is
     * not unlimited. Decrements available_spots on the class atomically.
     */
    async bookClass(schemaName: string, classId: string, memberId: string): Promise<any> {
        // Verify the class exists + has spots
        const classRows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM fitness_classes WHERE id = $1::uuid`,
            [classId],
        );
        const klass = classRows[0];
        if (!klass) throw new NotFoundException('Class not found');
        if (klass.is_cancelled) throw new BadRequestException('Class is cancelled');
        if (klass.available_spots <= 0) throw new BadRequestException('Class is full');

        // Verify the member can book (active + has credits)
        const member = await this.getMemberById(schemaName, memberId);
        if (!member) throw new NotFoundException('Member not found');
        if (member.status !== 'active') throw new BadRequestException('Member is not active');

        const credits = member.class_credits_remaining;
        const required = klass.credits_required || 1;
        if (credits !== null && credits < required) {
            throw new BadRequestException(`Insufficient credits — has ${credits}, needs ${required}`);
        }

        // Se toma el cupo PRIMERO y de forma atomica.
        //
        // Antes el orden era: chequear spots > 0 (arriba) -> INSERT -> UPDATE
        // guardado, y el resultado del UPDATE se descartaba. Dos socios que
        // reservaban el ultimo cupo a la vez pasaban los dos el chequeo, los dos
        // insertaban, y el segundo UPDATE no afectaba ninguna fila en silencio:
        // dos reservas para un solo lugar, sin que nadie se entere hasta que
        // llegan a la clase. PgBouncer corre en transaction mode, asi que no hay
        // BEGIN/COMMIT entre sentencias — la unica atomicidad disponible es un
        // solo UPDATE guardado, y hay que MIRAR si tomo fila.
        const claimed = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE fitness_classes SET available_spots = available_spots - 1
             WHERE id = $1::uuid AND available_spots > 0 RETURNING id`,
            [classId],
        );

        // Clase llena → lista de espera, no puerta cerrada.
        //
        // El estado 'waitlist' y su índice único están en el schema desde
        // siempre y no los escribía nadie: la respuesta era "Class is full" y
        // ahí terminaba la conversación. El costo real no es la molestia del
        // socio: es que cuando alguien cancela, ese lugar queda VACÍO — el
        // gimnasio pierde el cupo que ya tenía vendido.
        //
        // La reserva en espera NO consume créditos ni ocupa lugar. Los dos se
        // cobran recién al promoverla (ver promoteFromWaitlist).
        if (!claimed.length) {
            const waitRows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `INSERT INTO class_bookings (class_id, member_id, contact_id, credits_used, status)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'waitlist') RETURNING *`,
                [classId, memberId, member.contact_id, required],
            );
            const [pos] = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT COUNT(*)::int AS n FROM class_bookings
                 WHERE class_id = $1::uuid AND status = 'waitlist'
                   AND booked_at <= (SELECT booked_at FROM class_bookings WHERE id = $2::uuid)`,
                [classId, waitRows[0].id],
            );
            return { ...waitRows[0], waitlisted: true, waitlistPosition: Number(pos?.n || 1) };
        }

        let bookingRows: any[];
        try {
            bookingRows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `INSERT INTO class_bookings (class_id, member_id, contact_id, credits_used)
                 VALUES ($1::uuid, $2::uuid, $3::uuid, $4) RETURNING *`,
                [classId, memberId, member.contact_id, required],
            );
        } catch (e) {
            // Compensacion: el cupo ya esta tomado y la reserva no existe. Sin
            // esto un INSERT fallido dejaria el lugar perdido para siempre.
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE fitness_classes SET available_spots = available_spots + 1 WHERE id = $1::uuid`,
                [classId],
            ).catch(() => {});
            throw e;
        }

        if (credits !== null) {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE members SET class_credits_remaining = GREATEST(class_credits_remaining - $1, 0)
                 WHERE id = $2::uuid`,
                [required, memberId],
            );
        }
        return bookingRows[0];
    }

    async cancelBooking(schemaName: string, bookingId: string): Promise<void> {
        // El RETURNING de un UPDATE devuelve la fila YA modificada, así que
        // `status` diría siempre 'cancelled'. El auto-join contra la misma tabla
        // ve el snapshot ANTERIOR, que es lo único que distingue una reserva
        // confirmada (ocupaba lugar y créditos) de una en espera (no ocupaba
        // ninguno de los dos).
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE class_bookings b SET status = 'cancelled', cancelled_at = NOW()
             FROM class_bookings old
             WHERE b.id = $1::uuid AND old.id = b.id
               AND b.status IN ('confirmed', 'waitlist')
             RETURNING b.class_id, b.member_id, b.credits_used, old.status AS previous_status`,
            [bookingId],
        );
        const b = rows[0];
        if (!b) return;

        // Cancelar una ESPERA no devuelve nada: nunca tomó lugar ni consumió
        // créditos. Sin este guard, inflaba available_spots por encima del cupo
        // real de la sala y le regalaba créditos al socio — un bug que estaba
        // dormido sólo porque hasta ahora no existían filas en espera.
        if (b.previous_status === 'waitlist') return;

        // Restore credits + spot
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE fitness_classes SET available_spots = available_spots + 1 WHERE id = $1::uuid`,
            [b.class_id],
        );
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE members SET class_credits_remaining = COALESCE(class_credits_remaining, 0) + $1
             WHERE id = $2::uuid AND class_credits_remaining IS NOT NULL`,
            [b.credits_used || 1, b.member_id],
        );

        // El lugar liberado se le pasa a quien esté esperando.
        await this.promoteFromWaitlist(schemaName, b.class_id);
    }

    /**
     * Promueve la espera más antigua de una clase al lugar que acaba de quedar
     * libre.
     *
     * Es lo que le da sentido a la lista: sin esto, un cupo cancelado queda
     * vacío aunque haya gente esperando, que es exactamente lo que pasaba antes
     * (con la diferencia de que antes nadie podía siquiera anotarse).
     *
     * Reclama el lugar con el MISMO UPDATE guardado que `bookClass`: si entre la
     * cancelación y esto entró alguien por la puerta, no hay lugar que promover
     * y la espera sigue esperando. Y si el socio se quedó sin créditos mientras
     * tanto, se lo saltea en vez de dejarlo con saldo negativo — el siguiente
     * cancelado lo vuelve a intentar.
     */
    private async promoteFromWaitlist(schemaName: string, classId: string): Promise<void> {
        try {
            const [next] = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT b.id, b.member_id, b.credits_used, m.class_credits_remaining
                 FROM class_bookings b
                 JOIN members m ON m.id = b.member_id
                 WHERE b.class_id = $1::uuid AND b.status = 'waitlist' AND m.status = 'active'
                 ORDER BY b.booked_at ASC LIMIT 1`,
                [classId],
            );
            if (!next) return;

            const required = next.credits_used || 1;
            if (next.class_credits_remaining !== null && next.class_credits_remaining < required) {
                this.logger.debug(`[Waitlist] member ${next.member_id} sin créditos suficientes — no se promueve`);
                return;
            }

            const claimed = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `UPDATE fitness_classes SET available_spots = available_spots - 1
                 WHERE id = $1::uuid AND available_spots > 0 RETURNING id`,
                [classId],
            );
            if (!claimed.length) return;

            const promoted = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `UPDATE class_bookings SET status = 'confirmed'
                 WHERE id = $1::uuid AND status = 'waitlist' RETURNING *`,
                [next.id],
            );
            if (!promoted.length) {
                // Se canceló su propia espera mientras tanto: devolver el lugar.
                await this.prisma.executeInTenantSchema(
                    schemaName,
                    `UPDATE fitness_classes SET available_spots = available_spots + 1 WHERE id = $1::uuid`,
                    [classId],
                ).catch(() => {});
                return;
            }

            if (next.class_credits_remaining !== null) {
                await this.prisma.executeInTenantSchema(
                    schemaName,
                    `UPDATE members SET class_credits_remaining = GREATEST(class_credits_remaining - $1, 0)
                     WHERE id = $2::uuid`,
                    [required, next.member_id],
                );
            }

            this.logger.log(`[Waitlist] Reserva ${next.id} promovida a confirmada en la clase ${classId}`);
        } catch (error: any) {
            // Una promoción fallida deja el lugar libre para el próximo que
            // reserve: es una oportunidad perdida, no un dato corrupto.
            this.logger.warn(`[Waitlist] No se pudo promover en la clase ${classId}: ${error.message}`);
        }
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
            'fc.available_spots > 0',
        ];
        const params: any[] = [until.toISOString()];
        let i = 2;
        if (classType) { where.push(`fc.class_type ILIKE $${i++}`); params.push(`%${classType}%`); }
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, name, class_type, instructor_name, scheduled_at,
                    duration_minutes, available_spots, max_capacity, room, level
             FROM fitness_classes fc
             WHERE ${where.join(' AND ')}
             ORDER BY scheduled_at
             LIMIT 30`,
            params,
        );
    }
}
