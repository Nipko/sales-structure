#!/usr/bin/env node
/*
 * Turns the durable dispatch outbox on for ONE synthetic tenant on ONE channel
 * with no recipient, and turns it off again.
 *
 *   node scripts/staging-dispatch-pilot.cjs --enable  [--json <path>]
 *   node scripts/staging-dispatch-pilot.cjs --disable [--json <path>]
 *
 * The switch lives in `platform_settings` under `dispatch.normalOutbox` and is
 * read by `DispatchRolloutService`, which fails closed. Two properties matter
 * more than anything else this script does:
 *
 *   · `enabled: true` with an EMPTY tenant list means every tenant. A rehearsal
 *     that accidentally writes that has rehearsed the wrong thing, so the scope
 *     is asserted from the shared contract before the write and read back after;
 *   · turning it off writes an empty scope rather than flipping a boolean and
 *     leaving the tenant list behind, because a list left behind is one edit
 *     away from being live again.
 *
 * Exit: 0 written and verified, 1 the write did not take, 2 target refused.
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

async function main() {
    const { assertStagingTarget, assertPilotScope, dispatchPilotValue, PILOT_TENANT, PILOT_CHANNEL } = load();
    const enable = process.argv.includes('--enable');
    const disable = process.argv.includes('--disable');
    if (enable === disable) {
        console.error('::error::pass exactly one of --enable / --disable');
        process.exit(2);
    }
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
        console.error('::error::This script changes how replies leave the system. It runs only against staging.');
        process.exit(2);
    }

    const value = dispatchPilotValue(enable);
    try { assertPilotScope(value); }
    catch (error) {
        console.error(`::error::${error.message}`);
        process.exit(2);
    }

    const { Client } = require('pg');
    const client = new Client({ connectionString: target.databaseUrl });
    try {
        await client.connect();
        await client.query(`CREATE TABLE IF NOT EXISTS public.platform_settings(
            key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await client.query(
            `INSERT INTO public.platform_settings(key, value, updated_at)
             VALUES('dispatch.normalOutbox', $1, NOW())
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [JSON.stringify(value)]);

        // Read back. A write that reports success and did not land leaves the
        // pilot in whatever state the last run left it — including on.
        const stored = await client.query(
            `SELECT value FROM public.platform_settings WHERE key='dispatch.normalOutbox'`);
        const parsed = JSON.parse(stored.rows[0] ? stored.rows[0].value : '{}');
        assertPilotScope(parsed);
        if (JSON.stringify(parsed) !== JSON.stringify(value)) {
            console.error('::error::the dispatch pilot setting did not take the value that was written');
            process.exit(1);
        }
        // The runtime caches this for 60s in Redis. The service drops the key on
        // its own writes; this one is out of band, so say so rather than let an
        // operator read a stale answer as a failed write.
        console.log(`STAGING_DISPATCH_PILOT enabled=${parsed.enabled ? 1 : 0} `
            + `tenants=${parsed.tenantIds.length} channels=${parsed.channels.join(',') || 'none'}`);
        if (enable) {
            console.log(`  scoped to synthetic tenant ${PILOT_TENANT.slug} on ${PILOT_CHANNEL} only`);
        }
        console.log('  note: DispatchRolloutService caches this for up to 60s');
        if (jsonPath) {
            writeFileSync(jsonPath, JSON.stringify({ version: 1, changedAt: new Date().toISOString(),
                database: target.databaseName, setting: parsed }, null, 2));
        }
        process.exit(0);
    } catch (error) {
        console.error(`::error::dispatch pilot write failed: ${error && error.message}`);
        process.exit(1);
    } finally { await client.end().catch(() => {}); }
}

main();
