const test = require('node:test');
const assert = require('node:assert/strict');

const {
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
} = require('../sync-mp-plans');

test('derives the canonical 15% annual totals from persisted monthly COP prices', () => {
    assert.equal(deriveAnnualAmountCents(12_570_000, 15), 128_214_000);
    assert.equal(deriveAnnualAmountCents(27_690_000, 15), 282_438_000);
    assert.equal(deriveAnnualAmountCents(75_770_000, 15), 772_854_000);
    assert.equal(deriveAnnualAmountCents(178_980_000, 15), 1_825_596_000);
    assert.throws(() => deriveAnnualAmountCents(0, 15), /positive integer monthly amount/);
    assert.throws(() => deriveAnnualAmountCents(100, 100), /greater than 0 and less than 100/);
});

test('persists provider results atomically only when the whole cycle has no failures', async () => {
    const calls = [];
    const prisma = {
        billingPlan: {
            update(args) {
                calls.push(['update', args]);
                return { args };
            },
        },
        async $transaction(queries) {
            calls.push(['transaction', queries]);
        },
    };
    const pending = [
        { where: { id: 'one' }, data: { value: 1 }, providerCreated: true },
        { where: { id: 'two' }, data: { value: 2 }, providerCreated: false },
    ];

    assert.deepEqual(await persistPendingPlanUpdates(prisma, pending, 1), {
        persisted: 0,
        providerCreated: 0,
    });
    assert.deepEqual(calls, []);

    assert.deepEqual(await persistPendingPlanUpdates(prisma, pending, 0), {
        persisted: 2,
        providerCreated: 1,
    });
    assert.equal(calls.filter(([kind]) => kind === 'update').length, 2);
    assert.equal(calls.filter(([kind]) => kind === 'transaction').length, 1);
});

test('requires all four active self-service plans before any provider write', () => {
    const complete = [
        { slug: 'enterprise' },
        { slug: 'starter' },
        { slug: 'emprendedor' },
        { slug: 'pro' },
    ];
    assert.deepEqual(findMissingSelfServicePlanSlugs(complete), []);

    assert.deepEqual(
        findMissingSelfServicePlanSlugs(complete.filter(plan => plan.slug !== 'pro')),
        ['pro'],
    );
    assert.deepEqual(
        findMissingSelfServicePlanSlugs(null),
        ['emprendedor', 'starter', 'pro', 'enterprise'],
    );
});

test('buildPlanIdempotencyKey is a stable UUID for the same normalized specification', () => {
    const body = buildPlanBody({
        plan: { name: 'Pro' },
        country: 'CO',
        currency: 'COP',
        cycle: 'month',
        amountCents: 249_900,
    });
    const reorderedBody = {
        back_url: body.back_url,
        auto_recurring: {
            currency_id: body.auto_recurring.currency_id,
            transaction_amount: body.auto_recurring.transaction_amount,
            frequency_type: body.auto_recurring.frequency_type,
            frequency: body.auto_recurring.frequency,
        },
        reason: body.reason,
    };

    const first = buildPlanIdempotencyKey({
        country: 'CO', slug: 'pro', cycle: 'month', body, replacementOf: null,
    });
    const retry = buildPlanIdempotencyKey({
        country: 'co', slug: 'PRO', cycle: 'month', body: reorderedBody, replacementOf: null,
    });

    assert.equal(first, retry);
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('buildPlanIdempotencyKey changes with identity, cycle, replacementOf or expected payload', () => {
    const specification = {
        country: 'CO',
        slug: 'pro',
        cycle: 'month',
        replacementOf: null,
        body: buildPlanBody({
            plan: { name: 'Pro' },
            country: 'CO',
            currency: 'COP',
            cycle: 'month',
            amountCents: 249_900,
        }),
    };
    const original = buildPlanIdempotencyKey(specification);
    const variants = [
        { ...specification, country: 'MX' },
        { ...specification, slug: 'starter' },
        { ...specification, cycle: 'year' },
        { ...specification, replacementOf: 'existing-plan-id' },
        {
            ...specification,
            body: {
                ...specification.body,
                auto_recurring: {
                    ...specification.body.auto_recurring,
                    transaction_amount: specification.body.auto_recurring.transaction_amount + 1,
                },
            },
        },
    ];

    for (const variant of variants) {
        assert.notEqual(buildPlanIdempotencyKey(variant), original);
    }
});

test('buildPlanBody emits the documented COP monthly payload in peso units', () => {
    const body = buildPlanBody({
        plan: { name: 'Pro' },
        country: 'CO',
        currency: 'COP',
        cycle: 'month',
        amountCents: 249_900,
    });

    assert.deepEqual(body.auto_recurring, {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: 2499,
        currency_id: 'COP',
    });
    assert.equal('payment_methods_allowed' in body, false);
    assert.match(body.back_url, /^https:\/\//);
});

test('compareExistingPlan accepts a matching plan and rejects stale configuration', () => {
    const expected = { currency: 'COP', frequency: 12, amountCents: 2_499_900 };
    const matching = compareExistingPlan({
        id: 'plan-production',
        status: 'active',
        auto_recurring: {
            frequency: 12,
            frequency_type: 'months',
            transaction_amount: 24999,
            currency_id: 'COP',
        },
    }, expected);
    assert.equal(matching.valid, true);

    const stale = compareExistingPlan({
        id: 'plan-sandbox',
        status: 'active',
        auto_recurring: {
            frequency: 1,
            frequency_type: 'months',
            transaction_amount: 10,
            currency_id: 'ARS',
        },
    }, expected);
    assert.equal(stale.valid, false);
    assert.ok(stale.reasons.some(reason => reason.startsWith('currency=')));
    assert.ok(stale.reasons.some(reason => reason.startsWith('frequency=')));
    assert.ok(stale.reasons.some(reason => reason.startsWith('amount=')));
});

test('providerErrorDetails retains the regulatory code without serializing credentials', () => {
    const details = providerErrorDetails({
        status: 403,
        error: 'rejected_by_regulations_collector_non_compliant',
        message: 'Collector is not compliant',
        access_token: 'APP_USR-secret',
        cause: [{
            code: 'rejected_by_regulations_collector_non_compliant',
            description: 'Collector blocked. Bearer APP_USR-super-secret-token',
        }],
    });

    assert.deepEqual(details, {
        status: 403,
        code: 'rejected_by_regulations_collector_non_compliant',
        message: 'Collector blocked. Bearer [REDACTED]',
        requestId: null,
    });
    assert.equal(JSON.stringify(details).includes('APP_USR-secret'), false);
    assert.equal(isNotFoundError({ status: 404, code: null }), true);
});

test('createPlanRaw captures x-request-id from a 403 without retaining request headers', async () => {
    const idempotencyKey = '72a2a488-7225-5fe3-916f-a0e4b70f90ad';
    const fetchImpl = async (_url, request) => {
        assert.equal(request.headers.Authorization, 'Bearer APP_USR-secret');
        assert.equal(request.headers['X-Idempotency-Key'], idempotencyKey);
        return new Response(JSON.stringify({
            error: 'forbidden',
            message: 'Collector is not compliant',
            cause: [{ code: 'rejected_by_regulations_collector_non_compliant' }],
        }), {
            status: 403,
            headers: { 'content-type': 'application/json', 'x-request-id': 'req-403-mco' },
        });
    };

    await assert.rejects(
        createPlanRaw({
            accessToken: 'APP_USR-secret',
            body: { reason: 'Pro — Parallly CO' },
            fetchImpl,
            idempotencyKey,
        }),
        (error) => {
            const details = providerErrorDetails(error);
            assert.deepEqual(details, {
                status: 403,
                code: 'rejected_by_regulations_collector_non_compliant',
                message: 'Collector is not compliant',
                requestId: 'req-403-mco',
            });
            assert.equal(JSON.stringify(error).includes('APP_USR-secret'), false);
            return true;
        },
    );
});

test('getPlanRaw safely reports a stale ID and captures its request id', async () => {
    const fetchImpl = async (url, request) => {
        assert.match(url, /preapproval_plan\/old-plan%2Fid$/);
        assert.equal(request.method, 'GET');
        return new Response(JSON.stringify({ error: 'not_found', message: 'Plan not found' }), {
            status: 404,
            headers: { 'content-type': 'application/json', 'x-request-id': 'req-stale-plan' },
        });
    };

    await assert.rejects(
        getPlanRaw({ accessToken: 'APP_USR-secret', planId: 'old-plan/id', fetchImpl }),
        (error) => {
            const details = providerErrorDetails(error);
            assert.equal(isNotFoundError(details), true);
            assert.equal(details.requestId, 'req-stale-plan');
            assert.equal(JSON.stringify(error).includes('APP_USR-secret'), false);
            return true;
        },
    );
});
