import {
    Body, Controller, Delete, Get, Param, Post, Put, Query,
    Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CouponsService } from './coupons.service';

/**
 * Solo se emiten cupones de meses gratis. Los tipos percent_off / amount_off
 * existen en la tabla por historia pero nunca descontaron nada del cobro, así que
 * ya no se aceptan acá ni en el service. Ver el docstring de CouponsService.
 */
class CreateCouponDto {
    @IsString() code!: string;
    @IsOptional() @IsString() description?: string;
    @IsIn(['free_months']) type!: 'free_months';
    @IsInt() @Min(1) @Max(24) freeMonths!: number;
    // Slugs de plan ('pro', 'enterprise'…). Vacío = aplica a todos.
    @IsOptional() @IsArray() @IsString({ each: true }) appliesToPlanIds?: string[];
    @IsOptional() @IsInt() @Min(1) maxRedemptions?: number;
    @IsOptional() @IsString() expiresAt?: string;
}

class UpdateCouponDto {
    @IsOptional() @IsString() description?: string;
    @IsOptional() isActive?: boolean;
    @IsOptional() maxRedemptions?: number | null;
    @IsOptional() expiresAt?: string | null;
    // Slugs de plan ('pro', 'enterprise'…). Vacío = aplica a todos.
    @IsOptional() @IsArray() @IsString({ each: true }) appliesToPlanIds?: string[];
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
    constructor(private readonly couponsService: CouponsService) {}

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
    async update(@Param('id') id: string, @Body() body: UpdateCouponDto, @Req() req: any) {
        const updated = await this.couponsService.update(id, body as any, req.user?.sub);
        return { success: true, data: updated };
    }

    @Delete('admin/:id')
    @Roles('super_admin')
    async deactivate(@Param('id') id: string, @Req() req: any) {
        await this.couponsService.deactivate(id, req.user?.sub);
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
     * Canjea el cupón para la suscripción del tenant. El canje y la extensión del
     * trial ocurren en una sola transacción dentro del service — antes eran dos
     * pasos y un fallo del segundo dejaba el cupón quemado sin regalar nada.
     */
    @Post('redeem/:tenantId')
    @Roles('tenant_admin')
    async redeem(@Param('tenantId') tenantId: string, @Body() body: RedeemCouponDto, @Req() req: any) {
        const result = await this.couponsService.redeemForTenant({
            code: body.code,
            tenantId,
            actorUserId: req.user?.sub,
            source: req.user?.role === 'super_admin' ? 'admin' : 'billing_settings',
        });

        return {
            success: true,
            data: {
                redemptionId: result.redemptionId,
                couponType: 'free_months',
                freeMonths: result.freeMonths,
                trialEndsAt: result.trialEndsAt,
                description: result.description,
            },
        };
    }
}
