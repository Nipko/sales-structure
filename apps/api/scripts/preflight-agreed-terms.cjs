#!/usr/bin/env node
/*
 * Pre-deploy gate: rows a charge would refuse once this release loads.
 *
 * The runbook says to call `GET /tenant-payments/:tenantId/agreed-terms/orphans`
 * before deploying. A sentence in a runbook is applied per tenant, by hand, by
 * whoever remembers. This asks every tenant the same question from the pipeline,
 * before the migrations and before any container is recreated, and it refuses
 * the deploy instead of reporting to a log nobody reads.
 *
 * Read-only by construction: it issues SELECTs and nothing else. It cannot fix
 * what it finds, and it must not — an acceptance nobody gave is not something a
 * deploy script may invent. Every finding goes to a person.
 *
 * Runs inside the candidate image, where `dist/` is the compiled API, so the
 * rules it applies are the ones the runtime will apply. Usage:
 *
 *   node scripts/preflight-agreed-terms.cjs [--json <path>]
 *
 * Exit codes:
 *   0  nothing to do
 *   1  orphans found, or an inspection failed — deploy must not proceed
 *   2  could not even enumerate tenants — the gate did not run
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const COMPILED = path.join(__dirname, '..', 'dist', 'modules', 'tenant-payments', 'agreed-terms-preflight.js');

function loadPreflight() {
    if (fs.existsSync(COMPILED)) return require(COMPILED);
    // Local runs from a source checkout. Never the deploy path: the image ships
    // `dist`, and falling back silently there would run rules the runtime does
    // not have.
    const source = path.join(__dirname, '..', 'src', 'modules', 'tenant-payments', 'agreed-terms-preflight.ts');
    if (!fs.existsSync(source)) {
        console.error('::error::preflight module not found — expected dist/ in the candidate image');
        process.exit(2);
    }
    process.env.TS_NODE_PROJECT = path.join(__dirname, '..', 'tsconfig.json');
    require(path.join(__dirname, '..', '..', '..', 'node_modules', 'ts-node')).register({ transpileOnly: true });
    return require(source);
}

/**
 * Which tenants exist, from the global authority rather than a list somebody
 * maintains.
 *
 * The same rule `migrate-tenants.js` uses, deliberately: a tenant the migration
 * will touch is a tenant this gate has to have inspected, and two different
 * ideas of "which tenants" is how a gate comes to pass over the one that
 * mattered. That includes retained schemas of inactive tenants — they can be
 * reactivated, and their rows outlive the flag.
 */
const TENANTS_SQL = `
    SELECT t.id::text AS id, t.schema_name AS schema
      FROM public.tenants t
     WHERE t.schema_name IS NOT NULL
       AND (t.is_active = true
            OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname = t.schema_name))
     ORDER BY t.schema_name`;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function main() {
    const { preflightAgreedTerms, preflightSummaryLine, preflightFindings } = loadPreflight();
    const jsonFlag = process.argv.indexOf('--json');
    const jsonPath = jsonFlag > -1 ? process.argv[jsonFlag + 1] : null;

    const connectionString = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('::error::DIRECT_DATABASE_URL or DATABASE_URL is required — the gate did not run');
        process.exit(2);
    }

    const client = new Client({ connectionString });
    try {
        await client.connect();
    } catch (error) {
        console.error(`::error::could not connect to the database (${error && error.code ? error.code : 'unknown'}) — the gate did not run`);
        process.exit(2);
    }

    try {
        // A DIRECT connection on purpose: this reads across every tenant schema,
        // and PgBouncer in transaction mode would hand each statement whichever
        // server connection is free.
        await client.query('SET search_path TO public');

        let tenants;
        try {
            const result = await client.query(TENANTS_SQL);
            tenants = result.rows;
        } catch (error) {
            console.error(`::error::could not enumerate tenants (${error && error.code ? error.code : 'unknown'}) — the gate did not run`);
            process.exit(2);
        }
        if (!Array.isArray(tenants)) {
            console.error('::error::tenant enumeration returned an unexpected shape — the gate did not run');
            process.exit(2);
        }
        for (const tenant of tenants) {
            if (!tenant || typeof tenant.schema !== 'string' || !IDENTIFIER.test(tenant.schema)) {
                console.error(`::error::tenant ${tenant && tenant.id} has an unusable schema name — refusing to inspect`);
                process.exit(2);
            }
        }

        const query = async (sql, params = []) => (await client.query(sql, params)).rows;
        const summary = await preflightAgreedTerms(query, tenants);

        for (const line of preflightFindings(summary)) console.log(`  ${line}`);
        console.log(preflightSummaryLine(summary));

        if (jsonPath) {
            fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
        }

        if (summary.errors > 0) {
            console.error(`::error::agreed-terms preflight could not complete for ${summary.errors} family inspection(s); refusing to migrate on an unknown answer`);
            process.exitCode = 1;
            return;
        }
        if (summary.orphans > 0) {
            console.error(`::error::agreed-terms preflight found ${summary.orphans} live row(s) that this release would stop being able to charge. Each one needs a human decision; see docs/runbooks/agreed-terms-preflight.md`);
            process.exitCode = 1;
            return;
        }
        console.log(`  [OK] ${summary.tenantsInspected} tenant(s), ${summary.familiesInspected} family inspection(s), no rows at risk`);
    } finally {
        await client.end().catch(() => undefined);
    }
}

main().catch(error => {
    console.error(`::error::agreed-terms preflight crashed: ${error && error.code ? error.code : 'unknown'}`);
    process.exit(2);
});
