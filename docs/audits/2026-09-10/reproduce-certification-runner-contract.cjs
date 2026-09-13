#!/usr/bin/env node
/* Read-only reproduction. No DB, credentials, providers, or generated files.
 * Loads runtime TypeScript from src, never dist. The model/gate response and
 * the query boundary are synthetic; the two adapters and settlement are real.
 * Run from the repository root:
 *   node docs/audits/2026-09-10/reproduce-certification-runner-contract.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');

// Defense in depth: an imported module must not open even a local connection.
const forbiddenNetwork = () => { throw new Error('reproduction_network_forbidden'); };
require('node:net').Socket.prototype.connect = forbiddenNetwork;
require('node:http').request = forbiddenNetwork;
require('node:http').get = forbiddenNetwork;
require('node:https').request = forbiddenNetwork;
require('node:https').get = forbiddenNetwork;
globalThis.fetch = forbiddenNetwork;

const root = path.resolve(__dirname, '../../..');
const api = path.join(root, 'apps/api');
const req = createRequire(path.join(api, 'package.json'));
req('ts-node').register({ project: path.join(api, 'tsconfig.json'), transpileOnly: true });
const load = name => req(path.join(api, 'src/modules/simulation', name + '.ts'));
const { parallelyCertificationRunner, certificationScenario } = load('certification-runner');
const { requiredScenarios } = load('agent-certification');
const { planCertificationRun } = load('certification-plan');
const { recordCertificationCase } = load('certification-ledger');
const { BenchmarkService } = load('benchmark.service');
const { freezeBenchmarkCorpus, summariseBenchmark } = load('agent-benchmark');

async function main() {
    const evalSource = fs.readFileSync(path.join(api, 'src/modules/simulation/eval.service.ts'), 'utf8');
    // Guard against silently preserving a reproduction after its input contract
    // changes. This is only a shape check; it is not an execution of EvalService.
    if (!/total:\s*out\.length,\s*scenarios:\s*out/.test(evalSource)) {
        throw new Error('gate_return_shape_changed_review_reproduction');
    }
    const profile = 'salud/medica_general', language = 'es';
    const scenarioKey = [...requiredScenarios(profile, language).keys()][0];
    const scenario = certificationScenario(profile, language, scenarioKey);
    if (!scenario) throw new Error('canonical_scenario_missing');

    // runGateV2's successful return contains scenarios, not results. It does
    // not return costUsdCents. A single successful synthetic scenario is enough
    // to show whether the consumer reads the real producer's field names.
    const gateResponse = {
        runId: 'synthetic-run', status: 'completed', passed: true, avgScore: 9,
        total: 1, k: 1, threshold: 8, passPolicy: 'all', evalActivable: false,
        scenarios: [{ key: scenario.key, passed: true, score: 9, runs: [{
            model: 'gpt-4o-mini', models: ['gpt-4o-mini'],
            transcript: [{ role: 'assistant', content: 'Resultado sintético correcto.' }],
        }] }],
    };
    const gateOptions = [];
    const deps = {
        agentTest: { captureSnapshot: async () => ({ configHash: 'synthetic-hash' }) },
        evals: { runGateV2: async (_tenant, _agent, options) => {
            gateOptions.push(options); return gateResponse;
        } },
    };
    const runner = parallelyCertificationRunner({
        tenantId: 'synthetic-tenant', k: 1, threshold: 8,
        subjectFor: () => ({ agentId: 'synthetic-agent', configHash: 'synthetic-hash', dependencyRevision: 'synthetic-revision' }),
        captureSnapshot: deps.agentTest.captureSnapshot,
        runGate: deps.evals.runGateV2,
    });
    const result = await runner({
        profileId: profile, language, scenarioKey, channelType: 'web_widget', model: 'gpt-4o-mini',
    });
    let settlement;
    await recordCertificationCase(async (_sql, params) => {
        settlement = { state: params[2], servedModel: params[3], costUsdCents: params[4],
            verification: JSON.parse(params[8]), errorCode: params[10] };
        return [{ id: 'synthetic-case' }];
    }, { caseId: 'synthetic-case', leaseToken: 'synthetic-lease' }, result);

    // No Nest container/constructor/lifecycle is started. Call the real private
    // adapter with only its two synthetic collaborators.
    const benchmarkRunner = BenchmarkService.prototype.parallelyRunner.call(deps, 'synthetic-tenant');
    const task = { key: scenario.key, profileId: profile, language, channel: 'web_widget',
        messages: scenario.messages, grants: [],
        confirms: [{ table: 'synthetic_results', where: { id: 'synthetic-result' } }] };
    const benchmarkResult = await benchmarkRunner({ id: 'synthetic-agent' }, task);
    const corpus = freezeBenchmarkCorpus('synthetic-contract-corpus', [task]);
    const report = summariseBenchmark({ corpus,
        subjects: [
            { id: 'self-id', kind: 'self', label: 'Parallly', blindLabel: 'Alpha', setupMinutes: 1 },
            { id: 'other-id', kind: 'alternative', label: 'Example product', blindLabel: 'Beta', setupMinutes: 1 },
        ],
        attempts: [
            { ...benchmarkResult, subjectId: 'self-id', taskKey: task.key, corpusHash: corpus.contentHash },
            { subjectId: 'other-id', taskKey: task.key, corpusHash: corpus.contentHash,
                confirmed: true, costUsdCents: 1, latencyMs: 1, transcript: [] },
        ],
    });

    const plan = planCertificationRun({ profiles: [profile], channels: ['web_widget'], models: ['gpt-4o-mini'], k: 1 });
    let reservationSum = 0;
    for (const cell of plan.cells) {
        for (const required of requiredScenarios(cell.profileId, cell.language).values()) {
            reservationSum += Math.ceil(cell.maxCostUsdCents * required.turns / cell.turns);
        }
    }
    console.log(JSON.stringify({
        head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        scope: 'src adapters; synthetic gate and query; no network or database',
        gateFields: Object.keys(gateResponse),
        certification: { passed: result.passed, servedModel: result.servedModel,
            costUsdCents: result.costUsdCents, verification: result.verification,
            transcript: result.transcript, errorCode: result.errorCode,
            optionsSentToGate: Object.keys(gateOptions[0]), settlement },
        benchmark: { result: benchmarkResult, comparable: report.comparable,
            blockers: report.blockers, self: report.subjects.find(row => row.subjectId === 'self-id') },
        canary: { cases: plan.totals.requiredCases, announcedModelCalls: plan.totals.modelCalls,
            successfulCasesPlusOneJudgeEach: plan.totals.modelCalls + plan.totals.requiredCases,
            announcedCostUsdCents: plan.totals.maxCostUsdCents,
            sumCaseReservationUsdCents: reservationSum,
            note: 'Reservation sum is not actual spend or a corrected budget. Judge/tool calls and actual model usage require accounting.' },
    }, null, 2));
}
main().then(() => process.exit(0)).catch(error => {
    console.error(error.message); process.exit(1);
});
