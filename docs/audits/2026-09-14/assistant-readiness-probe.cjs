/** Read-only reproduction: production services with synthetic test fixtures.
 * Run from the repository root: node docs/audits/2026-09-14/assistant-readiness-probe.cjs
 * No app bootstrap, database, Redis, provider call, or tenant mutation.
 */
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '../../..');
require('ts-node').register({ project: resolve(root, 'apps/api/tsconfig.json'), transpileOnly: true });
const ts = require('typescript');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
    return originalResolve.call(this, request === '@parallext/shared'
        ? resolve(root, 'packages/shared/src/index.ts') : request, ...args);
};
global.jest = { fn: require('jest-mock').fn };
global.describe = () => {}; // Load fixture factories without executing their test suites.
function fixture(relative, exports) {
    const filename = resolve(root, relative);
    const source = `${readFileSync(filename, 'utf8')}\nmodule.exports = { ${exports} };`;
    const output = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021,
        experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true,
    }, fileName: filename }).outputText;
    const loaded = new Module(filename, module);
    loaded.filename = filename;
    loaded.paths = Module._nodeModulePaths(resolve(filename, '..'));
    loaded._compile(output, filename);
    return loaded.exports;
}
const { createHarness, completeConfig, TENANT_ID, AGENT_ID } = fixture(
    'apps/api/src/modules/quality/agent-quality.service.spec.ts', 'createHarness, completeConfig, TENANT_ID, AGENT_ID');
const { harness } = fixture('apps/api/src/modules/copilot/agent-assessment.service.spec.ts', 'harness');
const { normalizeAgentChannelAssignments, agentChannelAssignmentIssues } = require(resolve(root, 'apps/dashboard/src/lib/agent-channel-assignment.ts'));
const { agentReadinessBlockers } = require(resolve(root, 'apps/dashboard/src/lib/agent-readiness.ts'));
const supported = ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'];
const channels = supported.slice(0, 4);
const accounts = channels.map(type => ({ channel_type: type, account_id: `${type}-one`, has_account_token: true,
    metadata: { tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() } }));
const uiAccounts = accounts.map(row => ({ channelType: row.channel_type, accountId: row.account_id }));
const checks = overview => overview.preparation.dimensions.flatMap(dimension => dimension.checks);
const check = (overview, code) => checks(overview).find(entry => entry.code === code);
const inspect = options => createHarness(options).service.getOverview(TENANT_ID, AGENT_ID);
async function channelTask(overview) {
    const h = harness();
    h.quality.getOverview.mockResolvedValue(overview);
    return (await h.service.getAssessment(TENANT_ID, AGENT_ID)).tasks.find(task => task.key === 'channel');
}
function output(name, evidence) { process.stdout.write(`${JSON.stringify({ name, evidence })}\n`); }

async function main() {
    const valid = await inspect({ agent: { channels }, channelRows: accounts });
    const validTask = await channelTask(valid);
    assert.equal(validTask.status, 'pass');
    output('four-supported-connected-channels', { task: validTask.status,
        checks: checks(valid).filter(entry => entry.code.startsWith('channel_') || entry.code === 'operational_channel_scope') });

    for (const hidden of ['email', 'sms', 'web_chat']) {
        const rawChannels = [...channels, hidden];
        const overview = await inspect({ agent: { channels: rawChannels }, channelRows: accounts });
        const normalized = normalizeAgentChannelAssignments({ accounts: uiAccounts, channels: rawChannels,
            bindings: [], overviewAvailable: true, supportedTypes: supported });
        const task = await channelTask(overview);
        assert.equal(check(overview, 'channel_connection').status, 'pass');
        assert.equal(check(overview, 'operational_channel_scope').status, 'fail');
        assert.equal(task.status, 'fail');
        assert.deepEqual([...normalized.channels].sort(), [...rawChannels].sort());
        const issues = agentChannelAssignmentIssues({ accounts: uiAccounts, ...normalized, overviewAvailable: true, supportedTypes: supported });
        assert.ok(issues.some(issue => issue.value === hidden && issue.reason === 'unsupported'));
        output('unsupported-assignment-preserved-for-review', { hidden, rawChannels, editorChannels: normalized.channels, issues,
            connection: check(overview, 'channel_connection').status, scope: check(overview, 'operational_channel_scope'),
            task: { status: task.status, href: task.href, tour: task.tourId } });
    }

    const screenshotPattern = await inspect({ agent: { channels: [...channels, 'email'] }, channelRows: accounts,
        knowledgeChunks: 0, mediaProcessing: { audioPerMonth: 100, imagePerMonth: 50 }, privacyPolicies: 0 });
    assert.deepEqual(screenshotPattern.preparation.criticalBlockers,
        ['rag_knowledge', 'media_privacy_policy', 'operational_channel_scope']);
    output('screenshot-three-blocker-pattern-synthetic', { criticalBlockers: screenshotPattern.preparation.criticalBlockers,
        channelConnection: check(screenshotPattern, 'channel_connection').status,
        channelTask: (await channelTask(screenshotPattern)).status });

    const stale = await inspect({ agent: { channels: [], channel_bindings: ['whatsapp:old'] },
        channelRows: [{ channel_type: 'whatsapp', account_id: 'new', has_account_token: true }] });
    const staleEditor = normalizeAgentChannelAssignments({ accounts: [{ channelType: 'whatsapp', accountId: 'new' }],
        channels: [], bindings: ['whatsapp:old'], overviewAvailable: true, supportedTypes: supported });
    assert.equal(check(stale, 'channel_connection').status, 'fail');
    assert.deepEqual(staleEditor, { channels: [], bindings: ['whatsapp:old'] });
    output('stale-account-binding-preserved-in-editor', { savedBinding: 'whatsapp:old', currentAccount: 'whatsapp:new',
        editor: staleEditor, connection: check(stale, 'channel_connection') });

    const rag = await inspect({ knowledgeChunks: 0, faqs: 5, products: 4 });
    assert.equal(check(rag, 'knowledge_coverage').status, 'pass');
    assert.equal(check(rag, 'rag_knowledge').status, 'fail');
    output('catalog-and-faqs-do-not-satisfy-enabled-rag', {
        coverage: check(rag, 'knowledge_coverage'), rag: check(rag, 'rag_knowledge') });

    const privacy = await inspect({ mediaProcessing: { audioPerMonth: 100, imagePerMonth: 50 },
        policies: 2, privacyPolicies: 0 });
    assert.equal(check(privacy, 'media_privacy_policy').status, 'fail');
    const privacyReady = await inspect({ mediaProcessing: { audioPerMonth: 100, imagePerMonth: 50 }, privacyPolicies: 1 });
    assert.equal(check(privacyReady, 'media_privacy_policy').status, 'pass');
    output('privacy-specific-policy-required', { withoutPrivacy: check(privacy, 'media_privacy_policy'),
        withPrivacy: check(privacyReady, 'media_privacy_policy').status });

    const hours = await inspect({ config: { ...completeConfig,
        hours: { aiOutsideHours: false, afterHoursMessageOverride: 'Volvemos en nuestro horario de atencion.' } },
        tenantSettings: { businessHours: { is247: false, schedule: { monday: { enabled: true, open: '09:00', close: '17:00' } } } } });
    assert.equal(check(hours, 'business_hours').status, 'pass');
    assert.equal(check(hours, 'after_hours_behavior').status, 'pass');
    output('after-hours-override-recognized-by-quality', { businessHours: check(hours, 'business_hours'),
        afterHours: check(hours, 'after_hours_behavior'), overridePresent: true });

    const unavailable = await inspect({ failedQueries: ['FROM knowledge_embeddings'] });
    assert.equal(check(unavailable, 'rag_knowledge').status, 'unknown');
    assert.ok(unavailable.preparation.criticalBlockers.includes('rag_knowledge'));
    const blockers = agentReadinessBlockers(unavailable);
    assert.equal(blockers.filter(blocker => !blocker.unavailable).length, 0);
    output('unknown-source-is-not-presented-as-missing-configuration', { rag: check(unavailable, 'rag_knowledge'),
        criticalBlockers: unavailable.preparation.criticalBlockers, pendingVerification: blockers.length });
}
main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
