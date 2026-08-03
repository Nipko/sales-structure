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
// For each active self-service plan (emprendedor, starter, pro, enterprise —
// custom is sales-led and skipped), POSTs /preapproval_plan and saves the id into
// billing_plans:
//   - mpPlanId (top-level column, CO only for now)
//   - priceLocalOverrides[COUNTRY] = { currency, amountCents, mpPlanId }
//
// Price resolution order:
//   1. priceLocalOverrides[country].amountCents from DB (fixed local prices)
//   2. priceUsdCents × --fx (dynamic conversion)
//   If neither is available, the plan is skipped with an error.
//
// Idempotent: validates existing ids with the current credential before
// skipping them. This is important when cutting over from TEST-* credentials
// (or another collector) to the real production account.

const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('crypto');

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
    // --cycle=annual (alias --cycle=year) creates the ANNUAL preapproval_plan
    // (frequency 12 months) and stores its id under overrides[country].annual.mpPlanId
    // without touching the monthly slot. Default is monthly.
    const cycleRaw = get('cycle');
    const cycle = (cycleRaw === 'annual' || cycleRaw === 'year') ? 'year' : 'month';
    return {
        country,
        fx,
        cycle,
        dryRun: argv.includes('--dry-run'),
        force: argv.includes('--force'),
    };
}

function sanitizeProviderText(value, maxLength) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const sanitized = String(value)
        .replace(/\bBearer\s+[^\s,;"'}]+/gi, 'Bearer [REDACTED]')
        .replace(/\b(?:APP_USR|TEST)-[A-Za-z0-9_-]+/gi, '[REDACTED]')
        .replace(/[\r\n\t]+/g, ' ')
        .trim()
        .slice(0, maxLength);
    return sanitized || null;
}

function providerErrorDetails(error) {
    const response = error?.response;
    const responseData = response?.data && typeof response.data === 'object'
        ? response.data
        : (response && typeof response === 'object' ? response : undefined);
    const status = Number(
        error?.status
        ?? error?.statusCode
        ?? response?.status
        ?? responseData?.status,
    ) || null;
    const cause = Array.isArray(error?.cause) ? error.cause[0] : error?.cause;
    const code = cause?.code
        ?? responseData?.code
        ?? responseData?.error
        ?? error?.code
        ?? error?.error
        ?? null;
    const message = cause?.description
        ?? cause?.message
        ?? responseData?.message
        ?? error?.message
        ?? 'Mercado Pago request failed';
    const headers = response?.headers ?? error?.headers;
    const requestId = headers?.['x-request-id']
        ?? headers?.get?.('x-request-id')
        ?? null;
    return {
        status,
        code: sanitizeProviderText(code, 160),
        message: sanitizeProviderText(message, 500) ?? 'Mercado Pago request failed',
        requestId: sanitizeProviderText(requestId, 200),
    };
}

function isNotFoundError(details) {
    return details.status === 404
        || details.code === 'not_found'
        || details.code === 'resource_not_found';
}

function compareExistingPlan(existing, expected) {
    const recurring = existing?.auto_recurring ?? {};
    const reasons = [];
    if (!existing?.id) reasons.push('missing id');
    if (existing?.status && existing.status !== 'active') reasons.push(`status=${existing.status}`);
    if (recurring.currency_id !== expected.currency) {
        reasons.push(`currency=${recurring.currency_id ?? 'missing'} (expected ${expected.currency})`);
    }
    if (Number(recurring.frequency) !== expected.frequency || recurring.frequency_type !== 'months') {
        reasons.push(`frequency=${recurring.frequency ?? 'missing'} ${recurring.frequency_type ?? ''}`.trim());
    }
    if (!Number.isFinite(Number(recurring.transaction_amount))
        || Math.round(Number(recurring.transaction_amount) * 100) !== expected.amountCents) {
        reasons.push(`amount=${recurring.transaction_amount ?? 'missing'} (expected ${(expected.amountCents / 100).toFixed(2)})`);
    }
    return { valid: reasons.length === 0, reasons };
}

function buildPlanBody({ plan, country, currency, cycle, amountCents }) {
    const isAnnual = cycle === 'year';
    return {
        reason: `${plan.name} — Parallly ${country}${isAnnual ? ' (Anual)' : ''}`,
        auto_recurring: {
            frequency: isAnnual ? 12 : 1,
            frequency_type: 'months',
            transaction_amount: amountCents / 100,
            currency_id: currency,
        },
        back_url: 'https://admin.parallly-chat.cloud/admin/settings/billing?status=return',
    };
}

async function createPlanRaw({ accessToken, body, fetchImpl = globalThis.fetch, idempotencyKey = randomUUID() }) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('Node.js 20+ is required because global fetch is unavailable.');
    }

    const response = await fetchImpl('https://api.mercadopago.com/preapproval_plan', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
    });
    const raw = await response.text();
    let data;
    try {
        data = raw ? JSON.parse(raw) : {};
    } catch {
        data = { message: `Mercado Pago returned a non-JSON response (HTTP ${response.status}).` };
    }

    if (!response.ok) {
        // Deliberately retain only the provider's structured fields plus the
        // response object needed to read x-request-id. Never attach request
        // headers: they contain the Access Token.
        throw {
            status: response.status,
            error: data?.error,
            code: data?.code,
            cause: data?.cause,
            message: data?.message ?? `Mercado Pago request failed (HTTP ${response.status}).`,
            response: { status: response.status, headers: response.headers },
        };
    }
    return data;
}

async function getPlanRaw({ accessToken, planId, fetchImpl = globalThis.fetch }) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('Node.js 20+ is required because global fetch is unavailable.');
    }

    const response = await fetchImpl(
        `https://api.mercadopago.com/preapproval_plan/${encodeURIComponent(planId)}`,
        {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/json',
            },
            signal: AbortSignal.timeout(10_000),
        },
    );
    const raw = await response.text();
    let data;
    try {
        data = raw ? JSON.parse(raw) : {};
    } catch {
        data = { message: `Mercado Pago returned a non-JSON response (HTTP ${response.status}).` };
    }

    if (!response.ok) {
        throw {
            status: response.status,
            error: data?.error,
            code: data?.code,
            cause: data?.cause,
            message: data?.message ?? `Mercado Pago request failed (HTTP ${response.status}).`,
            response: { status: response.status, headers: response.headers },
        };
    }
    return data;
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

    const prisma = new PrismaClient({
        datasources: {
            db: {
                url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
            },
        },
    });
    let failures = 0;
    let created = 0;
    let validated = 0;

    try {
        const plans = await prisma.billingPlan.findMany({
            where: { isActive: true, slug: { in: ['emprendedor', 'starter', 'pro', 'enterprise'] } },
            orderBy: { sortOrder: 'asc' },
        });

        if (plans.length === 0) {
            throw new Error('No active self-service billing plans were found in the database.');
        }

        for (const plan of plans) {
            const priceLocalOverrides = (plan.priceLocalOverrides && typeof plan.priceLocalOverrides === 'object')
                ? { ...plan.priceLocalOverrides }
                : {};
            const existingOverride = priceLocalOverrides[args.country];
            const isAnnual = args.cycle === 'year';

            let localAmountCents;
            if (isAnnual) {
                // Annual has no USD/FX source — the yearly total must be seeded in
                // overrides[country].annual.amountCents.
                if (existingOverride?.annual?.amountCents) {
                    localAmountCents = existingOverride.annual.amountCents;
                } else {
                    console.error(`  [${plan.slug}] no annual price in DB for ${args.country} (overrides.${args.country}.annual.amountCents).`);
                    failures += 1;
                    continue;
                }
            } else if (existingOverride?.amountCents) {
                localAmountCents = existingOverride.amountCents;
            } else if (args.fx) {
                localAmountCents = Math.round(plan.priceUsdCents * args.fx);
            } else {
                console.error(`  [${plan.slug}] no local price in DB for ${args.country} and no --fx provided.`);
                failures += 1;
                continue;
            }

            const body = buildPlanBody({
                plan,
                country: args.country,
                currency,
                cycle: args.cycle,
                amountCents: localAmountCents,
            });

            // Idempotent PER CYCLE — but only after proving that the saved id is
            // visible to the current token and still matches the DB configuration.
            // A TEST→APP_USR cutover normally makes the old id return 404.
            const existingCycleId = isAnnual ? existingOverride?.annual?.mpPlanId : existingOverride?.mpPlanId;
            if (existingCycleId && !args.force) {
                if (args.dryRun) {
                    console.log(`  [${plan.slug}] would validate existing ${args.cycle} mpPlanId=${existingCycleId}; dry-run performs no network requests.`);
                    continue;
                }

                try {
                    const existingPlan = await getPlanRaw({ accessToken, planId: existingCycleId });
                    const assessment = compareExistingPlan(existingPlan, {
                        currency,
                        frequency: isAnnual ? 12 : 1,
                        amountCents: localAmountCents,
                    });
                    if (assessment.valid) {
                        validated += 1;
                        console.log(`  [${plan.slug}] ${args.cycle} plan ${existingCycleId} is accessible and matches — skipping.`);
                        continue;
                    }
                    console.warn(`  [${plan.slug}] saved ${args.cycle} plan is stale/mismatched (${assessment.reasons.join('; ')}) — creating a replacement.`);
                } catch (error) {
                    const details = providerErrorDetails(error);
                    if (isNotFoundError(details)) {
                        console.warn(`  [${plan.slug}] saved ${args.cycle} plan ${existingCycleId} is not visible to the current collector — creating a replacement.`);
                    } else {
                        console.error(`  [${plan.slug}] could not validate saved ${args.cycle} plan:`, details);
                        failures += 1;
                        continue;
                    }
                }
            }

            console.log(`  [${plan.slug}] creating MP ${args.cycle} plan: ${currency} ${(localAmountCents / 100).toLocaleString('es-CO')}${isAnnual ? '/año' : '/mes'}…`);

            if (args.dryRun) {
                console.log('    (dry-run) body:', JSON.stringify(body, null, 2));
                continue;
            }

            let res;
            try {
                // Raw fetch is intentional here: SDK v2.12 discards response
                // headers on non-2xx, including x-request-id required by MP support.
                res = await createPlanRaw({ accessToken, body });
            } catch (error) {
                console.error(`    FAILED to create ${plan.slug}/${args.cycle}:`, providerErrorDetails(error));
                failures += 1;
                continue;
            }
            if (!res.id) {
                console.error('    FAILED: Mercado Pago returned no plan id.');
                failures += 1;
                continue;
            }

            // Merge into the SAME country object so the other cycle's id survives.
            if (isAnnual) {
                priceLocalOverrides[args.country] = {
                    ...(existingOverride ?? {}),
                    annual: { ...(existingOverride?.annual ?? {}), currency, amountCents: localAmountCents, mpPlanId: res.id },
                };
            } else {
                priceLocalOverrides[args.country] = {
                    ...(existingOverride ?? {}),
                    currency,
                    amountCents: localAmountCents,
                    mpPlanId: res.id,
                };
            }

            const updateData = { priceLocalOverrides };
            // Legacy top-level column: CO monthly only (annual id lives in the override).
            if (args.country === 'CO' && !isAnnual) {
                updateData.mpPlanId = res.id;
            }

            await prisma.billingPlan.update({ where: { id: plan.id }, data: updateData });
            created += 1;
            console.log(`    OK mpPlanId=${res.id}`);
        }

        console.log(`\nDone. created=${created} validated=${validated} failures=${failures}.\n`);
        if (failures > 0) {
            throw new Error(`Mercado Pago plan sync finished with ${failures} failure(s).`);
        }
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error('Sync failed:', providerErrorDetails(error));
        process.exit(1);
    });
}

module.exports = {
    buildPlanBody,
    compareExistingPlan,
    createPlanRaw,
    getPlanRaw,
    isNotFoundError,
    providerErrorDetails,
    sanitizeProviderText,
};
