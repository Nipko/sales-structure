import { matchSafetyBackstop, SAFETY_CLASSES, SAFETY_TEMPLATES } from '@parallext/shared';
import {
    buildSafetyClassifierRequest,
    decideSafetyTriage,
    parseSafetyClassifierOutput,
    runSafetyTriage,
    type SafetyTriageTurnIo,
} from './safety-triage';
import { LLMRouterService } from '../../ai/router/llm-router.service';

const dental = SAFETY_CLASSES.dental_acute;
const verdict = (redFlag: boolean) => ({ redFlag, safetyClass: redFlag ? dental.key : null, confidence: 0.9, evidence: '' });
const noMatch = { flags: [] as string[], suppressedByHistory: false };

describe('safety classifier output', () => {
    it('builds a temperature-0 strict-JSON classify request from the class data', () => {
        const request = buildSafetyClassifierRequest(dental, 'se me hinchó la cara');
        expect(request).toMatchObject({ task: 'classify', temperature: 0, jsonMode: true });
        for (const flag of dental.redFlags) expect(request.systemPrompt).toContain(flag.key);
        expect(request.messages[0].content).toContain('se me hinchó la cara');
    });

    it.each([
        ['{"redFlag":true,"safetyClass":"dental_acute","confidence":0.93,"evidence":"se me hinchó la cara"}', true, 0.93],
        ['```json\n{"redFlag":false,"safetyClass":null,"confidence":0.8,"evidence":""}\n```', false, 0.8],
        ['Sure: {"redFlag": true, "confidence": "0.7"}', true, 0.7],
        ['{"redFlag":true,"confidence":7}', true, 1],
    ])('accepts %s', (raw, redFlag, confidence) => {
        expect(parseSafetyClassifierOutput(raw, dental)).toMatchObject({ redFlag, confidence });
    });

    it('pins a positive verdict to the business class, whatever class the model named', () => {
        expect(parseSafetyClassifierOutput('{"redFlag":true,"safetyClass":"pet_emergency","confidence":1}', dental)?.safetyClass).toBe('dental_acute');
    });

    it.each([
        '', 'no', '{"redFlag":"yes"}', '{"safetyClass":"dental_acute"}', '[true]', '{not json}', null, undefined, 42,
    ])('treats %p as a failure, never as a "no"', raw => {
        expect(parseSafetyClassifierOutput(raw as any, dental)).toBeNull();
    });

    it('bounds the evidence it keeps', () => {
        const parsed = parseSafetyClassifierOutput(JSON.stringify({ redFlag: true, confidence: 1, evidence: 'x'.repeat(1000) }), dental);
        expect(parsed?.evidence.length).toBeLessThanOrEqual(160);
    });
});

describe('the term backstop only escalates', () => {
    const hit = matchSafetyBackstop('se me hinchó la cara', dental);

    it('a classifier yes stays a yes without any term', () => {
        expect(decideSafetyTriage(verdict(true), noMatch, dental)).toMatchObject({ action: 'escalate', source: 'classifier' });
    });
    it('a classifier no plus a term hit escalates', () => {
        expect(decideSafetyTriage(verdict(false), hit, dental)).toMatchObject({ action: 'escalate', source: 'backstop' });
    });
    it('a classifier no and no term stays quiet', () => {
        expect(decideSafetyTriage(verdict(false), noMatch, dental)).toMatchObject({ action: 'none', source: 'none' });
    });
    it('an unavailable classifier plus a term hit adds the footer', () => {
        expect(decideSafetyTriage(null, hit, dental)).toMatchObject({ action: 'footer', source: 'backstop', classifierStatus: 'unavailable' });
    });
    it('an unavailable classifier and no term does nothing', () => {
        expect(decideSafetyTriage(null, noMatch, dental)).toMatchObject({ action: 'none', classifierStatus: 'unavailable' });
    });
    it('no combination ever lowers an escalation', () => {
        for (const v of [verdict(true), verdict(false), null]) {
            const without = decideSafetyTriage(v, noMatch, dental).action;
            const withHit = decideSafetyTriage(v, hit, dental).action;
            const rank = { none: 0, footer: 1, escalate: 2 } as const;
            expect(rank[withHit]).toBeGreaterThanOrEqual(rank[without]);
        }
    });
});

describe('runSafetyTriage', () => {
    function io(overrides: Partial<SafetyTriageTurnIo> & { content?: string } = {}) {
        const calls = {
            enabled: jest.fn().mockResolvedValue(true),
            classify: jest.fn().mockResolvedValue({ content: overrides.content ?? '{"redFlag":true,"safetyClass":"dental_acute","confidence":0.9,"evidence":"cara"}' }),
            escalate: jest.fn().mockResolvedValue('opened'),
            trace: jest.fn(), signal: jest.fn(), warn: jest.fn(),
        };
        return Object.assign(calls, overrides);
    }
    const input = { text: 'se me hinchó la cara', industry: 'salud', subType: 'dental', language: 'es', country: 'CO' };

    it('does nothing for a business without a safety class (not even reading the flag)', async () => {
        const deps = io();
        expect(await runSafetyTriage({ ...input, industry: 'restaurantes', subType: 'comida_rapida' }, deps)).toBeNull();
        expect(deps.enabled).not.toHaveBeenCalled();
        expect(deps.classify).not.toHaveBeenCalled();
    });

    it('does nothing when the flag is off', async () => {
        const deps = io({ enabled: jest.fn().mockResolvedValue(false) });
        expect(await runSafetyTriage(input, deps)).toBeNull();
        expect(deps.classify).not.toHaveBeenCalled();
    });

    it('on a red flag replies with the urgency template, opens a priority handoff, traces and signals', async () => {
        const deps = io();
        const outcome = await runSafetyTriage(input, deps);
        expect(outcome?.reply).toContain('al 123');
        expect(outcome?.reply).toContain(SAFETY_TEMPLATES['handoff.priority_notice'].es);
        expect(deps.escalate).toHaveBeenCalledWith('safety_red_flag:dental_acute:priority=urgent');
        expect(deps.signal).toHaveBeenCalledWith('safety_red_flag_escalated');
        expect(deps.trace).toHaveBeenCalledWith(expect.objectContaining({ action: 'escalate', source: 'classifier', safetyClass: 'dental_acute',
            handoff: 'opened', bookingMayContinue: false, templateReview: 'pending_clinical_review' }));
        // The customer's words never reach the trace.
        expect(JSON.stringify(deps.trace.mock.calls)).not.toContain('hinchó');
    });

    it('never promises a person when the handoff could not be opened', async () => {
        const deps = io({ escalate: jest.fn().mockRejectedValue(new Error('queue down')) });
        const outcome = await runSafetyTriage(input, deps);
        expect(outcome?.handoff).toBe('failed');
        expect(outcome?.reply).not.toContain(SAFETY_TEMPLATES['handoff.priority_notice'].es);
        expect(outcome?.reply).toContain('urgencias');
        expect(deps.signal).toHaveBeenCalledWith('safety_handoff_not_opened');
    });

    it('retries one unparseable answer, then treats the classifier as unavailable', async () => {
        const deps = io({ content: 'not json' });
        const outcome = await runSafetyTriage(input, deps);
        expect(deps.classify).toHaveBeenCalledTimes(2);
        // Unavailable classifier + term hit: footer on the normal reply and a deferred handoff, no takeover.
        expect(outcome?.decision.action).toBe('footer');
        expect(outcome?.reply).toBeUndefined();
        expect(outcome?.footer).toContain('al 123');
        expect(outcome?.deferredHandoffReason).toBe('safety_red_flag:dental_acute:priority=urgent:unverified');
        expect(deps.escalate).not.toHaveBeenCalled();
        expect(deps.signal).toHaveBeenCalledWith('safety_classifier_unavailable');
    });

    it('a provider failure is unavailable (no retry: the router already walked its chain), and without a term nothing happens', async () => {
        const deps = io({ classify: jest.fn().mockRejectedValue(new Error('all providers failed')) });
        const outcome = await runSafetyTriage({ ...input, text: 'quiero blanqueamiento' }, deps);
        expect(deps.classify).toHaveBeenCalledTimes(1);
        expect(outcome?.decision).toMatchObject({ action: 'none', classifierStatus: 'unavailable' });
        expect(outcome?.footer).toBeUndefined();
    });

    it('the backstop escalates over a classifier "no"', async () => {
        const deps = io({ content: '{"redFlag":false,"safetyClass":null,"confidence":0.6,"evidence":""}' });
        const outcome = await runSafetyTriage(input, deps);
        expect(outcome?.decision).toMatchObject({ action: 'escalate', source: 'backstop' });
        expect(deps.signal).toHaveBeenCalledWith('safety_backstop_escalated');
    });
});

describe('LLM router classify role', () => {
    function router(configured = ['openai', 'anthropic', 'google', 'xai', 'deepseek']) {
        const calls: Array<{ provider: string; model: string; temperature?: number; jsonMode?: boolean }> = [];
        const providers = ['openai', 'anthropic', 'google', 'xai', 'deepseek'].map(providerName => ({
            providerName,
            generate: jest.fn(async (req: any) => { calls.push({ provider: providerName, model: req.model, temperature: req.temperature, jsonMode: req.jsonMode });
                return { content: '{}', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }; }),
        }));
        const store = new Map<string, string>();
        const redis = { get: jest.fn(async (k: string) => store.get(k) ?? null), set: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
            del: jest.fn(), acquireLock: jest.fn(async () => true), lpush: jest.fn(), lrange: jest.fn(async () => []), ltrim: jest.fn(), expire: jest.fn() };
        const instance = new LLMRouterService(providers as any, redis as any, { isConfigured: jest.fn(async (p: string) => configured.includes(p)) } as any, { emit: jest.fn() } as any);
        return { instance, calls, store };
    }

    it('leads with a cheap JSON-capable model, passes temperature 0 and JSON mode, and leaves no affinity behind', async () => {
        const { instance, calls, store } = router();
        await instance.execute({ ...buildSafetyClassifierRequest(dental, 'hola'), tenantId: 't', traceContext: { conversationId: 'c' },
            routingFactors: { ticketValue: 100, complexity: 100, conversationStage: 100, sentiment: 100, intentType: 100 } });
        expect(calls[0]).toEqual({ provider: 'openai', model: 'gpt-4o-mini', temperature: 0, jsonMode: true });
        expect([...store.keys()].some(key => key.startsWith('llm:affinity:'))).toBe(false);
    });

    it('ignores a sticky model a conversation turn left behind', async () => {
        const { instance, calls, store } = router();
        store.set('llm:affinity:c:classify', 'anthropic:claude-sonnet-4-6');
        await instance.execute({ ...buildSafetyClassifierRequest(dental, 'hola'), traceContext: { conversationId: 'c' } });
        expect(calls[0].model).toBe('gpt-4o-mini');
    });

    it('falls through the fixed chain when the cheapest provider is not configured', async () => {
        const { instance, calls } = router(['xai', 'anthropic']);
        await instance.execute({ ...buildSafetyClassifierRequest(dental, 'hola') });
        expect(calls[0].model).toBe('grok-4-1-fast-non-reasoning');
    });
});
