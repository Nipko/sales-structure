import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SubscriptionStatus } from './types/subscription-status.enum';

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
    ) {}

    // ── Admin CRUD ─────────────────────────────────────────────────

    async list(filters: { active?: boolean } = {}) {
        const where = filters.active === undefined ? {} : { isActive: filters.active };
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

        const existing = await this.prisma.billingCoupon.findUnique({ where: { code } });
        if (existing) throw new ConflictException({ error: 'code_already_exists' });

        const created = await this.prisma.billingCoupon.create({
            data: {
                code,
                description: input.description ?? null,
                type: CouponsService.REDEEMABLE_TYPE,
                percentDiscount: null,
                amountOffCents: null,
                freeMonths: input.freeMonths,
                durationCycles: null,
                appliesToPlanIds: input.appliesToPlanIds ?? [],
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
        const updated = await this.prisma.billingCoupon.update({
            where: { id },
            data: {
                ...(data.description !== undefined && { description: data.description }),
                ...(data.isActive !== undefined && { isActive: data.isActive }),
                ...(data.maxRedemptions !== undefined && { maxRedemptions: data.maxRedemptions }),
                ...(data.expiresAt !== undefined && {
                    expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
                }),
                ...(data.appliesToPlanIds !== undefined && { appliesToPlanIds: data.appliesToPlanIds }),
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
        if (coupon.appliesToPlanIds.length > 0 && !coupon.appliesToPlanIds.includes(input.planId)) {
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
                        metadata: {
                            source: input.source,
                            freeMonths: months,
                            previousTrialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
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

        // `tenant_id` es TEXT sin FK (la tabla es global y los tenants se purgan),
        // así que la resolución del nombre se hace acá y tolera huérfanos.
        const tenants = await this.prisma.tenant.findMany({
            where: { id: { in: [...new Set(rows.map(r => r.tenantId))] } },
            select: { id: true, name: true, slug: true, subscriptionStatus: true, trialEndsAt: true },
        });
        const byId = new Map(tenants.map(t => [t.id, t]));

        return rows.map(r => ({ ...r, tenant: byId.get(r.tenantId) ?? null }));
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
export function addCalendarMonths(from: Date, months: number): Date {
    const result = new Date(from.getTime());
    const day = result.getUTCDate();
    result.setUTCMonth(result.getUTCMonth() + months);
    if (result.getUTCDate() < day) {
        result.setUTCDate(0);
    }
    return result;
}
