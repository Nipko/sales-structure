import { Controller, Get, Logger, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Tenant-facing billing endpoints — plan catalog, current subscription state,
 * upgrade / downgrade / cancel flows. Webhook reception lives in a separate
 * controller (webhook.controller.ts) because webhooks must bypass JWT auth and
 * read the raw body for signature verification.
 *
 * Scope of this file during Sprint 1.2: skeleton + plan listing only. The
 * rest of the endpoints land in Sprint 3 together with the dashboard billing
 * page.
 */
@Controller('billing')
export class BillingController {
    private readonly logger = new Logger(BillingController.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Public plan catalog — used by the dashboard pricing page and the
     * onboarding plan picker. No auth required.
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
     * Current subscription for the authenticated tenant. Returns null if the
     * tenant never started a subscription (still in the free pre-trial state
     * or onboarding incomplete).
     */
    @Get('subscription')
    @UseGuards(AuthGuard('jwt'))
    async getCurrentSubscription() {
        // TODO (Sprint 1.4 / Sprint 3): resolve tenantId from request, query
        // billing_subscriptions, return normalized view.
        return { success: true, data: null };
    }
}
