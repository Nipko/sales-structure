import { BadRequestException, Body, Controller, Get, Logger, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';

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
    @IsIn(['starter', 'pro', 'enterprise', 'custom'])
    planSlug!: string;

    @IsOptional()
    @IsString()
    cardTokenId?: string;

    @IsOptional()
    @IsString()
    billingEmail?: string;

    @IsOptional()
    @IsString()
    billingCountry?: string;
}

class ChangePlanDto {
    @IsString()
    @IsIn(['starter', 'pro', 'enterprise'])
    planSlug!: string;

    @IsOptional()
    @IsString()
    cardTokenId?: string;
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

@Controller('billing')
export class BillingController {
    private readonly logger = new Logger(BillingController.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly billingService: BillingService,
    ) {}

    /**
     * Public plan catalog — used by the onboarding pricing step and the
     * dashboard plan picker. No auth required.
     */
    @Get('plans')
    async listPlans() {
        const plans = await this.prisma.billingPlan.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            select: {
                id: true,
                slug: true,
                name: true,
                priceUsdCents: true,
                trialDays: true,
                requiresCardForTrial: true,
                maxAgents: true,
                maxAiMessages: true,
                features: true,
                priceLocalOverrides: true,
            },
        });
        return { success: true, data: plans };
    }

    /**
     * Current subscription for a tenant — dashboard reads this for the /admin/settings/billing page.
     * Returns null when the tenant never started a subscription.
     */
    @Get(':tenantId/subscription')
    @UseGuards(AuthGuard('jwt'))
    async getCurrentSubscription(@Param('tenantId') tenantId: string) {
        const sub = await this.billingService.getActiveSubscription(tenantId);
        if (!sub) return { success: true, data: null };

        const recentPayments = await this.prisma.billingPayment.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            take: 20,
        });

        return {
            success: true,
            data: {
                id: sub.id,
                status: sub.status,
                planId: sub.planId,
                plan: (sub as any).plan,
                provider: sub.provider,
                trialStartedAt: sub.trialStartedAt,
                trialEndsAt: sub.trialEndsAt,
                currentPeriodStart: sub.currentPeriodStart,
                currentPeriodEnd: sub.currentPeriodEnd,
                cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
                cancelledAt: sub.cancelledAt,
                payments: recentPayments,
            },
        };
    }

    /**
     * Start a new trial for a tenant that does not yet have one. Typically
     * called from the onboarding wizard via AuthService.completeOnboarding,
     * but also exposed here so super_admin tools or reseller flows can create
     * subscriptions on behalf of a tenant.
     */
    @Post(':tenantId/subscription')
    @UseGuards(AuthGuard('jwt'))
    async startTrial(@Param('tenantId') tenantId: string, @Body() body: StartTrialDto) {
        const subscription = await this.billingService.createTrialSubscription({
            tenantId,
            planSlug: body.planSlug,
            cardTokenId: body.cardTokenId,
            billingEmail: body.billingEmail,
            billingCountry: body.billingCountry,
        });
        return { success: true, data: subscription };
    }

    /**
     * Change plan for an existing subscription. MP has no native proration, so
     * BillingService may either update the preapproval in place or cancel and
     * recreate depending on the provider's behaviour.
     */
    @Post(':tenantId/subscription/upgrade')
    @UseGuards(AuthGuard('jwt'))
    async upgrade(@Param('tenantId') tenantId: string, @Body() body: ChangePlanDto) {
        const updated = await this.billingService.upgradeSubscription(tenantId, body.planSlug);
        return { success: true, data: updated };
    }

    /**
     * Cancel a subscription. Soft cancel (cancel_at_period_end) by default;
     * pass `immediate: true` for hard cancel that revokes access now.
     */
    @Post(':tenantId/subscription/cancel')
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
    @UseGuards(AuthGuard('jwt'))
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
}
