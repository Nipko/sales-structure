// scripts/sync-mp-plans.js
//
// Sync Parallly billing plans to MercadoPago per country.
//
// Runs on any Node container that has @prisma/client + mercadopago installed
// (the prod API image does). No ts-node or build step required.
//
// Usage (from inside parallext-api container or any host with the env set):
//
//   # Use fixed local prices from priceLocalOverrides (seeded in DB):
//   docker exec parallext-api sh -c \
//     'MP_ACCESS_TOKEN=$MP_ACCESS_TOKEN node scripts/sync-mp-plans.js --country=CO --dry-run'
//
//   # Or convert from USD with an explicit FX rate:
//   docker exec parallext-api sh -c \
//     'MP_ACCESS_TOKEN=$MP_ACCESS_TOKEN node scripts/sync-mp-plans.js --country=MX --fx=17.5'
//
// For each active paid plan (starter, pro, enterprise — custom is sales-led
// and skipped), POSTs /preapproval_plan and saves the returned plan id into
// billing_plans:
//   - mpPlanId (top-level column, CO only for now)
//   - priceLocalOverrides[COUNTRY] = { currency, amountCents, mpPlanId }
//
// Price resolution order:
//   1. priceLocalOverrides[country].amountCents from DB (fixed local prices)
//   2. priceUsdCents × --fx (dynamic conversion)
//   If neither is available, the plan is skipped with an error.
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
    let fx = null;
    if (fxRaw) {
        fx = Number(fxRaw);
        if (!Number.isFinite(fx) || fx <= 0) {
            console.error(`Invalid --fx value ${fxRaw}`);
            process.exit(1);
        }
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

    const priceMode = args.fx ? `fx=${args.fx}` : 'local (from DB)';
    console.log(`\nSync plans to MercadoPago — country=${args.country} currency=${currency} prices=${priceMode}${args.dryRun ? ' [DRY-RUN]' : ''}\n`);

    const prisma = new PrismaClient();
    const mpConfig = new MercadoPagoConfig({ accessToken, options: { timeout: 10_000 } });
    const preApprovalPlan = new PreApprovalPlan(mpConfig);

    const plans = await prisma.billingPlan.findMany({
        where: { isActive: true, slug: { in: ['emprendedor', 'starter', 'pro', 'enterprise'] } },
        orderBy: { sortOrder: 'asc' },
    });

    for (const plan of plans) {
        const priceLocalOverrides = (plan.priceLocalOverrides && typeof plan.priceLocalOverrides === 'object')
            ? { ...plan.priceLocalOverrides }
            : {};
        const existingOverride = priceLocalOverrides[args.country];

        if (existingOverride && existingOverride.mpPlanId && !args.force) {
            console.log(`  [${plan.slug}] already synced for ${args.country} (mpPlanId=${existingOverride.mpPlanId}) — skipping. Use --force to re-create.`);
            continue;
        }

        let localAmountCents;
        if (existingOverride?.amountCents) {
            localAmountCents = existingOverride.amountCents;
        } else if (args.fx) {
            localAmountCents = Math.round(plan.priceUsdCents * args.fx);
        } else {
            console.error(`  [${plan.slug}] no local price in DB for ${args.country} and no --fx provided — skipping.`);
            continue;
        }

        const body = {
            reason: `${plan.name} — Parallly ${args.country}`,
            auto_recurring: {
                frequency: 1,
                frequency_type: 'months',
                transaction_amount: localAmountCents / 100,
                currency_id: currency,
            },
            payment_methods_allowed: {
                payment_types: [{ id: 'credit_card' }, { id: 'debit_card' }],
            },
            back_url: 'https://admin.parallly-chat.cloud/admin/settings/billing?status=return',
        };

        console.log(`  [${plan.slug}] creating MP plan: ${currency} ${(localAmountCents / 100).toLocaleString('es-CO')}/mes…`);

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
            ...(existingOverride ?? {}),
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
