#!/usr/bin/env node
/*
 * Prices the cheapest honest certification run, and does not run it.
 *
 *   node scripts/plan-certification-canary.cjs [--profile <id>] [--channel <ch>]
 *                                              [--model <id>] [--json <path>]
 *
 * The full matrix is 76 profiles × 4 languages × 5 channels and costs between
 * US$259 and US$5,466 depending on the model — a factor of 21 for the same work,
 * which is why "the cost of certifying" is not a number anybody should quote
 * without also naming the model. Before spending that, one profile on one
 * channel says whether the executor, the ledger, the budget guard and the
 * verifier survive contact with a real provider. That is the canary.
 *
 * It stays FOUR languages on purpose. Certification demands all four, and the
 * planner refuses a scope missing one rather than certifying three-quarters of
 * something; a canary that dropped a language would be rehearsing a run that
 * cannot happen.
 *
 * This script PLANS. It opens no connection, reads no credential and calls no
 * provider — running the canary is `certification.service`, behind the same
 * external gate as the full matrix. Every number here comes from
 * `planCertificationRun` and the router's own catalogue, so the figure that gets
 * authorised and the figure that gets billed are the same list of prices.
 */
const { writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

function load(module) {
    try { return require(`../dist/${module}.js`); }
    catch (compiled) {
        try {
            require('ts-node/register/transpile-only');
            return require(resolve(__dirname, `../src/${module}.ts`));
        } catch (source) {
            console.error(`::error::${module} unavailable: ${compiled && compiled.message} / ${source && source.message}`);
            process.exit(2);
        }
    }
}

const arg = (name, fallback) => {
    const index = process.argv.indexOf(`--${name}`);
    return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const { planCertificationRun } = load('modules/simulation/certification-plan');
const { EVAL_LANGUAGES } = require('@parallext/shared');

// One profile, one channel, every language, one attempt each.
//
// `salud/medica_general` because it is a canonical profile with a booking
// engine, a money path and a handoff — the three things whose failure under a
// real model would matter most — and `web_widget` because it is the only channel
// with no provider account in front of it, so a canary can run without waiting
// for one. A profile the catalogue does not know is refused rather than planned:
// the plan and the run share `listCanonicalSubtypeExperienceProfileIds`.
const profile = arg('profile', 'salud/medica_general');
const channel = arg('channel', 'web_widget');
const model = arg('model', 'gpt-4o-mini');

const plan = planCertificationRun({
    profiles: [profile], languages: [...EVAL_LANGUAGES], channels: [channel], models: [model], k: 1,
});

const usd = cents => `US$${(cents / 100).toFixed(2)}`;
console.log('CERTIFICATION CANARY — planned, not executed');
console.log(`  profile   ${plan.profiles.join(', ') || '(none)'}`);
console.log(`  languages ${plan.languages.join(', ')}`);
console.log(`  channel   ${plan.channels.join(', ') || '(none)'}`);
console.log(`  model     ${plan.models.join(', ') || '(none)'}   k=${plan.k}`);
console.log(`  bound     ${plan.tokenBound.inputPerTurn} in / ${plan.tokenBound.outputPerTurn} out per turn`);
console.log('');
console.log(`  cases         ${plan.totals.requiredCases}`);
console.log(`  model calls   ${plan.totals.modelCalls}`);
console.log(`  cost ceiling  ${usd(plan.totals.maxCostUsdCents)}`);
console.log(`  wall clock    ${(plan.totals.maxSeconds / 60).toFixed(0)} min at ${plan.secondsPerTurn}s per turn`);
console.log(`  plan hash     ${plan.planHash}`);
if (plan.refusals.length) {
    console.log('');
    console.log('  REFUSALS (this scope cannot certify anything):');
    for (const refusal of plan.refusals) console.log(`    ${refusal}`);
}
console.log('');
console.log(`CERTIFICATION_CANARY cases=${plan.totals.requiredCases} calls=${plan.totals.modelCalls} `
    + `cents=${plan.totals.maxCostUsdCents} refusals=${plan.refusals.length}`);
console.log('  nothing was executed: this script has no provider client and opens no connection');

const jsonFlag = process.argv.indexOf('--json');
if (jsonFlag > -1 && process.argv[jsonFlag + 1]) {
    writeFileSync(process.argv[jsonFlag + 1], JSON.stringify({ plannedAt: new Date().toISOString(), plan }, null, 2));
}
// A scope the planner refuses is not a canary; exit non-zero so a pipeline that
// ever wires this up cannot read it as an authorisation.
process.exit(plan.refusals.length ? 1 : 0);
