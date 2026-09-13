import { LLM_MODEL_CATALOGUE, LLMRouterService } from './llm-router.service';

function harness(execResult: Array<[Error | null, unknown]> | null = []) {
    const calls: Array<[string, ...unknown[]]> = [];
    const transaction: any = {
        incrby: (key: string, value: number) => { calls.push(['incrby', key, value]); return transaction; },
        sadd: (key: string, value: string) => { calls.push(['sadd', key, value]); return transaction; },
        expire: (key: string, value: number) => { calls.push(['expire', key, value]); return transaction; },
        exec: jest.fn().mockResolvedValue(execResult),
    };
    const redis = { getClient: () => ({ multi: () => transaction }) };
    const router = new LLMRouterService([], redis as any, {} as any, {} as any);
    return { router, transaction, calls };
}

describe('LLM accounting transaction', () => {
    const model = LLM_MODEL_CATALOGUE.find(candidate => candidate.id === 'gpt-4o-mini')!;

    it('commits the monthly guard, daily counters, indexes and retention together', async () => {
        const { router, transaction, calls } = harness([]);

        await (router as any).trackStats(
            'tenant-1', model, 125, { promptTokens: 1_000, completionTokens: 500 }, false,
        );

        expect(transaction.exec).toHaveBeenCalledTimes(1);
        expect(calls).toEqual(expect.arrayContaining([
            ['incrby', expect.stringMatching(/^llm:stats:tenant-1:\d{4}-\d{2}-\d{2}:openai:calls$/), 1],
            ['incrby', expect.stringMatching(/^llm:stats:tenant-1:\d{4}-\d{2}-\d{2}:openai:cost_centi_usd$/), 5],
            ['incrby', expect.stringMatching(/^llm:cost:tenant-1:\d{4}-\d{2}$/), 5],
            ['expire', expect.stringMatching(/^llm:stats:tenants:\d{4}-\d{2}-\d{2}$/), 90 * 24 * 3600],
            ['expire', expect.stringMatching(/^llm:stats:providers:\d{4}-\d{2}-\d{2}$/), 90 * 24 * 3600],
            ['expire', expect.stringMatching(/^llm:cost:tenant-1:\d{4}-\d{2}$/), 40 * 24 * 3600],
        ]));
    });

    it('surfaces a command rejected inside EXEC instead of reporting successful accounting', async () => {
        const rejected = new Error('monthly accumulator is read-only');
        const { router } = harness([[null, 1], [rejected, null]]);

        await expect((router as any).trackStats(
            'tenant-1', model, 125, { promptTokens: 10, completionTokens: 10 }, false,
        )).rejects.toBe(rejected);
    });

    it('surfaces a discarded transaction', async () => {
        const { router } = harness(null);

        await expect((router as any).trackStats(
            'tenant-1', model, 125, { promptTokens: 10, completionTokens: 10 }, true,
        )).rejects.toThrow('discarded');
    });
});
