import { withAgentSourceFence } from './agent-source-fence';

const fixture = () => {
    const query = jest.fn().mockResolvedValue([]);
    const prisma = { transactionInTenantSchema: jest.fn(async (_schema, work) => work(query)) };
    return { prisma: prisma as any, query };
};
describe('Private source-fence composition', () => {
    it('uses one transaction and shared lock while executing every nested source check', async () => {
        const { prisma, query } = fixture();
        const checks: string[] = [];
        const result = await withAgentSourceFence(prisma, 'tenant_source', async outer => {
            checks.push('outer-before');
            return withAgentSourceFence(prisma, 'tenant_source', async inner => {
                expect(inner).toBe(outer);
                checks.push('inner-before', 'invoke', 'inner-after');
                return 'answer';
            }).then(answer => { checks.push('outer-after'); return answer; });
        });
        expect(result).toBe('answer');
        expect(checks).toEqual(['outer-before', 'inner-before', 'invoke', 'inner-after', 'outer-after']);
        expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][1]).toEqual(['agent-privacy:tenant_source']);
    });
    it('rejects a nested tenant or connection owner change before invoking its callback', async () => {
        const { prisma } = fixture(), foreign = fixture().prisma, invoke = jest.fn();
        await withAgentSourceFence(prisma, 'tenant_source', async () => {
            await expect(withAgentSourceFence(prisma, 'tenant_foreign', invoke)).rejects.toThrow('agent_source_fence_scope_mismatch');
            await expect(withAgentSourceFence(foreign, 'tenant_source', invoke)).rejects.toThrow('agent_source_fence_scope_mismatch');
        });
        expect(invoke).not.toHaveBeenCalled();
        expect(foreign.transactionInTenantSchema).not.toHaveBeenCalled();
    });
    it('keeps concurrent requests in independent transactions', async () => {
        const { prisma } = fixture();
        await Promise.all(['tenant_first', 'tenant_second'].map(schema =>
            withAgentSourceFence(prisma, schema, async () => withAgentSourceFence(prisma, schema, async () => schema))));
        expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(2);
    });
    it('does not retain a failed transaction for the next independent attempt', async () => {
        const { prisma } = fixture();
        await expect(withAgentSourceFence(prisma, 'tenant_source', async () => { throw new Error('provider_failed'); }))
            .rejects.toThrow('provider_failed');
        await expect(withAgentSourceFence(prisma, 'tenant_source', async () => 'retry')).resolves.toBe('retry');
        expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(2);
    });
    it('rejects detached continuations after their source transaction has closed', async () => {
        const { prisma } = fixture();
        let resume!: () => void, detached!: Promise<unknown>;
        const gate = new Promise<void>(resolve => { resume = resolve; });
        await withAgentSourceFence(prisma, 'tenant_source', async () => {
            detached = gate.then(() => withAgentSourceFence(prisma, 'tenant_source', async () => 'late'));
        });
        resume();
        await expect(detached).rejects.toThrow('agent_source_fence_expired');
        expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
    });
    it('invalidates a still-running callback as soon as its transaction rejects', async () => {
        const { prisma, query } = fixture();
        let resume!: () => void, entered!: () => void, pending!: Promise<unknown>;
        const gate = new Promise<void>(resolve => { resume = resolve; });
        const ready = new Promise<void>(resolve => { entered = resolve; });
        const invoke = jest.fn();
        prisma.transactionInTenantSchema.mockImplementation(async (_schema: string, work: (query: any) => Promise<unknown>) => {
            pending = work(query);
            pending.catch(() => undefined);
            await ready;
            throw new Error('transaction_timeout');
        });
        await expect(withAgentSourceFence(prisma, 'tenant_source', async () => {
            entered();
            await gate;
            return withAgentSourceFence(prisma, 'tenant_source', invoke);
        })).rejects.toThrow('transaction_timeout');
        resume();
        await expect(pending).rejects.toThrow('agent_source_fence_expired');
        expect(invoke).not.toHaveBeenCalled();
        expect(prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
    });
});
