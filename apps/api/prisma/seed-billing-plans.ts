/**
 * Seed Billing Plans
 * Run: npx ts-node prisma/seed-billing-plans.ts
 *
 * Upserts the 4 tier plans (starter, pro, enterprise, custom) into billing_plans.
 * Idempotent: rerunning the script updates prices and limits without creating
 * duplicates (slug is unique).
 *
 * Prices stored in USD cents (catalog price — source of truth). Per-country
 * local currency amounts are set up separately via priceLocalOverrides once
 * per-country pricing has been validated with customers.
 *
 * mpPlanId / stripePlanId remain null here — they get populated by the
 * provider-side plan sync script that will live at
 * `scripts/sync-mp-plans.ts` in Sprint 2 after plans are registered with
 * MercadoPago's preapproval_plan endpoint in each country.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SeedPlan {
    slug: string;
    name: string;
    priceUsdCents: number;
    trialDays: number;
    requiresCardForTrial: boolean;
    maxAgents: number;
    maxAiMessages: number;
    sortOrder: number;
    features: Record<string, unknown>;
}

// Decisions confirmed in docs/billing-plan.md Section 7.
// Starter = self-serve entry; Pro = SMB sweet spot; Enterprise = teams + SSO;
// Custom = sales-led agencies/resellers, manual admin provisioning only.
const PLANS: SeedPlan[] = [
    {
        slug: 'starter',
        name: 'Starter',
        priceUsdCents: 4900,
        trialDays: 7,
        requiresCardForTrial: false,
        maxAgents: 1,
        maxAiMessages: 5_000,
        sortOrder: 1,
        features: {
            seats: 3,
            channels: ['whatsapp', 'instagram', 'messenger', 'telegram'],
            automationRules: 5,
            broadcastCampaigns: 3,
            appointmentsServices: 2,
            knowledgeArticles: 20,
            whatsappCreditUsdCents: 1000,
            customPrompt: false,
            customTemplates: false,
            sso: false,
            auditLog: false,
            biApi: false,
        },
    },
    {
        slug: 'pro',
        name: 'Pro',
        priceUsdCents: 12900,
        trialDays: 15,
        requiresCardForTrial: true,
        maxAgents: 3,
        maxAiMessages: 25_000,
        sortOrder: 2,
        features: {
            seats: 5,
            channels: ['whatsapp', 'instagram', 'messenger', 'telegram'],
            automationRules: -1, // unlimited
            broadcastCampaigns: -1,
            appointmentsServices: -1,
            knowledgeArticles: -1,
            whatsappCreditUsdCents: 2500,
            customPrompt: true,
            customTemplates: true,
            sso: false,
            auditLog: false,
            biApi: true,
        },
    },
    {
        slug: 'enterprise',
        name: 'Enterprise',
        priceUsdCents: 34900,
        trialDays: 15,
        requiresCardForTrial: true,
        maxAgents: 10,
        maxAiMessages: 100_000,
        sortOrder: 3,
        features: {
            seats: -1,
            channels: ['whatsapp', 'instagram', 'messenger', 'telegram', 'sms'],
            automationRules: -1,
            broadcastCampaigns: -1,
            appointmentsServices: -1,
            knowledgeArticles: -1,
            whatsappCreditUsdCents: 0, // negotiated
            customPrompt: true,
            customTemplates: true,
            sso: true,
            auditLog: true,
            biApi: true,
            prioritySupport: true,
        },
    },
    {
        slug: 'custom',
        name: 'Custom',
        priceUsdCents: 0, // negotiated; not self-serve
        trialDays: 0,
        requiresCardForTrial: false,
        maxAgents: 999,
        maxAiMessages: -1, // unlimited
        sortOrder: 4,
        features: {
            seats: -1,
            channels: ['whatsapp', 'instagram', 'messenger', 'telegram', 'sms'],
            automationRules: -1,
            broadcastCampaigns: -1,
            appointmentsServices: -1,
            knowledgeArticles: -1,
            customPrompt: true,
            customTemplates: true,
            sso: true,
            auditLog: true,
            biApi: true,
            prioritySupport: true,
            salesLed: true,
            multiTenantSubAccounts: true,
        },
    },
];

async function main() {
    console.log('Seeding billing_plans…');
    for (const plan of PLANS) {
        const existing = await prisma.billingPlan.findUnique({ where: { slug: plan.slug } });
        if (existing) {
            await prisma.billingPlan.update({
                where: { slug: plan.slug },
                data: {
                    name: plan.name,
                    priceUsdCents: plan.priceUsdCents,
                    trialDays: plan.trialDays,
                    requiresCardForTrial: plan.requiresCardForTrial,
                    maxAgents: plan.maxAgents,
                    maxAiMessages: plan.maxAiMessages,
                    sortOrder: plan.sortOrder,
                    features: plan.features as any,
                    isActive: true,
                },
            });
            console.log(`  Updated ${plan.slug} (USD $${(plan.priceUsdCents / 100).toFixed(2)}, ${plan.trialDays}d trial)`);
        } else {
            await prisma.billingPlan.create({
                data: {
                    slug: plan.slug,
                    name: plan.name,
                    priceUsdCents: plan.priceUsdCents,
                    trialDays: plan.trialDays,
                    requiresCardForTrial: plan.requiresCardForTrial,
                    maxAgents: plan.maxAgents,
                    maxAiMessages: plan.maxAiMessages,
                    sortOrder: plan.sortOrder,
                    features: plan.features as any,
                    isActive: true,
                },
            });
            console.log(`  Created ${plan.slug} (USD $${(plan.priceUsdCents / 100).toFixed(2)}, ${plan.trialDays}d trial)`);
        }
    }
    console.log('Done.');
}

main()
    .catch((e) => {
        console.error('Failed to seed billing plans:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
