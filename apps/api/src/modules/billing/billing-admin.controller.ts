import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsPositive, IsString, Min } from 'class-validator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { MercadoPagoAdapter } from './adapters/mercadopago.adapter';
import { MercadoPagoConfigService } from './adapters/mercadopago-config.service';
import { BillingReconciliationProcessor } from './processors/reconciliation.processor';
import {
    PLAN_FEATURE_REGISTRY,
    NESTED_OBJECT_KEYS,
    validatePlanFeatures,
    unknownFeatureKeys,
} from '../throttle/plan-features.registry';

// Countries for which we can register a MercadoPago preapproval_plan. Mirrors
// scripts/sync-mp-plans.js — MP subscriptions are per-country.
const SYNC_CURRENCY_BY_COUNTRY: Record<string, string> = {
    CO: 'COP', AR: 'ARS', MX: 'MXN', CL: 'CLP', PE: 'PEN', UY: 'UYU', BR: 'BRL',
};

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

class SyncMpPlanDto {
    @IsOptional() @IsString() country?: string;
    // Only used when the plan has no fixed local price for the country yet.
    @IsOptional() @IsNumber() @IsPositive() fx?: number;
    // Recreate the preapproval_plan in MP even if one already exists (e.g. after
    // a price change). MP cannot delete plans, so this orphans the old one.
    @IsOptional() @IsBoolean() force?: boolean;
}

class ReconcileDto {
    @IsOptional() @IsIn(['full', 'past_due']) scope?: 'full' | 'past_due';
}

@Controller('billing-admin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin')
export class BillingAdminController {
    constructor(
        private readonly billingService: BillingService,
        private readonly prisma: PrismaService,
        private readonly throttle: TenantThrottleService,
        private readonly mp: MercadoPagoAdapter,
        private readonly mpConfig: MercadoPagoConfigService,
        private readonly reconciliation: BillingReconciliationProcessor,
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
        @Req() req: any,
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

        // Audit trail — plan catalog edits move real money, so record who changed
        // what (before → after), the same pattern setTenantPlan uses. tenantId is
        // null because a plan is global catalog, not a per-tenant resource.
        const scalarFields = ['name', 'priceUsdCents', 'trialDays', 'requiresCardForTrial', 'maxAgents', 'maxAiMessages', 'isActive'];
        const changes: Record<string, any> = {};
        for (const f of scalarFields) {
            if ((existing as any)[f] !== (updated as any)[f]) {
                changes[f] = { from: (existing as any)[f], to: (updated as any)[f] };
            }
        }
        if (body.features) {
            changes.features = Object.fromEntries(
                Object.keys(body.features).map((k) => [
                    k,
                    { from: (existing.features as any)?.[k], to: (updated.features as any)?.[k] },
                ]),
            );
        }
        if (body.priceLocalOverrides) {
            changes.priceLocalOverrides = { from: existing.priceLocalOverrides, to: updated.priceLocalOverrides };
        }
        if (Object.keys(changes).length > 0) {
            await this.prisma.auditLog.create({
                data: {
                    tenantId: null,
                    userId: req.user?.sub,
                    action: 'billing_plan_updated',
                    resource: `billing-plans/${slug}`,
                    details: { slug, changes },
                },
            });
        }

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

    // ── MercadoPago provider status ─────────────────────────────
    // Powers the sandbox/production badge in /admin/plans so the operator can
    // confirm which environment is live before/after a credentials cutover.
    @Get('provider-status')
    providerStatus() {
        return {
            success: true,
            data: {
                mercadopago: {
                    environment: this.mpConfig.environment(),
                    configured: this.mpConfig.isConfigured(),
                    webhookConfigured: Boolean(this.mpConfig.webhookSecret),
                },
            },
        };
    }

    // ── Sync a plan to MercadoPago (register/recreate preapproval_plan) ──
    // Replaces the SSH-only scripts/sync-mp-plans.js for a single plan+country.
    // The DB price (edited via PUT plans/:slug) is only what we SHOW; MP charges
    // the amount frozen in the preapproval_plan, so a price change is not live
    // until this runs. Existing plans are skipped unless force=true.
    @Post('plans/:slug/sync-mp')
    @HttpCode(HttpStatus.OK)
    async syncPlanToMp(
        @Param('slug') slug: string,
        @Body() body: SyncMpPlanDto,
        @Req() req: any,
    ) {
        if (slug === 'custom') {
            throw new BadRequestException({ error: 'custom_not_syncable', message: 'El plan Custom es sales-led y no se sincroniza con MercadoPago.' });
        }
        const plan = await this.prisma.billingPlan.findUnique({ where: { slug } });
        if (!plan) throw new NotFoundException('Plan not found');

        const country = (body.country || 'CO').toUpperCase();
        const currency = SYNC_CURRENCY_BY_COUNTRY[country];
        if (!currency) {
            throw new BadRequestException({
                error: 'unsupported_country',
                message: `País ${country} no soportado. Soportados: ${Object.keys(SYNC_CURRENCY_BY_COUNTRY).join(', ')}.`,
            });
        }
        if (!this.mpConfig.isConfigured()) {
            throw new BadRequestException({ error: 'mp_not_configured', message: 'MercadoPago no está configurado (falta MP_ACCESS_TOKEN).' });
        }

        const overrides: Record<string, any> = (plan.priceLocalOverrides && typeof plan.priceLocalOverrides === 'object')
            ? { ...(plan.priceLocalOverrides as any) }
            : {};
        const existing = overrides[country];

        // Idempotent: an already-synced plan is skipped unless force=true.
        if (existing?.mpPlanId && !body.force) {
            return { success: true, data: { slug, country, currency, mpPlanId: existing.mpPlanId, amountCents: existing.amountCents ?? null, skipped: true } };
        }

        let amountCents: number;
        if (existing?.amountCents) {
            amountCents = existing.amountCents;
        } else if (body.fx) {
            amountCents = Math.round(plan.priceUsdCents * body.fx);
        } else {
            throw new BadRequestException({
                error: 'no_local_price',
                message: `No hay precio local para ${country} ni se pasó un tipo de cambio. Definí el precio local del plan o pasá fx.`,
            });
        }

        const providerPlan = await this.mp.createPlan({
            slug: plan.slug,
            name: `${plan.name} — Parallly ${country}`,
            amountCents,
            currency,
            billingInterval: 'month',
            trialDays: 0,
        });

        overrides[country] = { ...(existing ?? {}), currency, amountCents, mpPlanId: providerPlan.providerPlanId };
        const data: any = { priceLocalOverrides: overrides };
        // Keep the legacy top-level column in sync for CO (resolveProviderPlanId fallback).
        if (country === 'CO') data.mpPlanId = providerPlan.providerPlanId;
        await this.prisma.billingPlan.update({ where: { slug }, data });

        await this.prisma.auditLog.create({
            data: {
                tenantId: null,
                userId: req.user?.sub,
                action: 'billing_plan_synced_mp',
                resource: `billing-plans/${slug}`,
                details: { country, currency, amountCents, mpPlanId: providerPlan.providerPlanId, force: !!body.force },
            },
        });

        return { success: true, data: { slug, country, currency, amountCents, mpPlanId: providerPlan.providerPlanId, skipped: false } };
    }

    // ── Reconciliation on-demand ────────────────────────────────
    // Force a provider poll instead of waiting for the hourly/daily crons —
    // useful right after a cutover to confirm DB and MercadoPago agree.
    @Post('reconcile')
    @HttpCode(HttpStatus.OK)
    async reconcile(@Body() body: ReconcileDto, @Req() req: any) {
        const scope = body.scope || 'full';
        const result = scope === 'past_due'
            ? await this.reconciliation.reconcilePastDue()
            : await this.reconciliation.fullReconciliation();
        await this.prisma.auditLog.create({
            data: {
                tenantId: null,
                userId: req.user?.sub,
                action: 'billing_reconcile_manual',
                resource: 'billing/reconcile',
                details: { scope, ...result },
            },
        });
        return { success: true, data: { scope, ...result } };
    }

    // Reconcile a single tenant's subscription against the provider.
    @Post('tenants/:tenantId/reconcile')
    @HttpCode(HttpStatus.OK)
    async reconcileTenant(@Param('tenantId') tenantId: string) {
        const result = await this.billingService.syncFromProvider(tenantId);
        return { success: true, data: result };
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
