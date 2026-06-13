import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import {
    PLAN_FEATURE_REGISTRY,
    NESTED_OBJECT_KEYS,
    validatePlanFeatures,
    unknownFeatureKeys,
} from '../throttle/plan-features.registry';

class RefundPaymentDto {
    @IsOptional()
    @IsInt()
    @Min(1)
    amountCents?: number;

    @IsOptional()
    @IsString()
    reason?: string;
}

class CompPlanDto {
    @IsString()
    @IsIn(['emprendedor', 'starter', 'pro', 'enterprise', 'custom'])
    planSlug!: string;

    @IsInt()
    @Min(1)
    durationDays!: number;

    @IsString()
    reason!: string;
}

class SetTenantPlanDto {
    @IsString()
    @IsIn(['emprendedor', 'starter', 'pro', 'enterprise', 'custom'])
    planSlug!: string;

    @IsOptional()
    @IsString()
    reason?: string;
}

class UpdatePlanDto {
    @IsOptional() @IsString() name?: string;
    @IsOptional() @IsInt() @Min(0) priceUsdCents?: number;
    @IsOptional() @IsInt() @Min(0) trialDays?: number;
    @IsOptional() @IsBoolean() requiresCardForTrial?: boolean;
    @IsOptional() @IsInt() @Min(0) maxAgents?: number;
    @IsOptional() @IsInt() maxAiMessages?: number;
    @IsOptional() @IsObject() features?: Record<string, any>;
    @IsOptional() @IsObject() priceLocalOverrides?: Record<string, any>;
    @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('billing-admin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin')
export class BillingAdminController {
    constructor(
        private readonly billingService: BillingService,
        private readonly prisma: PrismaService,
        private readonly throttle: TenantThrottleService,
    ) {}

    // ── Plan Management ─────────────────────────────────────────

    @Get('plans')
    async listPlans() {
        const plans = await this.prisma.billingPlan.findMany({
            orderBy: { sortOrder: 'asc' },
        });
        const counts = await this.prisma.tenant.groupBy({
            by: ['plan'],
            _count: { id: true },
            where: { isActive: true },
        });
        const countMap = Object.fromEntries(
            counts.map((c: { plan: string; _count: { id: number } }) => [c.plan, c._count.id]),
        );
        return {
            success: true,
            data: plans.map((p: any) => ({
                ...p,
                tenantCount: countMap[p.slug] || 0,
                unknownFeatureKeys: unknownFeatureKeys(p.features as any),
            })),
        };
    }

    @Get('feature-registry')
    listFeatureRegistry() {
        return { success: true, data: PLAN_FEATURE_REGISTRY };
    }

    @Get('plans/:slug')
    async getPlan(@Param('slug') slug: string) {
        const plan = await this.prisma.billingPlan.findUnique({ where: { slug } });
        if (!plan) throw new NotFoundException('Plan not found');
        const tenantCount = await this.prisma.tenant.count({
            where: { plan: slug, isActive: true },
        });
        return { success: true, data: { ...plan, tenantCount, unknownFeatureKeys: unknownFeatureKeys(plan.features as any) } };
    }

    @Put('plans/:slug')
    async updatePlan(
        @Param('slug') slug: string,
        @Body() body: UpdatePlanDto,
    ) {
        const existing = await this.prisma.billingPlan.findUnique({ where: { slug } });
        if (!existing) throw new NotFoundException('Plan not found');

        const mergedOverrides = body.priceLocalOverrides
            ? { ...((existing.priceLocalOverrides as any) ?? {}), ...body.priceLocalOverrides }
            : (existing.priceLocalOverrides as any);

        // Validate the incoming features against the canonical registry and MERGE
        // into the stored object (instead of replacing it), so a partial payload
        // can't silently wipe omitted keys and a typo can't create a dead key.
        let mergedFeatures = existing.features as any;
        if (body.features) {
            const { unknownKeys, typeErrors } = validatePlanFeatures(body.features);
            if (unknownKeys.length || typeErrors.length) {
                throw new BadRequestException({
                    error: 'invalid_features',
                    unknownKeys,
                    typeErrors,
                    message: 'El objeto features contiene claves desconocidas o tipos inválidos. Consultá GET /billing-admin/feature-registry.',
                });
            }
            mergedFeatures = this.mergeFeatures((existing.features as any) ?? {}, body.features);
        }

        const updated = await this.prisma.billingPlan.update({
            where: { slug },
            data: {
                name: body.name ?? existing.name,
                priceUsdCents: body.priceUsdCents ?? existing.priceUsdCents,
                trialDays: body.trialDays ?? existing.trialDays,
                requiresCardForTrial: body.requiresCardForTrial ?? existing.requiresCardForTrial,
                maxAgents: body.maxAgents ?? existing.maxAgents,
                maxAiMessages: body.maxAiMessages ?? existing.maxAiMessages,
                features: mergedFeatures,
                priceLocalOverrides: mergedOverrides,
                isActive: body.isActive ?? existing.isActive,
            },
        });

        const invalidated = await this.throttle.invalidatePlanCacheForSlug(slug);

        return { success: true, data: updated, invalidatedTenants: invalidated };
    }

    /** Shallow merge with 1-level deep-merge for nested config objects. */
    private mergeFeatures(existing: Record<string, any>, incoming: Record<string, any>): Record<string, any> {
        const merged: Record<string, any> = { ...existing };
        const nested = new Set<string>(NESTED_OBJECT_KEYS as readonly string[]);
        for (const [k, v] of Object.entries(incoming)) {
            if (nested.has(k) && v && typeof v === 'object' && !Array.isArray(v)
                && existing[k] && typeof existing[k] === 'object') {
                merged[k] = { ...existing[k], ...v };
            } else {
                merged[k] = v;
            }
        }
        return merged;
    }

    @Post('plans/:slug/invalidate-cache')
    @HttpCode(HttpStatus.OK)
    async invalidateCache(@Param('slug') slug: string) {
        const count = await this.throttle.invalidatePlanCacheForSlug(slug);
        return { success: true, invalidatedCount: count };
    }

    // ── Existing Operations ─────────────────────────────────────

    @Post('payments/:paymentId/refund')
    async refundPayment(
        @Param('paymentId') paymentId: string,
        @Body() body: RefundPaymentDto,
        @Req() req: any,
    ) {
        const result = await this.billingService.refundPayment({
            paymentId,
            amountCents: body.amountCents,
            reason: body.reason,
            actorUserId: req.user?.sub,
        });
        return { success: true, data: result };
    }

    @Post('tenants/:tenantId/comp-plan')
    async grantCompPlan(
        @Param('tenantId') tenantId: string,
        @Body() body: CompPlanDto,
        @Req() req: any,
    ) {
        if (!body.reason || body.reason.trim().length < 3) {
            throw new BadRequestException({ error: 'reason_required', message: 'Reason is required for audit trail.' });
        }
        await this.billingService.grantCompPlan({
            tenantId,
            planSlug: body.planSlug,
            durationDays: body.durationDays,
            reason: body.reason,
            actorUserId: req.user?.sub,
        });
        return { success: true };
    }

    // ── Permanent plan change (super_admin) ─────────────────────────
    // Unlike comp-plan (time-boxed gift), this sets the tenant's billing plan
    // outright. Updates tenant.plan, invalidates the throttle/feature caches so
    // the new entitlements apply immediately, and records an audit entry. Does
    // NOT touch the payment subscription — it's an admin entitlement override.
    @Put('tenants/:tenantId/plan')
    async setTenantPlan(
        @Param('tenantId') tenantId: string,
        @Body() body: SetTenantPlanDto,
        @Req() req: any,
    ) {
        const plan = await this.prisma.billingPlan.findUnique({ where: { slug: body.planSlug } });
        if (!plan) throw new NotFoundException('Plan not found');
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true, plan: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');

        await this.prisma.tenant.update({ where: { id: tenantId }, data: { plan: body.planSlug } });
        // Invalidate cached plan/features so the new entitlements take effect now.
        await this.throttle.invalidatePlanCacheForSlug(body.planSlug);
        if (tenant.plan && tenant.plan !== body.planSlug) {
            await this.throttle.invalidatePlanCacheForSlug(tenant.plan);
        }
        await this.prisma.auditLog.create({
            data: {
                tenantId,
                userId: req.user?.sub,
                action: 'tenant_plan_changed',
                resource: `tenants/${tenantId}`,
                details: { from: tenant.plan, to: body.planSlug, reason: body.reason ?? null },
            },
        });
        return { success: true, data: { from: tenant.plan, to: body.planSlug } };
    }
}
