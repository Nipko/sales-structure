const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const manifest = require('./agent-business-regressions.json');
const mode = process.argv[2];
assert(['unit', 'postgres'].includes(mode), 'Expected unit or postgres');
const specs = manifest[mode];
assert.equal(new Set(specs).size, specs.length);
if (mode === 'postgres') {
  for (const [key, database] of Object.entries({ POLICY_ATOMIC_SQL_TEST_URL: 'parallly_policy_a_eval_isolation', PROMOTION_SQL_TEST_URL: 'parallly_promo_a_eval_isolation', PARALLLY_ISOLATION_TEST_URL: 'parallly_eval_isolation' })) {
    const url = new URL(process.env[key]);
    assert(['127.0.0.1', 'localhost'].includes(url.hostname));
    assert.equal(url.pathname, '/' + database);
  }
}
fs.mkdirSync('artifacts', { recursive: true });
const output = path.resolve('artifacts/agent-business-' + mode + '.json');
const result = spawnSync(process.execPath, ['--max-old-space-size=8192', require.resolve('jest/bin/jest'), '--config', 'apps/api/jest.agent-business.config.cjs', '--runInBand', '--runTestsByPath', ...specs, '--json', '--outputFile', output], { stdio: 'inherit', env: process.env, timeout: 900000 });
assert.equal(result.status, 0, result.error?.message || 'Jest failed');
const raw = JSON.parse(fs.readFileSync(output, 'utf8'));
assert.equal(raw.success, true);
assert.equal(raw.numFailedTests, 0);
assert.equal(raw.numPendingTests, 0, 'Skipped tests are not coverage');
assert.equal(raw.numRuntimeErrorTestSuites, 0);
assert.equal(raw.testResults.length, specs.length);
for (const spec of specs) assert(raw.testResults.some(test => path.resolve(test.name) === path.resolve(spec)), 'Missing suite: ' + spec);
console.log(JSON.stringify({ mode, suites: raw.testResults.length, passed: raw.numPassedTests, pending: raw.numPendingTests }));
