#!/usr/bin/env node
/*
 * The four surfaces, asked the way a person or a provider asks them.
 *
 *   node scripts/staging-smoke.cjs [--dispatch] [--json <path>]
 *
 * Runs inside the API container against the running stack, over loopback, so
 * what it exercises is the deployed process rather than a fresh Nest built in
 * this script. Every check is a REQUEST with an expected shape:
 *
 *   api        — liveness and the detailed report, and that the report says the
 *                database and Redis are reachable rather than merely answering;
 *   dashboard  — the login page renders and carries the staging API URL, so a
 *                dashboard pointed at the wrong API is caught here and not by a
 *                person wondering why staging shows production data;
 *   widget     — the public widget config for the synthetic tenant, which is the
 *                one customer-facing surface with no provider in front of it;
 *   whatsapp   — the webhook verification handshake, using the staging verify
 *                token. Nothing is sent: `hub.challenge` echoes back or it does
 *                not, and that is the whole contract Meta checks.
 *
 * `--dispatch` additionally asserts that the durable outbox pilot is live for
 * exactly the synthetic tenant and nobody else.
 *
 * Exit: 0 every check passed, 1 a check failed, 2 the target was refused.
 */
const { writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

function load() {
    try { return require('../dist/common/utils/staging-operations.js'); }
    catch (compiled) {
        try {
            require('ts-node/register/transpile-only');
            return require(resolve(__dirname, '../src/common/utils/staging-operations.ts'));
        } catch (source) {
            console.error(`::error::staging contract unavailable: ${compiled && compiled.message} / ${source && source.message}`);
            process.exit(2);
        }
    }
}

const API = process.env.STAGING_SMOKE_API_URL || 'http://api:3000';
const DASHBOARD = process.env.STAGING_SMOKE_DASHBOARD_URL || 'http://dashboard:3001';
const WHATSAPP = process.env.STAGING_SMOKE_WHATSAPP_URL || 'http://whatsapp:3002';

async function get(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const text = await response.text();
        return { status: response.status, text };
    } finally { clearTimeout(timer); }
}

async function main() {
    const { assertStagingTarget, assertPilotScope, PILOT_TENANT, SYNTHETIC_TENANTS } = load();
    const withDispatch = process.argv.includes('--dispatch');
    const jsonFlag = process.argv.indexOf('--json');
    const jsonPath = jsonFlag > -1 ? process.argv[jsonFlag + 1] : null;

    let target;
    try {
        target = assertStagingTarget({
            environment: process.env.PARALLLY_ENVIRONMENT,
            databaseUrl: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL,
        });
    } catch (error) {
        console.error(`::error::${error.message}`);
        process.exit(2);
    }

    const results = [];
    const check = async (name, run) => {
        try {
            const detail = await run();
            results.push({ name, ok: true, detail: detail ?? null });
            console.log(`  [OK] ${name}${detail ? ` — ${detail}` : ''}`);
        } catch (error) {
            results.push({ name, ok: false, detail: String(error && error.message) });
            console.log(`  [FAIL] ${name} — ${error && error.message}`);
        }
    };

    await check('api.liveness', async () => {
        const { status } = await get(`${API}/health`);
        if (status !== 200) throw new Error(`status ${status}`);
        return 'GET /health 200';
    });

    await check('api.dependencies', async () => {
        const { status, text } = await get(`${API}/health/detailed`);
        if (status !== 200) throw new Error(`status ${status}`);
        const body = JSON.parse(text);
        // "Answered" is not "healthy": the detailed report names each dependency
        // and a run that reads a 200 without looking at them proves the route.
        const flat = JSON.stringify(body).toLowerCase();
        for (const dependency of ['database', 'redis']) {
            if (!flat.includes(dependency)) throw new Error(`report does not mention ${dependency}`);
        }
        if (/"status"\s*:\s*"(down|unhealthy|error)"/.test(flat)) throw new Error('a dependency reports down');
        return 'database and redis reported';
    });

    await check('dashboard.login', async () => {
        const { status, text } = await get(`${DASHBOARD}/login`);
        if (status !== 200) throw new Error(`status ${status}`);
        if (!/type="password"|type='password'/.test(text)) throw new Error('no password field rendered');
        // A dashboard built against the production API would show staging data
        // from production, and nothing about the page would look wrong.
        if (/parallly-chat\.cloud/.test(text)) throw new Error('the page references a production host');
        return 'renders, and references no production host';
    });

    await check('widget.publicConfig', async () => {
        const { status, text } = await get(`${API}/api/v1/widget/public/config/${PILOT_TENANT.id}`);
        if (status === 404) throw new Error('the synthetic tenant has no widget config — was the seed run?');
        if (status >= 500) throw new Error(`status ${status}`);
        if (/parallly-chat\.cloud/.test(text)) throw new Error('the widget config references a production host');
        return `status ${status}`;
    });

    await check('whatsapp.webhookVerification', async () => {
        const token = process.env.META_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN;
        if (!token) throw new Error('no verify token configured for staging');
        const challenge = `stg-${Date.now()}`;
        const { status, text } = await get(
            `${WHATSAPP}/api/v1/whatsapp/webhook?hub.mode=subscribe`
            + `&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=${challenge}`);
        if (status !== 200 || text.trim() !== challenge) throw new Error(`status ${status}, body did not echo the challenge`);
        return 'challenge echoed';
    });

    await check('whatsapp.webhookRejectsWrongToken', async () => {
        // The half that matters: a webhook that accepts any token accepts
        // anybody's payload.
        const { status } = await get(
            `${WHATSAPP}/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x`);
        if (status === 200) throw new Error('a wrong verify token was accepted');
        return `rejected with ${status}`;
    });

    if (withDispatch) {
        await check('dispatch.pilotScopedToSyntheticTenant', async () => {
            const { Client } = require('pg');
            const client = new Client({ connectionString: target.databaseUrl });
            try {
                await client.connect();
                const rows = await client.query(
                    `SELECT value FROM public.platform_settings WHERE key='dispatch.normalOutbox'`);
                const parsed = JSON.parse(rows.rows[0] ? rows.rows[0].value : '{}');
                if (parsed.enabled !== true) throw new Error('the pilot is not enabled');
                assertPilotScope(parsed);
                return `enabled for ${parsed.tenantIds.length} tenant on ${parsed.channels.join(',')}`;
            } finally { await client.end().catch(() => {}); }
        });
    }

    const failed = results.filter(result => !result.ok);
    const summary = `STAGING_SMOKE checks=${results.length} failed=${failed.length} `
        + `tenants=${SYNTHETIC_TENANTS.length} blocks=${failed.length ? 1 : 0}`;
    console.log(summary);
    if (jsonPath) {
        writeFileSync(jsonPath, JSON.stringify({ version: 1, ranAt: new Date().toISOString(),
            database: target.databaseName, summary, results }, null, 2));
    }
    if (failed.length) {
        console.error(`::error::${failed.length} staging smoke check(s) failed: ${failed.map(r => r.name).join(', ')}`);
        process.exit(1);
    }
    process.exit(0);
}

main().catch(error => { console.error(`::error::staging smoke crashed: ${error && error.message}`); process.exit(1); });
