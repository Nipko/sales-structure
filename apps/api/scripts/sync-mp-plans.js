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
const { createHash } = require('crypto');

// RFC 9562 URL namespace. A namespaced UUID keeps retries of the exact same
// plan specification on the same Mercado Pago idempotency key, including
// retries after an accepted POST whose response/DB update was interrupted.
const URL_UUID_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

function canonicalJson(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(item => canonicalJson(item) ?? 'null').join(',')}]`;
    }
    const entries = Object.keys(value)
        .sort()
        .filter(key => value[key] !== undefined)
        .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(',')}}`;
}

function uuidV5(name, namespace = URL_UUID_NAMESPACE) {
    const namespaceBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
    if (namespaceBytes.length !== 16) {
        throw new TypeError('The UUID namespace must contain exactly 16 bytes.');
    }

    const bytes = createHash('sha1')
        .update(namespaceBytes)
        .update(String(name), 'utf8')
        .digest()
        .subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50; // RFC 9562 version 5
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 9562 variant

    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function buildPlanIdempotencyKey({ country, slug, cycle, body, replacementOf = null }) {
    if (!country || !slug || !cycle || !body || typeof body !== 'object') {
        throw new TypeError('country, slug, cycle and body are required to build the plan idempotency key.');
    }

    const specification = {
        provider: 'mercadopago',
        resource: 'preapproval_plan',
        country: String(country).trim().toUpperCase(),
        slug: String(slug).trim().toLowerCase(),
        cycle: String(cycle).trim().toLowerCase(),
        replacementOf: replacementOf ? String(replacementOf).trim() : null,
        body,
    };
    return uuidV5(`parallly:${canonicalJson(specification)}`);
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
    return {
        country,
        fx,
        cycle,
        deriveMissingAnnualPct,
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

async function createPlanRaw({ accessToken, body, fetchImpl = globalThis.fetch, idempotencyKey }) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('Node.js 20+ is required because global fetch is unavailable.');
    }
    if (typeof idempotencyKey !== 'string' || !UUID_PATTERN.test(idempotencyKey)) {
        throw new TypeError('A valid deterministic UUID idempotencyKey is required to create a Mercado Pago plan.');
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

        for (const plan of plans) {
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
                        if (derivedMissingAnnual && !args.dryRun) {
                            priceLocalOverrides[args.country] = {
                                ...(existingOverride ?? {}),
                                annual: {
                                    ...(existingOverride?.annual ?? {}),
                                    currency,
                                    amountCents: localAmountCents,
                                    mpPlanId: existingCycleId,
                                },
                            };
                            pendingUpdates.push({
                                slug: plan.slug,
                                providerCreated: false,
                                where: { id: plan.id },
                                data: { priceLocalOverrides },
                            });
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

            let res;
            try {
                // Raw fetch is intentional here: SDK v2.12 discards response
                // headers on non-2xx, including x-request-id required by MP support.
                const idempotencyKey = buildPlanIdempotencyKey({
                    country: args.country,
                    slug: plan.slug,
                    cycle: args.cycle,
                    body,
                    replacementOf: existingCycleId ?? null,
                });
                res = await createPlanRaw({ accessToken, body, idempotencyKey });
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

            pendingUpdates.push({
                slug: plan.slug,
                providerCreated: true,
                where: { id: plan.id },
                data: updateData,
            });
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
    buildPlanIdempotencyKey,
    buildPlanBody,
    compareExistingPlan,
    createPlanRaw,
    deriveAnnualAmountCents,
    findMissingSelfServicePlanSlugs,
    getPlanRaw,
    isNotFoundError,
    persistPendingPlanUpdates,
    providerErrorDetails,
    sanitizeProviderText,
};
