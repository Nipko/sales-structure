import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { LLMRouterService } from './llm-router.service';
import { OpenAIProvider } from '../providers/openai.provider';
import { DeepSeekProvider } from '../providers/deepseek.provider';
import { XAIProvider } from '../providers/xai.provider';
import { AnthropicProvider } from '../providers/anthropic.provider';
import { LLMSourceAuthorityUnavailable, type LLMSourceAuthority } from '../interfaces/llm-source-authority';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../../common/types/execution-context';

const entries = [
    { Provider: OpenAIProvider, model: 'gpt-4o-mini' },
    { Provider: DeepSeekProvider, model: 'deepseek-chat' },
    { Provider: XAIProvider, model: 'grok-4-1-fast-non-reasoning' },
    { Provider: AnthropicProvider, model: 'claude-sonnet-4-6' },
];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'retry-after-ms': '1' },
});

/** Real providers + router + installed SDKs; only HTTP transport is synthetic. */
function fixture(entry: typeof entries[number]) {
    const provider = new entry.Provider({} as any);
    const success = () => provider.providerName === 'anthropic'
        ? json({ id: 'synthetic', type: 'message', role: 'assistant', model: entry.model,
            content: [{ type: 'text', text: 'Verified answer' }], stop_reason: 'end_turn', usage: { input_tokens: 9, output_tokens: 3 } })
        : json({ id: 'synthetic', object: 'chat.completion', model: entry.model,
            choices: [{ index: 0, message: { role: 'assistant', content: 'Verified answer' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 } });
    const fetch = jest.fn(async (_url: any, _options: any) => success());
    const sdkOptions = { apiKey: 'synthetic-test-key', maxRetries: 1, timeout: 45000, fetch: fetch as any };
    const client = provider.providerName === 'anthropic' ? new Anthropic(sdkOptions) : new OpenAI(sdkOptions);
    jest.spyOn(provider as any, 'ensureClient').mockResolvedValue(client);
    jest.spyOn((provider as any).logger, 'error').mockImplementation(() => undefined);
    const events = { emit: jest.fn() };
    const router = new LLMRouterService([provider], {} as any, {} as any, events as any);
    const candidate = { id: entry.model, provider: provider.providerName, tier: 'tier_2_standard',
        costPer1kTokens: .01, costInPer1k: .01, costOutPer1k: .01, maxContextTokens: 128000, supportsTools: true };
    jest.spyOn(router as any, 'buildCandidates').mockResolvedValue([candidate]);
    for (const method of ['log', 'warn', 'debug']) jest.spyOn((router as any).logger, method).mockImplementation(() => undefined);
    const breaker = jest.spyOn(router as any, 'markProviderFailure').mockResolvedValue(undefined);
    const state = { valid: true };
    const authority: LLMSourceAuthority = jest.fn(async invoke => {
        if (!state.valid) throw new LLMSourceAuthorityUnavailable();
        const response = await invoke();
        if (!state.valid) throw new LLMSourceAuthorityUnavailable(response.usage);
        return response;
    });
    const run = (mode: string, guarded = true) => router.execute({ messages: [{ role: 'user', content: 'Historical input' }],
        ...(mode === 'task' ? { task: 'conversation' as const } : { model: entry.model }),
        executionContext: AGENT_TEST_EXECUTION_CONTEXT, ...(guarded ? { withSourceAuthority: authority } : {}) });
    return { provider, fetch, success, authority, state, run, events, breaker };
}

describe.each(entries)('Source transport through $Provider.name', entry => {
    afterEach(() => jest.restoreAllMocks());
    it.each(['task', 'direct'])('revalidates %s transport after failure instead of allowing an internal SDK retry', async mode => {
        const f = fixture(entry);
        f.fetch.mockImplementationOnce(async () => {
            f.state.valid = false;
            return json({ error: { type: 'overloaded_error', message: 'Temporary overload' } }, 503);
        });
        await expect(f.run(mode)).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(f.fetch).toHaveBeenCalledTimes(1);
        expect(f.authority).toHaveBeenCalledTimes(2);
        expect(f.breaker).not.toHaveBeenCalled(); expect(f.events.emit).not.toHaveBeenCalled();
    });
    it.each(['task', 'direct'])('retains a valid %s retry with a fresh source check and no internal fields in HTTP input', async mode => {
        const f = fixture(entry);
        f.fetch.mockResolvedValueOnce(json({ error: { type: 'overloaded_error', message: 'Temporary overload' } }, 503));
        expect((await f.run(mode)).content).toBe('Verified answer');
        expect(f.fetch).toHaveBeenCalledTimes(2); expect(f.authority).toHaveBeenCalledTimes(2);
        const bodies = f.fetch.mock.calls.map(call => JSON.parse(call[1].body));
        expect(JSON.stringify(bodies)).not.toMatch(/authority|maxRetries|workerToken|releaseId/);
    });
    it('preserves the SDK retry policy for ordinary requests without a historical source scope', async () => {
        const f = fixture(entry);
        f.fetch.mockResolvedValueOnce(json({ error: { type: 'overloaded_error', message: 'Temporary overload' } }, 503));
        expect((await f.run('direct', false)).content).toBe('Verified answer');
        expect(f.fetch).toHaveBeenCalledTimes(2); expect(f.authority).not.toHaveBeenCalled();
    });
    it('does not retry a permanent authentication failure', async () => {
        const f = fixture(entry);
        f.fetch.mockResolvedValue(json({ error: { type: 'authentication_error', message: 'Invalid synthetic key' } }, 401));
        await expect(f.run('direct')).rejects.toMatchObject({ status: 401 });
        expect(f.fetch).toHaveBeenCalledTimes(1); expect(f.authority).toHaveBeenCalledTimes(1);
    });
    it('revalidates after a connection failure and limits repeated transient failures to two sends', async () => {
        const f = fixture(entry);
        f.fetch.mockRejectedValue(new Error('Synthetic connection failure'));
        await expect(f.run('direct')).rejects.toThrow();
        expect(f.fetch).toHaveBeenCalledTimes(2); expect(f.authority).toHaveBeenCalledTimes(2);
    });
});
