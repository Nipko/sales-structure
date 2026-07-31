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

// ──────────────────────────────────────────────────────────────
// DEFINITIVE PLAN MATRIX — single source of truth (May 2026)
//
// Top-level columns: maxAgents, maxAiMessages (on BillingPlan model)
// Everything else lives in `features` JSONB.
//
// Numeric limits:  -1 = unlimited (converted to Infinity at runtime)
// Boolean flags:   true/false
// String values:   kept as-is (e.g. llmTier)
// Arrays:          kept as-is (e.g. channels)
//
// enforcePlanLimit() reads features[key] from this table.
// Rate limits (rateLimits.*) are also stored here so super admin can
// edit them per plan. TenantThrottleService reads them at runtime.
// ──────────────────────────────────────────────────────────────

const PLANS = [
    {
        slug: 'emprendedor',
        name: 'Emprendedor',
        priceUsdCents: 2100,
        trialDays: 7,
        requiresCardForTrial: false,
        maxAgents: 1,
        maxAiMessages: 1_000,
        sortOrder: 0,
        priceLocalOverrides: {
            // amountCents = monthly; annual.amountCents = total year charged (−15% vs 12× monthly).
            CO: { currency: 'COP', amountCents: 12_570_000, annual: { amountCents: 128_214_000 } },
        },
        features: {
            // ── Resource limits ──
            seats: 1,
            maxCalendars: 1,
            maxContacts: 100,
            maxProperties: 2,
            maxVehicles: 5,
            automationRules: 0,
            maxDripSequences: 0,
            broadcastCampaigns: 0,
            appointmentsServices: 1,
            knowledgeArticles: 5,
            knowledgeMaxCharsPerDoc: 25_000,
            knowledgeEmbeddingsPerMonth: 100,
            knowledgeCrawlPages: 0,
            knowledgeAnalytics: false,
            customAttributes: 0,
            emailTemplates: 2,
            pipelineStages: 3,
            maxPipelines: 1,
            segments: 0,
            mediaStorageMb: 50,
            // Connected accounts allowed per channel type (-1 = unlimited; missing → 1 at runtime)
            maxChannelAccounts: { whatsapp: 1, instagram: 1, messenger: 1, telegram: 1, sms: 1 },
            externalCrm: 0,
            outboundWebhooks: 0,
            maxWebhookSubscriptions: 0,

            // ── Channel access ──
            channels: ['whatsapp'],

            // ── AI & engagement ──
            llmTier: 'tier_4',
            customPrompt: false,
            customTemplates: false,
            aiInsights: false,
            recall: false,

            // ── Operational ──
            scheduledReports: false,
            dataRetentionDays: 90,
            // Monthly LLM spend ceiling (USD cents). Once month-to-date LLM cost
            // exceeds this, routing is clamped to budget models (tier_3/tier_4) to
            // protect margin — the agent keeps replying, just on cheaper models.
            // -1 = no cap. Read by conversations.service routing + TenantThrottleService.
            llmCostBudgetUsdCents: 800,
            whatsappCreditUsdCents: 500,

            // ── Enterprise features ──
            sso: false,
            auditLog: false,
            biApi: false,
            customDomainKb: false,
            whiteLabel: false,
            prioritySupport: false,
            publicApi: false,
            publicApiKeys: 0,
            publicApiRateLimit: 0,

            // ── Module access ──
            staffScheduling: false,
            vehicleInventory: true,
            ecommerce: false,
            channelManager: false,
            widget: false,
            httpRequestAction: false,
            abTestBroadcasts: false,
            smsNotifications: false,
            widgetTriggers: 0,

            // ── Rate limits (per-hour sliding windows) ──
            rateLimits: {
                automation: 0,
                outbound: 100,
                broadcast: 0,
                priority: 6,
                maxPendingJobs: 20,
            },

            // ── Media processing (audio transcription + image vision) ──
            mediaProcessing: {
                audioPerMonth: 30,
                imagePerMonth: 50,
                maxAudioDurationSec: 120,
                perContactPerDay: 10,
                perConvPer5min: 3,
                perTenantPerHour: 20,
                dailyBudgetCentsUsd: 10,
            },
        },
    },
    {
        slug: 'starter',
        name: 'Starter',
        priceUsdCents: 4900,
        trialDays: 7,
        requiresCardForTrial: false,
        maxAgents: 1,
        maxAiMessages: 5_000,
        sortOrder: 1,
        priceLocalOverrides: {
            CO: { currency: 'COP', amountCents: 27_690_000, annual: { amountCents: 282_438_000 } },
        },
        features: {
            // ── Resource limits ──
            seats: 3,
            maxCalendars: 1,
            maxContacts: 500,
            maxProperties: 5,
            maxVehicles: 20,
            automationRules: 5,
            maxDripSequences: 3,
            broadcastCampaigns: 3,
            appointmentsServices: 2,
            knowledgeArticles: 20,
            knowledgeMaxCharsPerDoc: 100_000,
            knowledgeEmbeddingsPerMonth: 1_000,
            knowledgeCrawlPages: 50,
            knowledgeAnalytics: true,
            customAttributes: 5,
            emailTemplates: 4,
            pipelineStages: 5,
            maxPipelines: 1,
            segments: 3,
            mediaStorageMb: 100,
            // Connected accounts allowed per channel type (-1 = unlimited; missing → 1 at runtime)
            maxChannelAccounts: { whatsapp: 1, instagram: 1, messenger: 1, telegram: 1, sms: 1 },
            externalCrm: 0,
            outboundWebhooks: 0,
            maxWebhookSubscriptions: 3,

            // ── Channel access ──
            channels: ['whatsapp', 'instagram', 'messenger', 'email'],

            // ── AI & engagement ──
            llmTier: 'tier_3',
            customPrompt: false,
            customTemplates: false,
            aiInsights: false,
            recall: false,

            // ── Operational ──
            scheduledReports: false,
            dataRetentionDays: 180,
            llmCostBudgetUsdCents: 2500,
            whatsappCreditUsdCents: 1000,

            // ── Enterprise features ──
            sso: false,
            auditLog: false,
            biApi: false,
            customDomainKb: false,
            whiteLabel: false,
            prioritySupport: false,
            publicApi: false,
            publicApiKeys: 0,
            publicApiRateLimit: 0,

            // ── Module access ──
            staffScheduling: false,
            vehicleInventory: true,
            ecommerce: true,
            channelManager: false,
            widget: true,
            httpRequestAction: false,
            abTestBroadcasts: false,
            smsNotifications: false,
            widgetTriggers: 3,

            // ── Rate limits (per-hour sliding windows) ──
            rateLimits: {
                automation: 50,
                outbound: 200,
                broadcast: 500,
                priority: 5,
                maxPendingJobs: 50,
            },

            // ── Media processing (audio transcription + image vision) ──
            mediaProcessing: {
                audioPerMonth: 150,
                imagePerMonth: 250,
                maxAudioDurationSec: 180,
                perContactPerDay: 20,
                perConvPer5min: 3,
                perTenantPerHour: 50,
                dailyBudgetCentsUsd: 25,
            },
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
        priceLocalOverrides: {
            CO: { currency: 'COP', amountCents: 75_770_000, annual: { amountCents: 772_854_000 } },
        },
        features: {
            // ── Resource limits ──
            seats: 5,
            maxCalendars: 3,
            maxContacts: 5_000,
            maxProperties: 10,
            maxVehicles: 100,
            automationRules: -1,
            maxDripSequences: 10,
            broadcastCampaigns: -1,
            appointmentsServices: -1,
            knowledgeArticles: -1,
            knowledgeMaxCharsPerDoc: 250_000,
            knowledgeEmbeddingsPerMonth: 10_000,
            knowledgeCrawlPages: 500,
            knowledgeAnalytics: true,
            customAttributes: 20,
            emailTemplates: 20,
            pipelineStages: 15,
            maxPipelines: 3,
            segments: 15,
            mediaStorageMb: 1024,
            // Connected accounts allowed per channel type (-1 = unlimited; missing → 1 at runtime)
            maxChannelAccounts: { whatsapp: 2, instagram: 1, messenger: 3, telegram: 1, sms: 1 },
            externalCrm: 1,
            outboundWebhooks: 3,
            maxWebhookSubscriptions: 10,

            // ── Channel access ──
            channels: ['whatsapp', 'instagram', 'messenger', 'telegram', 'sms', 'email'],

            // ── AI & engagement ──
            llmTier: 'tier_2',
            customPrompt: true,
            customTemplates: true,
            aiInsights: true,
            recall: true,

            // ── Operational ──
            scheduledReports: true,
            dataRetentionDays: 365,
            llmCostBudgetUsdCents: 6000,
            whatsappCreditUsdCents: 2500,

            // ── Enterprise features ──
            sso: false,
            auditLog: false,
            biApi: true,
            customDomainKb: false,
            whiteLabel: false,
            prioritySupport: false,
            publicApi: true,
            publicApiKeys: 3,
            publicApiRateLimit: 60,

            // ── Module access ──
            staffScheduling: true,
            vehicleInventory: true,
            ecommerce: true,
            channelManager: false,
            widget: true,
            httpRequestAction: true,
            abTestBroadcasts: true,
            smsNotifications: true,
            widgetTriggers: 10,

            // ── Rate limits (per-hour sliding windows) ──
            rateLimits: {
                automation: 500,
                outbound: 2000,
                broadcast: 5000,
                priority: 3,
                maxPendingJobs: 200,
            },

            // ── Media processing (audio transcription + image vision) ──
            mediaProcessing: {
                audioPerMonth: 500,
                imagePerMonth: 1_000,
                maxAudioDurationSec: 300,
                perContactPerDay: 30,
                perConvPer5min: 5,
                perTenantPerHour: 200,
                dailyBudgetCentsUsd: 100,
            },
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
        priceLocalOverrides: {
            CO: { currency: 'COP', amountCents: 178_980_000, annual: { amountCents: 1_825_596_000 } },
        },
        features: {
            // ── Resource limits ──
            seats: -1,
            maxCalendars: 10,
            maxContacts: 50_000,
            maxProperties: 50,
            maxVehicles: 500,
            automationRules: -1,
            maxDripSequences: -1,
            broadcastCampaigns: -1,
            appointmentsServices: -1,
            knowledgeArticles: -1,
            knowledgeMaxCharsPerDoc: 500_000,
            knowledgeEmbeddingsPerMonth: 50_000,
            knowledgeCrawlPages: -1,
            knowledgeAnalytics: true,
            customAttributes: -1,
            emailTemplates: -1,
            pipelineStages: -1,
            maxPipelines: 10,
            segments: -1,
            mediaStorageMb: 10_240,
            // Connected accounts allowed per channel type (-1 = unlimited; missing → 1 at runtime)
            maxChannelAccounts: { whatsapp: 3, instagram: 2, messenger: 5, telegram: 2, sms: 2 },
            externalCrm: -1,
            outboundWebhooks: -1,
            maxWebhookSubscriptions: -1,

            // ── Channel access ──
            channels: ['whatsapp', 'instagram', 'messenger', 'telegram', 'sms', 'email'],

            // ── AI & engagement ──
            llmTier: 'tier_1',
            customPrompt: true,
            customTemplates: true,
            aiInsights: true,
            recall: true,

            // ── Operational ──
            scheduledReports: true,
            dataRetentionDays: 730,
            llmCostBudgetUsdCents: 10000,
            whatsappCreditUsdCents: 0,

            // ── Enterprise features ──
            sso: true,
            auditLog: true,
            biApi: true,
            customDomainKb: true,
            whiteLabel: false,
            prioritySupport: true,
            publicApi: true,
            publicApiKeys: -1,
            publicApiRateLimit: 300,

            // ── Module access ──
            staffScheduling: true,
            vehicleInventory: true,
            ecommerce: true,
            channelManager: true,
            widget: true,
            httpRequestAction: true,
            abTestBroadcasts: true,
            smsNotifications: true,
            widgetTriggers: -1,

            // ── Rate limits (per-hour sliding windows) ──
            rateLimits: {
                automation: 5000,
                outbound: 20000,
                broadcast: 50000,
                priority: 1,
                maxPendingJobs: 1000,
            },

            // ── Media processing (audio transcription + image vision) ──
            mediaProcessing: {
                audioPerMonth: 2_000,
                imagePerMonth: 5_000,
                maxAudioDurationSec: 300,
                perContactPerDay: 50,
                perConvPer5min: 5,
                perTenantPerHour: 500,
                dailyBudgetCentsUsd: 500,
            },
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
            // ── Resource limits ──
            seats: -1,
            maxCalendars: -1,
            maxContacts: -1,
            maxProperties: -1,
            maxVehicles: -1,
            automationRules: -1,
            maxDripSequences: -1,
            broadcastCampaigns: -1,
            appointmentsServices: -1,
            knowledgeArticles: -1,
            knowledgeMaxCharsPerDoc: -1,
            knowledgeEmbeddingsPerMonth: -1,
            knowledgeCrawlPages: -1,
            knowledgeAnalytics: true,
            customAttributes: -1,
            emailTemplates: -1,
            pipelineStages: -1,
            maxPipelines: -1,
            segments: -1,
            mediaStorageMb: -1,
            // Connected accounts allowed per channel type (-1 = unlimited; missing → 1 at runtime)
            maxChannelAccounts: { whatsapp: -1, instagram: -1, messenger: -1, telegram: -1, sms: -1 },
            externalCrm: -1,
            outboundWebhooks: -1,
            maxWebhookSubscriptions: -1,

            // ── Channel access ──
            channels: ['whatsapp', 'instagram', 'messenger', 'telegram', 'sms', 'email'],

            // ── AI & engagement ──
            llmTier: 'tier_1',
            customPrompt: true,
            customTemplates: true,
            aiInsights: true,
            recall: true,

            // ── Operational ──
            scheduledReports: true,
            dataRetentionDays: -1,
            llmCostBudgetUsdCents: -1,
            whatsappCreditUsdCents: 0,

            // ── Enterprise features ──
            sso: true,
            auditLog: true,
            biApi: true,
            customDomainKb: true,
            whiteLabel: true,
            prioritySupport: true,
            salesLed: true,
            multiTenantSubAccounts: true,
            publicApi: true,
            publicApiKeys: -1,
            publicApiRateLimit: 1000,

            // ── Module access ──
            staffScheduling: true,
            vehicleInventory: true,
            ecommerce: true,
            channelManager: true,
            widget: true,
            httpRequestAction: true,
            abTestBroadcasts: true,
            smsNotifications: true,
            widgetTriggers: -1,

            // ── Rate limits (per-hour sliding windows) ──
            rateLimits: {
                automation: -1,
                outbound: -1,
                broadcast: -1,
                priority: 1,
                maxPendingJobs: -1,
            },

            // ── Media processing (audio transcription + image vision) ──
            mediaProcessing: {
                audioPerMonth: -1,
                imagePerMonth: -1,
                maxAudioDurationSec: 600,
                perContactPerDay: 100,
                perConvPer5min: 10,
                perTenantPerHour: 1_000,
                dailyBudgetCentsUsd: 5_000,
            },
        },
    },
];

// The runtime source of truth for prices/features is the billing_plans table,
// edited from the super-admin panel (/admin/plans → PUT /billing-admin/plans/:slug).
// So this seed is CREATE-ONLY by default: it bootstraps missing plans on a fresh
// DB but never overwrites an existing plan, otherwise every deploy would silently
// revert panel edits. Pass --force to restore a plan to these factory values on
// purpose (e.g. after a bad manual edit) — that path keeps the old overwrite
// behaviour and preserves only the MP plan id via the override merge below.
const FORCE = process.argv.includes('--force');

async function main() {
    console.log(`Seeding billing_plans… (${FORCE ? 'FORCE: overwriting existing plans' : 'create-only: existing plans are left untouched'})`);
    for (const plan of PLANS) {
        const existing = await prisma.billingPlan.findUnique({ where: { slug: plan.slug } });
        if (existing) {
            if (!FORCE) {
                console.log(`  Skipped ${plan.slug} (already exists — panel is source of truth; use --force to restore factory values)`);
                continue;
            }
            const existingOverrides = (existing.priceLocalOverrides && typeof existing.priceLocalOverrides === 'object') ? existing.priceLocalOverrides : {};
            const mergedOverrides = { ...existingOverrides, ...(plan.priceLocalOverrides ?? {}) };
            for (const [country, vals] of Object.entries(plan.priceLocalOverrides ?? {})) {
                // Read `prev` from the DB value (existingOverrides), NOT from
                // mergedOverrides — the flat spread above already replaced
                // mergedOverrides[country] with the seed's (id-less) value, so
                // reading it back would drop the synced ids. From the DB value:
                // the base spread keeps the monthly override mpPlanId (the seed has
                // no mpPlanId key) and the deep-merge keeps annual.mpPlanId, while
                // the seed's AMOUNTS still win (expected --force behaviour).
                const prev = existingOverrides[country] ?? {};
                const merged = { ...prev, ...vals };
                if (prev.annual || vals.annual) {
                    merged.annual = { ...(prev.annual ?? {}), ...(vals.annual ?? {}) };
                }
                mergedOverrides[country] = merged;
            }
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
                    priceLocalOverrides: mergedOverrides,
                    isActive: true,
                },
            });
            console.log(`  Updated ${plan.slug} (USD $${(plan.priceUsdCents / 100).toFixed(2)}, ${plan.trialDays}d trial, ${Object.keys(plan.features).length} features)`);
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
                    priceLocalOverrides: plan.priceLocalOverrides ?? {},
                    isActive: true,
                },
            });
            console.log(`  Created ${plan.slug} (USD $${(plan.priceUsdCents / 100).toFixed(2)}, ${plan.trialDays}d trial, ${Object.keys(plan.features).length} features)`);
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
