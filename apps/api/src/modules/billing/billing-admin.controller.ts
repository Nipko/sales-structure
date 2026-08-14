import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Logger, NotFoundException, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { BillingService } from './billing.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { BillingReconciliationProcessor } from './processors/reconciliation.processor';
import {
    PLAN_FEATURE_REGISTRY,
    NESTED_OBJECT_KEYS,
    validatePlanFeatures,
    unknownFeatureKeys,
} from '../throttle/plan-features.registry';
import { auditActor } from '../../common/utils/audit-actor.util';
import {
    PriceOverrideValidationError,
    reconcilePlanPriceSync,
} from './billing-plan-price-sync.util';
import { normalizeBillingCountry } from './billing-country-config';
import { PaymentRoutingService } from './payment-routing.service';
import { WompiConfigService } from './adapters/wompi-config.service';
import { PaymentProviderFactory } from './payment-provider.factory';
import { PAYMENT_PROVIDER_NAMES, PaymentProviderName } from './types/provider-types';

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
    @MaxLength(80)
    planSlug!: string;

    @IsInt()
    @Min(1)
    durationDays!: number;

    @IsString()
    reason!: string;
}

class SetTenantPlanDto {
    @IsString()
    @MaxLength(80)
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
    @IsOptional() @IsInt() @Min(-1) maxAgents?: number;
    @IsOptional() @IsInt() @Min(-1) maxAiMessages?: number;
    @IsOptional() @IsObject() features?: Record<string, any>;
    @IsOptional() @IsObject() priceLocalOverrides?: Record<string, any>;
    @IsOptional() @IsBoolean() isActive?: boolean;
}

class ReconcileDto {
    @IsOptional() @IsIn(['full', 'past_due']) scope?: 'full' | 'past_due';
}

class UpdateProviderRoutingDto {
    /** L0 kill switch: { "wompi": true, "stripe": false, ... } */
    @IsOptional() @IsObject() providersEnabled?: Record<string, boolean>;
    /** L1 country defaults: { "CO": "wompi", "*": "wompi" } */
    @IsOptional() @IsObject() defaultByCountry?: Record<string, string>;
    /** Which Wompi payment methods the checkout may offer. */
    @IsOptional() @IsObject() wompiMethods?: Record<string, boolean>;
}

class SetTenantProviderDto {
    /**
     * `auto` CLEARS the pin and puts the tenant back under its country's default.
     * Without it a tenant pinned by mistake would stay pinned forever, which is
     * the trap the pin/override split exists to remove.
     */
    @IsIn([...(PAYMENT_PROVIDER_NAMES as unknown as string[]), 'auto'])
    provider!: PaymentProviderName | 'auto';

    /** Mandatory: a per-tenant billing override must always say why. */
    @IsString()
    @MaxLength(500)
    reason!: string;

    /**
     * Reassigning a tenant with a live subscription does NOT migrate the payment
     * mandate — the card/token stays at the old provider and the tenant has to
     * re-authorize. Requires an explicit force.
     */
    @IsOptional() @IsBoolean() force?: boolean;
}

@Controller('billing-admin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin')
export class BillingAdminController {
    private readonly logger = new Logger(BillingAdminController.name);

    constructor(
        private readonly billingService: BillingService,
        private readonly prisma: PrismaService,
        private readonly throttle: TenantThrottleService,
        private readonly wompiConfig: WompiConfigService,
        private readonly reconciliation: BillingReconciliationProcessor,
        private readonly routing: PaymentRoutingService,
        private readonly providerFactory: PaymentProviderFactory,
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

        let priceSync;
        try {
            priceSync = reconcilePlanPriceSync({
                planSlug: slug,
                existingOverrides: existing.priceLocalOverrides,
                incomingOverrides: body.priceLocalOverrides,
                existingUsdPriceCents: existing.priceUsdCents,
                nextUsdPriceCents: body.priceUsdCents ?? existing.priceUsdCents,
                existingLegacyMpPlanId: existing.mpPlanId,
            });
        } catch (error) {
            if (error instanceof PriceOverrideValidationError) {
                throw new BadRequestException({
                    error: 'invalid_price_local_overrides',
                    message: 'priceLocalOverrides contiene países, monedas o montos inválidos.',
                    issues: error.issues,
                });
            }
            throw error;
        }

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
                priceLocalOverrides: priceSync.priceLocalOverrides,
                mpPlanId: priceSync.legacyMpPlanId,
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
        if (priceSync.invalidated.length > 0) {
            changes.providerPlanInvalidations = {
                reason: 'configured_amount_changed',
                cycles: priceSync.invalidated,
            };
        }
        if (Object.keys(changes).length > 0) {
            await this.prisma.auditLog.create({
                data: {
                    tenantId: null,
                    userId: auditActor(req.user).userId,
                    action: 'billing_plan_updated',
                    resource: `billing-plans/${slug}`,
                    details: { slug, changes },
                },
            });
        }

        return {
            success: true,
            data: updated,
            invalidatedTenants: invalidated,
            invalidatedProviderCycles: priceSync.invalidated,
        };
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

    // ── Provider status ─────────────────────────────────────────
    // Powers the credential chips in /admin/plans → Proveedores. No provider
    // calls: environment is inferred locally from the loaded keys. MercadoPago
    // ya no aparece — está retirado y no es ruteable; sus filas históricas se
    // leen igual, pero no hay credenciales de plataforma que reportar.
    @Get('provider-status')
    async providerStatus() {
        const routing = await this.routing.getConfig();
        return {
            success: true,
            data: {
                providers: PAYMENT_PROVIDER_NAMES.reduce((acc, name) => {
                    const caps = this.providerFactory.capabilitiesOf(name);
                    acc[name] = {
                        enabled: routing.providersEnabled[name],
                        registered: this.providerFactory.isRegistered(name),
                        countries: caps.countries,
                        currencies: caps.currencies,
                        nativeSubscriptions: caps.nativeSubscriptions,
                        refunds: caps.refunds,
                        ...(name === 'wompi'
                            ? {
                                  environment: this.wompiConfig.environment(),
                                  configured: this.wompiConfig.isConfigured(),
                                  webhookConfigured: Boolean(this.wompiConfig.eventsSecret),
                              }
                            : {}),
                    };
                    return acc;
                }, {} as Record<string, any>),
                routing: {
                    defaultByCountry: routing.defaultByCountry,
                    wompiMethods: routing.wompiMethods,
                },
            },
        };
    }

    // ── Provider routing (the operator switch) ──────────────────
    // Which provider bills which country is runtime configuration, not code.
    // Flipping a country back to MercadoPago (or forward to Wompi) is a settings
    // write — no deploy, no rebuild. Scope is NEW acquisitions only: live
    // subscriptions keep the provider they were created with, and their webhooks
    // and reconciliation keep running even for a disabled provider.

    @Get('providers')
    async getProviderRouting() {
        const config = await this.routing.getConfig();
        return {
            success: true,
            data: {
                ...config,
                available: PAYMENT_PROVIDER_NAMES.map((name) => ({
                    name,
                    registered: this.providerFactory.isRegistered(name),
                    capabilities: this.providerFactory.capabilitiesOf(name),
                })),
            },
        };
    }

    @Put('providers')
    async updateProviderRouting(@Body() body: UpdateProviderRoutingDto, @Req() req: any) {
        const before = await this.routing.getConfig();
        const updated = await this.routing.updateConfig({
            providersEnabled: body.providersEnabled as any,
            defaultByCountry: body.defaultByCountry as any,
            wompiMethods: body.wompiMethods as any,
        });

        // auditActor takes the USER, not the request: passing `req` records an
        // undefined actor and never detects impersonation.
        const actor = auditActor(req?.user);
        await this.prisma.auditLog.create({
            data: {
                userId: actor.userId,
                tenantId: null,
                action: 'billing.provider_routing_changed',
                resource: 'platform_settings/billing',
                details: { before, after: updated, ...(actor.delegation ?? {}) } as any,
            },
        }).catch((err: any) => {
            // Changing who bills a whole country must never be silently unlogged.
            this.logger.error(`[Billing] Failed to audit provider routing change: ${err?.message}`);
        });

        // Same shape as GET so the caller can render straight from the response
        // instead of issuing a second request.
        return {
            success: true,
            data: {
                ...updated,
                available: PAYMENT_PROVIDER_NAMES.map((name) => ({
                    name,
                    registered: this.providerFactory.isRegistered(name),
                    capabilities: this.providerFactory.capabilitiesOf(name),
                })),
            },
        };
    }

    /**
     * Per-tenant provider override (L2). Deliberately guarded: switching a tenant
     * that already has a live subscription does not carry the payment mandate
     * across — card tokens live inside the old provider's PCI scope and cannot be
     * exported. The tenant WILL have to re-authorize, so this needs `force`.
     */
    @Put('tenants/:tenantId/payment-provider')
    async setTenantPaymentProvider(
        @Param('tenantId') tenantId: string,
        @Body() body: SetTenantProviderDto,
        @Req() req: any,
    ) {
        const reason = (body.reason || '').trim();
        if (!reason) {
            throw new BadRequestException({
                error: 'reason_required',
                message: 'A reason is required to override the payment provider of a tenant.',
            });
        }

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: {
                id: true, name: true, billingCountry: true,
                paymentProvider: true, paymentProviderOverride: true,
            },
        });
        if (!tenant) throw new NotFoundException({ error: 'tenant_not_found', tenantId });

        // `auto` releases the tenant back to its country default. Nothing to
        // validate: the router re-resolves at the next acquisition, and whatever
        // is enabled for that country then is what applies.
        const clearing = body.provider === 'auto';
        const nextOverride = clearing ? null : (body.provider as PaymentProviderName);

        if (nextOverride) {
            if (!this.providerFactory.isRegistered(nextOverride)) {
                throw new BadRequestException({
                    error: 'provider_not_registered',
                    message: `No adapter is registered for '${nextOverride}' yet.`,
                });
            }
            await this.routing.assertUsableForNewSubscription(nextOverride, tenant.billingCountry);
        }

        const liveSub = await this.prisma.billingSubscription.findFirst({
            where: { tenantId, status: { in: ['active', 'trialing', 'past_due'] } },
            select: { id: true, provider: true, status: true, providerSubscriptionId: true },
        });
        if (liveSub && nextOverride && liveSub.provider !== nextOverride && !body.force) {
            throw new BadRequestException({
                error: 'live_subscription_conflict',
                message: `Tenant has a ${liveSub.status} subscription on ${liveSub.provider}. Changing providers does not migrate the payment mandate — the tenant must re-authorize. Pass force=true to proceed.`,
                subscriptionId: liveSub.id,
                currentProvider: liveSub.provider,
                status: liveSub.status,
            });
        }

        // Only the override moves. `payment_provider` is the record of where the
        // last subscription was created and belongs to BillingService alone —
        // rewriting it here would forge history and re-pin the tenant.
        await this.prisma.tenant.update({
            where: { id: tenantId },
            data: { paymentProviderOverride: nextOverride },
        });

        const overrideActor = auditActor(req?.user);
        await this.prisma.auditLog.create({
            data: {
                userId: overrideActor.userId,
                tenantId,
                action: clearing ? 'billing.tenant_provider_override_cleared' : 'billing.tenant_provider_overridden',
                resource: `tenants/${tenantId}`,
                details: {
                    from: tenant.paymentProviderOverride ?? null,
                    to: nextOverride,
                    // What actually charged this tenant last, for context: it is
                    // no longer what decides, so the audit has to name both.
                    lastBilledBy: tenant.paymentProvider ?? null,
                    reason,
                    forced: Boolean(body.force),
                    liveSubscriptionId: liveSub?.id ?? null,
                    ...(overrideActor.delegation ?? {}),
                } as any,
            },
        }).catch((err: any) => {
            this.logger.error(`[Billing] Failed to audit tenant provider override: ${err?.message}`);
        });

        return {
            success: true,
            data: {
                tenantId,
                paymentProviderOverride: nextOverride,
                lastBilledBy: tenant.paymentProvider ?? null,
                // The existing subscription keeps billing where it was created.
                affectsExistingSubscription: false,
            },
        };
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
                userId: auditActor(req.user).userId,
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

    // ── Cross-tenant read views (subscriptions / payments / events) ──
    // The runbook's psql-by-SSH queries, moved into the panel.

    @Get('subscriptions')
    async listSubscriptions(
        @Query('status') status?: string,
        @Query('provider') provider?: string,
        @Query('plan') plan?: string,
        @Query('q') q?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        const pageN = Math.max(1, parseInt(page || '1', 10) || 1);
        const limitN = Math.min(100, Math.max(1, parseInt(limit || '25', 10) || 25));
        const where: any = {};
        if (status) where.status = status;
        if (provider) where.provider = provider;
        if (plan) where.plan = { slug: plan };
        if (q) where.tenant = { OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }] };

        const [items, total] = await Promise.all([
            this.prisma.billingSubscription.findMany({
                where,
                select: {
                    id: true, status: true, provider: true, providerSubscriptionId: true,
                    currentPeriodEnd: true, trialEndsAt: true, cancelAtPeriodEnd: true, pendingPlanChangeAt: true,
                    tenant: { select: { id: true, name: true, slug: true } },
                    plan: { select: { slug: true, name: true } },
                    pendingPlan: { select: { slug: true, name: true } },
                },
                orderBy: { updatedAt: 'desc' },
                skip: (pageN - 1) * limitN,
                take: limitN,
            }),
            this.prisma.billingSubscription.count({ where }),
        ]);
        return { success: true, data: { items, total, page: pageN, limit: limitN } };
    }

    @Get('payments')
    async listPayments(
        @Query('status') status?: string,
        @Query('provider') provider?: string,
        @Query('tenantId') tenantId?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        const pageN = Math.max(1, parseInt(page || '1', 10) || 1);
        const limitN = Math.min(100, Math.max(1, parseInt(limit || '25', 10) || 25));
        const where: any = {};
        if (status) where.status = status;
        if (provider) where.provider = provider;
        if (tenantId) where.tenantId = tenantId;

        const [items, total] = await Promise.all([
            this.prisma.billingPayment.findMany({
                where,
                select: {
                    id: true, tenantId: true, amountCents: true, currency: true, status: true,
                    provider: true, providerPaymentId: true, paidAt: true, failureReason: true,
                    invoiceNumber: true, createdAt: true,
                    subscription: { select: { tenant: { select: { id: true, name: true, slug: true } } } },
                },
                orderBy: { createdAt: 'desc' },
                skip: (pageN - 1) * limitN,
                take: limitN,
            }),
            this.prisma.billingPayment.count({ where }),
        ]);
        return { success: true, data: { items, total, page: pageN, limit: limitN } };
    }

    @Get('events')
    async listEvents(
        @Query('eventType') eventType?: string,
        @Query('provider') provider?: string,
        @Query('tenantId') tenantId?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        const pageN = Math.max(1, parseInt(page || '1', 10) || 1);
        const limitN = Math.min(100, Math.max(1, parseInt(limit || '25', 10) || 25));
        const where: any = {};
        if (eventType) where.eventType = eventType;
        if (provider) where.provider = provider;
        if (tenantId) where.tenantId = tenantId;

        const [items, total] = await Promise.all([
            this.prisma.billingEvent.findMany({
                where,
                // Omit the raw provider payload from the list — it can be large.
                select: {
                    id: true, tenantId: true, subscriptionId: true, provider: true,
                    providerEventId: true, eventType: true, processedAt: true,
                },
                orderBy: { processedAt: 'desc' },
                skip: (pageN - 1) * limitN,
                take: limitN,
            }),
            this.prisma.billingEvent.count({ where }),
        ]);
        return { success: true, data: { items, total, page: pageN, limit: limitN } };
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
        if (!plan || !plan.isActive) throw new NotFoundException('Active plan not found');
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
                userId: auditActor(req.user).userId,
                action: 'tenant_plan_changed',
                resource: `tenants/${tenantId}`,
                details: { from: tenant.plan, to: body.planSlug, reason: body.reason ?? null },
            },
        });
        return { success: true, data: { from: tenant.plan, to: body.planSlug } };
    }
}
