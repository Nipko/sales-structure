import {
    BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query,
    Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CouponsService } from './coupons.service';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma/prisma.service';

class CreateCouponDto {
    @IsString() code!: string;
    @IsOptional() @IsString() description?: string;
    @IsString() @IsIn(['percent_off', 'amount_off', 'free_months']) type!: 'percent_off' | 'amount_off' | 'free_months';
    @IsOptional() @IsInt() @Min(1) @Max(100) percentDiscount?: number;
    @IsOptional() @IsInt() @Min(1) amountOffCents?: number;
    @IsOptional() @IsInt() @Min(1) @Max(24) freeMonths?: number;
    @IsOptional() @IsInt() @Min(1) durationCycles?: number;
    @IsOptional() @IsArray() appliesToPlanIds?: string[];
    @IsOptional() @IsInt() @Min(1) maxRedemptions?: number;
    @IsOptional() @IsString() expiresAt?: string;
}

class UpdateCouponDto {
    @IsOptional() @IsString() description?: string;
    @IsOptional() isActive?: boolean;
    @IsOptional() maxRedemptions?: number | null;
    @IsOptional() expiresAt?: string | null;
    @IsOptional() @IsArray() appliesToPlanIds?: string[];
}

class ValidateCouponDto {
    @IsString() code!: string;
    @IsString() planId!: string;
}

class RedeemCouponDto {
    @IsString() code!: string;
}

/**
 * Coupon endpoints split into two surfaces:
 *
 *   /billing-coupons/admin/...   — super_admin CRUD
 *   /billing-coupons/...         — tenant-facing validate + redeem
 *
 * Single controller with role-gated routes. The admin routes use
 * @Roles('super_admin'); the tenant routes use plain JWT auth and are
 * scoped via the path tenant param.
 */
@Controller('billing-coupons')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class CouponsController {
    constructor(
        private readonly couponsService: CouponsService,
        private readonly billingService: BillingService,
        private readonly prisma: PrismaService,
    ) {}

    // ── Admin (super_admin) ─────────────────────────────────────────

    @Get('admin')
    @Roles('super_admin')
    async list(@Query('active') active?: string) {
        const filters = active === undefined ? {} : { active: active === 'true' };
        const coupons = await this.couponsService.list(filters);
        return { success: true, data: coupons };
    }

    @Post('admin')
    @Roles('super_admin')
    async create(@Body() body: CreateCouponDto, @Req() req: any) {
        const created = await this.couponsService.create({
            ...body,
            createdByUserId: req.user?.sub,
        });
        return { success: true, data: created };
    }

    @Put('admin/:id')
    @Roles('super_admin')
    async update(@Param('id') id: string, @Body() body: UpdateCouponDto) {
        const updated = await this.couponsService.update(id, body as any);
        return { success: true, data: updated };
    }

    @Delete('admin/:id')
    @Roles('super_admin')
    async deactivate(@Param('id') id: string) {
        await this.couponsService.deactivate(id);
        return { success: true };
    }

    @Get('admin/:id/redemptions')
    @Roles('super_admin')
    async redemptions(@Param('id') id: string) {
        const data = await this.couponsService.listRedemptions(id);
        return { success: true, data };
    }

    // ── Tenant-facing ───────────────────────────────────────────────

    @Post('validate/:tenantId')
    @Roles('tenant_admin')
    async validate(@Param('tenantId') tenantId: string, @Body() body: ValidateCouponDto) {
        const result = await this.couponsService.validate({
            code: body.code,
            tenantId,
            planId: body.planId,
        });
        return { success: result.valid, data: result };
    }

    /**
     * Redeem a coupon for the tenant's active subscription. For free_months
     * coupons, this also extends the trial period locally. For percent/amount
     * coupons, this just records the redemption — actual credit is handled
     * by the runbook/manual refund flow.
     */
    @Post('redeem/:tenantId')
    @Roles('tenant_admin')
    async redeem(@Param('tenantId') tenantId: string, @Body() body: RedeemCouponDto) {
        const sub = await this.prisma.billingSubscription.findUnique({ where: { tenantId } });
        if (!sub) {
            throw new BadRequestException({ error: 'no_subscription', message: 'Tenant has no subscription to apply coupon to.' });
        }

        const validation = await this.couponsService.validate({
            code: body.code,
            tenantId,
            planId: sub.planId,
        });
        if (!validation.valid || !validation.coupon) {
            throw new BadRequestException({ error: validation.error, message: 'Invalid or already-used coupon.' });
        }

        const redemption = await this.couponsService.redeem({
            couponId: validation.coupon.id,
            tenantId,
            subscriptionId: sub.id,
        });

        // For free_months — extend the trial period locally
        if (validation.coupon.type === 'free_months' && validation.coupon.freeMonths) {
            await this.billingService.applyFreeMonthsExtension(tenantId, validation.coupon.freeMonths);
        }

        return {
            success: true,
            data: {
                redemptionId: redemption.redemptionId,
                couponType: validation.coupon.type,
                description: validation.coupon.description,
            },
        };
    }
}
