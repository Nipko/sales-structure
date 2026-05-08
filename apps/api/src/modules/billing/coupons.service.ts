import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Coupon system for promotional codes. Three coupon types:
 *
 *  - free_months: extends the trial by N months. Applied immediately at
 *    redemption — bumps `trialEndsAt` and `currentPeriodEnd` so MP doesn't
 *    charge during the gift period. The provider subscription continues
 *    on its own schedule; we just push our local "expected next charge"
 *    out.
 *
 *  - percent_off / amount_off: tracked as a redemption row with
 *    `cyclesRemaining`. MP doesn't support discount adjustments on
 *    preapprovals natively, so the actual credit is reconciled outside
 *    the subscription flow (manual credit notes via fiscal integration
 *    or super_admin issues a refund equal to the discount after each
 *    successful charge — see runbook).
 *
 * Validation rules enforced:
 *  - one redemption per tenant per coupon
 *  - global maxRedemptions cap
 *  - expiresAt cutoff
 *  - planId allow-list (empty array = any plan)
 */
@Injectable()
export class CouponsService {
    private readonly logger = new Logger(CouponsService.name);

    constructor(private readonly prisma: PrismaService) {}

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

    async create(input: {
        code: string;
        description?: string;
        type: 'percent_off' | 'amount_off' | 'free_months';
        percentDiscount?: number;
        amountOffCents?: number;
        freeMonths?: number;
        durationCycles?: number;
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

        // Type-specific validation
        if (input.type === 'percent_off') {
            if (!input.percentDiscount || input.percentDiscount < 1 || input.percentDiscount > 100) {
                throw new BadRequestException({ error: 'invalid_percent', message: 'percentDiscount must be 1-100' });
            }
        } else if (input.type === 'amount_off') {
            if (!input.amountOffCents || input.amountOffCents < 1) {
                throw new BadRequestException({ error: 'invalid_amount', message: 'amountOffCents must be >= 1' });
            }
        } else if (input.type === 'free_months') {
            if (!input.freeMonths || input.freeMonths < 1 || input.freeMonths > 24) {
                throw new BadRequestException({ error: 'invalid_months', message: 'freeMonths must be 1-24' });
            }
        } else {
            throw new BadRequestException({ error: 'invalid_type' });
        }

        const existing = await this.prisma.billingCoupon.findUnique({ where: { code } });
        if (existing) throw new ConflictException({ error: 'code_already_exists' });

        return this.prisma.billingCoupon.create({
            data: {
                code,
                description: input.description ?? null,
                type: input.type,
                percentDiscount: input.percentDiscount ?? null,
                amountOffCents: input.amountOffCents ?? null,
                freeMonths: input.freeMonths ?? null,
                durationCycles: input.durationCycles ?? null,
                appliesToPlanIds: input.appliesToPlanIds ?? [],
                maxRedemptions: input.maxRedemptions ?? null,
                expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
                createdByUserId: input.createdByUserId ?? null,
            },
        });
    }

    async update(id: string, data: Partial<{
        description: string;
        isActive: boolean;
        maxRedemptions: number | null;
        expiresAt: string | null;
        appliesToPlanIds: string[];
    }>) {
        return this.prisma.billingCoupon.update({
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
    }

    async deactivate(id: string) {
        return this.prisma.billingCoupon.update({
            where: { id },
            data: { isActive: false },
        });
    }

    // ── Validation + Redemption ────────────────────────────────────

    /**
     * Validate a coupon code for a tenant×plan combo. Used by checkout to
     * preview the discount before redeeming. Does NOT mutate state.
     */
    async validate(input: {
        code: string;
        tenantId: string;
        planId: string;
    }): Promise<{
        valid: boolean;
        coupon?: any;
        error?: string;
        message?: string;
    }> {
        const coupon = await this.getByCode(input.code);
        if (!coupon) return { valid: false, error: 'not_found' };
        if (!coupon.isActive) return { valid: false, error: 'inactive' };
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
     * Redeem a coupon. Caller (BillingService) is responsible for any
     * subscription-side updates (e.g. extending trialEndsAt for free_months)
     * — this method only writes the redemption record and bumps the counter.
     * Wrapped in a transaction so the unique constraint on (couponId,tenantId)
     * doubles as a concurrency guard.
     */
    async redeem(input: {
        couponId: string;
        tenantId: string;
        subscriptionId?: string;
    }): Promise<{ redemptionId: string; cyclesRemaining: number | null }> {
        return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const coupon = await tx.billingCoupon.findUnique({ where: { id: input.couponId } });
            if (!coupon) throw new NotFoundException({ error: 'coupon_not_found' });
            if (!coupon.isActive) throw new BadRequestException({ error: 'inactive' });

            const redemption = await tx.billingCouponRedemption.create({
                data: {
                    couponId: input.couponId,
                    tenantId: input.tenantId,
                    subscriptionId: input.subscriptionId ?? null,
                    cyclesRemaining: coupon.type === 'free_months' ? null : (coupon.durationCycles ?? null),
                },
            });

            await tx.billingCoupon.update({
                where: { id: input.couponId },
                data: { redemptionCount: { increment: 1 } },
            });

            return {
                redemptionId: redemption.id,
                cyclesRemaining: redemption.cyclesRemaining,
            };
        });
    }

    /** List redemptions for a coupon — used by the admin detail page. */
    async listRedemptions(couponId: string, limit = 100) {
        return this.prisma.billingCouponRedemption.findMany({
            where: { couponId },
            orderBy: { redeemedAt: 'desc' },
            take: limit,
        });
    }

    /** All redemptions for a tenant — used to render "applied discount" badges. */
    async tenantRedemptions(tenantId: string) {
        return this.prisma.billingCouponRedemption.findMany({
            where: { tenantId },
            include: { coupon: true },
            orderBy: { redeemedAt: 'desc' },
        });
    }
}
