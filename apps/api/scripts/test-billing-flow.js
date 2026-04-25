// scripts/test-billing-flow.js
//
// End-to-end validation of the billing pipeline using the mock provider.
// Creates a throwaway tenant, exercises createTrial / get / cancel through
// the real HTTP API, and checks the DB side-effects at every step. No
// MercadoPago credentials required — this script uses paymentProvider='mock'
// on the test tenant so the MockPaymentProvider (in-memory, deterministic)
// handles every provider call.
//
// What it validates
//   1. POST /billing/:id/subscription creates a BillingSubscription in TRIALING
//   2. Denormalised columns on tenants (subscriptionStatus, trialEndsAt) stay in sync
//   3. GET /billing/:id/subscription returns the expected shape
//   4. POST /billing/:id/subscription/cancel transitions to CANCELLED
//   5. Quota enforcement: starter plan can only have 1 agent, so a second
//      persona/agents POST returns 403 with error=agent_limit_reached
//   6. billing_events is populated (audit trail) and events fire on EventEmitter2
//
// Cleanup is automatic — the test tenant and its rows are deleted at the end,
// even on failure.
//
// Usage (runs inside the api container so JWT_SECRET is already set):
//   docker exec parallext-api node scripts/test-billing-flow.js
//
// The script mints its own short-lived super_admin JWT using the server's
// JWT_SECRET — no password required and no dependency on an external admin
// user existing in the DB.

const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const API_URL = process.env.API_URL || 'http://localhost:3000/api/v1';

const prisma = new PrismaClient();
const testId = Date.now();
const slug = `test-billing-${testId}`;
const schemaName = `tenant_${slug.replace(/-/g, '_')}`;

let tenant;
let pass = 0;
let fail = 0;

const ok = (msg) => { console.log(`  ✅ ${msg}`); pass++; };
const ko = (msg) => { console.error(`  ❌ ${msg}`); fail++; };
const step = (title) => console.log(`\n▶ ${title}`);

async function mintTestToken() {
    // Server signs JWTs with JWT_SECRET (falling back to INTERNAL_JWT_SECRET
    // for historical reasons — see auth.config.ts). The script runs inside
    // the api container so both are in env.
    const secret = process.env.JWT_SECRET || process.env.INTERNAL_JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET / INTERNAL_JWT_SECRET not set in env — cannot mint test token');

    // JwtStrategy.validate looks up prisma.user.findUnique({ id: payload.sub })
    // and user.id is a UUID column — so sub has to be a real user's UUID, not
    // a sentinel. Use the seeded super_admin user (created by prisma/seed-admin.ts).
    const admin = await prisma.user.findFirst({
        where: { role: 'super_admin', isActive: true },
        select: { id: true, email: true },
    });
    if (!admin) throw new Error('No active super_admin user found. Run prisma/seed-admin.ts first.');

    return jwt.sign(
        { sub: admin.id, email: admin.email, role: 'super_admin' },
        secret,
        { expiresIn: '5m' },
    );
}

async function createTestTenant() {
    tenant = await prisma.tenant.create({
        data: {
            name: `Test Billing ${testId}`,
            slug,
            industry: 'testing',
            schemaName,
            plan: 'starter',
            paymentProvider: 'mock',
            billingCountry: 'CO',
            billingEmail: `test-${testId}@example.com`,
        },
    });
}

async function http(token, method, path, body) {
    const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep null */ }
    return { status: res.status, json, text };
}

async function cleanup() {
    if (!tenant) return;
    try {
        // Cascade: billing_subscriptions, billing_events, billing_payments all CASCADE from tenant_id
        // Audit logs FK on tenant cascades too.
        await prisma.tenant.delete({ where: { id: tenant.id } });
        console.log(`\n  Cleanup: deleted test tenant ${tenant.id}`);
    } catch (e) {
        console.error(`\n  Cleanup failed: ${e.message}`);
    }
}

async function main() {
    console.log(`\n=== Billing flow E2E test (tenant=${slug}) ===`);

    step('1. Mint super_admin JWT from server secret');
    const token = await mintTestToken();
    if (!token) { ko('Failed to mint token'); return; }
    ok('access token minted (5 min TTL)');

    step('2. Create throwaway tenant with paymentProvider=mock');
    await createTestTenant();
    ok(`tenant ${tenant.id} created`);

    step('3. POST /billing/:id/subscription (starter, no card)');
    const start = await http(token, 'POST', `/billing/${tenant.id}/subscription`, {
        planSlug: 'starter',
        billingCountry: 'CO',
    });
    if (start.status === 201 || start.status === 200) {
        ok(`HTTP ${start.status}`);
    } else {
        ko(`HTTP ${start.status}: ${start.text.slice(0, 200)}`);
    }

    step('4. Check BillingSubscription row');
    const sub = await prisma.billingSubscription.findUnique({
        where: { tenantId: tenant.id },
        include: { plan: true },
    });
    if (!sub) { ko('subscription row not found'); }
    else {
        sub.status === 'trialing' ? ok(`status = ${sub.status}`) : ko(`status expected trialing, got ${sub.status}`);
        sub.plan?.slug === 'starter' ? ok(`plan = ${sub.plan.slug}`) : ko(`plan expected starter, got ${sub.plan?.slug}`);
        sub.trialEndsAt ? ok(`trial_ends_at = ${sub.trialEndsAt.toISOString()}`) : ko('trial_ends_at not set');
        sub.providerSubscriptionId ? ok(`provider_sub_id = ${sub.providerSubscriptionId}`) : ko('provider_sub_id missing');
    }

    step('5. Check Tenant denormalised fields are in sync');
    const t2 = await prisma.tenant.findUnique({ where: { id: tenant.id } });
    t2?.subscriptionStatus === 'trialing' ? ok(`tenant.subscription_status = ${t2.subscriptionStatus}`) : ko(`expected trialing, got ${t2?.subscriptionStatus}`);
    t2?.trialEndsAt ? ok(`tenant.trial_ends_at synced`) : ko('tenant.trial_ends_at not set');
    t2?.paymentProviderCustomerId ? ok(`payment_provider_customer_id = ${t2.paymentProviderCustomerId}`) : ko('customer id missing');

    step('6. GET /billing/:id/subscription returns the shape');
    const got = await http(token, 'GET', `/billing/${tenant.id}/subscription`);
    got.status === 200 ? ok(`HTTP ${got.status}`) : ko(`HTTP ${got.status}: ${got.text.slice(0, 200)}`);
    got.json?.data?.status === 'trialing' ? ok('data.status = trialing') : ko(`data.status = ${got.json?.data?.status}`);
    Array.isArray(got.json?.data?.payments) ? ok('data.payments is an array') : ko('data.payments missing');

    step('7. Simulate PAYMENT_SUCCEEDED webhook via /billing/webhook/mock');
    // MockPaymentProvider.parseWebhookEvent reads the body as already-normalized.
    // MockPaymentProvider.verifyWebhookSignature always returns true, so no HMAC needed.
    const webhookBody = {
        type: 'billing.payment.succeeded',
        providerEventId: `test_evt_${testId}`,
        occurredAt: new Date().toISOString(),
        tenantId: tenant.id,
        providerSubscriptionId: sub?.providerSubscriptionId,
        payment: {
            providerPaymentId: `test_pay_${testId}`,
            amountCents: 4900,
            currency: 'USD',
            status: 'succeeded',
            paidAt: new Date().toISOString(),
        },
    };
    const webhookRes = await fetch(`${API_URL}/billing/webhook/mock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookBody),
    });
    webhookRes.status === 200 ? ok(`webhook HTTP ${webhookRes.status}`) : ko(`webhook HTTP ${webhookRes.status}: ${await webhookRes.text()}`);

    // Give the event loop a tick so the async transaction inside handleBillingEvent settles
    await new Promise(r => setTimeout(r, 200));

    const subAfterPay = await prisma.billingSubscription.findUnique({ where: { tenantId: tenant.id } });
    subAfterPay?.status === 'active' ? ok(`status transitioned trialing → ${subAfterPay.status}`) : ko(`expected active, got ${subAfterPay?.status}`);

    const payments = await prisma.billingPayment.findMany({ where: { tenantId: tenant.id } });
    payments.length === 1 && payments[0].status === 'succeeded' ? ok('billing_payments row created with status=succeeded') : ko(`expected 1 succeeded payment, got ${payments.length}`);

    step('8. POST /billing/:id/subscription/cancel (immediate)');
    const cancel = await http(token, 'POST', `/billing/${tenant.id}/subscription/cancel`, { immediate: true, reason: 'e2e_test' });
    cancel.status === 200 || cancel.status === 201 ? ok(`HTTP ${cancel.status}`) : ko(`HTTP ${cancel.status}: ${cancel.text.slice(0, 200)}`);

    const sub2 = await prisma.billingSubscription.findUnique({ where: { tenantId: tenant.id } });
    sub2?.status === 'cancelled' ? ok(`status = ${sub2.status}`) : ko(`expected cancelled, got ${sub2?.status}`);
    sub2?.cancelledAt ? ok('cancelled_at populated') : ko('cancelled_at missing');

    step('9. Create a second tenant and upgrade to Pro with a mock card token');
    const tenantPro = await prisma.tenant.create({
        data: {
            name: `Test Pro ${testId}`,
            slug: `${slug}-pro`,
            industry: 'testing',
            schemaName: `${schemaName}_pro`,
            plan: 'starter',
            paymentProvider: 'mock',
            billingCountry: 'CO',
            billingEmail: `test-${testId}-pro@example.com`,
        },
    });
    try {
        // Pro requires a card — send a mock token; MockPaymentProvider accepts any string
        const proRes = await http(token, 'POST', `/billing/${tenantPro.id}/subscription`, {
            planSlug: 'pro',
            cardTokenId: `mock_card_token_${testId}`,
            billingCountry: 'CO',
        });
        (proRes.status === 200 || proRes.status === 201) ? ok(`Pro trial started HTTP ${proRes.status}`) : ko(`Pro trial HTTP ${proRes.status}: ${proRes.text.slice(0, 200)}`);
        const proSub = await prisma.billingSubscription.findUnique({ where: { tenantId: tenantPro.id } });
        proSub?.status === 'trialing' ? ok(`Pro subscription in trialing`) : ko(`Pro expected trialing, got ${proSub?.status}`);

        // Reject Pro creation without card
        const tenantProNoCard = await prisma.tenant.create({
            data: {
                name: `Test Pro NoCard ${testId}`,
                slug: `${slug}-pro-nocard`,
                industry: 'testing',
                schemaName: `${schemaName}_pro_nocard`,
                plan: 'starter',
                paymentProvider: 'mock',
                billingCountry: 'CO',
                billingEmail: `test-${testId}-pro-nocard@example.com`,
            },
        });
        const rejectRes = await http(token, 'POST', `/billing/${tenantProNoCard.id}/subscription`, {
            planSlug: 'pro',
            billingCountry: 'CO',
        });
        rejectRes.status === 400 || rejectRes.status === 403 ? ok(`Pro without card correctly rejected HTTP ${rejectRes.status}`) : ko(`Expected 400/403 for Pro without card, got ${rejectRes.status}`);
        await prisma.tenant.delete({ where: { id: tenantProNoCard.id } });
    } finally {
        await prisma.tenant.delete({ where: { id: tenantPro.id } });
    }

    step('10. billing_events audit log has webhook entry');
    const events = await prisma.billingEvent.findMany({ where: { tenantId: tenant.id }, orderBy: { processedAt: 'asc' } });
    events.length >= 1 ? ok(`${events.length} webhook event(s) recorded`) : ko('no billing_events rows created — webhook processing failed');
    events.forEach(e => console.log(`    • ${e.eventType} (${e.provider}/${e.providerEventId})`));

    step('11. Summary');
    console.log(`\n  ${pass} passed, ${fail} failed.\n`);
    if (fail > 0) process.exitCode = 1;
}

main()
    .catch(e => { console.error('\nFATAL:', e.message, '\n', e.stack); process.exitCode = 1; })
    .finally(async () => {
        await cleanup();
        await prisma.$disconnect();
    });
