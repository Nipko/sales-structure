import {
    splitPromptTokens, usageCostUsd, usageFromAnthropic, usageFromGemini, usageFromOpenAICompatible,
} from './llm-cost';
import { activeLlmCatalog } from './llm-catalog';
import { LLMRouterService } from './llm-router.service';
import { modelCostMicro } from './llm-spend-guard.service';
import { callCostUsd } from '../../conversations/agent-turn-session';

const model = (id: string) => activeLlmCatalog().models.find(m => m.id === id)!;

describe('Caché de prompts en el costo LLM (ADR-0027)', () => {
    describe('normalización por proveedor', () => {
        it('OpenAI / xAI: cached_tokens es parte de prompt_tokens', () => {
            expect(usageFromOpenAICompatible({
                prompt_tokens: 10_000, completion_tokens: 200, total_tokens: 10_200,
                prompt_tokens_details: { cached_tokens: 5_200 },
            })).toEqual({ promptTokens: 10_000, completionTokens: 200, totalTokens: 10_200, cachedPromptTokens: 5_200 });
        });

        it('OpenAI GPT-5.6+/GPT-6: cache_write_tokens, también dentro de prompt_tokens (respuesta real del 9-nov)', () => {
            expect(usageFromOpenAICompatible({
                prompt_tokens: 1_206, completion_tokens: 34, total_tokens: 1_240,
                prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 1_203, audio_tokens: 0 },
            })).toEqual({ promptTokens: 1_206, completionTokens: 34, totalTokens: 1_240, cacheWritePromptTokens: 1_203 });
            const luna = activeLlmCatalog().models.find(m => m.id === 'gpt-6-luna')!;
            // 3 frescos a $0,10/M + 1.203 escritos a $0,125/M + 34 de salida a $0,50/M.
            expect(usageCostUsd(luna, { promptTokens: 1_206, completionTokens: 34, totalTokens: 1_240, cacheWritePromptTokens: 1_203 }))
                .toBeCloseTo((3 * 0.10 + 1_203 * 0.125 + 34 * 0.50) / 1e6, 12);
        });

        it('DeepSeek: prompt_cache_hit_tokens', () => {
            expect(usageFromOpenAICompatible({
                prompt_tokens: 3_000, completion_tokens: 50, total_tokens: 3_050,
                prompt_cache_hit_tokens: 2_048, prompt_cache_miss_tokens: 952,
            })?.cachedPromptTokens).toBe(2_048);
        });

        it('sin caché no inventa el campo, y sin usage no hay usage', () => {
            expect(usageFromOpenAICompatible({ prompt_tokens: 10, completion_tokens: 2, total_tokens: 12,
                prompt_tokens_details: { cached_tokens: 0 } })).toEqual({ promptTokens: 10, completionTokens: 2, totalTokens: 12 });
            expect(usageFromOpenAICompatible(undefined)).toBeUndefined();
        });

        it('Anthropic: suma las tres partes de la entrada, que no se solapan', () => {
            expect(usageFromAnthropic({
                input_tokens: 300, cache_read_input_tokens: 9_000, cache_creation_input_tokens: 700, output_tokens: 150,
            })).toEqual({
                promptTokens: 10_000, completionTokens: 150, totalTokens: 10_150,
                cachedPromptTokens: 9_000, cacheWritePromptTokens: 700,
            });
        });

        it('Gemini: cachedContentTokenCount va dentro de promptTokenCount', () => {
            expect(usageFromGemini({ promptTokenCount: 4_000, cachedContentTokenCount: 1_000,
                candidatesTokenCount: 80, thoughtsTokenCount: 20, totalTokenCount: 4_100 }))
                .toEqual({ promptTokens: 4_000, completionTokens: 100, totalTokens: 4_100, cachedPromptTokens: 1_000 });
        });
    });

    it('un proveedor que reporta más caché que entrada no vuelve negativa la parte fresca', () => {
        expect(splitPromptTokens({ promptTokens: 100, cachedPromptTokens: 150, cacheWritePromptTokens: 30 }))
            .toEqual({ fresh: 0, cached: 100, cacheWrite: 0 });
    });

    it('gpt-6-luna: la entrada en caché cuesta el 10 % (ADR-0029)', () => {
        const rates = model('gpt-6-luna');
        const full = usageCostUsd(rates, { promptTokens: 1_000_000, completionTokens: 0, totalTokens: 0 });
        const cached = usageCostUsd(rates, { promptTokens: 1_000_000, completionTokens: 0, totalTokens: 0, cachedPromptTokens: 1_000_000 });
        expect(full).toBeCloseTo(0.10, 10);
        expect(cached).toBeCloseTo(0.01, 10);
    });

    it('con 52 % de caché, la estimación baja como bajó la factura de OpenAI', () => {
        // 16-sep → 8-nov: facturado $99,39, estimado $169,89 a precio completo. Tarifas de
        // gpt-4.1-mini, que salió del catálogo el 9-nov (ADR-0029): el caso es histórico.
        const rates = { costInPer1k: 0.0004, costOutPer1k: 0.0016, costCachedInPer1k: 0.0001 };
        const usage = { promptTokens: 100_000, completionTokens: 1_000, totalTokens: 101_000 };
        const before = usageCostUsd(rates, usage);
        const after = usageCostUsd(rates, { ...usage, cachedPromptTokens: 52_000 });
        expect(after / before).toBeCloseTo((48_000 * 0.4 + 52_000 * 0.1 + 1_000 * 1.6) / (100_000 * 0.4 + 1_000 * 1.6), 10);
        expect(after).toBeLessThan(before * 0.63); // 0,625; la factura real quedó en 0,585
    });

    it('cada modelo del catálogo declara precio de caché, menor que la entrada', () => {
        for (const m of activeLlmCatalog().models) {
            expect(m.costCachedInPer1k).toBeGreaterThan(0);
            expect(m.costCachedInPer1k!).toBeLessThan(m.costInPer1k);
        }
    });

    it('un modelo sin precio de caché la cobra completa (no se inventa un descuento)', () => {
        const rates = { costInPer1k: 0.001, costOutPer1k: 0.002 };
        expect(usageCostUsd(rates, { promptTokens: 1_000, completionTokens: 0, totalTokens: 0, cachedPromptTokens: 1_000 }))
            .toBeCloseTo(0.001, 12);
    });

    it('Anthropic cobra la escritura en caché con recargo', () => {
        const rates = model('claude-sonnet-5-5');
        expect(usageCostUsd(rates, { promptTokens: 1_000, completionTokens: 0, totalTokens: 0, cacheWritePromptTokens: 1_000 }))
            .toBeCloseTo(0.0025, 12);
    });

    it('el guardián descuenta la caché en micro-USD', () => {
        const price = model('gpt-6-luna');
        expect(modelCostMicro(price, 10_000, 0)).toBeGreaterThanOrEqual(1_000);
        expect(modelCostMicro(price, 10_000, 0)).toBeLessThanOrEqual(1_001);
        expect(modelCostMicro(price, 10_000, 0, 10_000)).toBeGreaterThanOrEqual(100);
        expect(modelCostMicro(price, 10_000, 0, 10_000)).toBeLessThanOrEqual(101);
        expect(() => modelCostMicro(price, 10, 0, -1)).toThrow();
    });

    it('la traza de pruebas del agente también descuenta la caché', () => {
        // Un snapshot con fecha se cobra como su modelo base.
        expect(callCostUsd('gpt-6-luna-2026-05-18', 1_000_000, 0, 1_000_000)).toBeCloseTo(0.01, 10);
        expect(callCostUsd('gpt-6-luna', 1_000_000, 0)).toBeCloseTo(0.10, 10);
    });

    it('el router cuenta tokens en caché y cobra la caché a su tarifa', async () => {
        const calls: Array<[string, ...unknown[]]> = [];
        const transaction: any = {
            incrby: (k: string, v: number) => { calls.push(['incrby', k, v]); return transaction; },
            sadd: () => transaction,
            expire: () => transaction,
            exec: jest.fn().mockResolvedValue([]),
        };
        const router = new LLMRouterService([], { getClient: () => ({ multi: () => transaction }) } as any, {} as any, {} as any);
        await (router as any).trackStats('tenant-1', model('gpt-6-luna'), 10,
            { promptTokens: 100_000, completionTokens: 0, totalTokens: 100_000, cachedPromptTokens: 100_000 }, false);
        // 100k tokens en caché × $0,01/M = $0,001 = 10 centi-USD (a precio completo serían 100).
        expect(calls).toEqual(expect.arrayContaining([
            ['incrby', expect.stringMatching(/:openai:cost_centi_usd$/), 10],
            ['incrby', expect.stringMatching(/^llm:cost:tenant-1:/), 10],
            ['incrby', expect.stringMatching(/:openai:tokens_cached$/), 100_000],
        ]));
    });
});
