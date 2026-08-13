#!/usr/bin/env node
/**
 * End-to-end check of the Wompi integration against the SANDBOX API.
 *
 * Runs the exact sequence a real charge takes — acceptance tokens → card token →
 * payment source → charge → settlement — using the same signature and status
 * rules the adapter implements. It exists to prove the contract before the
 * recurring engine is built on top of it: a wrong field order or a stale
 * assumption is cheap to find here and expensive to find in production.
 *
 * SAFETY: refuses to run with production keys. Every charge is COP 1,500 (the
 * provider minimum) against Wompi's deterministic test cards, so no real money
 * can move.
 *
 * Usage (locally, with the four keys exported or in apps/api/.env):
 *   node scripts/verify-wompi-sandbox.js
 *
 * Inside the deployed container:
 *   docker exec parallext-api node scripts/verify-wompi-sandbox.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// --- env -------------------------------------------------------------------
// Read apps/api/.env when present so the script works before the app boots.
(function loadEnvFile() {
    const envPath = path.resolve(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!match) continue;
        const [, key, rawValue] = match;
        if (process.env[key]) continue;
        process.env[key] = rawValue.replace(/^["']|["']$/g, '');
    }
})();

const PUBLIC_KEY = (process.env.WOMPI_PUBLIC_KEY || '').trim();
const PRIVATE_KEY = (process.env.WOMPI_PRIVATE_KEY || '').trim();
const EVENTS_SECRET = (process.env.WOMPI_EVENTS_SECRET || '').trim();
const INTEGRITY_SECRET = (process.env.WOMPI_INTEGRITY_SECRET || '').trim();

const AMOUNT_IN_CENTS = 150_000; // COP 1.500 — the aggregator minimum
const CURRENCY = 'COP';
const TEST_EMAIL = 'sandbox-check@parallly-chat.cloud';

// Wompi's deterministic sandbox cards.
const CARD_APPROVED = '4242424242424242';
const CARD_DECLINED = '4111111111111111';

let failures = 0;
const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const bad = (msg) => { failures++; console.log(`  \x1b[31m✗\x1b[0m ${msg}`); };
const info = (msg) => console.log(`    ${msg}`);
const step = (msg) => console.log(`\n\x1b[1m${msg}\x1b[0m`);

function fail(msg) {
    console.error(`\n\x1b[31m${msg}\x1b[0m\n`);
    process.exit(1);
}

// --- guards ----------------------------------------------------------------
if (!PUBLIC_KEY || !PRIVATE_KEY || !INTEGRITY_SECRET) {
    fail('Missing keys. Set WOMPI_PUBLIC_KEY, WOMPI_PRIVATE_KEY, WOMPI_EVENTS_SECRET and WOMPI_INTEGRITY_SECRET.');
}

const looksSandbox = PUBLIC_KEY.startsWith('pub_test_')
    && PRIVATE_KEY.startsWith('prv_test_')
    && (!INTEGRITY_SECRET || INTEGRITY_SECRET.startsWith('test_'))
    && (!EVENTS_SECRET || EVENTS_SECRET.startsWith('test_'));

if (!looksSandbox) {
    fail(
        'These are NOT all sandbox keys. This script only runs against sandbox.\n'
        + `  public:    ${PUBLIC_KEY.slice(0, 12)}…  (expected pub_test_…)\n`
        + `  private:   ${PRIVATE_KEY.slice(0, 12)}…  (expected prv_test_…)\n`
        + `  integrity: ${INTEGRITY_SECRET.slice(0, 12)}…  (expected test_integrity_…)\n`
        + `  events:    ${EVENTS_SECRET.slice(0, 12)}…  (expected test_events_…)`,
    );
}

const BASE_URL = 'https://sandbox.wompi.co/v1';

async function api(pathname, { method = 'GET', body, auth = 'none' } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth === 'private') headers.Authorization = `Bearer ${PRIVATE_KEY}`;
    if (auth === 'public') headers.Authorization = `Bearer ${PUBLIC_KEY}`;

    const res = await fetch(`${BASE_URL}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { /* keep raw below */ }
    return { status: res.status, ok: res.ok, json, text };
}

/** Same rule as the adapter: SHA256(reference + amount + currency [+ expiration] + secret). */
function integritySignature(reference, amountInCents, currency, expirationTime) {
    const parts = [reference, String(amountInCents), currency];
    if (expirationTime) parts.push(expirationTime);
    parts.push(INTEGRITY_SECRET);
    return crypto.createHash('sha256').update(parts.join('')).digest('hex');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
    console.log('\n\x1b[1mWompi sandbox verification\x1b[0m');
    console.log(`  base url: ${BASE_URL}`);
    console.log(`  merchant: ${PUBLIC_KEY.slice(0, 20)}…`);

    // 1. Acceptance contracts ------------------------------------------------
    step('1. Acceptance tokens (habeas data)');
    const merchant = await api(`/merchants/${PUBLIC_KEY}`);
    if (!merchant.ok) fail(`GET /merchants failed (${merchant.status}): ${merchant.text.slice(0, 300)}`);

    const presigned = merchant.json?.data?.presigned_acceptance;
    const personal = merchant.json?.data?.presigned_personal_data_auth;
    if (!presigned?.acceptance_token) bad('no presigned_acceptance token returned');
    else ok(`end-user policy token received (${presigned.type || 'END_USER_POLICY'})`);

    if (!personal?.acceptance_token) {
        bad('no presigned_personal_data_auth token — the checkout needs BOTH contracts');
    } else {
        ok(`personal data auth token received (${personal.type || 'PERSONAL_DATA_AUTH'})`);
    }
    if (presigned?.permalink) info(`policy: ${presigned.permalink}`);

    // 2. Card tokenization ---------------------------------------------------
    step('2. Card tokenization (public key)');
    const tokenRes = await api('/tokens/cards', {
        method: 'POST',
        auth: 'public',
        body: {
            number: CARD_APPROVED,
            cvc: '123',
            exp_month: '12',
            exp_year: '32',
            card_holder: 'Parallly Sandbox',
        },
    });
    if (!tokenRes.ok) fail(`POST /tokens/cards failed (${tokenRes.status}): ${tokenRes.text.slice(0, 300)}`);
    const cardToken = tokenRes.json?.data?.id;
    if (!cardToken) fail('no card token id returned');
    ok(`card token created (${cardToken.slice(0, 16)}…)`);

    // 3. Payment source ------------------------------------------------------
    step('3. Reusable payment source (private key)');
    const sourceRes = await api('/payment_sources', {
        method: 'POST',
        auth: 'private',
        body: {
            type: 'CARD',
            token: cardToken,
            customer_email: TEST_EMAIL,
            acceptance_token: presigned?.acceptance_token,
            accept_personal_auth: personal?.acceptance_token,
        },
    });
    if (!sourceRes.ok) {
        fail(
            `POST /payment_sources failed (${sourceRes.status}): ${sourceRes.text.slice(0, 400)}\n`
            + 'If this complains about acceptance tokens, the checkout must send BOTH.',
        );
    }
    const sourceId = sourceRes.json?.data?.id;
    const sourceStatus = sourceRes.json?.data?.status;
    ok(`payment source ${sourceId} → ${sourceStatus}`);
    if (sourceStatus !== 'AVAILABLE') bad(`expected AVAILABLE, got ${sourceStatus}`);
    if (typeof sourceId !== 'number') info(`note: source id type is ${typeof sourceId} (adapter casts to integer)`);

    // 4. Charge --------------------------------------------------------------
    step('4. Merchant-initiated charge (the recurring path)');
    const reference = `verify_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const signature = integritySignature(reference, AMOUNT_IN_CENTS, CURRENCY);
    info(`reference: ${reference}`);

    const chargeRes = await api('/transactions', {
        method: 'POST',
        auth: 'private',
        body: {
            amount_in_cents: AMOUNT_IN_CENTS,
            currency: CURRENCY,
            customer_email: TEST_EMAIL,
            reference,
            payment_source_id: sourceId,
            signature,
            recurrent: true,
            // Required for CARD sources even though the docs call payment_method
            // optional when payment_source_id is present.
            payment_method: { installments: 1 },
            acceptance_token: presigned?.acceptance_token,
            accept_personal_auth: personal?.acceptance_token,
        },
    });
    if (!chargeRes.ok) {
        fail(
            `POST /transactions failed (${chargeRes.status}): ${chargeRes.text.slice(0, 400)}\n`
            + 'A signature error here means the concatenation order is wrong:\n'
            + '  SHA256(reference + amount_in_cents + currency + integrity_secret)',
        );
    }
    ok('integrity signature accepted');
    const txnId = chargeRes.json?.data?.id;
    const initialStatus = chargeRes.json?.data?.status;
    info(`transaction ${txnId} → ${initialStatus}`);
    if (initialStatus !== 'PENDING') {
        bad(`expected PENDING (nothing settles synchronously); got ${initialStatus}`);
    } else {
        ok('charge is asynchronous, as the engine assumes');
    }

    // 5. Settlement by polling ----------------------------------------------
    step('5. Settlement (polling — the webhook fallback path)');
    let finalStatus = initialStatus;
    for (let attempt = 1; attempt <= 10 && finalStatus === 'PENDING'; attempt++) {
        await sleep(2000);
        const poll = await api(`/transactions/${txnId}`, { auth: 'public' });
        finalStatus = poll.json?.data?.status ?? finalStatus;
        info(`attempt ${attempt}: ${finalStatus}`);
    }
    if (finalStatus === 'APPROVED') ok('charge APPROVED with the test card');
    else bad(`expected APPROVED, ended as ${finalStatus}`);

    // 6. Lookup by reference — the timeout rescue ----------------------------
    step('6. Lookup by reference (rescue for an indeterminate charge)');
    const byRef = await api(`/transactions?reference=${encodeURIComponent(reference)}`, { auth: 'private' });
    if (!byRef.ok) {
        bad(`GET /transactions?reference= failed (${byRef.status}). WITHOUT this, a network timeout leaves a charge that cannot be resolved without risking a double charge.`);
        info(byRef.text.slice(0, 300));
    } else {
        const list = Array.isArray(byRef.json?.data) ? byRef.json.data : [];
        const found = list.find((t) => t?.id === txnId);
        if (found) ok(`reference lookup returned the transaction (${list.length} result(s))`);
        else bad(`reference lookup returned ${list.length} result(s) but not our transaction`);
    }

    // 7. Declined card -------------------------------------------------------
    step('7. Declined card (dunning depends on telling these apart)');
    const declinedToken = await api('/tokens/cards', {
        method: 'POST',
        auth: 'public',
        body: { number: CARD_DECLINED, cvc: '123', exp_month: '12', exp_year: '32', card_holder: 'Parallly Sandbox' },
    });
    if (!declinedToken.ok) {
        bad(`could not tokenize the declined test card (${declinedToken.status})`);
    } else {
        const declinedSource = await api('/payment_sources', {
            method: 'POST',
            auth: 'private',
            body: {
                type: 'CARD',
                token: declinedToken.json?.data?.id,
                customer_email: TEST_EMAIL,
                acceptance_token: presigned?.acceptance_token,
                accept_personal_auth: personal?.acceptance_token,
            },
        });
        if (!declinedSource.ok) {
            info(`declined card rejected at source creation (${declinedSource.status}) — also a valid provider behaviour`);
        } else {
            const ref2 = `verify_dec_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
            const declinedCharge = await api('/transactions', {
                method: 'POST',
                auth: 'private',
                body: {
                    amount_in_cents: AMOUNT_IN_CENTS,
                    currency: CURRENCY,
                    customer_email: TEST_EMAIL,
                    reference: ref2,
                    payment_source_id: declinedSource.json?.data?.id,
                    signature: integritySignature(ref2, AMOUNT_IN_CENTS, CURRENCY),
                    recurrent: true,
                    payment_method: { installments: 1 },
                    acceptance_token: presigned?.acceptance_token,
                    accept_personal_auth: personal?.acceptance_token,
                },
            });
            if (!declinedCharge.ok) {
                info(`declined charge refused up front (${declinedCharge.status})`);
            } else {
                let status2 = declinedCharge.json?.data?.status;
                const id2 = declinedCharge.json?.data?.id;
                for (let attempt = 1; attempt <= 8 && status2 === 'PENDING'; attempt++) {
                    await sleep(2000);
                    const poll = await api(`/transactions/${id2}`, { auth: 'public' });
                    status2 = poll.json?.data?.status ?? status2;
                }
                if (status2 === 'DECLINED') ok('declined card resolves to DECLINED');
                else bad(`expected DECLINED, got ${status2}`);
            }
        }
    }

    // 8. Events secret -------------------------------------------------------
    step('8. Webhook secret');
    if (!EVENTS_SECRET) {
        bad('WOMPI_EVENTS_SECRET is empty — every incoming event will be rejected (fail-closed)');
    } else {
        ok('events secret present (verify a real delivery once the URL is configured in the panel)');
        info('Panel → Desarrolladores → URL de eventos:');
        info('  https://api.parallly-chat.cloud/api/v1/billing/webhook/wompi');
    }

    // --- summary ------------------------------------------------------------
    console.log('\n' + '─'.repeat(64));
    if (failures === 0) {
        console.log('\x1b[32m✓ Sandbox contract verified — the adapter assumptions hold.\x1b[0m');
        console.log('  Charges are async, the signature order is right, and a charge can');
        console.log('  be recovered by reference after a timeout.');
    } else {
        console.log(`\x1b[31m✗ ${failures} check(s) failed — fix these before building the engine on top.\x1b[0m`);
    }
    console.log('─'.repeat(64) + '\n');
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error('\n\x1b[31mUnexpected error:\x1b[0m', err?.message || err);
    process.exit(1);
});
