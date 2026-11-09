import { LlmProviderProbeService, LLM_PROBE_DRILL_KEY } from './llm-provider-probe.service';
import { LlmProviderHealthService, LLM_PROVIDER_HEALTH_ALERT_EVENT } from './llm-provider-health.service';

/**
 * ADR-0026. La sonda tiene que ver el caso del 8-nov sin tráfico: la clave en
 * uso es válida pero la cuenta no tiene crédito. OpenAI responde 429 con
 * `insufficient_quota`, el mismo código que un límite de velocidad.
 */
class FakeRedis {
    store = new Map<string, string>();
    hashes = new Map<string, Record<string, string>>();
    async get(k: string) { return this.store.get(k) ?? null; }
    async set(k: string, v: string) { this.store.set(k, v); }
    async del(k: string) { this.store.delete(k); }
    async getDel(k: string) { const v = this.store.get(k) ?? null; this.store.delete(k); return v; }
    async acquireLock(k: string) { if (this.store.has(k)) return false; this.store.set(k, '1'); return true; }
    async hincrBy(k: string, f: string, by: number) { const h = this.hashes.get(k) ?? {}; h[f] = String(Number(h[f] ?? 0) + by); this.hashes.set(k, h); return Number(h[f]); }
    async hgetall(k: string) { return { ...(this.hashes.get(k) ?? {}) }; }
    async expire() { /* noop */ }
}

const OPENAI_NO_CREDITS = {
    error: {
        message: 'You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.',
        type: 'insufficient_quota',
        param: null,
        code: 'insufficient_quota',
    },
};

function setup(keys: Record<string, string>, respond: (url: string, init: any) => { status: number; body: unknown }) {
    const redis = new FakeRedis();
    const alerts: any[] = [];
    const events = { emit: (e: string, p: any) => { if (e === LLM_PROVIDER_HEALTH_ALERT_EVENT) alerts.push(p); return true; } };
    const health = new LlmProviderHealthService(redis as any, events as any);
    const calls: Array<{ url: string; auth: string }> = [];
    jest.spyOn(global, 'fetch' as any).mockImplementation((async (url: string, init: any) => {
        calls.push({ url, auth: init?.headers?.Authorization ?? init?.headers?.['x-api-key'] ?? '' });
        const r = respond(url, init);
        return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json', 'openai-organization': 'architerin', 'openai-project': 'proj_test' } });
    }) as any);
    const probe = new LlmProviderProbeService(
        health,
        { getKey: async (p: string) => keys[p] } as any,
        redis as any,
        { runExclusive: async (_n: string, _t: number, fn: () => Promise<void>) => fn() } as any,
        { get: () => undefined } as any,
    );
    return { probe, health, redis, alerts, calls };
}

describe('LlmProviderProbeService', () => {
    beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => undefined));
    afterEach(() => jest.restoreAllMocks());

    it('clave en uso sin crédito: sin_creditos, aviso crítico y fuera de rotación, sin tráfico', async () => {
        const { probe, health, redis, alerts, calls } = setup({ openai: 'sk-real' }, () => ({ status: 429, body: OPENAI_NO_CREDITS }));
        await probe.runOnce();
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
        const state = await health.getState('openai');
        expect(state).toMatchObject({ status: 'no_credits', lastErrorKind: 'quota', lastErrorSource: 'probe', lastErrorModel: 'gpt-4o-mini' });
        expect(alerts.filter(a => !a.resolveOnly).map(a => [a.key, a.severity])).toEqual([['llm:provider:openai:no_credits', 'critical']]);
        expect(redis.store.get('llm:health:openai:open')).toBeDefined();
        // Qué cuenta factura la clave en uso queda a la vista.
        expect(redis.store.get('llm:provider:account:openai')).toBe('architerin / proj_test');

        // Siguiente pasada: sigue sin crédito, sin aviso nuevo (el recordatorio es cada 6 h).
        await probe.runOnce();
        expect(alerts.filter(a => !a.resolveOnly)).toHaveLength(1);
    });

    it('al recargar, la sonda lo devuelve a rotación y avisa la recuperación', async () => {
        let credits = false;
        const { probe, health, redis, alerts } = setup({ openai: 'sk-real' }, () => (credits
            ? { status: 200, body: { choices: [{ message: { content: 'p' } }] } }
            : { status: 429, body: OPENAI_NO_CREDITS }));
        await probe.runOnce();
        credits = true;
        await probe.runOnce();
        expect((await health.getState('openai')).status).toBe('healthy');
        expect(redis.store.get('llm:health:openai:open')).toBeUndefined();
        expect(alerts.some(a => a.key === 'llm:provider:openai:recovered' && !a.resolveOnly)).toBe(true);
    });

    it('simulacro: usa una clave inválida fija, nunca la real, y no toca al proveedor real', async () => {
        const { probe, health, redis, alerts, calls } = setup({}, () => ({ status: 401, body: { error: { message: 'Incorrect API key provided: sk-parallext-drill-***', code: 'invalid_api_key' } } }));
        await redis.set(LLM_PROBE_DRILL_KEY, 'openai');
        await probe.runOnce();
        expect(calls).toHaveLength(1);
        expect(calls[0].auth).toMatch(/^Bearer sk-parallext-drill-invalid-key/);
        expect((await health.getState('drill:openai')).status).toBe('auth_invalid');
        expect((await health.getState('openai')).status).toBe('unknown');
        expect(alerts[0]).toMatchObject({ key: 'llm:provider:drill:openai:auth_invalid', drill: true });
        expect(redis.store.has(LLM_PROBE_DRILL_KEY)).toBe(false);
    });
});
