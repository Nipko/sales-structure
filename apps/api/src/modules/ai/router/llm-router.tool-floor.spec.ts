import { LLM_MODEL_CATALOGUE, LLMRouterService, partitionByPlan } from './llm-router.service';

/**
 * Which model leads a tool-calling turn, and who gets to change it.
 *
 * The value score reads ticket value, sentiment and complexity off the CURRENT
 * message. The message that closes a sale is "sí": it scores ~19, which pushed
 * the turn holding the booking down to the cheapest model in the chain — and
 * then affinity pinned that model to the whole conversation for half an hour,
 * including every later turn that had to pick a tool and fill its arguments.
 */

const conversationId = '33333333-3333-4333-8333-333333333333';

function createRouter(opts: { configured?: string[]; failing?: string[] } = {}) {
    const configured = new Set(opts.configured || ['openai', 'anthropic', 'google', 'xai', 'deepseek']);
    const calls: Array<{ provider: string; model: string }> = [];
    const makeProvider = (providerName: string) => ({
        providerName,
        generate: jest.fn(async (req: any) => {
            calls.push({ provider: providerName, model: req.model });
            if (opts.failing?.includes(providerName)) throw Object.assign(new Error('upstream down'), { status: 503 });
            return { content: 'ok', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
        }),
    });
    const providers = ['openai', 'anthropic', 'google', 'xai', 'deepseek'].map(makeProvider);
    const redisStore = new Map<string, string>();
    const redis = {
        get: jest.fn(async (k: string) => redisStore.get(k) ?? null),
        set: jest.fn(async (k: string, v: string) => { redisStore.set(k, v); }),
        del: jest.fn(),
        acquireLock: jest.fn(async () => true),
        lpush: jest.fn(),
        lrange: jest.fn(async () => []),
        ltrim: jest.fn(),
        expire: jest.fn(async () => 1),
        incrBy: jest.fn(async () => 1),
        incr: jest.fn(async () => 1),
    };
    const router = new LLMRouterService(
        providers as any,
        redis as any,
        { isConfigured: jest.fn(async (p: string) => configured.has(p)) } as any,
        { emit: jest.fn() } as any,
    );
    return { router, calls, redisStore };
}

// A "sí": no ticket value, no complexity, closing stage — the composite that
// used to select the budget tier.
const CONFIRMATION_FACTORS = {
    ticketValue: 10, complexity: 0, conversationStage: 45, sentiment: 50, intentType: 25,
};

describe('LLM router — tool-calling floor', () => {
    it('does not hand a tool-calling turn to the budget tier because the message is short', async () => {
        const { router, calls } = createRouter();

        await router.execute({
            task: 'tool_calling',
            messages: [{ role: 'user', content: 'sí' }],
            systemPrompt: 'x',
            tools: [{ name: 'create_property_booking', description: 'd', parameters: {} }] as any,
            routingFactors: CONFIRMATION_FACTORS as any,
            allowedTiers: ['tier_4_budget'],
            // The «sí» that closes a sale: the server sees a proposal waiting for it (ADR-0028).
            writeInPlay: true,
            traceContext: { conversationId },
        });

        expect(calls[0].model).not.toBe('deepseek-flash');
    });

    it('still lets the budget circuit breaker win', async () => {
        const { router, calls } = createRouter();

        await router.execute({
            task: 'tool_calling',
            messages: [{ role: 'user', content: 'sí' }],
            systemPrompt: 'x',
            tools: [{ name: 'create_property_booking', description: 'd', parameters: {} }] as any,
            routingFactors: CONFIRMATION_FACTORS as any,
            allowedTiers: ['tier_4_budget'],
            budgetConstrained: true,
            traceContext: { conversationId },
        });

        // Over budget the agent keeps replying on whatever is cheapest: a weaker
        // answer beats no answer.
        expect(calls[0].model).toBe('deepseek-flash');
    });

    it('keeps value-routing for plain conversation turns', async () => {
        const { router, calls } = createRouter();

        await router.execute({
            task: 'conversation',
            messages: [{ role: 'user', content: 'hola' }],
            systemPrompt: 'x',
            routingFactors: CONFIRMATION_FACTORS as any,
            allowedTiers: ['tier_3_efficient', 'tier_4_budget'],
            traceContext: { conversationId },
        });

        expect(calls).toHaveLength(1);
    });
});

describe('LLM router — affinity is per task', () => {
    it('does not let the greeting model pin the tool-calling turn', async () => {
        const { router, redisStore } = createRouter();

        await router.execute({
            task: 'conversation',
            messages: [{ role: 'user', content: 'hola' }],
            systemPrompt: 'x',
            allowedTiers: ['tier_3_efficient', 'tier_4_budget'],
            traceContext: { conversationId },
        });

        const keys = [...redisStore.keys()];
        expect(keys).toContain(`llm:affinity:${conversationId}:conversation`);
        expect(keys).not.toContain(`llm:affinity:${conversationId}`);
    });

    it('reuses the affinity of the SAME task on the next turn', async () => {
        const { router, redisStore, calls } = createRouter();

        await router.execute({
            task: 'tool_calling',
            messages: [{ role: 'user', content: 'quiero reservar' }],
            systemPrompt: 'x',
            tools: [{ name: 'create_property_booking', description: 'd', parameters: {} }] as any,
            allowedTiers: ['tier_2_standard', 'tier_3_efficient', 'tier_4_budget'],
            traceContext: { conversationId },
        });
        const first = calls[0];
        expect(redisStore.get(`llm:affinity:${conversationId}:tool_calling`))
            .toBe(`${first.provider}:${first.model}`);

        await router.execute({
            task: 'tool_calling',
            messages: [{ role: 'user', content: 'sí' }],
            systemPrompt: 'x',
            tools: [{ name: 'create_property_booking', description: 'd', parameters: {} }] as any,
            allowedTiers: ['tier_2_standard', 'tier_3_efficient', 'tier_4_budget'],
            traceContext: { conversationId },
        });
        expect(calls[1]).toEqual(first);
    });
});

describe('LLM router — pinned model inside one turn', () => {
    it('keeps the tool loop on the model that made the first decision', async () => {
        const { router, calls } = createRouter();

        await router.execute({
            task: 'tool_calling',
            messages: [{ role: 'user', content: 'quiero reservar' }],
            systemPrompt: 'x',
            tools: [{ name: 'create_property_booking', description: 'd', parameters: {} }] as any,
            allowedTiers: ['tier_1_premium', 'tier_2_standard'],
            pinnedModel: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
            traceContext: { conversationId },
        });

        expect(calls[0]).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
    });

    it('ignores a pin the tenant cannot reach instead of failing the turn', async () => {
        // Provider not configured: the pin simply is not among the candidates.
        const { router, calls } = createRouter({ configured: ['openai'] });

        await router.execute({
            task: 'tool_calling',
            messages: [{ role: 'user', content: 'quiero reservar' }],
            systemPrompt: 'x',
            tools: [{ name: 'create_property_booking', description: 'd', parameters: {} }] as any,
            allowedTiers: ['tier_2_standard'],
            pinnedModel: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
            traceContext: { conversationId },
        });

        expect(calls[0].provider).toBe('openai');
    });
});

const TOOLS = [{ name: 'search_catalog', description: 'd', parameters: {} }] as any;

describe('LLM router — the plan bounds the tool-calling floor (ADR-0028)', () => {
    it('Emprendedor: a tool turn with no write in play stays on the plan model', async () => {
        const { router, calls } = createRouter();
        await router.execute({
            task: 'tool_calling', messages: [{ role: 'user', content: '¿tienen talla M?' }], systemPrompt: 'x',
            tools: TOOLS, allowedTiers: ['tier_4_budget'], traceContext: { conversationId },
        });
        expect(calls[0].model).toBe('deepseek-flash');
    });

    it('Starter: no tool-capable model in tier_3, so the plan tier_4 leads, not tier_2', async () => {
        const { router, calls } = createRouter();
        await router.execute({
            task: 'tool_calling', messages: [{ role: 'user', content: 'busco un hotel' }], systemPrompt: 'x',
            tools: TOOLS, allowedTiers: ['tier_3_efficient', 'tier_4_budget'], traceContext: { conversationId },
        });
        expect(calls[0].model).toBe('deepseek-flash');
    });

    it('a model outside the plan is still the last resort when the plan model fails', async () => {
        const { router, calls } = createRouter({ failing: ['deepseek'] });
        await router.execute({
            task: 'tool_calling', messages: [{ role: 'user', content: '¿tienen talla M?' }], systemPrompt: 'x',
            tools: TOOLS, allowedTiers: ['tier_4_budget'], traceContext: { conversationId },
        });
        expect(calls[0].model).toBe('deepseek-flash');
        expect(calls[1]).toBeDefined();
        expect(calls[1].provider).not.toBe('deepseek');
    });

    it('affinity to a model outside the plan (left by an escalation) does not pin later turns', async () => {
        const { router, calls, redisStore } = createRouter();
        redisStore.set(`llm:affinity:${conversationId}:tool_calling`, 'openai:gpt-6-luna');
        await router.execute({
            task: 'tool_calling', messages: [{ role: 'user', content: '¿y en azul?' }], systemPrompt: 'x',
            tools: TOOLS, allowedTiers: ['tier_4_budget'], traceContext: { conversationId },
        });
        expect(calls[0].model).toBe('deepseek-flash');
    });

    it('a turn voicing a committed write may still lead above the plan', async () => {
        const { router, calls } = createRouter();
        await router.execute({
            task: 'tool_calling', messages: [{ role: 'user', content: 'listo' }], systemPrompt: 'x',
            tools: TOOLS, allowedTiers: ['tier_4_budget'], voicedWrite: true, traceContext: { conversationId },
        });
        expect(calls[0].model).not.toBe('deepseek-flash');
    });

    it('Pro keeps leading with tier_2 on any tool turn (no change inside the plan)', async () => {
        const { router, calls } = createRouter();
        await router.execute({
            task: 'tool_calling', messages: [{ role: 'user', content: '¿tienen talla M?' }], systemPrompt: 'x',
            tools: TOOLS, allowedTiers: ['tier_2_standard', 'tier_3_efficient', 'tier_4_budget'], traceContext: { conversationId },
        });
        expect(LLM_MODEL_CATALOGUE.find(m => m.id === calls[0].model)?.tier).toBe('tier_2_standard');
    });

    it('partitionByPlan is stable inside each group', () => {
        const c = [
            { id: 'a', tier: 'tier_2_standard' as const }, { id: 'b', tier: 'tier_4_budget' as const },
            { id: 'c', tier: 'tier_1_premium' as const }, { id: 'd', tier: 'tier_4_budget' as const },
        ];
        expect(partitionByPlan(c, ['tier_4_budget']).map(x => x.id)).toEqual(['b', 'd', 'a', 'c']);
        expect(partitionByPlan(c, ['tier_1_premium', 'tier_2_standard', 'tier_4_budget'])).toBe(c);
    });
});
