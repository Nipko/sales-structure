// scripts/sync-mp-plans.js
//
// Sync Parallly billing plans to MercadoPago per country.
//
// Runs on any Node container that has @prisma/client + mercadopago installed
// (the prod API image does). No ts-node or build step required.
//
// Usage (from inside parallext-api container or any host with the env set):
//   docker exec parallext-api sh -c \
//     'MP_ACCESS_TOKEN=$MP_ACCESS_TOKEN node scripts/sync-mp-plans.js --country=CO --fx=4200 --dry-run'
//
//   docker exec parallext-api sh -c \
//     'MP_ACCESS_TOKEN=$MP_ACCESS_TOKEN node scripts/sync-mp-plans.js --country=CO --fx=4200'
//
// For each active paid plan (starter, pro, enterprise — custom is sales-led
// and skipped), converts USD cents → local currency cents via --fx, POSTs
// /preapproval_plan, and saves the returned plan id into billing_plans:
//   - mpPlanId (top-level column, CO only for now — Sprint 3 adds per-country resolver)
//   - priceLocalOverrides[COUNTRY] = { currency, amountCents, mpPlanId }
//
// Idempotent: skips tiers already synced for that country unless --force.

const { PrismaClient } = require('@prisma/client');
const { MercadoPagoConfig, PreApprovalPlan } = require('mercadopago');

const CURRENCY_BY_COUNTRY = {
    CO: 'COP',
    AR: 'ARS',
    MX: 'MXN',
    CL: 'CLP',
    PE: 'PEN',
    UY: 'UYU',
    BR: 'BRL',
};

function parseArgs() {
    const argv = process.argv.slice(2);
    const get = (flag) => {
        const match = argv.find(a => a.startsWith(`--${flag}=`));
        return match ? match.split('=')[1] : undefined;
    };
    const country = (get('country') || 'CO').toUpperCase();
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
        const priceLocalOverrides = (plan.priceLocalOverrides && typeof plan.priceLocalOverrides === 'object')
            ? { ...plan.priceLocalOverrides }
            : {};
        const existing = priceLocalOverrides[args.country];

        if (existing && existing.mpPlanId && !args.force) {
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

        priceLocalOverrides[args.country] = {
            currency,
            amountCents: localAmountCents,
            mpPlanId: res.id,
        };

        const updateData = { priceLocalOverrides };
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
