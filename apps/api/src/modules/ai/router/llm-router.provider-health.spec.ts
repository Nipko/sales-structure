import { LLMRouterService } from './llm-router.service';

/**
 * ADR-0026. El 8-nov OpenAI respondio "429 You have no credits remaining" mas
 * de 5.000 veces: el router lo trataba como un rate limit pasajero, no lo
 * sacaba de rotacion y nadie se enteraba. Un proveedor sin credito tiene que
 * salir de rotacion al primer error, y el turno servido por el respaldo tiene
 * que contarse como fallback.
 */
function createRouter(failing: Record<string, any>) {
    const calls: string[] = [];
    const providers = ['openai', 'anthropic', 'google', 'xai', 'deepseek'].map(providerName => ({
        providerName,
        generate: jest.fn(async (req: any) => {
            calls.push(`${providerName}/${req.model}`);
            if (failing[providerName]) throw failing[providerName];
            return { content: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
        }),
    }));
    const store = new Map<string, string>();
    const redis = {
        get: jest.fn(async (k: string) => store.get(k) ?? null),
        set: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
        del: jest.fn(async (k: string) => { store.delete(k); }),
        acquireLock: jest.fn(async () => true),
        incrBy: jest.fn(async () => 1),
        expire: jest.fn(async () => undefined),
        lrange: jest.fn(async () => []),
        getClient: () => ({ lrange: async () => [] }),
    };
    const health = {
        recordFailure: jest.fn(async () => (failing.openai?.status === 429 ? 'quota' : 'unavailable')),
        recordSuccess: jest.fn(async () => undefined),
        recordRouting: jest.fn(async () => undefined),
    };
    const router = new LLMRouterService(
        providers as any,
        redis as any,
        { isConfigured: jest.fn(async () => true) } as any,
        { emit: jest.fn() } as any,
        undefined,
        health as any,
    );
    return { router, calls, store, health };
}

const noCredits = Object.assign(new Error('429 You have no credits remaining.'), { status: 429 });

describe('LLM router — salud de proveedores', () => {
    it('un error de credito saca al proveedor de rotacion de inmediato y el turno cuenta como fallback', async () => {
        const { router, calls, store, health } = createRouter({ openai: noCredits });
        const req = { task: 'tool_calling' as const, messages: [{ role: 'user' as const, content: 'hola' }], systemPrompt: 'x' };

        await router.execute(req);
        // Un solo intento contra la cuenta sin credito, no uno por cada modelo de OpenAI.
        expect(calls).toEqual(['openai/gpt-4.1-mini', 'xai/grok-4-1-fast-non-reasoning']);
        expect(store.get('llm:health:openai:open')).toBeDefined();
        expect(health.recordFailure).toHaveBeenCalledWith('openai', 'gpt-4.1-mini', noCredits, 'traffic');
        expect(health.recordRouting).toHaveBeenLastCalledWith('xai', true);

        // Siguiente turno: OpenAI ya no se intenta, y sigue contando como fallback.
        calls.length = 0;
        await router.execute(req);
        expect(calls.every(c => !c.startsWith('openai/'))).toBe(true);
        expect(health.recordRouting).toHaveBeenLastCalledWith('xai', true);
    });

    it('un turno atendido por el modelo preferido no es fallback', async () => {
        const { router, health } = createRouter({});
        await router.execute({ task: 'tool_calling', messages: [{ role: 'user', content: 'hola' }], systemPrompt: 'x' });
        expect(health.recordRouting).toHaveBeenLastCalledWith('openai', false);
        expect(health.recordSuccess).toHaveBeenCalledWith('openai', 'gpt-4.1-mini', 'traffic');
    });
});
