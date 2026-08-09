import { BadRequestException, Body, Controller, Get, Logger, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';
import { InvoiceGeneratorService } from './invoice-generator.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { MediaThrottleService } from '../media-processing/media-throttle.service';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';
import { BillingPlanCatalogService } from './billing-plan-catalog.service';
import { BILLING_CURRENCY_BY_COUNTRY } from './billing-country-config';

const BILLING_COUNTRIES = Object.keys(BILLING_CURRENCY_BY_COUNTRY);

/**
 * Tenant-facing billing endpoints.
 *
 * Webhook reception lives in a separate controller (webhook.controller.ts)
 * because webhooks must bypass JWT auth and read the raw body for signature
 * verification.
 *
 * URL convention matches the rest of the project — tenantId is a path param,
 * not extracted from the JWT — so super_admins can operate on any tenant
 * from tooling or scripts with the same routes.
 */

class StartTrialDto {
    @IsString()
    @MaxLength(80)
    planSlug!: string;

    @IsOptional()
    @IsString()
    cardTokenId?: string;

    @IsOptional()
    @IsString()
    billingEmail?: string;

    @IsOptional()
    @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
    @IsString()
    @IsIn(BILLING_COUNTRIES)
    billingCountry?: string;

    @IsOptional()
    @IsIn(['monthly', 'annual'])
    billingCycle?: 'monthly' | 'annual';
}

class ChangePlanDto {
    @IsString()
    @MaxLength(80)
    planSlug!: string;

    @IsOptional()
    @IsString()
    cardTokenId?: string;

    @IsOptional()
    @IsIn(['monthly', 'annual'])
    billingCycle?: 'monthly' | 'annual';
}

class CancelSubscriptionDto {
    @IsOptional()
    @IsBoolean()
    immediate?: boolean;

    @IsOptional()
    @IsString()
    reason?: string;
}

class UpdatePaymentMethodDto {
    @IsString()
    cardTokenId!: string;
}

class PauseSubscriptionDto {
    @IsOptional()
    @IsString()
    reason?: string;
}

@Controller('billing')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@ApiBearerAuth()
export class BillingController {
    private readonly logger = new Logger(BillingController.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly billingService: BillingService,
        private readonly throttle: TenantThrottleService,
        private readonly invoiceGenerator: InvoiceGeneratorService,
        private readonly mediaThrottle: MediaThrottleService,
        private readonly planCatalog: BillingPlanCatalogService,
    ) {}

    /**
     * Authenticated plan catalog used by onboarding and the dashboard plan
     * picker. The public landing uses BillingPublicController.
     */
    @Get('plans')
    async listPlans(@Query('country') country?: string) {
        const plans = await this.planCatalog.listActivePlans(country);
        return { success: true, data: plans };
    }

    /**
     * Current subscription for a tenant — dashboard reads this for the /admin/settings/billing page.
     * Returns null when the tenant never started a subscription.
     */
    @Get(':tenantId/subscription')
    @UseGuards(AuthGuard('jwt'))
    async getCurrentSubscription(@Param('tenantId') tenantId: string) {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { billingCountry: true, billingEmail: true },
        });
        const sub = await this.billingService.getActiveSubscription(tenantId);

        const recentPayments = sub
            ? await this.prisma.billingPayment.findMany({
                where: { tenantId },
                orderBy: { createdAt: 'desc' },
                take: 20,
            })
            : [];

        if (!sub) {
            return {
                success: true,
                data: null,
                billingCountry: tenant?.billingCountry ?? null,
            };
        }

        // Pending plan change (scheduled downgrade) info — UI shows banner
        let pendingPlan: any = null;
        if ((sub as any).pendingPlanId) {
            pendingPlan = await this.prisma.billingPlan.findUnique({
                where: { id: (sub as any).pendingPlanId },
                select: { id: true, slug: true, name: true, priceUsdCents: true },
            });
        }

        return {
            success: true,
            data: {
                id: sub.id,
                status: sub.status,
                planId: sub.planId,
                plan: (sub as any).plan,
                provider: sub.provider,
                billingCycle: ((sub as any).metadata && typeof (sub as any).metadata === 'object' && (sub as any).metadata.billingCycle === 'annual') ? 'annual' : 'monthly',
                providerBacked: Boolean(sub.providerSubscriptionId),
                trialStartedAt: sub.trialStartedAt,
                trialEndsAt: sub.trialEndsAt,
                currentPeriodStart: sub.currentPeriodStart,
                currentPeriodEnd: sub.currentPeriodEnd,
                cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
                cancelledAt: sub.cancelledAt,
                cancellationReason: sub.cancellationReason,
                pendingPlanId: (sub as any).pendingPlanId ?? null,
                pendingPlanChangeAt: (sub as any).pendingPlanChangeAt ?? null,
                pendingPlan,
                payments: recentPayments,
            },
            billingCountry: tenant?.billingCountry ?? null,
        };
    }

    /**
     * Start a new trial for a tenant that does not yet have one. Typically
     * called from the onboarding wizard via AuthService.completeOnboarding,
     * but also exposed here so super_admin tools or reseller flows can create
     * subscriptions on behalf of a tenant.
     */
    @Post(':tenantId/subscription')
    @Roles('tenant_admin')
    @UseGuards(AuthGuard('jwt'))
    async startTrial(@Param('tenantId') tenantId: string, @Body() body: StartTrialDto) {
        const subscription = await this.billingService.createTrialSubscription({
            tenantId,
            planSlug: body.planSlug,
            cardTokenId: body.cardTokenId,
            billingEmail: body.billingEmail,
            billingCountry: body.billingCountry,
            billingCycle: body.billingCycle,
        });
        return { success: true, data: subscription };
    }

    /**
     * Change plan for an existing subscription. MP has no native proration, so
     * BillingService may either update the preapproval in place or cancel and
     * recreate depending on the provider's behaviour.
     */
    @Post(':tenantId/subscription/upgrade')
    @Roles('tenant_admin')
    @UseGuards(AuthGuard('jwt'), EmailVerifiedGuard)
    async upgrade(@Param('tenantId') tenantId: string, @Body() body: ChangePlanDto) {
        const updated = await this.billingService.upgradeSubscription(tenantId, body.planSlug, body.cardTokenId, body.billingCycle);
        return { success: true, data: updated };
    }

    /**
     * Cancel a subscription. Soft cancel (cancel_at_period_end) by default;
     * pass `immediate: true` for hard cancel that revokes access now.
     */
    @Post(':tenantId/subscription/cancel')
    @Roles('tenant_admin')
    @UseGuards(AuthGuard('jwt'))
    async cancel(@Param('tenantId') tenantId: string, @Body() body: CancelSubscriptionDto) {
        await this.billingService.cancelSubscription(tenantId, {
            immediate: body.immediate ?? false,
            reason: body.reason,
        });
        return { success: true };
    }

    /**
     * Rotate the card attached to the subscription with a new short-lived
     * token from the provider's client-side SDK.
     */
    @Post(':tenantId/subscription/payment-method')
    @Roles('tenant_admin')
    @UseGuards(AuthGuard('jwt'), EmailVerifiedGuard)
    async updatePaymentMethod(@Param('tenantId') tenantId: string, @Body() body: UpdatePaymentMethodDto) {
        const sub = await this.billingService.getActiveSubscription(tenantId);
        if (!sub || !sub.providerCustomerId) {
            throw new BadRequestException({ error: 'no_active_subscription', message: 'No active subscription to update the card on.' });
        }
        // Provider-side rotation goes through the adapter. BillingService does not
        // own this yet (it's a pure adapter operation with no state change),
        // so we call the factory directly. Kept thin on purpose.
        const provider = (this.billingService as any).providerFactory.getByName(sub.provider);
        await provider.updatePaymentMethod(sub.providerCustomerId, body.cardTokenId);
        return { success: true };
    }

    /**
     * Pause an active subscription — short-term hold without cancelling.
     * Provider stops charging but record stays so tenant can resume later
     * with the same card on file.
     */
    @Post(':tenantId/subscription/pause')
    @Roles('tenant_admin')
    @UseGuards(AuthGuard('jwt'))
    async pause(@Param('tenantId') tenantId: string, @Body() body: PauseSubscriptionDto) {
        await this.billingService.pauseSubscription(tenantId, { reason: body.reason });
        return { success: true };
    }

    /** Resume a paused subscription. */
    @Post(':tenantId/subscription/resume')
    @Roles('tenant_admin')
    @UseGuards(AuthGuard('jwt'))
    async resume(@Param('tenantId') tenantId: string) {
        await this.billingService.resumeSubscription(tenantId);
        return { success: true };
    }

    /** Cancel a previously scheduled downgrade (user changed mind). */
    @Post(':tenantId/subscription/cancel-pending-downgrade')
    @Roles('tenant_admin')
    @UseGuards(AuthGuard('jwt'))
    async cancelPendingDowngrade(@Param('tenantId') tenantId: string) {
        await this.billingService.cancelPendingDowngrade(tenantId);
        return { success: true };
    }

    /**
     * Current-month usage for the tenant — drives the dashboard usage card.
     * Returns AI message count vs plan limit. Cheap call (Redis-backed).
     */
    @Get(':tenantId/usage')
    @UseGuards(AuthGuard('jwt'))
    async getUsage(@Param('tenantId') tenantId: string) {
        const aiMessages = await this.throttle.getAiMessageUsage(tenantId);

        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { schemaName: true } });
        let conversations = 0;
        let activeAgents = 0;
        if (tenant?.schemaName) {
            const monthStart = `${aiMessages.monthKey}-01`;
            try {
                const convResult = await this.prisma.$queryRawUnsafe(
                    `SELECT COUNT(*) as count FROM "${tenant.schemaName}".conversations WHERE created_at >= $1::date`,
                    monthStart,
                ) as any[];
                conversations = Number(convResult[0]?.count ?? 0);
            } catch { /* noop */ }
            try {
                const agentResult = await this.prisma.$queryRawUnsafe(
                    `SELECT COUNT(*) as count FROM "${tenant.schemaName}".agent_personas WHERE is_active = true`,
                ) as any[];
                activeAgents = Number(agentResult[0]?.count ?? 0);
            } catch { /* noop */ }
        }

        const [planRow, mediaStats] = await Promise.all([
            this.prisma.billingPlan.findUnique({
                where: { slug: aiMessages.plan },
                select: { maxAgents: true },
            }),
            this.mediaThrottle.getUsageStats(tenantId).catch(() => null),
        ]);

        return {
            success: true,
            data: {
                aiMessages: {
                    used: aiMessages.used,
                    limit: Number.isFinite(aiMessages.limit) ? aiMessages.limit : null,
                    remaining: aiMessages.remaining,
                    percent: aiMessages.percent,
                    monthKey: aiMessages.monthKey,
                    plan: aiMessages.plan,
                },
                conversations,
                activeAgents,
                maxAgents: planRow?.maxAgents ?? null,
                media: mediaStats ? {
                    audio: {
                        used: mediaStats.audio.used,
                        limit: Number.isFinite(mediaStats.audio.limit) ? mediaStats.audio.limit : null,
                        percent: mediaStats.audio.limit > 0 && Number.isFinite(mediaStats.audio.limit)
                            ? Math.min(100, Math.round((mediaStats.audio.used / mediaStats.audio.limit) * 100))
                            : 0,
                    },
                    image: {
                        used: mediaStats.image.used,
                        limit: Number.isFinite(mediaStats.image.limit) ? mediaStats.image.limit : null,
                        percent: mediaStats.image.limit > 0 && Number.isFinite(mediaStats.image.limit)
                            ? Math.min(100, Math.round((mediaStats.image.used / mediaStats.image.limit) * 100))
                            : 0,
                    },
                    dailyCostCents: mediaStats.dailyCostCents,
                    dailyBudgetCents: Number.isFinite(mediaStats.dailyBudgetCents) ? mediaStats.dailyBudgetCents : null,
                } : null,
            },
        };
    }

    /**
     * Force an immediate provider sync — used by the past_due recovery
     * "retry now" button. Pulls the latest state from MP; if MP succeeded
     * a retry charge in background, we pick it up without waiting for
     * the hourly reconciliation cron.
     */
    @Post(':tenantId/subscription/sync')
    @Roles('tenant_admin')
    @UseGuards(AuthGuard('jwt'))
    async sync(@Param('tenantId') tenantId: string) {
        const result = await this.billingService.syncFromProvider(tenantId);
        return { success: true, data: result };
    }

    @Get(':tenantId/restriction-status')
    @UseGuards(AuthGuard('jwt'))
    async getRestrictionStatus(@Param('tenantId') tenantId: string) {
        const result = await this.billingService.getRestrictionStatus(tenantId);
        return { success: true, data: result };
    }

    /**
     * Download PDF invoice for a payment. Generated on demand (not persisted)
     * until fiscal integration is wired. Tenant scope enforced via tenantId
     * path param + JWT — service rejects mismatch.
     */
    @Get(':tenantId/payments/:paymentId/invoice')
    @UseGuards(AuthGuard('jwt'))
    async downloadInvoice(
        @Param('tenantId') tenantId: string,
        @Param('paymentId') paymentId: string,
        @Res() res: Response,
    ) {
        const pdf = await this.invoiceGenerator.generate(tenantId, paymentId);
        const filename = `parallly-invoice-${paymentId.slice(0, 8)}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', pdf.length.toString());
        res.send(pdf);
    }
}
