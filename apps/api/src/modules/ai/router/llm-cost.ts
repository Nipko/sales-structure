/**
 * Precio de una llamada LLM a partir de lo que el proveedor dice que consumió (ADR-0027).
 *
 * Hasta el 9-nov-2026 todo el texto de entrada se cobraba a precio completo.
 * Del 16-sep al 8-nov OpenAI facturó $99,39 y la plataforma estimó $169,89
 * para las mismas solicitudes: el 52 % de la entrada había salido de la caché
 * de prompts, que OpenAI cobra al 25 %. Ese mismo número alimenta el tope
 * blando y el tope duro de cada tenant, así que la sobreestimación bajaba de
 * modelo o callaba a agentes que tenían dinero sin gastar.
 *
 * Convención: `promptTokens` es SIEMPRE toda la entrada, con caché o sin ella.
 * `cachedPromptTokens` y `cacheWritePromptTokens` dicen qué parte de ese total
 * se cobró a otra tarifa. Cada proveedor se normaliza aquí, en un solo lugar.
 */

export interface LLMUsage {
    /** Toda la entrada: tokens frescos + leídos de caché + escritos en caché. */
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** Parte de `promptTokens` leída de la caché del proveedor. */
    cachedPromptTokens?: number;
    /** Parte de `promptTokens` escrita en caché (Anthropic y OpenAI GPT-5.6+ la cobran con recargo). */
    cacheWritePromptTokens?: number;
}

export interface LLMRates {
    costInPer1k: number;
    costOutPer1k: number;
    /** Entrada leída de caché. Sin dato, se cobra como entrada normal: nunca se inventa un descuento. */
    costCachedInPer1k?: number;
    /** Entrada escrita en caché. Sin dato, se cobra como entrada normal. */
    costCacheWritePer1k?: number;
}

const count = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

export interface PromptSplit { fresh: number; cached: number; cacheWrite: number }

/**
 * Reparte la entrada entre sus tres tarifas. Un proveedor que reporte más
 * caché que entrada (no debería) no puede volver negativa la parte fresca:
 * se recorta, y lo que sobra se trata como caché, nunca al revés.
 */
export function splitPromptTokens(usage: Pick<LLMUsage, 'promptTokens' | 'cachedPromptTokens' | 'cacheWritePromptTokens'>): PromptSplit {
    const total = count(usage.promptTokens);
    const cached = Math.min(total, count(usage.cachedPromptTokens));
    const cacheWrite = Math.min(total - cached, count(usage.cacheWritePromptTokens));
    return { fresh: total - cached - cacheWrite, cached, cacheWrite };
}

/** USD de una llamada a tarifa de catálogo. */
export function usageCostUsd(rates: LLMRates, usage: LLMUsage | undefined): number {
    if (!usage) return 0;
    const { fresh, cached, cacheWrite } = splitPromptTokens(usage);
    return (fresh / 1000) * rates.costInPer1k
        + (cached / 1000) * (rates.costCachedInPer1k ?? rates.costInPer1k)
        + (cacheWrite / 1000) * (rates.costCacheWritePer1k ?? rates.costInPer1k)
        + (count(usage.completionTokens) / 1000) * rates.costOutPer1k;
}

/**
 * OpenAI, xAI y DeepSeek (API compatible con OpenAI).
 * - OpenAI y xAI: `prompt_tokens_details.cached_tokens`, incluido en `prompt_tokens`.
 * - OpenAI GPT-5.6+/GPT-6: además `prompt_tokens_details.cache_write_tokens`,
 *   también incluido en `prompt_tokens` y cobrado a 1,25× la entrada (ADR-0029;
 *   visto en la API real el 9-nov-2026: 1.206 de entrada, 1.203 escritos).
 * - DeepSeek: `prompt_cache_hit_tokens` (+ `prompt_cache_miss_tokens` = `prompt_tokens`).
 */
export function usageFromOpenAICompatible(raw: any): LLMUsage | undefined {
    if (!raw) return undefined;
    const cached = raw.prompt_tokens_details?.cached_tokens ?? raw.prompt_cache_hit_tokens;
    const written = raw.prompt_tokens_details?.cache_write_tokens;
    return {
        promptTokens: raw.prompt_tokens,
        completionTokens: raw.completion_tokens,
        totalTokens: raw.total_tokens,
        ...(count(cached) > 0 ? { cachedPromptTokens: count(cached) } : {}),
        ...(count(written) > 0 ? { cacheWritePromptTokens: count(written) } : {}),
    };
}

/**
 * Anthropic informa la entrada en tres campos que NO se solapan:
 * `input_tokens` (después del último punto de caché), `cache_read_input_tokens`
 * y `cache_creation_input_tokens`. Antes se tomaba sólo el primero, así que la
 * lectura de caché ni siquiera se contaba.
 */
export function usageFromAnthropic(raw: any): LLMUsage {
    const fresh = count(raw?.input_tokens);
    const cached = count(raw?.cache_read_input_tokens);
    const cacheWrite = count(raw?.cache_creation_input_tokens);
    const output = count(raw?.output_tokens);
    const promptTokens = fresh + cached + cacheWrite;
    return {
        promptTokens,
        completionTokens: output,
        totalTokens: promptTokens + output,
        ...(cached > 0 ? { cachedPromptTokens: cached } : {}),
        ...(cacheWrite > 0 ? { cacheWritePromptTokens: cacheWrite } : {}),
    };
}

/** Gemini: `cachedContentTokenCount` va incluido en `promptTokenCount`. */
export function usageFromGemini(meta: any): LLMUsage | undefined {
    if (!meta) return undefined;
    const cached = count(meta.cachedContentTokenCount);
    return {
        promptTokens: meta.promptTokenCount,
        completionTokens: (meta.candidatesTokenCount ?? 0) + (Number(meta.thoughtsTokenCount) || 0),
        totalTokens: meta.totalTokenCount,
        ...(cached > 0 ? { cachedPromptTokens: cached } : {}),
    };
}
