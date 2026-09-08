// Source authority concurrency/erasure is exercised with real Prisma in simulation-replay.postgres.spec.ts.
jest.mock('./simulation-replay-authority',()=>({
    ...jest.requireActual('./simulation-replay-authority'),
    assertSimulationReplayRun:async()=>undefined,
    withSimulationReplayRun:async(prisma:any,schema:string,runId:string,work:any)=>{
        const query=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema(schema,sql,params);
        const rows=await query('SELECT * FROM simulation_runs WHERE id=$1::uuid',[runId]);
        return work(query,rows?.[0] || {});
    },
}));
import { SimulationService } from './simulation.service';
import { EvalService } from './eval.service';
import { evaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { revisionHash } from '../evaluation-revision/evaluation-revision';

const replayRun={schemaName:'test_schema',runId:'test_run'};
const frozenSnapshot = evaluationSnapshot('tenant', 'agent', {version:1,config_json:{language:'fr'}});
const scenario = (key: string) => ({ key, title: key, source: 'replay', language: 'fr', goal: 'support', openingMessage: 'bonjour', replayMessages: ['bonjour', 'oui'] });
const judge = { overall: 8, resolved: true, tone: 8, accuracy: 8, empathy: 8, resolution: 8, flags: [] };

function simulation() {
    const prisma = { executeInTenantSchema: jest.fn().mockResolvedValue([]),transactionInTenantSchema:jest.fn(async(_schema:any,work:any)=>work(async()=>[])) };
    const agentTest = { releaseSnapshot: jest.fn(), snapshotSourceAuthority: jest.fn(() => async (invoke: any) => invoke()), assertSnapshotExecutable: jest.fn().mockResolvedValue(undefined), test: jest.fn().mockResolvedValue({ reply: 'Comment puis-je vous aider?', debug: { toolCalls: [] } }) };
    const llm = { execute: jest.fn() };
    const quality = { judgeTranscript: jest.fn().mockResolvedValue(judge) };
    const service = new SimulationService(prisma as any, {} as any, llm as any, {} as any, quality as any, agentTest as any, {} as any, { emit: jest.fn() } as any);
    return { service, prisma, agentTest, llm, quality };
}

describe('simulation execution fidelity', () => {
    it('migrates the full revision column even when the previous deployment cached the v2 schema',async()=>{
        const f=simulation();
        const redis={get:jest.fn(async(key:string)=>key==='simulation_cols:v2:tenant_test'?'1':null),set:jest.fn()};
        (f.service as any).redis=redis;
        await f.service.ensureTables('tenant_test');
        expect(f.prisma.executeInTenantSchema.mock.calls.some((call:any[])=>call[1].includes('ADD COLUMN IF NOT EXISTS evaluation_snapshot JSONB'))).toBe(true);
        expect(redis.set).toHaveBeenCalledWith('simulation_cols:v4:tenant_test','1',86400);
    });
    it('reruns a previous result when its customer script changed under the same scenario key',async()=>{
        const f=simulation();const old=scenario('same');const changed={...old,replayMessages:['Nouvelle demande']};
        const previous={...old,scenarioHash:revisionHash(old),transcript:[],turns:1,latencyMs:1,judge};
        const results=await (f.service as any).runScenariosConcurrently('tenant','agent','telegram',[changed],frozenSnapshot,undefined,[previous],undefined,replayRun);
        expect(f.agentTest.test).toHaveBeenCalledTimes(1);
        expect(results[0]).not.toBe(previous);expect(results[0].scenarioHash).toBe(revisionHash(changed));
    });
    it('never grades a runtime failure as a successful customer-service answer', async () => {
        const { service, agentTest, quality } = simulation();
        agentTest.test.mockResolvedValue({ reply: 'Disculpa, hubo un problema.', debug: { runtimeError: 'provider unavailable', toolCalls: [] } } as any);
        const results = await (service as any).runScenariosConcurrently('tenant', 'agent', 'telegram', [scenario('failed')],frozenSnapshot,undefined,[],undefined,replayRun);
        expect(results[0]).toMatchObject({ judge: null, error: 'agent_runtime_failed:provider unavailable' });
        expect(quality.judgeTranscript).not.toHaveBeenCalled();
    });
    it('passes the same frozen revision, actual channel and owned tool sandbox through every turn', async () => {
        const { service, agentTest } = simulation();
        const snapshot = evaluationSnapshot('tenant', 'agent', { version: 9, config_json: { language: 'fr' } });
        const session = { sandboxContactId: 'sandbox', sandboxConversationId: 'conversation', recordInbound: jest.fn(), assertLease: jest.fn(), reset: jest.fn() };
        await (service as any).runScenario('tenant', 'agent', 'instagram', scenario('one'), snapshot, session,replayRun);
        expect(agentTest.test).toHaveBeenCalledTimes(2);
        for (const call of agentTest.test.mock.calls as any[]) {
            expect(call[2].channelType).toBe('instagram');
            expect(call[3]).toMatchObject({ disableTools: false, evalMode: true, agentSnapshot: snapshot, sandboxConversationId: 'conversation', beforeToolExecution:expect.any(Function),beforeModelExecution:expect.any(Function) });
        }
        expect(session.recordInbound.mock.calls).toEqual([['bonjour'], ['oui']]);
    });

    it('preserves partial evidence when customer generation fails and retries only failed scenarios', async () => {
        const { service, agentTest, llm } = simulation();
        llm.execute.mockRejectedValue(new Error('provider timeout'));
        const synthetic = { ...scenario('broken'), source: 'synthetic',replayMessages:undefined };
        const good = { ...scenario('done'), scenarioHash: revisionHash(scenario('done')), transcript: [], turns: 1, latencyMs: 1, judge };
        const reset = jest.fn(); const checkpoint = jest.fn();
        const result = await (service as any).runScenariosConcurrently('tenant', 'agent', 'telegram', [scenario('done'), synthetic], frozenSnapshot, { reset, recordInbound: jest.fn() }, [good], checkpoint,replayRun);
        expect(result[0]).toBe(good);
        expect(result[1]).toMatchObject({ error: 'customer_simulator_failed:provider timeout', judge: null, turns: 1 });
        expect(result[1].transcript).toHaveLength(2);
        expect(agentTest.test).toHaveBeenCalledTimes(1);
        expect(reset).toHaveBeenCalledTimes(1);
        expect(checkpoint).toHaveBeenCalledWith(result);
    });

    it('keeps simulator failure distinct from the explicit end token', async () => {
        const { service, llm } = simulation();
        llm.execute.mockResolvedValueOnce({ content: '[FIN]' }).mockResolvedValueOnce({ content: '' });
        const authority = async (invoke: any) => invoke();
        await expect((service as any).nextCustomerMessage('tenant', scenario('one'), [], authority)).resolves.toBe('[FIN]');
        await expect((service as any).nextCustomerMessage('tenant', scenario('one'), [], authority)).rejects.toThrow('customer_simulator_failed');
        expect(llm.execute.mock.calls[0][0].systemPrompt).toContain('idioma fr');
    });

    it('counts failed, absent and newly false claims as regressions even with a higher judge score', async () => {
        const { service, prisma } = simulation();
        const base = ['failed', 'missing', 'false'].map(key => ({ ...scenario(key), judge, transcript: [], turns: 1, latencyMs: 1 }));
        prisma.executeInTenantSchema.mockResolvedValue([{ results: base, avg_score: 8 }]);
        const results = [{ ...base[0], judge: null, error: 'timeout' }, { ...base[2], judge: { ...judge, overall: 10 }, falseClaims: [{ turn: 1, reply: 'confirmed' }] }];
        const summary = await (service as any).buildSummary('schema', results, 'baseline');
        expect(summary).toMatchObject({ total: 2, scored: 1, failed: 1, complete: false, falseClaimCount: 1 });
        expect(summary.baseline.regressions.map((row: any) => row.reason).sort()).toEqual(['new_false_claim', 'scenario_failed', 'scenario_missing']);
    });
});

describe('sandbox ownership lease', () => {
    function fixture() {
        const redis = { acquireLockToken: jest.fn().mockResolvedValue('owner'), renewLockToken: jest.fn().mockResolvedValue(true), releaseLockToken: jest.fn().mockResolvedValue(true) };
        const service = new EvalService({} as any, {} as any, {} as any, redis as any, { emit: jest.fn() } as any);
        return { redis, service };
    }
    it('rejects a busy or unavailable lock before running sandbox work', async () => {
        const { redis, service } = fixture(); const work = jest.fn();
        redis.acquireLockToken.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('redis unavailable'));
        await expect((service as any).withSandboxLease('tenant', work)).rejects.toThrow('already_running');
        await expect((service as any).withSandboxLease('tenant', work)).rejects.toThrow('redis unavailable');
        expect(work).not.toHaveBeenCalled();
    });
    it('stops after losing ownership and releases only its own token', async () => {
        const { redis, service } = fixture(); redis.renewLockToken.mockResolvedValue(false);
        await expect((service as any).withSandboxLease('tenant', async (assert: any) => assert())).rejects.toThrow('lease_lost');
        expect(redis.releaseLockToken).toHaveBeenCalledWith('eval-gate-run:tenant', 'owner');
    });
    it('requires a strict majority when pass-k is even', async () => {
        const { service } = fixture();
        jest.spyOn(service as any, 'runScenarioWithActions').mockResolvedValueOnce({ passed: true, score: 8 }).mockResolvedValueOnce({ passed: false, score: 6 });
        const result = await (service as any).runPassK('tenant', 'agent', 'schema', scenario('one'), 2, 'majority', 7, false);
        expect(result.passed).toBe(false);
        expect(result.runs).toHaveLength(2);
    });
});
