import { EvalController } from './eval.controller';
import { EvalService } from './eval.service';
import { selectEvalScenarios, validateEvalScenarioKeys } from './eval-scenario-selection';
import { revisionHash } from '../evaluation-revision/evaluation-revision';

describe('explicit diagnostic eval selection', () => {
    const scenarios = [{ key: 'qa-crm-lead', title: 'Lead' }, { key: 'qa-crm-task', title: 'Task' }, { key: 'unrelated', title: 'Unrelated' }];
    it('selects only exact server-owned keys in the requested order', () => {
        expect(selectEvalScenarios(scenarios, ['qa-crm-task', 'qa-crm-lead'])).toEqual([scenarios[1], scenarios[0]]);
    });
    it('preserves the full gate when no selection is supplied', () => {
        expect(selectEvalScenarios(scenarios)).toBe(scenarios);
    });
    it.each([[], ['a', 'a'], [''], [' a'], ['a\n'], ['a'.repeat(181)], new Array(51).fill('a'), null, 'a', [{}]].map(value => [value]))(
        'rejects malformed, duplicate or unbounded selections: %p', value => {
            expect(() => validateEvalScenarioKeys(value)).toThrow();
        },
    );
    it('rejects an unknown or inapplicable key instead of silently running a subset', () => {
        expect(() => selectEvalScenarios(scenarios, ['qa-crm-lead', 'foreign-or-inactive'])).toThrow();
    });
    it('rejects ambiguous server data', () => {
        expect(() => selectEvalScenarios([scenarios[0], scenarios[0]], ['qa-crm-lead'])).toThrow();
    });
    it('passes explicit selection through the guarded controller', async () => {
        const service = { runGateV2: jest.fn().mockResolvedValue({ passed: true }) };
        const controller = new EvalController(service as any);
        await controller.runActions('own-tenant', { agentId: 'own-agent', scenarioKeys: ['qa-crm-lead'], expectedScenarioSetHash: 'a'.repeat(64) });
        expect(service.runGateV2).toHaveBeenCalledWith('own-tenant', 'own-agent', expect.objectContaining({ scenarioKeys: ['qa-crm-lead'], expectedScenarioSetHash: 'a'.repeat(64) }));
    });
    function harness() {
        const service = Object.create(EvalService.prototype) as any;
        service.prisma = { getTenantSchemaName: jest.fn().mockResolvedValue('tenant_owned') };
        service.withSandboxLease = jest.fn(async (_tenant, run) => run(async () => undefined));
        service.ensureTable = jest.fn(); service.listScenarios = jest.fn().mockResolvedValue(scenarios);
        service.agentTest = { captureSnapshot: jest.fn().mockResolvedValue({ configHash: 'owned-config', manifest: { revision: 'owned-revision' }, releaseScope: {} }),
            assertSnapshotExecutable: jest.fn(), releaseSnapshot: jest.fn() };
        service.runPassK = jest.fn().mockImplementation(async (_tenant, _agent, _schema, sc) => ({ key: sc.key, score: 10, passed: true, runs: [] }));
        service.persistRun = jest.fn(); service.emitRunEvent = jest.fn();
        return service;
    }
    it('never starts a model unit or acquires a lease for an empty selection', async () => {
        const s = harness();
        await expect(s.runGateV2('own-tenant', 'own-agent', { scenarioKeys: [] })).rejects.toThrow();
        expect(s.runPassK).not.toHaveBeenCalled(); expect(s.withSandboxLease).not.toHaveBeenCalled();
    });
    it('does not run any model units when one requested key is missing', async () => {
        const s = harness();
        await expect(s.runGateV2('own-tenant', 'own-agent', { scenarioKeys: ['qa-crm-lead', 'missing'], expectedScenarioSetHash: 'a'.repeat(64) })).rejects.toThrow();
        expect(s.runPassK).not.toHaveBeenCalled(); expect(s.agentTest.releaseSnapshot).toHaveBeenCalledTimes(1);
    });
    it('runs only the selected case and never issues release evidence for a diagnostic subset', async () => {
        const s = harness(); const result = await s.runGateV2('own-tenant', 'own-agent', { scenarioKeys: ['qa-crm-task'], expectedScenarioSetHash: revisionHash([scenarios[1]]) });
        expect(s.runPassK).toHaveBeenCalledTimes(1); expect(s.runPassK.mock.calls[0][3].key).toBe('qa-crm-task');
        expect(result).toMatchObject({ passed: true, total: 1, evaluationScope: 'selected_diagnostic', evalActivable: false });
        expect(result.releaseEvidence).toBeUndefined(); expect(result.releaseReadiness).toBeUndefined();
        expect(s.persistRun.mock.calls[0][3]).toBe('manual_selected_diagnostic');
        expect(s.emitRunEvent).not.toHaveBeenCalled();
        expect(s.agentTest.releaseSnapshot).toHaveBeenCalledTimes(1);
    });
    it('preserves full-suite execution and gate evidence without a selector', async () => {
        const s = harness(); const result = await s.runGateV2('own-tenant', 'own-agent');
        expect(s.runPassK).toHaveBeenCalledTimes(3); expect(result.total).toBe(3);
        expect(result.releaseEvidence).toBeDefined(); expect(result.releaseReadiness).toBeDefined();
        expect(s.persistRun.mock.calls[0][3]).toBe('manual');
        expect(s.emitRunEvent).toHaveBeenCalledTimes(1);
    });
    it('rejects an inactive requested case before executing any case', async () => {
        const s = harness(); s.listScenarios.mockResolvedValue([{ ...scenarios[0], seedState: 'retired' }]);
        await expect(s.runGateV2('own-tenant', 'own-agent', { scenarioKeys: ['qa-crm-lead'], expectedScenarioSetHash: 'a'.repeat(64) })).rejects.toThrow();
        expect(s.runPassK).not.toHaveBeenCalled();
    });
    it('cannot mix selected keys with caller-supplied scenario bodies', async () => {
        const s = harness();
        await expect(s.runGateV2('own-tenant', 'own-agent', { scenarioKeys: ['qa-crm-lead'], scenarios, expectedScenarioSetHash: 'a'.repeat(64) })).rejects.toThrow();
        expect(s.withSandboxLease).not.toHaveBeenCalled();
    });
    it('retains source review checks on a selected case', async () => {
        const s = harness(); s.listScenarios.mockResolvedValue([{ ...scenarios[0], regressionBlocked: true }]);
        await expect(s.runGateV2('own-tenant', 'own-agent', { scenarioKeys: ['qa-crm-lead'], expectedScenarioSetHash: 'a'.repeat(64) })).rejects.toThrow();
        expect(s.runPassK).not.toHaveBeenCalled(); expect(s.emitRunEvent).not.toHaveBeenCalled();
    });
    it('persists a failed diagnostic without release evidence and releases its snapshot', async () => {
        const s = harness(); s.runPassK.mockRejectedValue(new Error('Synthetic model failure'));
        await expect(s.runGateV2('own-tenant', 'own-agent', { scenarioKeys: ['qa-crm-lead'], expectedScenarioSetHash: revisionHash([scenarios[0]]) })).rejects.toThrow('Synthetic model failure');
        const failed = s.persistRun.mock.calls[0][2];
        expect(failed).toMatchObject({ status: 'failed', passed: false, evalActivable: false });
        expect(failed.releaseEvidence).toBeUndefined(); expect(s.emitRunEvent).not.toHaveBeenCalled();
        expect(s.agentTest.releaseSnapshot).toHaveBeenCalledTimes(1);
    });
    it('requires a pinned scenario definition before acquiring a lease', async () => {
        const s = harness();
        await expect(s.runGateV2('own-tenant', 'own-agent', { scenarioKeys: ['qa-crm-lead'] })).rejects.toThrow();
        expect(s.withSandboxLease).not.toHaveBeenCalled();
    });
    it('refuses a changed scenario definition before any model units', async () => {
        const s = harness();
        await expect(s.runGateV2('own-tenant', 'own-agent', { scenarioKeys: ['qa-crm-lead'], expectedScenarioSetHash: 'a'.repeat(64) })).rejects.toThrow();
        expect(s.runPassK).not.toHaveBeenCalled(); expect(s.agentTest.releaseSnapshot).toHaveBeenCalledTimes(1);
    });
});
