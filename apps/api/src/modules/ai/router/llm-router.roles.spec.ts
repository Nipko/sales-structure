import { roleModel } from './llm-catalog';
import { LLMRouterService } from './llm-router.service';

// ADR-0030 §3: los servicios piden un rol y el router usa su cabeza en la versión activa.
function harness() {
    const sent: Array<{ provider: string; model: string }> = [];
    const provider = (name: string) => ({
        providerName: name,
        generate: jest.fn(async (opts: { model: string }) => {
            sent.push({ provider: name, model: opts.model });
            return { content: 'ok', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
        }),
    });
    const transaction: any = { incrby: () => transaction, sadd: () => transaction, expire: () => transaction, exec: async () => [] };
    const redis = { getClient: () => ({ multi: () => transaction, get: async () => null, mget: async () => [] }) };
    const keys = { isConfigured: async () => true };
    const events = { emit: jest.fn() };
    const router = new LLMRouterService(
        ['openai', 'deepseek', 'google', 'xai', 'anthropic'].map(provider) as any, redis as any, keys as any, events as any,
    );
    return { router, sent };
}

describe('LLMRouterService · roles del catálogo', () => {
    it('sin task ni model, un rol se resuelve a la cabeza del rol', async () => {
        const { router, sent } = harness();
        await router.execute({ role: 'aux_reasoning', messages: [{ role: 'user', content: 'hola' }] });
        await router.execute({ role: 'aux_cheap', messages: [{ role: 'user', content: 'hola' }] });
        expect(sent).toEqual([
            { provider: 'openai', model: roleModel('aux_reasoning') },
            { provider: 'deepseek', model: roleModel('aux_cheap') },
        ]);
    });

    it('un model explícito gana sobre el rol', async () => {
        const { router, sent } = harness();
        await router.execute({ role: 'aux_cheap', model: 'gpt-6-sol', messages: [{ role: 'user', content: 'hola' }] });
        expect(sent).toEqual([{ provider: 'openai', model: 'gpt-6-sol' }]);
    });

    it('getModels devuelve una copia de la versión activa', () => {
        const { router } = harness();
        const models = router.getModels();
        expect(models.map(m => m.id)).toContain(roleModel('aux_reasoning'));
        models.pop();
        expect(router.getModels().length).toBe(models.length + 1);
    });
});
