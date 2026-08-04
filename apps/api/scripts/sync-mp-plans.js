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
// Recovery-safe: validates saved ids, then searches/adopts an exact active
// provider match before creating. New POSTs use a fresh UUID v4 (the official
// SDK behaviour), so a prior rejected deterministic key cannot replay a cached
// response. This is important when cutting over from TEST-* credentials (or
// another collector) to the real production account.

const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('crypto');

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SELF_SERVICE_PLAN_SLUGS = Object.freeze(['emprendedor', 'starter', 'pro', 'enterprise']);

const CURRENCY_BY_COUNTRY = {
    CO: 'COP',
    AR: 'ARS',
    MX: 'MXN',
    CL: 'CLP',
    PE: 'PEN',
    UY: 'UYU',
    BR: 'BRL',
};

function findMissingSelfServicePlanSlugs(plans) {
    const activeSlugs = new Set(
        (Array.isArray(plans) ? plans : [])
            .map(plan => plan?.slug)
            .filter(slug => typeof slug === 'string'),
    );
    return SELF_SERVICE_PLAN_SLUGS.filter(slug => !activeSlugs.has(slug));
}

function selectPlansForSync(plans, only = null) {
    const safePlans = Array.isArray(plans) ? plans : [];
    return only ? safePlans.filter(plan => plan?.slug === only) : safePlans;
}

function deriveAnnualAmountCents(monthlyAmountCents, discountPct) {
    if (!Number.isSafeInteger(monthlyAmountCents) || monthlyAmountCents <= 0) {
        throw new TypeError('A positive integer monthly amount is required to derive an annual price.');
    }
    if (!Number.isFinite(discountPct) || discountPct <= 0 || discountPct >= 100) {
        throw new TypeError('Annual discount must be greater than 0 and less than 100.');
    }
    const amount = Math.round(monthlyAmountCents * 12 * (1 - discountPct / 100));
    if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new RangeError('Derived annual amount is outside the supported integer range.');
    }
    return amount;
}

async function persistPendingPlanUpdates(prisma, pendingUpdates, failures) {
    if (failures > 0 || pendingUpdates.length === 0) {
        return { persisted: 0, providerCreated: 0 };
    }
    const queries = pendingUpdates.map(update => prisma.billingPlan.update({
        where: update.where,
        data: update.data,
    }));
    await prisma.$transaction(queries);
    return {
        persisted: pendingUpdates.length,
        providerCreated: pendingUpdates.filter(update => update.providerCreated).length,
    };
}

function createFreshPlanIdempotencyKey(randomUUIDImpl = randomUUID) {
    const key = randomUUIDImpl();
    if (typeof key !== 'string' || !UUID_V4_PATTERN.test(key)) {
        throw new TypeError('The UUID generator returned an invalid Mercado Pago idempotency key.');
    }
    return key;
}

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
    const annualDiscountRaw = get('derive-missing-annual');
    let deriveMissingAnnualPct = null;
    if (annualDiscountRaw !== undefined) {
        deriveMissingAnnualPct = Number(annualDiscountRaw);
        if (!Number.isFinite(deriveMissingAnnualPct) || deriveMissingAnnualPct <= 0 || deriveMissingAnnualPct >= 100) {
            console.error(`Invalid --derive-missing-annual value ${annualDiscountRaw}; expected a percentage between 0 and 100.`);
            process.exit(1);
        }
        if (cycle !== 'year') {
            console.error('--derive-missing-annual is only valid with --cycle=annual.');
            process.exit(1);
        }
    }
    const only = get('only')?.trim().toLowerCase() || null;
    if (only && !SELF_SERVICE_PLAN_SLUGS.includes(only)) {
        console.error(`Invalid --only value ${only}. Expected one of: ${SELF_SERVICE_PLAN_SLUGS.join(', ')}.`);
        process.exit(1);
    }
    return {
        country,
        fx,
        cycle,
        deriveMissingAnnualPct,
        only,
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
    const correlationId = headers?.['x-correlation-id']
        ?? headers?.get?.('x-correlation-id')
        ?? null;
    return {
        status,
        code: sanitizeProviderText(code, 160),
        message: sanitizeProviderText(message, 500) ?? 'Mercado Pago request failed',
        requestId: sanitizeProviderText(requestId, 200),
        correlationId: sanitizeProviderText(correlationId, 200),
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
    if (expected.reason && existing?.reason !== expected.reason) {
        reasons.push(`reason=${existing?.reason ?? 'missing'} (expected ${expected.reason})`);
    }
    if (expected.backUrl && existing?.back_url !== expected.backUrl) {
        reasons.push(`back_url=${existing?.back_url ?? 'missing'} (expected ${expected.backUrl})`);
    }
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

function findMatchingExistingPlans(searchResponse, expected) {
    const results = Array.isArray(searchResponse?.results) ? searchResponse.results : [];
    return results
        .filter(plan => compareExistingPlan(plan, expected).valid)
        .sort((left, right) => {
            const leftTime = Date.parse(left?.last_modified ?? left?.date_created ?? '') || 0;
            const rightTime = Date.parse(right?.last_modified ?? right?.date_created ?? '') || 0;
            return leftTime - rightTime;
        });
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

async function createPlanRaw({
    accessToken,
    body,
    fetchImpl = globalThis.fetch,
    idempotencyKey = createFreshPlanIdempotencyKey(),
}) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('Node.js 20+ is required because global fetch is unavailable.');
    }
    if (typeof idempotencyKey !== 'string' || !UUID_V4_PATTERN.test(idempotencyKey)) {
        throw new TypeError('A valid UUID v4 idempotencyKey is required to create a Mercado Pago plan.');
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

async function searchPlansRaw({ accessToken, reason, fetchImpl = globalThis.fetch }) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('Node.js 20+ is required because global fetch is unavailable.');
    }
    if (typeof reason !== 'string' || !reason.trim()) {
        throw new TypeError('A non-empty reason is required to search Mercado Pago plans.');
    }

    const params = new URLSearchParams({ q: reason.trim(), status: 'active', limit: '100' });
    const response = await fetchImpl(
        `https://api.mercadopago.com/preapproval_plan/search?${params.toString()}`,
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
    let providerAccepted = 0;
    const pendingUpdates = [];

    try {
        const plans = await prisma.billingPlan.findMany({
            where: { isActive: true, slug: { in: [...SELF_SERVICE_PLAN_SLUGS] } },
            orderBy: { sortOrder: 'asc' },
        });

        const missingPlanSlugs = findMissingSelfServicePlanSlugs(plans);
        if (missingPlanSlugs.length > 0) {
            throw new Error(
                `Missing active self-service billing plan(s): ${missingPlanSlugs.join(', ')}. `
                + `Expected all of: ${SELF_SERVICE_PLAN_SLUGS.join(', ')}.`,
            );
        }

        const selectedPlans = selectPlansForSync(plans, args.only);
        if (args.only) {
            console.log(`  Clean probe scope: only ${args.only}/${args.cycle}.`);
        }

        for (const plan of selectedPlans) {
            const priceLocalOverrides = (plan.priceLocalOverrides && typeof plan.priceLocalOverrides === 'object')
                ? { ...plan.priceLocalOverrides }
                : {};
            const existingOverride = priceLocalOverrides[args.country];
            const isAnnual = args.cycle === 'year';

            let localAmountCents;
            let derivedMissingAnnual = false;
            if (isAnnual) {
                const persistedAnnualAmount = existingOverride?.annual?.amountCents;
                if (Number.isSafeInteger(persistedAnnualAmount) && persistedAnnualAmount > 0) {
                    localAmountCents = existingOverride.annual.amountCents;
                } else if (
                    (persistedAnnualAmount === undefined || persistedAnnualAmount === null)
                    && args.deriveMissingAnnualPct !== null
                ) {
                    const monthlyAmount = Number.isSafeInteger(existingOverride?.amountCents)
                        && existingOverride.amountCents > 0
                        ? existingOverride.amountCents
                        : (args.fx ? Math.round(plan.priceUsdCents * args.fx) : null);
                    if (!Number.isSafeInteger(monthlyAmount) || monthlyAmount <= 0) {
                        console.error(`  [${plan.slug}] cannot derive annual price: no positive monthly amount for ${args.country}.`);
                        failures += 1;
                        continue;
                    }
                    if (existingOverride?.amountCents && existingOverride?.currency !== currency) {
                        console.error(`  [${plan.slug}] cannot derive annual price: override currency ${existingOverride.currency ?? 'missing'} does not match ${currency}.`);
                        failures += 1;
                        continue;
                    }
                    localAmountCents = deriveAnnualAmountCents(monthlyAmount, args.deriveMissingAnnualPct);
                    derivedMissingAnnual = true;
                    console.warn(`  [${plan.slug}] annual price missing; deriving ${args.deriveMissingAnnualPct}% discount from the monthly ${currency} price. It will be persisted only after every provider write succeeds.`);
                } else {
                    console.error(`  [${plan.slug}] no valid annual price in DB for ${args.country} (overrides.${args.country}.annual.amountCents).`);
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

            const queuePlanIdUpdate = (mpPlanId, providerCreated) => {
                const nextOverrides = { ...priceLocalOverrides };
                if (isAnnual) {
                    nextOverrides[args.country] = {
                        ...(existingOverride ?? {}),
                        annual: {
                            ...(existingOverride?.annual ?? {}),
                            currency,
                            amountCents: localAmountCents,
                            mpPlanId,
                        },
                    };
                } else {
                    nextOverrides[args.country] = {
                        ...(existingOverride ?? {}),
                        currency,
                        amountCents: localAmountCents,
                        mpPlanId,
                    };
                }
                const data = { priceLocalOverrides: nextOverrides };
                if (args.country === 'CO' && !isAnnual) {
                    data.mpPlanId = mpPlanId;
                }
                pendingUpdates.push({
                    slug: plan.slug,
                    providerCreated,
                    where: { id: plan.id },
                    data,
                });
            };

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
                        reason: body.reason,
                        backUrl: body.back_url,
                    });
                    if (assessment.valid) {
                        validated += 1;
                        if (derivedMissingAnnual && !args.dryRun) {
                            queuePlanIdUpdate(existingCycleId, false);
                            console.log(`  [${plan.slug}] ${args.cycle} plan ${existingCycleId} matches; pending atomic annual-price repair.`);
                        } else {
                            console.log(`  [${plan.slug}] ${args.cycle} plan ${existingCycleId} is accessible and matches — skipping.`);
                        }
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

            // Recover a provider-side success that was not persisted locally
            // (for example, the process lost the response or another plan later
            // failed and the atomic DB transaction was skipped). This lets us use
            // the SDK-compatible fresh UUID v4 on each POST without accumulating
            // duplicate plans across deploy retries.
            if (!args.force) {
                try {
                    const search = await searchPlansRaw({ accessToken, reason: body.reason });
                    const matches = findMatchingExistingPlans(search, {
                        currency,
                        frequency: isAnnual ? 12 : 1,
                        amountCents: localAmountCents,
                        reason: body.reason,
                        backUrl: body.back_url,
                    });
                    if (matches.length > 0) {
                        let recovered = null;
                        for (const candidate of matches) {
                            try {
                                const current = await getPlanRaw({ accessToken, planId: candidate.id });
                                const currentAssessment = compareExistingPlan(current, {
                                    currency,
                                    frequency: isAnnual ? 12 : 1,
                                    amountCents: localAmountCents,
                                    reason: body.reason,
                                    backUrl: body.back_url,
                                });
                                if (currentAssessment.valid) {
                                    recovered = current;
                                    break;
                                }
                            } catch (error) {
                                const details = providerErrorDetails(error);
                                if (!isNotFoundError(details)) throw error;
                            }
                        }
                        if (recovered) {
                            validated += 1;
                            queuePlanIdUpdate(recovered.id, false);
                            const duplicateNote = matches.length > 1
                                ? ` (${matches.length} equivalent search matches; oldest live match selected)`
                                : '';
                            console.log(`    Recovered existing provider plan mpPlanId=${recovered.id}${duplicateNote}; pending atomic DB commit.`);
                            continue;
                        }
                    }
                } catch (error) {
                    console.error(`    FAILED to search existing ${plan.slug}/${args.cycle} plans safely:`, providerErrorDetails(error));
                    failures += 1;
                    continue;
                }
            }

            let res;
            try {
                // Raw fetch is intentional here: SDK v2.12 discards response
                // headers on non-2xx, including x-request-id required by MP support.
                // Mercado Pago's current SDK creates a fresh UUID v4 for every
                // non-GET request. Do the same so a regulatory 403 captured under
                // an older deterministic key cannot be replayed from idempotency.
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
            providerAccepted += 1;
            queuePlanIdUpdate(res.id, true);
            console.log(`    Provider accepted mpPlanId=${res.id}; pending atomic DB commit.`);
        }

        if (failures > 0) {
            console.log(`\nDone. providerAccepted=${providerAccepted} created=0 validated=${validated} failures=${failures}; database updates skipped.\n`);
            throw new Error(`Mercado Pago plan sync finished with ${failures} failure(s).`);
        }

        const persisted = await persistPendingPlanUpdates(prisma, pendingUpdates, failures);
        created = persisted.providerCreated;
        if (persisted.persisted > 0) {
            console.log(`  Atomically persisted ${persisted.persisted} plan update(s).`);
        }
        console.log(`\nDone. created=${created} validated=${validated} failures=0.\n`);
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
    createFreshPlanIdempotencyKey,
    createPlanRaw,
    deriveAnnualAmountCents,
    findMatchingExistingPlans,
    findMissingSelfServicePlanSlugs,
    getPlanRaw,
    isNotFoundError,
    persistPendingPlanUpdates,
    providerErrorDetails,
    sanitizeProviderText,
    searchPlansRaw,
    selectPlansForSync,
};
