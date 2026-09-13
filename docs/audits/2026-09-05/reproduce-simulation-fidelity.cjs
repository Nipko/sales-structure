/* Current-source audit, synthetic dependencies only. No DB, model or network.
 * Run from repository root. These assertions reproduce gaps, not acceptance.
 */
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../..');
require('ts-node').register({ project: path.join(root, 'apps/api/tsconfig.json'), transpileOnly: true });
require('@nestjs/common').Logger.overrideLogger([]);
const { SimulationService } = require(path.join(root, 'apps/api/src/modules/simulation/simulation.service.ts'));
const judge = { overall: 9, resolution: 9, tone: 9, accuracy: 9, empathy: 9, flags: [], resolved: true, resolutionReason: 'Synthetic' };
const makeResult = (key) => ({ key, title: key, difficulty: 'medium', transcript: [], turns: 1, latencyMs: 1, judge });

async function main() {
  const calls = [];
  const service = new SimulationService(
    { executeInTenantSchema: async () => [{ results: [makeResult('A'), makeResult('B')], avg_score: 9 }] },
    {},
    { execute: async () => { throw new Error('Synthetic customer model outage'); } },
    {},
    { judgeTranscript: async () => judge },
    { test: async (...args) => { calls.push(args); return { reply: 'Respuesta de prueba', debug: { toolCalls: [] } }; } },
    {},
    { emit: () => {} },
  );
  const scenario = { key: 'A', title: 'Replay', language: 'fr', source: 'replay', goal: 'Consultar', openingMessage: 'Bonjour', replayMessages: ['Bonjour', 'Merci'] };
  const run = await service.runScenario('tenant-audit', 'agent-audit', 'web_widget', scenario);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][2].channelType, undefined);
  assert.equal(calls[0][3].disableTools, true);
  assert.deepEqual(Object.keys(calls[0][2]).sort(), ['conversationHistory', 'message']);
  const next = await service.nextCustomerMessage('tenant-audit', scenario, run.transcript);
  assert.equal(next, '[FIN]');
  const summary = await service.buildSummary('audit-schema', [
    makeResult('A'),
    { ...makeResult('B'), judge: null, error: 'Synthetic runtime failure' },
  ], 'baseline-audit');
  assert.equal(summary.baseline.hasRegression, false);
  console.log(JSON.stringify({
    scope: 'Real SimulationService methods with isolated dependencies; no DB, LLM or network.',
    requestedChannel: 'web_widget',
    requestPassedToAgentTest: calls[0][2],
    toolsDisabled: calls[0][3].disableTools,
    immutablePersonaSnapshotPassedToAgentTest: false,
    customerSimulatorFailureBecomes: next,
    baselineWithPreviouslyPassingScenarioNowError: summary,
  }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
