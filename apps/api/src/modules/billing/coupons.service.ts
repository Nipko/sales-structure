import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SubscriptionStatus } from './types/subscription-status.enum';
import { CouponGovernanceService } from './coupon-governance.service';

/**
 * Formas declaradas a mano de las filas que se mapean acá.
 *
 * No es redundancia con el cliente de Prisma: en CI el chequeo de tipos corre
 * ANTES de `prisma generate`, así que los modelos generados no existen todavía y
 * `findMany` devuelve `any`. Sin estas anotaciones el build falla con TS7006
 * ("implicitly has an 'any' type") solo en CI, nunca en local.
 */
export interface CouponRedemptionRow {
    id: string;
    couponId: string;
    tenantId: string;
    subscriptionId: string | null;
    redeemedAt: Date;
    cyclesRemaining: number | null;
    metadata: unknown;
}

export interface BillingPlanRef {
    id: string;
    slug: string;
}

export interface RedemptionTenantRef {
    id: string;
    name: string;
    slug: string;
    subscriptionStatus: string | null;
    trialEndsAt: Date | null;
}

/**
 * Cupones promocionales.
 *
 * HISTORIA (importante para no repetir el error): la tabla nació con tres tipos
 * —percent_off, amount_off y free_months— pero solo el último llegó a hacer algo.
 * `redeem()` escribía la fila de canje y sumaba el contador, y NADIE leía esa fila
 * para descontar: ni el adapter de MercadoPago, ni el webhook, ni el cálculo de
 * precio. El docstring original derivaba el descuento a "un runbook" que nunca se
 * escribió. Resultado real: el tenant canjeaba "20% OFF", veía "Cupón aplicado
 * correctamente" y le cobraban el 100% todos los meses.
 *
 * Por eso hoy **el único tipo canjeable es `free_months`**. Los cupones viejos de
 * porcentaje/monto siguen en la base (no se borra historia) pero no se pueden
 * crear ni canjear: `validate()` los rechaza con `type_not_supported`. Volver a
 * habilitarlos exige implementar el descuento de verdad contra el proveedor, no
 * solo destildar esta guarda.
 *
 * Cómo funciona free_months: extiende el trial LOCAL (`trialEndsAt` +
 * `currentPeriodEnd`) y deja la suscripción en `trialing`. Eso frena el cobro
 * porque durante el trial no existe preapproval en MercadoPago
 * (`skipProviderCreate = plan.trialDays > 0` en BillingService.createTrialSubscription).
 * De ahí la guarda dura: si la suscripción YA tiene `providerSubscriptionId`, el
 * regalo no se aplica — extender la fecha local no le dice nada a MercadoPago, que
 * seguiría cobrando igual mientras el tenant cree que está de regalo.
 *
 * Reglas de validación:
 *  - un canje por tenant por cupón (UNIQUE couponId+tenantId)
 *  - tope global maxRedemptions, aplicado de forma atómica en el UPDATE
 *  - expiresAt
 *  - allow-list de planes (array vacío = cualquier plan)
 */
@Injectable()
export class CouponsService {
    private readonly logger = new Logger(CouponsService.name);

    /** Único tipo que produce un efecto económico real. Ver docstring de la clase. */
    static readonly REDEEMABLE_TYPE = 'free_months';

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly events: EventEmitter2,
        private readonly governance: CouponGovernanceService,
    ) {}

    // ── Admin CRUD ─────────────────────────────────────────────────

    /**
     * Cupones sueltos, los creados de a uno. Los generados por lote se excluyen a
     * propósito: un lote de 200 códigos ahogaría la tabla y no se leería nada.
     * Esos se ven agrupados por `listBatches()`.
     */
    async list(filters: { active?: boolean } = {}) {
        const where: any = { batchId: null };
        if (filters.active !== undefined) where.isActive = filters.active;
        return this.prisma.billingCoupon.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 200,
        });
    }

    async getByCode(code: string) {
        return this.prisma.billingCoupon.findUnique({
            where: { code: code.toUpperCase().trim() },
        });
    }

    async getById(id: string) {
        const coupon = await this.prisma.billingCoupon.findUnique({ where: { id } });
        if (!coupon) throw new NotFoundException({ error: 'coupon_not_found' });
        return coupon;
    }

    async create(input: {
        code: string;
        description?: string;
        type: string;
        freeMonths?: number;
        appliesToPlanIds?: string[];
        maxRedemptions?: number;
        expiresAt?: string;
        reason?: string;
        ownerPin?: string;
        createdByUserId?: string;
    }) {
        const code = input.code.toUpperCase().trim();
        if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
            throw new BadRequestException({
                error: 'invalid_code',
                message: 'Code must be 3-40 chars, letters/digits/_/-',
            });
        }

        if (input.type !== CouponsService.REDEEMABLE_TYPE) {
            throw new BadRequestException({
                error: 'type_not_supported',
                message:
                    'Only free_months coupons can be issued. percent_off / amount_off never applied a discount to the charge — see CouponsService docs.',
            });
        }

        if (!input.freeMonths || input.freeMonths < 1 || input.freeMonths > 24) {
            throw new BadRequestException({ error: 'invalid_months', message: 'freeMonths must be 1-24' });
        }

        // Gobernanza: motivo + cuota mensual + PIN del dueno. Un cupon sin tope de
        // canjes tiene potencial infinito (alto impacto) → exige PIN; uno con tope,
        // freeMonths x maxRedemptions consume la cuota del mes.
        const plannedGiftedMonths = input.maxRedemptions == null
            ? Infinity
            : input.freeMonths * input.maxRedemptions;
        const gov = await this.governance.assertCanIssue({
            reason: input.reason,
            plannedGiftedMonths,
            ownerPin: input.ownerPin,
        });

        const existing = await this.prisma.billingCoupon.findUnique({ where: { code } });
        if (existing) throw new ConflictException({ error: 'code_already_exists' });

        const appliesToPlanIds = await this.normalizePlanSlugs(input.appliesToPlanIds);

        const created = await this.prisma.billingCoupon.create({
            data: {
                code,
                description: input.description ?? null,
                type: CouponsService.REDEEMABLE_TYPE,
                percentDiscount: null,
                amountOffCents: null,
                freeMonths: input.freeMonths,
                durationCycles: null,
                appliesToPlanIds,
                maxRedemptions: input.maxRedemptions ?? null,
                expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
                createdByUserId: input.createdByUserId ?? null,
            },
        });

        await this.writeAudit(input.createdByUserId, 'coupon_created', created.id, {
            code: created.code,
            freeMonths: created.freeMonths,
            maxRedemptions: created.maxRedemptions,
            expiresAt: created.expiresAt,
            appliesToPlanIds,
            reason: input.reason ?? null,
            highImpact: gov.highImpact,
        });

        this.events.emit('coupon.issued', {
            kind: 'single',
            code: created.code,
            freeMonths: created.freeMonths,
            maxRedemptions: created.maxRedemptions,
            plannedGiftedMonths: Number.isFinite(plannedGiftedMonths) ? plannedGiftedMonths : null,
            highImpact: gov.highImpact,
            reason: input.reason ?? null,
        });

        return created;
    }

    async update(
        id: string,
        data: Partial<{
            description: string;
            isActive: boolean;
            maxRedemptions: number | null;
            expiresAt: string | null;
            appliesToPlanIds: string[];
        }>,
        actorUserId?: string,
    ) {
        const appliesToPlanIds = data.appliesToPlanIds !== undefined
            ? await this.normalizePlanSlugs(data.appliesToPlanIds)
            : undefined;

        const updated = await this.prisma.billingCoupon.update({
            where: { id },
            data: {
                ...(data.description !== undefined && { description: data.description }),
                ...(data.isActive !== undefined && { isActive: data.isActive }),
                ...(data.maxRedemptions !== undefined && { maxRedemptions: data.maxRedemptions }),
                ...(data.expiresAt !== undefined && {
                    expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
                }),
                ...(appliesToPlanIds !== undefined && { appliesToPlanIds }),
            },
        });

        await this.writeAudit(actorUserId, 'coupon_updated', id, { code: updated.code, changes: data });
        return updated;
    }

    async deactivate(id: string, actorUserId?: string) {
        const updated = await this.prisma.billingCoupon.update({
            where: { id },
            data: { isActive: false },
        });
        await this.writeAudit(actorUserId, 'coupon_deactivated', id, { code: updated.code });
        return updated;
    }

    // ── Generación de lotes ────────────────────────────────────────

    /**
     * Genera N códigos de UN SOLO USO a partir de una palabra: `LANZA-K7M2QX`.
     *
     * Cada código es un cupón independiente con `maxRedemptions = 1`, no un cupón
     * con N usos: así se reparten uno por persona y se puede ver cuál se quemó y
     * cuál sigue libre. El lote existe solo para agruparlos en el panel.
     *
     * El alfabeto excluye I, L, O, 0 y 1 a propósito: estos códigos los tipea una
     * persona desde un mail o un cartel, y esas cinco son las que se confunden.
     */
    async generateBatch(input: {
        label: string;
        count: number;
        freeMonths: number;
        validDays: number;
        appliesToPlanIds?: string[];
        description?: string;
        reason?: string;
        ownerPin?: string;
        createdByUserId?: string;
    }): Promise<{
        batchId: string;
        batchLabel: string;
        created: number;
        expiresAt: Date;
        codes: string[];
    }> {
        const label = input.label.toUpperCase().trim().replace(/\s+/g, '');
        if (!/^[A-Z0-9]{2,20}$/.test(label)) {
            throw new BadRequestException({
                error: 'invalid_batch_label',
                message: 'Label must be 2-20 chars, letters and digits only.',
            });
        }
        if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_BATCH_SIZE) {
            throw new BadRequestException({
                error: 'invalid_count',
                message: `count must be between 1 and ${MAX_BATCH_SIZE}`,
            });
        }
        if (!Number.isInteger(input.freeMonths) || input.freeMonths < 1 || input.freeMonths > 24) {
            throw new BadRequestException({ error: 'invalid_months', message: 'freeMonths must be 1-24' });
        }
        if (!Number.isInteger(input.validDays) || input.validDays < 1 || input.validDays > 365) {
            throw new BadRequestException({
                error: 'invalid_valid_days',
                message: 'validDays must be between 1 and 365',
            });
        }

        // Gobernanza: un lote emite freeMonths x count meses-gratis de una vez —
        // el caso de mayor volumen, y el que el dueno mas quiere controlar.
        const plannedGiftedMonths = input.freeMonths * input.count;
        const gov = await this.governance.assertCanIssue({
            reason: input.reason,
            plannedGiftedMonths,
            ownerPin: input.ownerPin,
        });

        const appliesToPlanIds = await this.normalizePlanSlugs(input.appliesToPlanIds);

        // Vence al FINAL del día N, no en el instante exacto de la generación:
        // "vale 30 días" no debería morir a media mañana del día 30.
        const expiresAt = new Date(Date.now() + input.validDays * 86_400_000);
        expiresAt.setUTCHours(23, 59, 59, 999);

        const batchId = randomUUID();

        // Se generan de más y se filtra contra lo que ya existe: el UNIQUE de
        // `code` es la garantía final, pero chequear antes evita que una colisión
        // tumbe la inserción entera de 200 códigos.
        const codes = await this.mintUniqueCodes(label, input.count);

        await this.prisma.billingCoupon.createMany({
            data: codes.map((code: string) => ({
                code,
                description: input.description ?? null,
                type: CouponsService.REDEEMABLE_TYPE,
                percentDiscount: null,
                amountOffCents: null,
                freeMonths: input.freeMonths,
                durationCycles: null,
                appliesToPlanIds,
                maxRedemptions: 1,
                expiresAt,
                batchId,
                batchLabel: label,
                createdByUserId: input.createdByUserId ?? null,
            })),
            skipDuplicates: true,
        });

        await this.writeAudit(input.createdByUserId, 'coupon_batch_generated', batchId, {
            batchLabel: label,
            count: codes.length,
            freeMonths: input.freeMonths,
            validDays: input.validDays,
            expiresAt: expiresAt.toISOString(),
            appliesToPlanIds,
            reason: input.reason ?? null,
            plannedGiftedMonths,
            highImpact: gov.highImpact,
        });

        this.events.emit('coupon.issued', {
            kind: 'batch',
            code: label,
            freeMonths: input.freeMonths,
            count: codes.length,
            plannedGiftedMonths,
            highImpact: gov.highImpact,
            reason: input.reason ?? null,
        });

        this.logger.log(`[Coupons] batch ${label} (${batchId}) — ${codes.length} single-use codes, expire ${expiresAt.toISOString()}`);

        return { batchId, batchLabel: label, created: codes.length, expiresAt, codes };
    }

    /** Resumen por lote: cuántos quedan libres, cuántos se usaron y cuántos vencieron. */
    async listBatches(): Promise<any[]> {
        return this.prisma.$queryRaw<any[]>`
            SELECT
                "batch_id"                                          AS "batchId",
                MIN("batch_label")                                  AS "batchLabel",
                MIN("free_months")::int                             AS "freeMonths",
                MIN("created_at")                                   AS "createdAt",
                MAX("expires_at")                                   AS "expiresAt",
                COUNT(*)::int                                       AS "total",
                COUNT(*) FILTER (WHERE "redemption_count" > 0)::int AS "redeemed",
                COUNT(*) FILTER (
                    WHERE "redemption_count" = 0
                      AND "is_active" = true
                      AND ("expires_at" IS NULL OR "expires_at" >= NOW())
                )::int                                              AS "available",
                COUNT(*) FILTER (
                    WHERE "redemption_count" = 0
                      AND "is_active" = true
                      AND "expires_at" IS NOT NULL AND "expires_at" < NOW()
                )::int                                              AS "expired",
                COUNT(*) FILTER (WHERE "is_active" = false)::int    AS "disabled"
            FROM "public"."billing_coupons"
            WHERE "batch_id" IS NOT NULL
            GROUP BY "batch_id"
            ORDER BY MIN("created_at") DESC
            LIMIT 200
        `;
    }

    /** Los códigos de un lote, con su estado, para repartirlos o auditarlos. */
    async listBatchCodes(batchId: string) {
        const rows = await this.prisma.billingCoupon.findMany({
            where: { batchId },
            orderBy: { code: 'asc' },
            take: MAX_BATCH_SIZE,
        });
        const now = Date.now();
        return rows.map((c: any) => ({
            id: c.id,
            code: c.code,
            status: !c.isActive
                ? 'disabled'
                : c.redemptionCount > 0
                    ? 'redeemed'
                    : c.expiresAt && c.expiresAt.getTime() < now
                        ? 'expired'
                        : 'available',
            expiresAt: c.expiresAt,
        }));
    }

    /** Apaga un lote entero. Los ya canjeados no se tocan: el regalo sigue vivo. */
    async deactivateBatch(batchId: string, actorUserId?: string) {
        const result = await this.prisma.billingCoupon.updateMany({
            where: { batchId, isActive: true },
            data: { isActive: false },
        });
        await this.writeAudit(actorUserId, 'coupon_batch_deactivated', batchId, {
            disabled: result.count,
        });
        return { disabled: result.count };
    }

    /**
     * Acuña códigos únicos. Reintenta contra la base porque dos lotes con la
     * misma palabra comparten espacio de nombres y el UNIQUE los rechazaría.
     */
    private async mintUniqueCodes(label: string, count: number): Promise<string[]> {
        const picked = new Set<string>();
        // El sufijo crece si el lote es grande, para no forzar la suerte: con 6
        // caracteres del alfabeto seguro hay ~594 millones de combinaciones.
        const suffixLen = count > 1000 ? 8 : 6;

        for (let attempt = 0; attempt < 12 && picked.size < count; attempt++) {
            const missing = count - picked.size;
            const candidates: string[] = [];
            // Se piden de más en cada vuelta para absorber duplicados y colisiones.
            for (let i = 0; i < missing * 2; i++) {
                candidates.push(`${label}-${randomSuffix(suffixLen)}`);
            }

            const unique = [...new Set(candidates)].filter((c: string) => !picked.has(c));
            const taken = await this.prisma.billingCoupon.findMany({
                where: { code: { in: unique } },
                select: { code: true },
            });
            const takenSet = new Set<string>(taken.map((t: { code: string }) => t.code));

            for (const candidate of unique) {
                if (picked.size >= count) break;
                if (!takenSet.has(candidate)) picked.add(candidate);
            }
        }

        if (picked.size < count) {
            throw new ConflictException({
                error: 'code_space_exhausted',
                message: `Could not mint ${count} unique codes for "${label}". Try a different word.`,
            });
        }
        return [...picked];
    }

    // ── Validation + Redemption ────────────────────────────────────

    /**
     * Valida un código para un tenant×plan. Lo usa el preview del checkout y el
     * propio canje. NO muta nada.
     */
    async validate(input: {
        code: string;
        tenantId: string;
        planId: string;
    }): Promise<{
        valid: boolean;
        coupon?: any;
        error?: string;
    }> {
        const coupon = await this.getByCode(input.code);
        if (!coupon) return { valid: false, error: 'not_found' };
        if (!coupon.isActive) return { valid: false, error: 'inactive' };
        // Los cupones legacy de porcentaje/monto nunca descontaron nada: se
        // rechazan acá para no volver a prometer un descuento que no ocurre.
        if (coupon.type !== CouponsService.REDEEMABLE_TYPE || !coupon.freeMonths) {
            return { valid: false, error: 'type_not_supported' };
        }
        if (coupon.expiresAt && coupon.expiresAt < new Date()) return { valid: false, error: 'expired' };
        if (coupon.maxRedemptions && coupon.redemptionCount >= coupon.maxRedemptions) {
            return { valid: false, error: 'max_redemptions_reached' };
        }
        if (coupon.appliesToPlanIds.length > 0
            && !(await this.isPlanEligible(coupon.appliesToPlanIds, input.planId))) {
            return { valid: false, error: 'plan_not_eligible' };
        }
        const previousRedemption = await this.prisma.billingCouponRedemption.findUnique({
            where: { couponId_tenantId: { couponId: coupon.id, tenantId: input.tenantId } },
        });
        if (previousRedemption) return { valid: false, error: 'already_redeemed' };

        return { valid: true, coupon };
    }

    /**
     * Canjea un cupón de meses gratis y aplica el efecto en la MISMA transacción.
     *
     * Antes esto vivía en dos lugares: el service escribía la fila y commiteaba, y
     * recién después el controller llamaba a `BillingService.applyFreeMonthsExtension`.
     * Si esa segunda llamada fallaba el cupón quedaba quemado (`already_redeemed`)
     * sin haber regalado nada, y no había forma de revertirlo. Ahora o pasan las dos
     * cosas o no pasa ninguna.
     */
    async redeemForTenant(input: {
        code: string;
        tenantId: string;
        actorUserId?: string;
        source: 'onboarding' | 'billing_settings' | 'admin';
    }): Promise<{
        redemptionId: string;
        code: string;
        freeMonths: number;
        trialEndsAt: Date;
        description: string | null;
    }> {
        const sub = await this.prisma.billingSubscription.findUnique({
            where: { tenantId: input.tenantId },
        });
        if (!sub) {
            throw new BadRequestException({
                error: 'no_subscription',
                message: 'Tenant has no subscription to apply coupon to.',
            });
        }

        const validation = await this.validate({
            code: input.code,
            tenantId: input.tenantId,
            planId: sub.planId,
        });
        if (!validation.valid || !validation.coupon) {
            throw new BadRequestException({
                error: validation.error,
                message: 'Invalid or already-used coupon.',
            });
        }
        const coupon = validation.coupon;

        // Guarda dura contra el doble cobro. Extender la fecha local no cancela ni
        // pausa el preapproval de MercadoPago: si hay suscripción viva en el
        // proveedor, el tenant vería "1 mes gratis" y le seguirían cobrando. Además
        // pisar el estado a `trialing` haría que el cron de trial vencido lo tirara a
        // past_due un mes después, aunque nunca hubiera dejado de pagar.
        if (sub.providerSubscriptionId) {
            throw new BadRequestException({
                error: 'active_provider_subscription',
                message:
                    'This tenant has a live provider subscription. Cancel or pause it before applying a free-months coupon.',
            });
        }

        const months: number = coupon.freeMonths;

        // Tope de stacking: un tenant no puede apilar cupones distintos y encadenar
        // meses gratis sin límite. Se evalúa contra los meses YA canjeados vivos.
        await this.governance.assertStackingAllowed(input.tenantId, months);

        // Base = el vencimiento futuro si todavía no pasó; si ya venció (tenant en
        // past_due que vuelve por una campaña de recuperación), se cuenta desde hoy.
        // Sumarle meses a una fecha pasada regalaría un mes que ya se consumió.
        const now = new Date();
        const base = sub.trialEndsAt && sub.trialEndsAt > now ? sub.trialEndsAt : now;
        const newTrialEnd = addCalendarMonths(base, months);
        const newPeriodEnd =
            sub.currentPeriodEnd && sub.currentPeriodEnd > newTrialEnd ? sub.currentPeriodEnd : newTrialEnd;

        const redemptionId = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // Incremento condicional y atómico: el tope global se evalúa dentro del
            // mismo UPDATE, así dos canjes en paralelo no pueden pasarse del límite.
            // `updated_at` es @updatedAt en Prisma, o sea que en SQL crudo hay que
            // setearlo a mano (la columna no tiene DEFAULT).
            // Schema explícito: el pool corre con search_path variable (multi-tenant),
            // así que una tabla global nunca se referencia sin calificar.
            const affected = await tx.$executeRaw`
                UPDATE "public"."billing_coupons"
                   SET "redemption_count" = "redemption_count" + 1,
                       "updated_at" = NOW()
                 WHERE "id" = ${coupon.id}
                   AND "is_active" = true
                   AND ("expires_at" IS NULL OR "expires_at" >= NOW())
                   AND ("max_redemptions" IS NULL OR "redemption_count" < "max_redemptions")
            `;
            if (affected !== 1) {
                throw new BadRequestException({ error: 'max_redemptions_reached' });
            }

            let redemption;
            try {
                redemption = await tx.billingCouponRedemption.create({
                    data: {
                        couponId: coupon.id,
                        tenantId: input.tenantId,
                        subscriptionId: sub.id,
                        cyclesRemaining: null,
                        // El estado previo se guarda para poder DESHACER el regalo:
                        // `revokeRedemption` lo restaura tal cual estaba. Sin esto,
                        // cortar un cupón sería adivinar a qué fecha volver.
                        metadata: {
                            source: input.source,
                            freeMonths: months,
                            previousTrialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
                            previousCurrentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
                            previousStatus: sub.status,
                            newTrialEndsAt: newTrialEnd.toISOString(),
                            redeemedByUserId: input.actorUserId ?? null,
                        },
                    },
                });
            } catch (err: any) {
                // Doble clic / carrera: el UNIQUE (couponId, tenantId) es la guarda
                // real. Sin este catch salía un 500 en vez del 400 que la UI traduce.
                if (err?.code === 'P2002') {
                    throw new BadRequestException({ error: 'already_redeemed' });
                }
                throw err;
            }

            await tx.billingSubscription.update({
                where: { id: sub.id },
                data: {
                    trialEndsAt: newTrialEnd,
                    currentPeriodEnd: newPeriodEnd,
                    status: SubscriptionStatus.TRIALING,
                },
            });
            await tx.tenant.update({
                where: { id: input.tenantId },
                data: {
                    trialEndsAt: newTrialEnd,
                    currentPeriodEnd: newPeriodEnd,
                    subscriptionStatus: SubscriptionStatus.TRIALING,
                },
            });

            return redemption.id;
        });

        // Fuera de la transacción: cachés y auditoría no deben abortar el canje.
        await this.redis.del(`tenant_plan:${input.tenantId}`);
        await this.redis.del(`sub_status:${input.tenantId}`);
        // El tenant volvió a `trialing`: si venía arrastrando el reloj de gracia por
        // impago, hay que apagarlo o el guard lo seguiría contando como vencido.
        await this.redis.del(`offboard:past_due:${input.tenantId}`);

        await this.writeAudit(input.actorUserId, 'coupon_redeemed', coupon.id, {
            code: coupon.code,
            tenantId: input.tenantId,
            freeMonths: months,
            source: input.source,
            newTrialEndsAt: newTrialEnd.toISOString(),
        }, input.tenantId);

        this.logger.log(
            `[Coupons] ${coupon.code} redeemed by tenant ${input.tenantId} (${input.source}) — trial extended ${months}m to ${newTrialEnd.toISOString()}`,
        );

        // El aviso al dueño sale por evento y no llamando a Telegram desde acá:
        // así este servicio no depende del módulo de alertas (que arrastra colas y
        // AIModule) y un fallo de la notificación no puede tumbar un canje ya hecho.
        const tenantName = await this.tenantName(input.tenantId);
        this.events.emit('coupon.redeemed', {
            code: coupon.code,
            tenantId: input.tenantId,
            tenantName,
            freeMonths: months,
            source: input.source,
            trialEndsAt: newTrialEnd,
            description: coupon.description ?? null,
        });

        return {
            redemptionId,
            code: coupon.code,
            freeMonths: months,
            trialEndsAt: newTrialEnd,
            description: coupon.description ?? null,
        };
    }

    /** Canjes de un cupón, con el nombre del tenant resuelto — para el panel admin. */
    async listRedemptions(couponId: string, limit = 100) {
        const rows = await this.prisma.billingCouponRedemption.findMany({
            where: { couponId },
            orderBy: { redeemedAt: 'desc' },
            take: limit,
        });
        if (rows.length === 0) return [];

        // Los callbacks van anotados a mano a propósito: en CI `tsc` corre ANTES de
        // `prisma generate` (.github/workflows/deploy.yml), así que ahí los modelos
        // del cliente son `any` y cualquier parámetro sin anotar explota con TS7006
        // aunque en local compile limpio.
        const tenantIds = [...new Set(rows.map((r: CouponRedemptionRow) => r.tenantId))];

        // `tenant_id` es TEXT sin FK (la tabla es global y los tenants se purgan),
        // así que la resolución del nombre se hace acá y tolera huérfanos.
        const tenants = await this.prisma.tenant.findMany({
            where: { id: { in: tenantIds } },
            select: { id: true, name: true, slug: true, subscriptionStatus: true, trialEndsAt: true },
        });
        const byId = new Map<string, RedemptionTenantRef>(
            tenants.map((t: RedemptionTenantRef): [string, RedemptionTenantRef] => [t.id, t]),
        );

        return rows.map((r: CouponRedemptionRow) => this.decorateRedemption(r, byId.get(r.tenantId) ?? null));
    }

    /**
     * Todos los canjes, de todos los cupones — la vista de control del dueño:
     * quién entró por cupón, con cuál, y cuántos días de regalo le quedan.
     */
    async listAllRedemptions(limit = 300) {
        const rows = await this.prisma.billingCouponRedemption.findMany({
            orderBy: { redeemedAt: 'desc' },
            take: limit,
            include: { coupon: true },
        });
        if (rows.length === 0) return [];

        const tenantIds = [...new Set(rows.map((r: CouponRedemptionRow) => r.tenantId))];
        const tenants = await this.prisma.tenant.findMany({
            where: { id: { in: tenantIds } },
            select: { id: true, name: true, slug: true, subscriptionStatus: true, trialEndsAt: true },
        });
        const byId = new Map<string, RedemptionTenantRef>(
            tenants.map((t: RedemptionTenantRef): [string, RedemptionTenantRef] => [t.id, t]),
        );

        return rows.map((r: any) => this.decorateRedemption(r, byId.get(r.tenantId) ?? null, r.coupon));
    }

    /**
     * Corta un regalo en curso y devuelve la suscripción al estado exacto que
     * tenía antes del canje (fechas y estado guardados en `metadata`).
     *
     * La fila NO se borra: se marca revocada. Borrarla dejaría al tenant canjear
     * el mismo código otra vez —el UNIQUE (couponId, tenantId) es justamente lo
     * que lo impide— y además se perdería el rastro de que el regalo existió.
     * El contador global sí se devuelve, para que el cupo quede libre para otro.
     */
    async revokeRedemption(redemptionId: string, actorUserId?: string, reason?: string) {
        const redemption: any = await this.prisma.billingCouponRedemption.findUnique({
            where: { id: redemptionId },
            include: { coupon: true },
        });
        if (!redemption) throw new NotFoundException({ error: 'redemption_not_found' });

        const meta = (redemption.metadata || {}) as Record<string, any>;
        if (meta.revokedAt) {
            throw new BadRequestException({ error: 'already_revoked', message: 'This redemption was already revoked.' });
        }

        const sub = await this.prisma.billingSubscription.findUnique({
            where: { tenantId: redemption.tenantId },
        });

        // Si la suscripción ya tiene cobro automático vivo, el tenant pasó a pagar
        // después del regalo: pisarle las fechas ahora lo dejaría en un estado que
        // no se corresponde con lo que MercadoPago va a cobrar.
        if (sub?.providerSubscriptionId) {
            throw new BadRequestException({
                error: 'active_provider_subscription',
                message: 'Tenant already moved to a paid subscription; revoking would desync local dates from the provider.',
            });
        }

        const restoredTrialEnd = meta.previousTrialEndsAt ? new Date(meta.previousTrialEndsAt) : null;
        const restoredPeriodEnd = meta.previousCurrentPeriodEnd
            ? new Date(meta.previousCurrentPeriodEnd)
            // Los canjes anteriores a este cambio no guardaron el período: durante
            // el trial coincide con trialEndsAt, así que es la mejor reconstrucción.
            : restoredTrialEnd;
        const restoredStatus = typeof meta.previousStatus === 'string'
            ? meta.previousStatus
            : SubscriptionStatus.TRIALING;

        await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            if (sub) {
                await tx.billingSubscription.update({
                    where: { id: sub.id },
                    data: {
                        trialEndsAt: restoredTrialEnd,
                        currentPeriodEnd: restoredPeriodEnd,
                        status: restoredStatus,
                    },
                });
                await tx.tenant.update({
                    where: { id: redemption.tenantId },
                    data: {
                        trialEndsAt: restoredTrialEnd,
                        currentPeriodEnd: restoredPeriodEnd,
                        subscriptionStatus: restoredStatus,
                    },
                });
            }

            await tx.billingCouponRedemption.update({
                where: { id: redemptionId },
                data: {
                    metadata: {
                        ...meta,
                        revokedAt: new Date().toISOString(),
                        revokedByUserId: actorUserId ?? null,
                        revokeReason: reason ?? null,
                    },
                },
            });

            // Nunca por debajo de 0: un contador negativo rompería el tope global.
            await tx.$executeRaw`
                UPDATE "public"."billing_coupons"
                   SET "redemption_count" = GREATEST("redemption_count" - 1, 0),
                       "updated_at" = NOW()
                 WHERE "id" = ${redemption.couponId}
            `;
        });

        await this.redis.del(`tenant_plan:${redemption.tenantId}`);
        await this.redis.del(`sub_status:${redemption.tenantId}`);

        await this.writeAudit(actorUserId, 'coupon_redemption_revoked', redemption.couponId, {
            code: redemption.coupon?.code,
            redemptionId,
            tenantId: redemption.tenantId,
            reason: reason ?? null,
            restoredTrialEndsAt: restoredTrialEnd?.toISOString() ?? null,
            restoredStatus,
        }, redemption.tenantId);

        const tenantName = await this.tenantName(redemption.tenantId);
        this.events.emit('coupon.revoked', {
            code: redemption.coupon?.code ?? '—',
            tenantId: redemption.tenantId,
            tenantName,
            reason: reason ?? null,
            restoredTrialEndsAt: restoredTrialEnd,
        });

        this.logger.log(
            `[Coupons] redemption ${redemptionId} (${redemption.coupon?.code}) revoked for tenant ${redemption.tenantId}`,
        );

        return { redemptionId, restoredTrialEndsAt: restoredTrialEnd, restoredStatus };
    }

    /** Canjes de un tenant — para pintar el badge de "descuento aplicado". */
    async tenantRedemptions(tenantId: string) {
        return this.prisma.billingCouponRedemption.findMany({
            where: { tenantId },
            include: { coupon: true },
            orderBy: { redeemedAt: 'desc' },
        });
    }

    // ── Internals ──────────────────────────────────────────────────

    /**
     * Agrega a cada canje lo que el dueño necesita ver de un vistazo: si sigue
     * vigente y cuántos días de regalo quedan.
     *
     * Los días se calculan contra el `trialEndsAt` ACTUAL del tenant, no contra el
     * que se escribió al canjear: si después cambió de plan, pagó o se le revocó,
     * lo que importa es lo que le queda hoy, no lo que se le prometió.
     */
    private decorateRedemption(
        row: any,
        tenant: RedemptionTenantRef | null,
        coupon?: { code?: string; freeMonths?: number | null } | null,
    ) {
        const meta = (row.metadata || {}) as Record<string, any>;
        const revokedAt: string | null = meta.revokedAt ?? null;
        const trialEndsAt: Date | null = tenant?.trialEndsAt ?? null;

        let daysRemaining: number | null = null;
        if (!revokedAt && trialEndsAt) {
            const ms = trialEndsAt.getTime() - Date.now();
            daysRemaining = ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
        }

        return {
            id: row.id,
            couponId: row.couponId,
            couponCode: coupon?.code ?? null,
            freeMonths: meta.freeMonths ?? coupon?.freeMonths ?? null,
            tenantId: row.tenantId,
            tenant,
            redeemedAt: row.redeemedAt,
            source: meta.source ?? null,
            revoked: !!revokedAt,
            revokedAt,
            revokeReason: meta.revokeReason ?? null,
            trialEndsAt,
            daysRemaining,
            subscriptionStatus: tenant?.subscriptionStatus ?? null,
        };
    }

    /** Nombre del tenant para los avisos; nunca hace fallar al que lo llama. */
    private async tenantName(tenantId: string): Promise<string> {
        try {
            const t = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { name: true },
            });
            return t?.name || tenantId;
        } catch {
            return tenantId;
        }
    }

    /**
     * Normaliza la lista de planes elegibles a SLUGS y rechaza los que no existen.
     *
     * Se guardan slugs y no ids aunque la columna se llame `applies_to_plan_ids`:
     * `billing_subscriptions.plan_id` sí es el UUID del plan, pero esos UUID los
     * genera el seed y se regeneran si la base se recrea, con lo cual un cupón
     * viejo dejaría de aplicar sin que nadie se entere. Además un UUID en el
     * panel no le dice nada a nadie. El slug es estable y legible.
     *
     * Un plan inexistente se rechaza en vez de guardarse: un typo silencioso
     * dejaría un cupón que no aplica a NADA y que parece configurado.
     */
    private async normalizePlanSlugs(input?: string[]): Promise<string[]> {
        if (!input || input.length === 0) return [];

        const wanted = [...new Set(input.map((p: string) => String(p).trim()).filter(Boolean))];
        if (wanted.length === 0) return [];

        const plans = await this.prisma.billingPlan.findMany({
            where: { OR: [{ slug: { in: wanted } }, { id: { in: wanted } }] },
            select: { id: true, slug: true },
        });
        const bySlug = new Set<string>(plans.map((p: BillingPlanRef) => p.slug));
        const byId = new Map<string, string>(
            plans.map((p: BillingPlanRef): [string, string] => [p.id, p.slug]),
        );

        const resolved: string[] = [];
        const unknown: string[] = [];
        for (const key of wanted) {
            const slug = bySlug.has(key) ? key : byId.get(key);
            if (slug) resolved.push(slug);
            else unknown.push(key);
        }
        if (unknown.length > 0) {
            throw new BadRequestException({
                error: 'unknown_plan',
                message: `Unknown plan(s): ${unknown.join(', ')}`,
            });
        }
        return [...new Set(resolved)];
    }

    /**
     * ¿El plan del tenant está en la allow-list del cupón?
     *
     * Acepta slug o UUID de los dos lados: lo nuevo se guarda como slug, pero las
     * filas creadas antes de este cambio pueden tener UUID y tienen que seguir
     * funcionando.
     */
    private async isPlanEligible(appliesTo: string[], planKey: string): Promise<boolean> {
        if (appliesTo.includes(planKey)) return true;

        const plan = await this.prisma.billingPlan.findFirst({
            where: { OR: [{ id: planKey }, { slug: planKey }] },
            select: { id: true, slug: true },
        });
        if (!plan) return false;

        return appliesTo.includes(plan.id) || appliesTo.includes(plan.slug);
    }

    /**
     * Los cupones no dejaban ningún rastro: ni crearlos, ni desactivarlos, ni
     * canjearlos escribían en audit_logs (a diferencia de refund y comp-plan). Un
     * cupón de 24 meses gratis era invisible después del hecho.
     */
    private async writeAudit(
        userId: string | undefined,
        action: string,
        couponId: string,
        details: Record<string, any>,
        tenantId?: string,
    ): Promise<void> {
        try {
            await this.prisma.auditLog.create({
                data: {
                    userId: userId ?? null,
                    tenantId: tenantId ?? null,
                    action,
                    resource: `billing_coupons/${couponId}`,
                    details,
                },
            });
        } catch (err: any) {
            this.logger.warn(`[Coupons] audit write failed for ${action}: ${err?.message}`);
        }
    }
}

/**
 * Suma meses de CALENDARIO. El código original hacía `months * 30 * 86_400_000`,
 * así que "1 mes gratis" eran 30 días y "12 meses" eran 360 — se comía 5 días al
 * año. Si el mes destino no tiene ese día (31 de enero + 1 mes), cae al último día
 * del mes destino en vez de desbordar a marzo.
 */
/** Tope por lote: cota superior del INSERT y del listado de códigos. */
export const MAX_BATCH_SIZE = 2000;

/**
 * Alfabeto sin I, L, O, 0 ni 1. Estos códigos los tipea una persona desde un
 * mail o un cartel, y esas cinco son exactamente las que se confunden entre sí.
 * `randomInt` es criptográfico: un código adivinable es un mes gratis regalado.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomSuffix(length: number): string {
    let out = '';
    for (let i = 0; i < length; i++) {
        out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    return out;
}

export function addCalendarMonths(from: Date, months: number): Date {
    const result = new Date(from.getTime());
    const day = result.getUTCDate();
    result.setUTCMonth(result.getUTCMonth() + months);
    if (result.getUTCDate() < day) {
        result.setUTCDate(0);
    }
    return result;
}
