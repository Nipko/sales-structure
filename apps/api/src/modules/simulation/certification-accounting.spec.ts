import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parallelyCertificationRunner } from './certification-runner';
import { gateScenario, gateUsage, servedModels, servedTheRequestedModel, USAGE_NOT_RUN, type EvalGateResult } from './eval-gate-result';

/**
 * ═══ WHAT THE GATE RETURNS, AND WHAT THE LEDGER MAY CONCLUDE FROM IT ═══
 *
 * `runGateV2` returns `{ scenarios }`. Two consumers read `gate.results`, and
 * one also read `gate.costUsdCents`, which the gate has never had. Both sides
 * were typed `any`, so nothing said a word.
 *
 * The consequence was not a crash. A PASSING scenario became
 * `{passed: false, servedModel: '', costUsdCents: 0}`; the ledger settled it as
 * `failed` at zero cost; the reservation was released; and the budget went back
 * up after work the provider had already done. The benchmark had the same read
 * and turned it into a measured failure at zero cost, which then satisfied
 * `comparable: true` against an alternative.
 *
 * Reproduced by `docs/audits/2026-09-10/reproduce-certification-runner-contract.cjs`
 * on `80f56077`. These are the regressions.
 */

const scenarioKey = 'intent_ask_question_es_0';

/** A gate result in the shape the real producer emits. */
const gateResult = (overrides: Partial<EvalGateResult> = {}): EvalGateResult => ({
    runId: 'run-1', status: 'completed', passed: true, avgScore: 9, total: 1,
    k: 1, threshold: 8, passPolicy: 'all', evalActivable: false,
    scenarios: [{
        key: scenarioKey, passed: true, score: 9, resolved: true, error: null,
        runs: [{ score: 9, passed: true, model: 'gpt-4o-mini', models: ['gpt-4o-mini'], transcript: [], executedTools: [] }],
    }],
    ...overrides,
});

describe('reading the gate', () => {
    it('finds a scenario by the field the producer actually emits', () => {
        expect(gateScenario(gateResult(), scenarioKey)?.passed).toBe(true);
        // The old read, spelled out so the regression is legible: there is no
        // `results`, and asking for one returns nothing for every case.
        expect((gateResult() as unknown as { results?: unknown }).results).toBeUndefined();
    });

    it('tells "not run" apart from "ran and failed"', () => {
        // These are different facts and the ledger acts differently on them:
        // one is a verdict, the other is an absence of one.
        expect(gateScenario(gateResult(), 'a-key-the-gate-did-not-run')).toBeUndefined();
        expect(gateUsage(gateResult(), undefined)).toEqual(USAGE_NOT_RUN);
    });

    it('never turns an unreported cost into zero', () => {
        // The whole defect in one assertion. The gate reports no usage; the old
        // read was `Number(gate?.costUsdCents ?? 0)`, and 0 settles.
        expect(gateUsage(gateResult(), gateScenario(gateResult(), scenarioKey)))
            .toEqual({ state: 'unknown', costUsdCents: null });
    });

    it('reads a reported cost when there finally is one', () => {
        const withUsage = { ...gateResult(), costUsdCents: 12 } as unknown as EvalGateResult;
        expect(gateUsage(withUsage, gateScenario(withUsage, scenarioKey)))
            .toEqual({ state: 'reported', costUsdCents: 12 });
        // And refuses nonsense rather than rounding it.
        const negative = { ...gateResult(), costUsdCents: -4 } as unknown as EvalGateResult;
        expect(gateUsage(negative, gateScenario(negative, scenarioKey)).state).toBe('unknown');
    });

    it('collects the models that answered, from the plural field', () => {
        expect(servedModels(gateScenario(gateResult(), scenarioKey))).toEqual(['gpt-4o-mini']);
        // The router can fall back mid-run; both models are named.
        const fellBack = gateResult({
            scenarios: [{ key: scenarioKey, passed: true, runs: [
                { models: ['gpt-4o-mini'] }, { models: ['deepseek-chat'] },
            ] }],
        });
        expect(servedModels(gateScenario(fellBack, scenarioKey))).toEqual(['deepseek-chat', 'gpt-4o-mini']);
    });

    it('knows whether the model somebody paid to certify is the one that answered', () => {
        expect(servedTheRequestedModel('gpt-4o-mini', ['gpt-4o-mini'])).toBe(true);
        expect(servedTheRequestedModel('gpt-4o-mini', ['deepseek-chat'])).toBe(false);
        expect(servedTheRequestedModel('', ['gpt-4o-mini'])).toBe(false);
    });
});

describe('the certification runner, against the real gate shape', () => {
    const lease = {
        caseId: 'case-1', runId: 'run-1', caseKey: 'k', attempt: 1,
        profileId: 'education/capacitacion', scenarioKey, language: 'es',
        channelType: 'web_widget', model: 'gpt-4o-mini', definitionHash: 'h', leaseToken: 'token',
    } as any;

    const deps = (overrides: Record<string, unknown> = {}) => ({
        runGate: jest.fn(async () => gateResult()),
        captureSnapshot: jest.fn(async () => ({ configHash: 'cfg' })),
        tenantId: '11111111-1111-4111-8111-111111111111',
        k: 1, threshold: 8,
        subjectFor: () => ({ agentId: '22222222-2222-4222-8222-222222222222', configHash: 'cfg' }) as any,
        ...overrides,
    });

    /** A scenario key the packs really contain, so the runner gets that far. */
    const realKey = async (): Promise<string | null> => {
        const { composeSubtypeEvalPack } = await import('@parallext/shared');
        const pack = composeSubtypeEvalPack({ industry: 'education', subtype: 'capacitacion', language: 'es' });
        return pack[0]?.key ?? null;
    };

    it('records a pass as a pass, and its cost as unknown rather than zero', async () => {
        const key = await realKey();
        if (!key) throw new Error('the education pack produced no scenario to certify');
        const run = deps({ runGate: jest.fn(async () => gateResult({
            scenarios: [{ key, passed: true, score: 9, runs: [{ passed: true, models: ['gpt-4o-mini'] }] }],
        })) });
        const result = await parallelyCertificationRunner(run as any)({ ...lease, scenarioKey: key });
        // Before: passed=false, servedModel='', costUsdCents=0 — a pass turned
        // into a failure that settled and refilled the budget.
        expect(result.passed).toBe(true);
        expect(result.servedModel).toBe('gpt-4o-mini');
        expect(result.usage).toEqual({ state: 'unknown', costUsdCents: null });
        expect(result.errorCode).toBeNull();
    });

    it('passes the authority and budget callbacks the gate expects', async () => {
        // The runner passed neither, so a certification run had no lease check
        // and no budget decrement between model calls: it kept spending past a
        // cancellation and past its own ceiling.
        const key = await realKey();
        const assertExecutionAuthority = jest.fn(async () => undefined);
        const beforeModelUnits = jest.fn(async () => undefined);
        const runGate = jest.fn(async (_tenantId: string, _agentId: string, _opts: Record<string, unknown>) =>
            gateResult({ scenarios: [{ key: key!, passed: true, runs: [] }] }));
        await parallelyCertificationRunner(deps({ runGate, assertExecutionAuthority, beforeModelUnits }) as any)(
            { ...lease, scenarioKey: key });
        const options = runGate.mock.calls[0][2];
        expect(options.assertExecutionAuthority).toBe(assertExecutionAuthority);
        expect(options.beforeModelUnits).toBe(beforeModelUnits);
    });

    it('refuses a case answered by a model nobody asked to certify', async () => {
        // Certification is per model. The router falls back by design, so a run
        // can legitimately be answered by another model — and evidence that does
        // not notice is evidence about a model nobody asked about.
        const key = await realKey();
        const result = await parallelyCertificationRunner(deps({
            runGate: jest.fn(async () => gateResult({
                scenarios: [{ key: key!, passed: true, runs: [{ passed: true, models: ['deepseek-chat'] }] }],
            })),
        }) as any)({ ...lease, scenarioKey: key });
        expect(result.passed).toBe(false);
        expect(result.errorCode).toBe('certification_model_mismatch:gpt-4o-mini:deepseek-chat');
        // And its cost is still unknown: the provider did the work either way.
        expect(result.usage.state).toBe('unknown');
    });

    it('says the gate returned nothing rather than inventing a verdict', async () => {
        const key = await realKey();
        const result = await parallelyCertificationRunner(deps({
            runGate: jest.fn(async () => gateResult({ scenarios: [] })),
        }) as any)({ ...lease, scenarioKey: key });
        expect(result.passed).toBe(false);
        expect(result.errorCode).toBe('certification_gate_returned_no_scenario');
        // `not_run`: nothing happened, so there is nothing to account for. This
        // is the ONE case where zero is honest.
        expect(result.usage).toEqual(USAGE_NOT_RUN);
    });

    it('accounts a scenario the packs do not contain as not run', async () => {
        const result = await parallelyCertificationRunner(deps() as any)(
            { ...lease, scenarioKey: 'a_key_no_pack_contains' });
        expect(result.errorCode).toBe('certification_scenario_missing');
        expect(result.usage).toEqual(USAGE_NOT_RUN);
    });
});

describe('no consumer reads a field the gate does not have', () => {
    // The drift guard. Both defects were a consumer reading `gate.results` and
    // `gate.costUsdCents` from a producer that emits neither, under `any` on
    // both sides. A type stops the next one; this stops the next one being
    // written back in by hand.
    const files = [
        'apps/api/src/modules/simulation/certification-runner.ts',
        'apps/api/src/modules/simulation/benchmark.service.ts',
    ];

    it.each(files)('%s reads scenarios, and never defaults a cost to zero', file => {
        const source = readFileSync(resolve(__dirname, '../../../../..', file), 'utf8')
            .split(/\r?\n/)
            .filter((line: string) => !/^\s*(\*|\/\/|\/\*)/.test(line))
            .join('\n');
        expect({ file, readsResults: /gate\??\.\s*results/.test(source) })
            .toEqual({ file, readsResults: false });
        expect({ file, defaultsCostToZero: /costUsdCents\s*\?\?\s*0/.test(source) })
            .toEqual({ file, defaultsCostToZero: false });
        // And both go through the one reader that knows the field's name.
        expect(source).toContain('gateScenario(');
    });
});
