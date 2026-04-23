/**
 * Sync Parallly billing plans to MercadoPago per country.
 *
 * Usage (from repo root):
 *   npx ts-node apps/api/scripts/sync-mp-plans.ts --country=CO --fx=4200
 *   npx ts-node apps/api/scripts/sync-mp-plans.ts --country=AR --fx=1200 --dry-run
 *
 * What it does
 * ------------
 * For each active paid plan in billing_plans (starter, pro, enterprise; skips
 * `custom` because that one is sales-led and never registered with a provider):
 *  1. Converts the USD cents price into local currency cents using the --fx rate.
 *  2. POSTs /preapproval_plan with auto_recurring + free_trial to the MP API
 *     using the provided MP_ACCESS_TOKEN from the environment.
 *  3. Writes the returned plan id into two places:
 *       - `billing_plans.mpPlanId` (kept for Colombia single-country launch)
 *       - `billing_plans.priceLocalOverrides[COUNTRY]`:
 *           { currency, amountCents, mpPlanId }
 *     so subsequent countries just add more entries under priceLocalOverrides
 *     without losing the Colombian ids.
 *
 * Idempotent: rerunning the script with the same country creates NEW MP plans
 * (MP has no upsert on /preapproval_plan). To avoid duplicates, check the
 * priceLocalOverrides for an existing entry first — if it exists and
 * --force is NOT passed, skip that tier.
 */

import { PrismaClient } from '@prisma/client';
import { MercadoPagoConfig, PreApprovalPlan } from 'mercadopago';

type CountryCode = 'CO' | 'AR' | 'MX' | 'CL' | 'PE' | 'UY' | 'BR';

const CURRENCY_BY_COUNTRY: Record<CountryCode, string> = {
    CO: 'COP',
    AR: 'ARS',
    MX: 'MXN',
    CL: 'CLP',
    PE: 'PEN',
    UY: 'UYU',
    BR: 'BRL',
};

interface Args {
    country: CountryCode;
    fx: number;
    dryRun: boolean;
    force: boolean;
}

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    const get = (flag: string) => {
        const match = argv.find(a => a.startsWith(`--${flag}=`));
        return match ? match.split('=')[1] : undefined;
    };
    const country = (get('country') ?? 'CO').toUpperCase() as CountryCode;
    if (!CURRENCY_BY_COUNTRY[country]) {
        console.error(`Unknown country ${country}. Supported: ${Object.keys(CURRENCY_BY_COUNTRY).join(', ')}`);
        process.exit(1);
    }
    const fxRaw = get('fx');
    if (!fxRaw) {
        console.error('Missing --fx=<usd_to_local_rate> (e.g., --fx=4200 for 1 USD = 4,200 COP)');
        process.exit(1);
    }
    const fx = Number(fxRaw);
    if (!Number.isFinite(fx) || fx <= 0) {
        console.error(`Invalid --fx value ${fxRaw}`);
        process.exit(1);
    }
    return {
        country,
        fx,
        dryRun: argv.includes('--dry-run'),
        force: argv.includes('--force'),
    };
}

async function main() {
    const args = parseArgs();
    const currency = CURRENCY_BY_COUNTRY[args.country];

    const accessToken = process.env.MP_ACCESS_TOKEN;
    if (!accessToken) {
        console.error('MP_ACCESS_TOKEN is not set in the environment.');
        process.exit(1);
    }

    console.log(`\nSync plans to MercadoPago — country=${args.country} currency=${currency} fx=${args.fx}${args.dryRun ? ' [DRY-RUN]' : ''}\n`);

    const prisma = new PrismaClient();
    const mpConfig = new MercadoPagoConfig({ accessToken, options: { timeout: 10_000 } });
    const preApprovalPlan = new PreApprovalPlan(mpConfig);

    const plans = await prisma.billingPlan.findMany({
        where: { isActive: true, slug: { in: ['starter', 'pro', 'enterprise'] } },
        orderBy: { sortOrder: 'asc' },
    });

    for (const plan of plans) {
        const localAmountCents = Math.round(plan.priceUsdCents * args.fx);
        const priceLocalOverrides = (plan.priceLocalOverrides as Record<string, any>) ?? {};
        const existing = priceLocalOverrides[args.country];

        if (existing?.mpPlanId && !args.force) {
            console.log(`  [${plan.slug}] already synced for ${args.country} (mpPlanId=${existing.mpPlanId}) — skipping. Use --force to re-create.`);
            continue;
        }

        const body = {
            reason: `${plan.name} — Parallly ${args.country}`,
            auto_recurring: {
                frequency: 1,
                frequency_type: 'months',
                transaction_amount: localAmountCents / 100,
                currency_id: currency,
                ...(plan.trialDays > 0
                    ? { free_trial: { frequency: plan.trialDays, frequency_type: 'days' } }
                    : {}),
            },
            payment_methods_allowed: {
                payment_types: [{ id: 'credit_card' }, { id: 'debit_card' }],
            },
            back_url: 'https://admin.parallly-chat.cloud/admin/settings/billing?status=return',
        };

        console.log(`  [${plan.slug}] creating MP plan: ${currency} ${(localAmountCents / 100).toFixed(2)}, trial=${plan.trialDays}d…`);

        if (args.dryRun) {
            console.log(`    (dry-run) body:`, JSON.stringify(body, null, 2));
            continue;
        }

        const res = await preApprovalPlan.create({ body });
        if (!res.id) {
            console.error(`    FAILED: MP returned no plan id. Response:`, res);
            continue;
        }

        // Persist the id in both the simple column (for Colombia MVP) and the
        // per-country JSONB for future multi-country resolution.
        priceLocalOverrides[args.country] = {
            currency,
            amountCents: localAmountCents,
            mpPlanId: res.id,
        };

        const updateData: any = { priceLocalOverrides };
        // Colombia is our primary launch — keep mpPlanId pointing at CO until
        // BillingService gains a country-aware resolver in Sprint 3.
        if (args.country === 'CO') {
            updateData.mpPlanId = res.id;
        }

        await prisma.billingPlan.update({ where: { id: plan.id }, data: updateData });
        console.log(`    OK mpPlanId=${res.id}`);
    }

    console.log(`\nDone.\n`);
    await prisma.$disconnect();
}

main().catch((e) => {
    console.error('Sync failed:', e);
    process.exit(1);
});
