#!/usr/bin/env node
/**
 * ═══ A GREEN SUITE WITH TWENTY SKIPS IS A GREEN SUITE AND A HOLE ═══
 *
 * Every PostgreSQL-, PgBouncer- and Valkey-backed suite in this repository
 * skips ITSELF when the variable naming its database or its proxy is unset:
 *
 *     (url ? describe : describe.skip)('the additive migrations, under load', …)
 *
 * That is the right default for a laptop and the wrong one for the run that
 * decides whether a commit may become the images a cut-over pins. Jest exits 0
 * either way, and the summary line that would have said so scrolls past in a
 * log nobody reads to the end. The candidate workflow used to run the suite
 * with no database at all: the money engine, the outbox, the migrations and the
 * pooling semantics were all *skipped*, and the run was green.
 *
 * So the exit code is not the check. This reads Jest's own JSON report and
 * refuses anything that did not actually run:
 *
 *   · `numPendingTests`   — `it.skip`, `describe.skip`, and every suite gated
 *                           on an environment variable;
 *   · `numTodoTests`      — `it.todo`, a test that exists as a name;
 *   · `numFailedTests`    — belt and braces; jest's exit code already says so,
 *                           and a wrapper that swallowed it would not;
 *   · zero tests at all   — an empty run is not a clean run.
 *
 * It also names the suites that skipped, because "17 skipped" sends somebody
 * hunting and "these three files skipped" sends them to the variable.
 *
 * Usage:
 *   npx jest --config apps/api/jest.config.js --ci --json --outputFile report.json
 *   node infra/scripts/assert-no-skipped-tests.cjs --report report.json --label "API suite"
 */

'use strict';

const fs = require('fs');
const path = require('path');

function readReport(file) {
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        throw new Error(`no readable Jest report at ${file}: ${error.message}. `
            + 'A run that produced no report is a run nothing can vouch for.');
    }
    if (!parsed || typeof parsed !== 'object') throw new Error('the Jest report is not an object');
    return parsed;
}

/**
 * The skipped files, named.
 *
 * Jest reports per-test status, so a file whose every test is `pending` is a
 * suite that gated itself off. Those are the ones worth printing: they are one
 * missing environment variable each.
 */
function skippedSuites(report) {
    const results = Array.isArray(report.testResults) ? report.testResults : [];
    const named = [];
    for (const suite of results) {
        const assertions = Array.isArray(suite.assertionResults) ? suite.assertionResults : [];
        const pending = assertions.filter(a => a.status === 'pending' || a.status === 'todo');
        if (!pending.length) continue;
        const file = suite.name ? path.relative(process.cwd(), suite.name).replace(/\\/g, '/') : '(unnamed)';
        named.push(`${file} — ${pending.length} of ${assertions.length} did not run`);
    }
    return named;
}

/** Every reason this report is not proof, in one pass. */
function problemsWith(report) {
    const problems = [];
    const total = Number(report.numTotalTests || 0);
    const pending = Number(report.numPendingTests || 0);
    const todo = Number(report.numTodoTests || 0);
    const failed = Number(report.numFailedTests || 0);
    const failedSuites = Number(report.numFailedTestSuites || 0);

    if (total === 0) problems.push('the run contained no tests at all');
    if (failed > 0) problems.push(`${failed} test(s) failed`);
    if (failedSuites > 0) problems.push(`${failedSuites} suite(s) failed to run`);
    if (pending > 0) problems.push(`${pending} test(s) were skipped`);
    if (todo > 0) problems.push(`${todo} test(s) are todo`);
    if (report.success === false && !problems.length) {
        problems.push('Jest reported the run as unsuccessful without naming a failure');
    }
    return problems;
}

function main(argv) {
    const args = argv.slice(2);
    const value = flag => {
        const index = args.indexOf(flag);
        return index === -1 ? null : args[index + 1];
    };
    const file = value('--report');
    const label = value('--label') || 'suite';
    if (!file) {
        process.stderr.write('usage: --report <jest --outputFile json> [--label <name>]\n');
        return 2;
    }

    let report;
    try {
        report = readReport(path.resolve(file));
    } catch (error) {
        process.stderr.write(`assert-no-skipped-tests: ${error.message}\n`);
        return 1;
    }

    const problems = problemsWith(report);
    const counts = `${report.numTotalTests || 0} tests, ${report.numPassedTests || 0} passed, `
        + `${report.numFailedTests || 0} failed, ${report.numPendingTests || 0} skipped, `
        + `${report.numTodoTests || 0} todo`;

    if (!problems.length) {
        process.stdout.write(`assert-no-skipped-tests: ${label} — ${counts}\n`);
        return 0;
    }

    for (const problem of problems) {
        process.stderr.write(`assert-no-skipped-tests: ${label}: ${problem}\n`);
    }
    const skipped = skippedSuites(report);
    for (const suite of skipped) {
        process.stderr.write(`  · ${suite}\n`);
    }
    process.stderr.write(`\n${label}: ${counts}.\n`);
    if (skipped.length) {
        process.stderr.write('A suite that skipped itself did not prove anything. Each one names the '
            + 'environment variable it needs in its own header; set it and run again.\n');
    }
    return 1;
}

if (require.main === module) process.exit(main(process.argv));
module.exports = { problemsWith, skippedSuites };
