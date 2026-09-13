#!/usr/bin/env node
/* Local, synthetic review reproducer. No network, subprocess, credentials or DB.
 * Run from any directory: node docs/audits/2026-09-10/reproduce-staging-contract.cjs
 * Exit 0 means all reported defects below reproduced, NOT release acceptance.
 * After fixing them, this diagnostic should report NOT_REPRODUCED; replace with
 * proper positive/negative regression tests rather than keeping defects green.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const ts = require(path.join(root, 'node_modules/typescript'));
const yaml = require(path.join(root, 'node_modules/js-yaml'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function load(file, mocks = {}) {
    const exports = {};
    const code = ts.transpileModule(read(file), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        experimentalDecorators: true,
    } }).outputText;
    vm.runInNewContext(code, {
        exports,
        require: name => {
            if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name];
            if (name === 'crypto') return require('node:crypto');
            throw new Error(`Unmocked import refused: ${name}`);
        },
        URL, Object, Set, Map, Date, Error,
    }, { filename: file });
    return exports;
}
const results = [];
function record(id, reproduced, evidence, kind = 'executable_contract') {
    results.push({ id, reproduced, kind, evidence });
    console.log(`${reproduced ? 'REPRODUCED' : 'NOT_REPRODUCED'} ${id} ${JSON.stringify(evidence)}`);
}
async function main() {
    const isolation = load('apps/api/src/common/utils/staging-isolation.ts');
    const operations = load('apps/api/src/common/utils/staging-operations.ts', { './staging-isolation': isolation });
    const env = {};
    for (const variable of isolation.STAGING_CONTRACT) {
        env[variable.name] = `synthetic-only-${'x'.repeat(variable.minLength || 32)}`;
    }
    Object.assign(env, {
        STAGING_SERVER_HOST: 'staging.example.test',
        STAGING_REDIS_HOST: 'redis.staging.example.test',
        STAGING_DATABASE_URL: 'postgresql://synthetic:synthetic@db.staging.example.test/parallext_staging',
        STAGING_DIRECT_DATABASE_URL: 'postgresql://synthetic:synthetic@db.staging.example.test/parallext_staging',
        STAGING_PUBLIC_API_URL: 'https://api.staging.example.test',
        STAGING_PUBLIC_DASHBOARD_URL: 'https://app.staging.example.test',
        STAGING_SEED_SOURCE: 'synthetic',
    });
    const report = isolation.assessStagingIsolation({ env, productionDigests: [] });
    record('S03_EMPTY_DIGESTS_ACCEPTED', report.ok, { checked: report.checked, ok: report.ok, findings: report.findings });

    const compose = yaml.load(read('infra/docker/docker-compose.prod.yml'));
    const direct = compose.services.api.environment.DIRECT_DATABASE_URL.replace('${DB_PASSWORD:-parallext_secret}', 'synthetic-only');
    let refusal = null;
    try { operations.assertStagingTarget({ environment: 'staging', databaseUrl: direct }); }
    catch (error) { refusal = error.message; }
    record('S02_COMPOSE_REJECTED_BY_OWN_STAGING_GATE', refusal === 'staging_target_refused:production_database_name:parallext_engine', {
        effectiveDatabase: isolation.databaseNameIn(direct), refusal,
    });

    const { DispatchRolloutService } = load('apps/api/src/modules/channels/dispatch-rollout.service.ts', {
        '@nestjs/common': { Injectable: () => () => {}, Logger: class { debug() {} warn() {} } },
        '../prisma/prisma.service': {}, '../redis/redis.service': {}, './channel-gateway.service': {},
    });
    const runtime = new DispatchRolloutService({}, {
        getJson: async () => operations.dispatchPilotValue(true),
    }, { getStrictTransport: () => ({}) });
    const state = await runtime.state();
    const enabled = await runtime.enabledFor(operations.PILOT_TENANT.id, operations.PILOT_CHANNEL);
    record('S06_PILOT_HAS_NO_EFFECTIVE_CHANNEL', enabled === false && state.effectiveChannels.length === 0, {
        enabledFor: enabled, effectiveChannels: state.effectiveChannels, ignoredChannels: state.ignoredChannels,
    });

    const workflow = yaml.load(read('.github/workflows/staging.yml'));
    const condition = workflow.jobs.rollback.if;
    // Interpret only this workflow's restricted boolean expression; reject any
    // unrecognised token instead of evaluating arbitrary source from the repo.
    const evaluated = condition.replace(/always\(\)/g, 'true')
        .replace(/inputs\.action/g, JSON.stringify('rollback'))
        .replace(/needs\.(?:deploy|verify)\.result/g, JSON.stringify('skipped'))
        .replace(/needs\.guard\.result/g, JSON.stringify('failure'));
    if (!/^[\s\w'"=!&|().-]+$/.test(evaluated) || /[A-Za-z_$][\w$]*\s*\(/.test(evaluated)) {
        throw new Error('Rollback condition has changed: manually review the new expression');
    }
    const wouldRun = vm.runInNewContext(evaluated, {}, { timeout: 100 });
    record('S01_ROLLBACK_RUNS_AFTER_GUARD_FAILURE', wouldRun === true, {
        guard: 'failure', deploy: 'skipped', verify: 'skipped', action: 'rollback', wouldRun,
        needs: workflow.jobs.rollback.needs, condition,
    }, 'workflow_expression');

    const verifyScript = workflow.jobs.verify.steps.find(step => step.name === 'Exercise the staging host').with.script;
    const transientWrite = /run --rm api node scripts\/seed-staging-synthetic\.cjs --reset --json \/tmp\/seed\.json/.test(verifyScript);
    const differentContainerRead = /exec -T api cat \/tmp\/seed\.json/.test(verifyScript);
    const sharedTmp = (compose.services.api.volumes || []).some(volume => String(volume).split(':')[1] === '/tmp');
    record('S05_ARTIFACT_WRITTEN_IN_REMOVED_CONTAINER', transientWrite && differentContainerRead && !sharedTmp, {
        transientWrite, differentContainerRead, sharedTmp,
    }, 'compose_workflow_contract_not_docker_execution');

    const apiPrefix = /setGlobalPrefix\('([^']+)'\)/.exec(read('apps/api/src/main.ts'))?.[1];
    const apiController = /@Controller\('([^']+)'\)/.exec(read('apps/api/src/modules/health/health.controller.ts'))?.[1];
    const expectedHealth = `/${apiPrefix}/${apiController}`;
    const deployScript = workflow.jobs.deploy.steps.find(step => step.name === 'Deploy').with.script;
    const actualHealth = /http:\/\/localhost:3000([^\s]+)/.exec(deployScript)?.[1];
    record('S04_HEALTH_PATH_MISMATCH', actualHealth !== expectedHealth, { actualHealth, expectedHealth }, 'route_composition');

    const prod = yaml.load(read('.github/workflows/deploy.yml'));
    const dashboardBuild = prod.jobs['build-and-push'].steps.find(step => step.name === 'Build and push Dashboard image');
    const prodApiBaked = /^NEXT_PUBLIC_API_URL=https:\/\/api\.parallly-chat\.cloud\/api\/v1$/m.test(dashboardBuild.with['build-args']);
    const noStagingBuild = !Object.values(workflow.jobs).some(job => job.steps?.some(step => /docker\/build-push-action/.test(step.uses || '')));
    record('S07_PRODUCTION_DASHBOARD_WITH_NO_STAGING_BUILD', prodApiBaked && noStagingBuild, {
        prodApiBaked, noStagingBuild, productionValidateCondition: prod.jobs.validate.if,
        productionBuildNeeds: prod.jobs['build-and-push'].needs,
    }, 'build_workflow_contract');
    const reproduced = results.filter(result => result.reproduced).length;
    console.log(`STAGING_REVIEW_REPRODUCER reproduced=${reproduced} checks=${results.length} releaseAcceptance=false`);
    process.exitCode = reproduced === results.length ? 0 : 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 2; });
