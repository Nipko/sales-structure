#!/usr/bin/env node
/*
 * Refuses to deploy a "staging" environment that is really production wearing
 * a different label.
 *
 *   node scripts/assert-staging-isolation.cjs [--json <path>]
 *
 * Reads the staging variables from the environment and compares them against
 * PRODUCTION_SECRET_DIGESTS — salted digests of the production secrets,
 * computed where those values already live. No production value is ever in this
 * process, and no value of any kind reaches stdout: findings name a variable and
 * a reason, never a secret.
 *
 * Exit codes, on purpose the same shape as the agreed-terms pre-flight:
 *   0  every variable present, distinct from production, and synthetic-seeded
 *   1  at least one finding — the deploy must not proceed
 *   2  the check itself could not run (no salt with digests, unreadable input)
 *
 * "We could not check" is not permission to deploy. Both non-zero codes abort.
 */
const { writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

function load() {
    // Compiled first: inside the candidate image there is no TypeScript.
    try { return require('../dist/common/utils/staging-isolation.js'); }
    catch (compiled) {
        try {
            require('ts-node/register/transpile-only');
            return require(resolve(__dirname, '../src/common/utils/staging-isolation.ts'));
        } catch (source) {
            console.error('::error::staging isolation contract unavailable: '
                + `${compiled && compiled.message} / ${source && source.message}`);
            process.exit(2);
        }
    }
}

function main() {
    const { assessStagingIsolation, isolationSummaryLine, isolationFindings } = load();

    const jsonFlag = process.argv.indexOf('--json');
    const jsonPath = jsonFlag > -1 ? process.argv[jsonFlag + 1] : null;
    if (jsonFlag > -1 && !jsonPath) {
        console.error('::error::--json needs a path');
        process.exit(2);
    }

    const digests = String(process.env.PRODUCTION_SECRET_DIGESTS || '')
        .split(/[\s,]+/).map(value => value.trim().toLowerCase())
        .filter(value => /^[a-f0-9]{64}$/.test(value));
    const salt = String(process.env.STAGING_ISOLATION_DIGEST_SALT || '').trim();
    const productionHosts = String(process.env.PRODUCTION_HOSTS || '')
        .split(/[\s,]+/).map(value => value.trim()).filter(Boolean);

    if (digests.length > 0 && !salt) {
        // Refusing here rather than reporting "nothing shared" for every secret,
        // which is exactly the false clean this control exists to prevent.
        console.error('::error::PRODUCTION_SECRET_DIGESTS was supplied without STAGING_ISOLATION_DIGEST_SALT; '
            + 'the comparison cannot run and is not being reported as clean');
        process.exit(2);
    }

    let report;
    try {
        report = assessStagingIsolation({ env: process.env, productionDigests: digests, digestSalt: salt, productionHosts });
    } catch (error) {
        console.error(`::error::staging isolation check failed to run: ${error && error.message}`);
        process.exit(2);
    }

    for (const line of isolationFindings(report)) console.log(line);
    const summary = isolationSummaryLine(report);
    console.log(summary);
    console.log(`  production digests compared: ${digests.length}`);

    if (jsonPath) {
        try {
            writeFileSync(jsonPath, JSON.stringify({
                version: 1, checkedAt: new Date().toISOString(),
                digestsCompared: digests.length, summary, ...report,
            }, null, 2));
        } catch (error) {
            console.error(`::error::could not write ${jsonPath}: ${error && error.message}`);
            process.exit(2);
        }
    }

    if (!report.ok) {
        console.error('::error::Staging isolation refused. A staging environment that shares a value, a host or a '
            + 'database with production is production. Fix each finding above; do not relax the contract.');
        process.exit(1);
    }
    console.log('  [OK] staging shares nothing with production');
    process.exit(0);
}

main();
