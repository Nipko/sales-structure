import { SimulationService } from './simulation.service';
import { EvalService } from './eval.service';
import { evaluationSnapshot } from '../conversations/agent-evaluation-snapshot';

const scenario = (key: string) => ({ key, title: key, source: 'replay', language: 'fr', goal: 'support', openingMessage: 'bonjour', replayMessages: ['bonjour', 'oui'] });
const judge = { overall: 8, resolved: true, tone: 8, accuracy: 8, empathy: 8, resolution: 8, flags: [] };

function simulation() {
    const prisma = { executeInTenantSchema: jest.fn().mockResolvedValue([]) };
    const agentTest = { test: jest.fn().mockResolvedValue({ reply: 'Comment puis-je vous aider?', debug: { toolCalls: [] } }) };
    const llm = { execute: jest.fn() };
    const quality = { judgeTranscript: jest.fn().mockResolvedValue(judge) };
    const service = new SimulationService(prisma as any, {} as any, llm as any, {} as any, quality as any, agentTest as any, {} as any, { emit: jest.fn() } as any);
    return { service, prisma, agentTest, llm, quality };
}

describe('simulation execution fidelity', () => {
    it('passes the same frozen revision, actual channel and owned tool sandbox through every turn', async () => {
        const { service, agentTest } = simulation();
        const snapshot = evaluationSnapshot('tenant', 'agent', { version: 9, config_json: { language: 'fr' } });
        const session = { sandboxContactId: 'sandbox', sandboxConversationId: 'conversation', recordInbound: jest.fn(), assertLease: jest.fn(), reset: jest.fn() };
        await (service as any).runScenario('tenant', 'agent', 'instagram', scenario('one'), snapshot, session);
        expect(agentTest.test).toHaveBeenCalledTimes(2);
        for (const call of agentTest.test.mock.calls as any[]) {
            expect(call[2].channelType).toBe('instagram');
            expect(call[3]).toMatchObject({ disableTools: false, evalMode: true, agentSnapshot: snapshot, sandboxConversationId: 'conversation', beforeToolExecution: session.assertLease });
        }
        expect(session.recordInbound.mock.calls).toEqual([['bonjour'], ['oui']]);
    });

    it('preserves partial evidence when customer generation fails and retries only failed scenarios', async () => {
        const { service, agentTest, llm } = simulation();
        llm.execute.mockRejectedValue(new Error('provider timeout'));
        const synthetic = { ...scenario('broken'), source: 'synthetic' };
        const good = { ...scenario('done'), transcript: [], turns: 1, latencyMs: 1, judge };
        const reset = jest.fn(); const checkpoint = jest.fn();
        const result = await (service as any).runScenariosConcurrently('tenant', 'agent', 'telegram', [scenario('done'), synthetic], undefined, { reset, recordInbound: jest.fn() }, [good], checkpoint);
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
        await expect((service as any).nextCustomerMessage('tenant', scenario('one'), [])).resolves.toBe('[FIN]');
        await expect((service as any).nextCustomerMessage('tenant', scenario('one'), [])).rejects.toThrow('customer_simulator_failed');
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
