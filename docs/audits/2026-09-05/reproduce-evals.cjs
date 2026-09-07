/*
 * Read-only audit reproduction. Run from the repository with:
 *   node docs/audits/2026-09-05/reproduce-evals.cjs
 *
 * Loads current TypeScript sources. No database, Redis or LLM connection is
 * created. The gate and effect verifier are real; dependencies and the model
 * execution are stubs. The simulated judge always returns 10/10, tools never
 * run, and the fake database reports zero rows. This isolates infrastructure
 * rejection from agent behavior; it is not a live agent quality measurement.
 */
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
require(path.join(root, 'node_modules/ts-node')).register({
    project: path.join(root, 'apps/api/tsconfig.json'),
    transpileOnly: true,
});

const shared = require(path.join(root, 'packages/shared/src/index.ts'));
// API imports must see source contracts, not a potentially stale dist build.
const sharedRuntimePath = require.resolve('@parallext/shared', { paths: [root] });
require.cache[sharedRuntimePath] = {
    id: sharedRuntimePath,
    filename: sharedRuntimePath,
    loaded: true,
    exports: shared,
};

const { EvalService, EVAL_EFFECT_VERIFIERS } = require(path.join(
    root, 'apps/api/src/modules/simulation/eval.service.ts',
));
const { EVAL_WRITER_SANDBOX_FAMILIES } = require(path.join(
    root, 'apps/api/src/modules/conversations/agent-test-tool-policy.ts',
));

const positiveTypes = new Set(['called', 'row_exists', 'row_count']);

async function main() {
    const profiles = shared.listSubtypeExperienceProfileIds();
    const rows = profiles.flatMap(profileId => {
        const [industry, subtype] = profileId.split('/');
        return shared.EVAL_LANGUAGES.map(language => {
            const pack = shared.composeSubtypeEvalPack({ industry, subtype, language });
            return {
                profileId,
                language,
                scenarios: pack.length,
                customerTurns: pack.reduce((sum, scenario) => sum + scenario.messages.length, 0),
                scenariosWithActions: pack.filter(scenario => scenario.expectedActions?.length).length,
                scenariosWithPositiveActions: pack.filter(scenario =>
                    scenario.expectedActions?.some(action => positiveTypes.has(action.type)),
                ).length,
                scenariosWithMissingEffectVerifier: pack.filter(scenario =>
                    scenario.expectedActions?.some(action => action.kind === 'db_effect'
                        && (!EVAL_EFFECT_VERIFIERS[action.family]
                            || EVAL_EFFECT_VERIFIERS[action.family].table !== action.table)),
                ).length,
            };
        });
    });

    const workshopPack = shared.composeSubtypeEvalPack({
        industry: 'automotriz', subtype: 'taller', language: 'es',
    });
    const service = new EvalService(
        {
            getTenantSchemaName: async () => 'audit_stub_schema',
            executeInTenantSchema: async () => [{ cnt: 0 }],
        },
        {},
        {},
        { acquireLock: async () => true, releaseLock: async () => {} },
        { emit: () => {} },
    );
    // Prohibit setup/persistence by replacing only dependencies of the gate.
    service.ensureTable = async () => {};
    service.ensureSandboxContact = async () => {};
    service.listScenarios = async () => workshopPack;
    service.persistRun = async () => {};
    service.runScenarioWithActions = async (_tenantId, _agentId, schema, scenario) => {
        const verification = await service.verifyActions(
            schema,
            scenario.expectedActions,
            '00000000-0000-4000-8000-00000000eba1',
            [],
        );
        return { score: 10, passed: verification.passed, actionChecks: verification.checks };
    };
    const gate = await service.runGateV2('audit_stub_tenant', 'audit_stub_agent');

    process.stdout.write(JSON.stringify({
        scope: 'Current source contracts; isolated dependency stubs; no DB, Redis or LLM calls',
        profileCount: profiles.length,
        languages: shared.EVAL_LANGUAGES,
        totalSeededScenarios: rows.reduce((sum, row) => sum + row.scenarios, 0),
        totalScenariosWithPositiveActions: rows.reduce((sum, row) => sum + row.scenariosWithPositiveActions, 0),
        minScenariosPerProfileAndLanguage: Math.min(...rows.map(row => row.scenarios)),
        maxScenariosPerProfileAndLanguage: Math.max(...rows.map(row => row.scenarios)),
        missingVerifierProfiles: rows.filter(row => row.scenariosWithMissingEffectVerifier > 0),
        exampleProfiles: rows.filter(row => row.language === 'es'
            && ['salud/dental', 'restaurantes/comida_rapida'].includes(row.profileId)),
        evalSandbox: {
            auditedFamilies: Object.values(EVAL_WRITER_SANDBOX_FAMILIES).filter(family => family.status === 'audited').length,
            auditedWriters: Object.values(EVAL_WRITER_SANDBOX_FAMILIES)
                .filter(family => family.status === 'audited')
                .flatMap(family => family.tools).length,
            repairOrdersVerifierPresent: !!EVAL_EFFECT_VERIFIERS.repair_orders,
        },
        workshopGate: {
            language: 'es',
            simulatedJudgeScore: 10,
            simulatedToolCalls: 0,
            simulatedDatabaseRows: 0,
            total: gate.total,
            avgScore: gate.avgScore,
            passed: gate.passed,
            evalActivable: gate.evalActivable,
            failedScenarios: gate.scenarios.filter(scenario => !scenario.passed).length,
            firstFailure: gate.scenarios.find(scenario => !scenario.passed),
        },
    }, null, 2) + '\n');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
