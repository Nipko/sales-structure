import { LlmProviderHealthService, LLM_PROVIDER_HEALTH_ALERT_EVENT, LlmProviderHealthAlert } from './llm-provider-health.service';

class FakeRedis {
    store = new Map<string, string>();
    hashes = new Map<string, Record<string, string>>();
    async get(k: string) { return this.store.get(k) ?? null; }
    async set(k: string, v: string) { this.store.set(k, v); }
    async del(k: string) { this.store.delete(k); }
    async acquireLock(k: string) {
        if (this.store.has(k)) return false;
        this.store.set(k, '1');
        return true;
    }
    async hincrBy(k: string, f: string, by: number) {
        const h = this.hashes.get(k) ?? {};
        h[f] = String(Number(h[f] ?? 0) + by);
        this.hashes.set(k, h);
        return Number(h[f]);
    }
    async hgetall(k: string) { return { ...(this.hashes.get(k) ?? {}) }; }
    async expire() { /* noop */ }
}

function setup() {
    const redis = new FakeRedis();
    const emitted: Array<{ event: string; payload: any }> = [];
    const events = { emit: (event: string, payload: any) => { emitted.push({ event, payload }); return true; } };
    const svc = new LlmProviderHealthService(redis as any, events as any);
    const alerts = () => emitted.filter(e => e.event === LLM_PROVIDER_HEALTH_ALERT_EVENT).map(e => e.payload as LlmProviderHealthAlert);
    const sent = () => alerts().filter(a => !a.resolveOnly);
    return { redis, svc, emitted, alerts, sent };
}

const noCredits = { status: 429, message: '429 You have no credits remaining. Add credits to continue using the API.' };

describe('LlmProviderHealthService', () => {
    beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => undefined));
    afterEach(() => jest.restoreAllMocks());

    it('5.000 errores de credito producen UN aviso critico, no 5.000', async () => {
        const { svc, sent, emitted } = setup();
        for (let i = 0; i < 50; i++) await svc.recordFailure('openai', 'gpt-4.1-mini', noCredits, 'traffic');
        const outage = sent();
        expect(outage).toHaveLength(1);
        expect(outage[0]).toMatchObject({ key: 'llm:provider:openai:no_credits', severity: 'critical' });
        expect(outage[0].html).toContain('no credits remaining');
        // Toast en vivo para admins conectados (gateway existente).
        expect(emitted.filter(e => e.event === 'llm.provider.alert')).toHaveLength(1);
    });

    it('cuenta errores por proveedor, modelo y tipo', async () => {
        const { svc, redis } = setup();
        await svc.recordFailure('openai', 'gpt-4.1-mini', noCredits, 'traffic');
        await svc.recordFailure('openai', 'gpt-4o-mini', noCredits, 'traffic');
        await svc.recordFailure('openai', 'gpt-4o-mini', { status: 429, message: 'Rate limit reached' }, 'traffic');
        const day = new Date().toISOString().slice(0, 10);
        expect(await redis.hgetall(`llm:provider:errors:${day}`)).toEqual({
            'openai|gpt-4.1-mini|quota': '1',
            'openai|gpt-4o-mini|quota': '1',
            'openai|gpt-4o-mini|rate_limit': '1',
        });
    });

    it('recuperacion: avisa, cierra el incidente y re-arma el aviso para una recaida', async () => {
        const { svc, sent, alerts } = setup();
        await svc.recordFailure('openai', 'm', noCredits, 'traffic');
        await svc.recordSuccess('openai', 'm', 'probe');
        const recovery = sent().find(a => a.key === 'llm:provider:openai:recovered');
        expect(recovery).toBeDefined();
        expect(recovery!.noIncident).toBe(true);
        expect(recovery!.resolveKeys).toEqual(expect.arrayContaining(['llm:provider:openai:no_credits']));
        expect((await svc.getState('openai')).status).toBe('healthy');

        // Recaida: el gate en Redis se libero; el guard local de 5 min tambien.
        await svc.recordFailure('openai', 'm', noCredits, 'traffic');
        expect(alerts().filter(a => a.key === 'llm:provider:openai:no_credits' && !a.resolveOnly)).toHaveLength(2);
    });

    it('rate limit y errores sueltos no avisan; tres caidas seguidas si', async () => {
        const { svc, sent } = setup();
        await svc.recordFailure('xai', 'g', { status: 429, message: 'rate limit' }, 'traffic');
        await svc.recordFailure('xai', 'g', { status: 503, message: 'unavailable' }, 'traffic');
        expect(sent()).toHaveLength(0);
        expect((await svc.getState('xai')).status).toBe('degraded');
        await svc.recordFailure('xai', 'g', { status: 503, message: 'unavailable' }, 'traffic');
        await svc.recordFailure('xai', 'g', { status: 503, message: 'unavailable' }, 'traffic');
        expect(sent().map(a => a.key)).toEqual(['llm:provider:xai:down']);
    });

    it('un modelo retirado avisa una vez y no toca la salud del proveedor', async () => {
        const { svc, sent } = setup();
        await svc.recordSuccess('google', 'gemini-2.5-flash', 'traffic');
        for (let i = 0; i < 3; i++) await svc.recordFailure('google', 'gemini-2.5-pro', { status: 404, message: 'model is no longer available' }, 'traffic');
        expect(sent().map(a => a.key)).toEqual(['llm:model:gemini-2.5-pro:not_found']);
        expect((await svc.getState('google')).status).toBe('healthy');
    });

    it('simulacro: avisa marcado como simulacro y no toca al proveedor real', async () => {
        const { svc, sent } = setup();
        await svc.recordSuccess('openai', 'm', 'traffic');
        await svc.recordFailure('drill:openai', 'gpt-4o-mini', { status: 401, message: '401 Incorrect API key provided' }, 'probe');
        const [a] = sent();
        expect(a).toMatchObject({ key: 'llm:provider:drill:openai:auth_invalid', drill: true, severity: 'warning' });
        expect(a.subject).toContain('[SIMULACRO]');
        expect((await svc.getState('openai')).status).toBe('healthy');
    });

    it('% de fallback por ventana y aviso deduplicado', async () => {
        const { svc, sent } = setup();
        for (let i = 0; i < 8; i++) await svc.recordRouting('openai', false);
        for (let i = 0; i < 4; i++) await svc.recordRouting('xai', true);
        const w = await svc.routingWindow(15);
        expect(w).toMatchObject({ total: 12, fallback: 4, pct: 33.3, byServedProvider: { xai: 4 } });
        await svc.checkFallbackShare();
        await svc.checkFallbackShare();
        expect(sent().filter(a => a.key === 'llm:fallback')).toHaveLength(1);
    });

    it('saldo bajo avisa una vez; saldo sano lo resuelve', async () => {
        const { svc, sent, alerts } = setup();
        await svc.recordBalance('deepseek', { amount: 1.5, currency: 'USD', at: 1 }, 5);
        await svc.recordBalance('deepseek', { amount: 1.2, currency: 'USD', at: 2 }, 5);
        expect(sent().filter(a => a.key === 'llm:provider:deepseek:low_balance')).toHaveLength(1);
        await svc.recordBalance('deepseek', { amount: 20, currency: 'USD', at: 3 }, 5);
        expect(alerts().some(a => a.resolveOnly && a.resolveKeys?.includes('llm:provider:deepseek:low_balance'))).toBe(true);
    });

    it('snapshot: estado, ultimo error y conteos del dia', async () => {
        const { svc } = setup();
        await svc.recordFailure('openai', 'gpt-4.1-mini', noCredits, 'traffic');
        await svc.recordRouting('xai', true);
        const snap = await svc.snapshot({ openai: true, xai: true });
        const openai = snap.providers.find(p => p.provider === 'openai')!;
        expect(openai).toMatchObject({ configured: true, status: 'no_credits', statusLabel: 'sin creditos', lastErrorKind: 'quota', errorsToday: { quota: 1 } });
        expect(snap.providers.find(p => p.provider === 'anthropic')!.configured).toBe(false);
        expect(snap.routing.lastHour).toMatchObject({ total: 1, fallback: 1, pct: 100 });
    });
});
