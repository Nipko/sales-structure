// prisma/seed-billing-plans.js
//
// Seed the 4 billing plans (starter, pro, enterprise, custom).
// Rerunning is safe — slug is UNIQUE and the script UPSERTS: existing rows
// get their price, limits, and features refreshed; missing rows get created.
//
// Usage (prod container with plain node, no ts-node required):
//   docker exec parallext-api node prisma/seed-billing-plans.js
//
// After this, run sync-mp-plans.js per country to register the plans in
// MercadoPago and populate billing_plans.mpPlanId + priceLocalOverrides.

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Decisions confirmed in docs/billing-plan.md Section 7.
// Starter = self-serve entry; Pro = SMB sweet spot; Enterprise = teams + SSO;
// Custom = sales-led agencies/resellers, manual admin provisioning only.
const PLANS = [
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
            automationRules: -1,
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
            whatsappCreditUsdCents: 0,
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
        priceUsdCents: 0,
        trialDays: 0,
        requiresCardForTrial: false,
        maxAgents: 999,
        maxAiMessages: -1,
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
                    features: plan.features,
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
                    features: plan.features,
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
