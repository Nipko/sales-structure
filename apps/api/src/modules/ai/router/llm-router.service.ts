import { LlmSpendGuardService, LlmBudgetExceeded, LlmBudgetUnavailable } from './llm-spend-guard.service';
import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ModelTier, RoutingFactors, RoutingDecision } from '@parallext/shared';
import { ILLMProvider, LLMRequestOptions, LLMResponse } from '../interfaces/illm-provider.interface';
import { LLMSourceAuthorityUnavailable, type LLMSourceAuthority } from '../interfaces/llm-source-authority';
import { generateWithSourceAuthority } from './llm-source-attempt';
import { RedisService } from '../../redis/redis.service';
import {
    ACCOUNT_FAILURE_BREAKER_SEC, LlmProviderHealthService, llmBreakerOpenKey,
} from '../health/llm-provider-health.service';
import { LlmKeyService } from '../../settings/llm-key.service';
import { splitPromptTokens, usageCostUsd } from './llm-cost';
import type { ServiceExecutionContext } from '../../../common/types/execution-context';
import {
    operationalUsageAccountingEnabled,
    persistenceDisabled,
} from '../../../common/types/execution-context';

/**
 * - `conversation` / `tool_calling`: the reply of a turn.
 * - `classify`: a short, strict-JSON, temperature-0 judgement that runs BEFORE
 *   the reply (the health safety triage today). It never decides tools and
 *   never writes, so it takes a fixed cheap chain: no value-based reordering,
 *   no tool-calling floor and no sticky affinity — the same message must reach
 *   the same model whatever the conversation did before.
 */
export type TaskType = 'conversation' | 'tool_calling' | 'classify';

export interface ModelConfig {
    id: string;
    provider: string;
    tier: ModelTier;
    /** Blended display rate (USD per 1k tokens). Kept for routing-decision display. */
    costPer1kTokens: number;
    /** Real input/output rates (USD per 1k tokens) — used for accurate cost tracking. */
    costInPer1k: number;
    costOutPer1k: number;
    /**
     * Entrada leída de la caché de prompts del proveedor (ADR-0027). Sin este
     * dato la caché se cobra a precio completo: el 52 % de la entrada de
     * sep–nov 2026 era caché y la estimación quedó 71 % por encima de la factura.
     */
    costCachedInPer1k?: number;
    /** Entrada escrita en caché; sólo Anthropic la cobra aparte (1,25× la entrada). */
    costCacheWritePer1k?: number;
    maxContextTokens: number;
    supportsTools: boolean;
}

// Rates are USD per 1k tokens (provider list price / 1000), input vs output
// separated because output is typically 3-5× input. Update when providers
// change pricing. costPer1kTokens is a rough blended figure for display only.
/**
 * The one catalogue. Anything that needs to know what a model costs — the
 * router at runtime, a certification plan that has to state a maximum spend
 * before anyone authorises it — reads THIS, because a second copy of a price
 * list is a price list that will be wrong on the day it matters.
 */
const MODEL_REGISTRY: ModelConfig[] = [
    // Catálogo migrado el 9-nov-2026 (ADR-0029). Precios de lista verificados ese día en la página
    // oficial de cada proveedor, USD por 1k tokens. Caché con la convención de ADR-0027: lectura en
    // `costCachedInPer1k`; escritura en `costCacheWritePer1k` sólo donde se cobra aparte (OpenAI
    // GPT-5.6+/GPT-6 y Anthropic, 1,25× la entrada a 30 min / 5 min).
    //
    // Tier 1 — Premium (enterprise/custom).
    { id: 'gpt-6-sol', provider: 'openai', tier: 'tier_1_premium', costPer1kTokens: 0.006, costInPer1k: 0.002, costOutPer1k: 0.010, costCachedInPer1k: 0.0002, costCacheWritePer1k: 0.0025, maxContextTokens: 1050000, supportsTools: true },
    // Sin clave de Anthropic en la plataforma (9-nov-2026): no medido, va al final de cada cadena.
    { id: 'claude-sonnet-5-5', provider: 'anthropic', tier: 'tier_1_premium', costPer1kTokens: 0.006, costInPer1k: 0.002, costOutPer1k: 0.010, costCachedInPer1k: 0.0001, costCacheWritePer1k: 0.0025, maxContextTokens: 1000000, supportsTools: true },
    // xAI no tiene hoy un modelo barato: grok-4.3 es el más barato de su lista ($1,25/$0,20/$2,50 por M
    // bajo 200k de prompt). Es el respaldo de otro proveedor cuando OpenAI y DeepSeek caen.
    { id: 'grok-4.3', provider: 'xai', tier: 'tier_1_premium', costPer1kTokens: 0.001875, costInPer1k: 0.00125, costOutPer1k: 0.0025, costCachedInPer1k: 0.0002, maxContextTokens: 200000, supportsTools: true },
    // Tier 2 — Standard (pro).
    { id: 'gpt-6-luna', provider: 'openai', tier: 'tier_2_standard', costPer1kTokens: 0.0003, costInPer1k: 0.0001, costOutPer1k: 0.0005, costCachedInPer1k: 0.00001, costCacheWritePer1k: 0.000125, maxContextTokens: 1050000, supportsTools: true },
    // Haiku 5.5 cobra 5× sobre 100k de prompt: el tope de contexto lo mantiene en su tarifa baja.
    { id: 'claude-haiku-5-5', provider: 'anthropic', tier: 'tier_2_standard', costPer1kTokens: 0.0003, costInPer1k: 0.0001, costOutPer1k: 0.0005, costCachedInPer1k: 0.00001, costCacheWritePer1k: 0.000125, maxContextTokens: 100000, supportsTools: true },
    { id: 'gpt-5.6-luna', provider: 'openai', tier: 'tier_2_standard', costPer1kTokens: 0.0007, costInPer1k: 0.0002, costOutPer1k: 0.0012, costCachedInPer1k: 0.00002, costCacheWritePer1k: 0.00025, maxContextTokens: 1050000, supportsTools: true },
    // Tier 3 — Efficient (starter). Google redirige gemini-2.5-flash a este modelo el 1-dic-2026.
    // Piensa en `minimal` y no se puede apagar. Sin herramientas: el adaptador no devuelve la
    // `thoughtSignature` que Gemini 3.x exige en el turno siguiente a una llamada de función.
    { id: 'gemini-3.5-flash-lite', provider: 'google', tier: 'tier_3_efficient', costPer1kTokens: 0.0014, costInPer1k: 0.0003, costOutPer1k: 0.0025, costCachedInPer1k: 0.00003, maxContextTokens: 1048576, supportsTools: false },
    // Tier 4 — Budget. Tarifa de hora pico (lun–vie 01–04 y 06–10 UTC); el resto del día cuesta la
    // mitad. Se cataloga la pico: el error queda del lado conservador.
    { id: 'deepseek-flash', provider: 'deepseek', tier: 'tier_4_budget', costPer1kTokens: 0.00075, costInPer1k: 0.0003, costOutPer1k: 0.0012, costCachedInPer1k: 0.000006, maxContextTokens: 1000000, supportsTools: true },
];

/** Read-only view of the catalogue for callers outside the router. */
export const LLM_MODEL_CATALOGUE: readonly Readonly<ModelConfig>[] =
    Object.freeze(MODEL_REGISTRY.map(model => Object.freeze({ ...model })));

// Cadenas por tarea (ADR-0029). Dentro de cada una el orden es el de la medición QA del 9-nov:
// primero el mejor modelo barato, después otros proveedores para que un apagón de OpenAI (8-nov:
// sin créditos) no deje al agente sin respuesta, y lo premium al final.
const FALLBACK_CHAINS: Record<TaskType, string[]> = {
    conversation: [
        'gpt-6-luna',
        'deepseek-flash',
        'gemini-3.5-flash-lite',
        'claude-haiku-5-5',
        'gpt-5.6-luna',
        'grok-4.3',
        'gpt-6-sol',
        'claude-sonnet-5-5',
    ],
    tool_calling: [
        'gpt-6-luna',
        'claude-haiku-5-5',
        'gpt-5.6-luna',
        'deepseek-flash',
        'grok-4.3',
        'gpt-6-sol',
        'claude-sonnet-5-5',
    ],
    // Cheap, JSON-capable models first; a premium model only as the last
    // resort so a classification is still produced when the cheap providers
    // are down (an unavailable classifier degrades the safety triage).
    //
    // Esta cadena también es la del verificador de evidencia (pide `task:
    // 'classify'`, así que su `model` fijo no cuenta). Medido el 9-nov (ADR-0029):
    // con gpt-6-luna a la cabeza el verificador borraba la frase de traspaso y
    // dejaba «Claro que sí.» (C30 falló 4–9 veces por corrida); con
    // gemini-3.5-flash-lite, 0 fallos y el mejor resultado global (0,940).
    // deepseek-flash va tarde: es el juez del ensayo y no debe verificarse a sí mismo.
    classify: [
        'gemini-3.5-flash-lite',
        'gpt-5.6-luna',
        'gpt-6-luna',
        'deepseek-flash',
        'claude-haiku-5-5',
        'gpt-6-sol',
    ],
};

/**
 * Modelo que encabeza los turnos de conversación y herramientas en una MEDICIÓN
 * (ADR-0029). Lo pone sólo el contenedor del runner (`scripts/rehearsal/measure.cjs`)
 * para medir un candidato en el banco QA con el resto del ruteo intacto; la API y
 * el worker no lo definen. Entra en la firma de ruteo de las evaluaciones.
 */
const MEASUREMENT_LEAD_MODEL = (process.env.LLM_MEASUREMENT_LEAD_MODEL || '').trim() || undefined;

/** Pone `leadId` a la cabeza si está entre los candidatos; si no, no cambia nada. */
export function leadWithModel<T extends { id: string }>(candidates: T[], leadId: string | undefined): T[] {
    if (!leadId) return candidates;
    const idx = candidates.findIndex(c => c.id === leadId);
    return idx > 0 ? [candidates[idx], ...candidates.slice(0, idx), ...candidates.slice(idx + 1)] : candidates;
}

const ALL_TIERS: ModelTier[] = ['tier_1_premium', 'tier_2_standard', 'tier_3_efficient', 'tier_4_budget'];

/**
 * Tiers that may LEAD a tool-calling turn.
 *
 * Deciding which tool to call, with which arguments, across several turns, is
 * the hardest thing we ask a model to do and the place where a weak one does
 * the most damage: it picks the wrong tool, drifts the arguments so the
 * confirmation hash no longer matches, or answers in prose while the customer
 * waits for a booking. When this floor was written (19-ago-2026) public
 * multi-turn tool benchmarks put the budget models we were leading with
 * (deepseek-chat, gpt-4.1-mini) in the mid-thirties, far under the standard
 * tier. Which model sits in each tier is decided by our own QA measurement
 * (ADR-0029), not by this comment.
 *
 * This is an ORDERING, not a gate: cheaper tiers stay in the chain as fallback,
 * and the monthly-budget circuit breaker still overrides it (see
 * `budgetConstrained`), so a tenant that blew its LLM budget keeps replying on
 * the cheap models instead of being cut off.
 */
const TOOL_CALLING_LEAD_TIERS: ReadonlySet<ModelTier> = new Set<ModelTier>([
    'tier_1_premium',
    'tier_2_standard',
]);

/**
 * Modelos del plan primero y, detrás, los de escalada (fuera del plan), cada
 * grupo en el orden que ya traía. Pura y estable (ADR-0028).
 */
export function partitionByPlan<T extends { tier: ModelTier }>(candidates: T[], allowedTiers: readonly ModelTier[]): T[] {
    const inPlan = candidates.filter(c => allowedTiers.includes(c.tier));
    return inPlan.length === candidates.length ? candidates : [...inPlan, ...candidates.filter(c => !allowedTiers.includes(c.tier))];
}

@Injectable()
export class LLMRouterService {
    private readonly logger = new Logger(LLMRouterService.name);
    private readonly CIRCUIT_BREAKER_TTL_MS = 120_000;
    // Open the breaker only after this many breakable failures within the window —
    // a single transient blip must not knock out a whole provider.
    private readonly BREAKER_THRESHOLD = 3;
    private readonly BREAKER_WINDOW_SEC = 60;
    // Sticky routing: keep the same provider+model across turns of a conversation
    // to preserve Anthropic prompt-cache (cache_control) and OpenAI auto-prefix-cache.
    // TTL outlasts a typical inter-turn gap but lets affinity decay when idle.
    private readonly AFFINITY_TTL_SEC = 1800;
    // TTFT (time-to-first-token) as an ADDITIONAL breaker signal: a provider that is up
    // but sustainedly slow should degrade out of rotation. Only measurable on the
    // streaming path (web widget); kept fully separate from the error breaker.
    private readonly TTFT_RESERVOIR = 50;          // max samples kept per provider
    private readonly TTFT_WINDOW_SEC = 300;
    private readonly TTFT_P95_THRESHOLD_MS = 8000; // sustained p95 over this ⇒ degrade
    // Min samples before the p95 is trustworthy. MUST be ≥20: below that, the p95 index
    // (ceil(0.95*n)-1) lands on the MAX sample, so a single slow first-token would
    // degrade the provider globally (the key is per-provider, fed only by the widget
    // stream). At n≥20 it takes ≥2 slow samples — a real sustained-slowness signal.
    private readonly TTFT_MIN_SAMPLES = 20;

    constructor(
        @Inject('LLM_PROVIDERS') private providers: ILLMProvider[],
        private redis: RedisService,
        private llmKeys: LlmKeyService,
        private eventEmitter: EventEmitter2,
        private spendGuard?: LlmSpendGuardService,
        @Optional() private providerHealth?: LlmProviderHealthService,
    ) { }

    getProvider(name: string): ILLMProvider {
        const provider = this.providers.find(p => p.providerName === name);
        if (!provider) throw new Error(`Provider ${name} not found`);
        return provider;
    }

    /** The exact routing policy/configuration used by readonly evaluations; exposes no prices or credentials. */
    async evaluationRoutingSignature(): Promise<string> {
        const configured = await Promise.all(['openai','anthropic','google','xai','deepseek'].map(async name =>
            [name, await this.llmKeys.isConfigured(name)]));
        return createHash('sha256').update(JSON.stringify({registry:MODEL_REGISTRY, chains:FALLBACK_CHAINS,
            leadTiers:[...TOOL_CALLING_LEAD_TIERS], measurementLead:MEASUREMENT_LEAD_MODEL ?? null, configured, providers:this.providers.map(provider => provider.providerName).sort()})).digest('hex');
    }

    private breakerOpenKey(provider: string): string {
        return llmBreakerOpenKey(provider);
    }

    /**
     * Affinity is per (conversation, task).
     *
     * With a single key per conversation, the model chosen for a two-word
     * greeting — routed to the cheapest tier by the value score — was pinned
     * ahead of everything for the next half hour, including the turn that had to
     * pick a tool and fill its arguments. Conversation and tool calling are
     * different jobs and keep different caches warm.
     */
    private affinityKey(conversationId: string, task?: TaskType): string {
        return task ? `llm:affinity:${conversationId}:${task}` : `llm:affinity:${conversationId}`;
    }

    /** Sticky provider:model for a conversation. Fails open (null) on any Redis error. */
    private async getAffinity(conversationId?: string, task?: TaskType): Promise<{ provider: string; model: string } | null> {
        if (!conversationId) return null;
        try {
            const raw = await this.redis.get(this.affinityKey(conversationId, task));
            if (!raw) return null;
            const idx = raw.indexOf(':');
            if (idx <= 0) return null;
            return { provider: raw.slice(0, idx), model: raw.slice(idx + 1) };
        } catch { return null; }
    }

    /** Persist/refresh the sticky provider:model. Never throws — affinity is best-effort. */
    private async setAffinity(
        conversationId: string | undefined,
        provider: string,
        model: string,
        task?: TaskType,
    ): Promise<void> {
        if (!conversationId) return;
        try {
            await this.redis.set(this.affinityKey(conversationId, task), `${provider}:${model}`, this.AFFINITY_TTL_SEC);
        } catch { /* best-effort */ }
    }

    private ttftKey(provider: string): string {
        return `llm:ttft:${provider}:samples`;
    }

    /** Record a stream TTFT sample (ms) into a capped Redis reservoir. Never throws. */
    private async recordTtftSample(provider: string, ms: number): Promise<void> {
        try {
            const key = this.ttftKey(provider);
            await this.redis.getClient().multi()
                .rpush(key, String(Math.round(ms)))
                .ltrim(key, -this.TTFT_RESERVOIR, -1)
                .expire(key, this.TTFT_WINDOW_SEC)
                .exec();
        } catch { /* best-effort, never throw */ }
    }

    /** p95 of the provider's recent stream TTFT, or null if too few samples / Redis down. */
    private async getTtftP95(provider: string): Promise<number | null> {
        try {
            const raw = await this.redis.getClient().lrange(this.ttftKey(provider), 0, -1);
            if (!raw || raw.length < this.TTFT_MIN_SAMPLES) return null;
            const nums = raw.map(Number).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
            if (nums.length < this.TTFT_MIN_SAMPLES) return null;
            return nums[Math.ceil(0.95 * nums.length) - 1];
        } catch { return null; /* fail open = healthy */ }
    }

    /**
     * Classify an error: does it indicate provider unavailability (and thus
     * count toward opening the breaker)? 4xx client/config errors (400 malformed
     * request, 401/403 auth, 404, 422) are NOT health problems — they'd fail on
     * every provider and must not knock out a healthy one. 429 (rate limit) is
     * transient: fall through to the next candidate but don't open the breaker.
     * Only 5xx, timeouts and network errors count.
     */
    private isBreakableError(err: any): boolean {
        const code = err?.code || err?.cause?.code;
        if (code && ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE'].includes(code)) return true;
        if (err?.name === 'APIConnectionTimeoutError' || err?.name === 'APIConnectionError') return true;
        const status = err?.status ?? err?.statusCode ?? err?.response?.status;
        if (typeof status === 'number') {
            if (status >= 400 && status < 500) return false; // client/config/rate-limit — not a health signal
            if (status >= 500) return true;                  // provider-side failure
        }
        // Unknown shape — treat as breakable so a genuinely broken provider still
        // trips; the threshold prevents a single blip from opening it.
        return true;
    }

    /** Read the breaker open-state from Redis for a set of providers (shared across API + worker). */
    private async getUnhealthyProviders(providers: string[]): Promise<Set<string>> {
        const unhealthy = new Set<string>();
        await Promise.all(providers.map(async p => {
            try {
                if (await this.redis.get(this.breakerOpenKey(p))) unhealthy.add(p);
                // Additive signal: a sustainedly-slow provider (p95 TTFT over threshold)
                // degrades out of rotation WITHOUT touching the error-count breaker.
                const p95 = await this.getTtftP95(p);
                if (p95 !== null && p95 > this.TTFT_P95_THRESHOLD_MS) unhealthy.add(p);
            } catch { /* Redis down — fail open (treat as healthy) */ }
        }));
        return unhealthy;
    }

    /**
     * Record a provider failure. Classifies the error and only opens the breaker
     * for genuine unavailability past a threshold within a short window. The
     * open-state lives in Redis (TTL) so it's shared across processes; when the
     * TTL expires the next request naturally probes the provider (half-open).
     */
    private async markProviderFailure(provider: string, err: any, kind?: string): Promise<void> {
        // Sin credito o clave invalida: no es pasajero ni se arregla reintentando.
        // Fuera de rotacion de inmediato (10 min, renovable por la sonda), en vez
        // de pagar un intento fallido en CADA turno — el 8-nov fueron >5.000.
        if (kind === 'quota' || kind === 'auth') {
            try {
                await this.redis.set(this.breakerOpenKey(provider), String(Date.now()), ACCOUNT_FAILURE_BREAKER_SEC);
            } catch (e: any) { this.logger.warn(`Breaker open write failed for ${provider}: ${e.message}`); }
            return;
        }
        if (!this.isBreakableError(err)) {
            this.logger.debug(`[CircuitBreaker] ${provider} error not breakable (status=${err?.status ?? err?.statusCode ?? 'n/a'}) — not counting`);
            return;
        }

        let count = this.BREAKER_THRESHOLD;
        try {
            const winKey = `llm:health:${provider}:errwin`;
            count = await this.redis.incrBy(winKey, 1);
            await this.redis.expire(winKey, this.BREAKER_WINDOW_SEC);
        } catch { /* Redis hiccup — be conservative and open */ }

        if (count >= this.BREAKER_THRESHOLD) {
            try {
                await this.redis.set(this.breakerOpenKey(provider), String(Date.now()), Math.ceil(this.CIRCUIT_BREAKER_TTL_MS / 1000));
            } catch (e: any) { this.logger.warn(`Breaker open write failed for ${provider}: ${e.message}`); }
            this.logger.warn(`[CircuitBreaker] ${provider} OPEN for ${this.CIRCUIT_BREAKER_TTL_MS / 1000}s after ${count} failures in ${this.BREAKER_WINDOW_SEC}s`);
        }

        // Long-window failure counter for alerting.
        const failKey = `llm:health:${provider}:failures`;
        this.redis.incrBy(failKey, 1).then(c => {
            this.redis.expire(failKey, 600).catch(e => this.logger.warn(`Redis expire failed for ${failKey}: ${e.message}`));
            if (c === 3 || c === 10 || c === 25) {
                this.eventEmitter.emit('llm.provider.alert', {
                    provider,
                    severity: c >= 10 ? 'critical' : 'warning',
                    failures: c,
                    error: err?.message || 'Provider unavailable',
                    timestamp: new Date().toISOString(),
                });
            }
        }).catch(e => this.logger.warn(`Redis circuit breaker tracking failed for ${provider}: ${e.message}`));
    }

    /** Rough prompt-size estimate (chars/4) used to exclude too-small context windows. */
    private estimatePromptTokens(systemPrompt?: string, messages?: Array<{ content: any }>): number {
        let chars = (systemPrompt || '').length;
        for (const m of messages || []) {
            const c = (m as any)?.content;
            chars += typeof c === 'string' ? c.length : JSON.stringify(c ?? '').length;
        }
        return Math.ceil(chars / 4);
    }

    private async buildCandidates(
        task: TaskType,
        allowedTiers: ModelTier[],
        executionContext?: ServiceExecutionContext,
        skippedForHealthOut?: string[],
    ): Promise<ModelConfig[]> {
        const chain = FALLBACK_CHAINS[task];
        const allConfigs = chain
            .map(id => MODEL_REGISTRY.find(m => m.id === id))
            .filter((m): m is ModelConfig => !!m);

        const eligible = task === 'tool_calling'
            ? allConfigs.filter(m => m.supportsTools)
            : allConfigs;

        const configuredProviders = new Set<string>();
        for (const p of ['openai', 'anthropic', 'google', 'xai', 'deepseek']) {
            if (await this.llmKeys.isConfigured(p)) configuredProviders.add(p);
        }

        // Agent Test must not consult or mutate runtime Redis state. Provider
        // failures still fall through within this one request, but they neither
        // inherit nor affect production circuit-breaker/TTFT state.
        const unhealthy = persistenceDisabled(executionContext)
            ? new Set<string>()
            : await this.getUnhealthyProviders([...new Set(eligible.map(m => m.provider))]);
        const available = eligible.filter(m =>
            configuredProviders.has(m.provider) && !unhealthy.has(m.provider),
        );
        // Lo que quedo fuera por salud (breaker abierto, sin credito, lento):
        // el turno que se sirve sin ellos es un turno de fallback, aunque
        // ningun intento haya fallado en esta llamada.
        if (skippedForHealthOut) {
            skippedForHealthOut.push(...eligible
                .filter(m => configuredProviders.has(m.provider) && unhealthy.has(m.provider))
                .map(m => m.id));
        }

        const primary = available.filter(m => allowedTiers.includes(m.tier));
        const escalation = available.filter(m => !allowedTiers.includes(m.tier));

        return [...primary, ...escalation];
    }

    // Value-based routing weights (sum ≈ 1). Hot leads / closing stages / high complexity
    // bias toward a higher tier within the plan; small talk biases toward the cheapest.
    private readonly ROUTING_WEIGHTS = { ticketValue: 0.30, complexity: 0.30, conversationStage: 0.20, sentiment: 0.10, intentType: 0.10 };

    /** Composite 0-100 from the turn's factors. undefined ⇒ 50 (neutral, no bias). */
    private scoreFactors(f?: RoutingFactors): number {
        if (!f) return 50;
        const w = this.ROUTING_WEIGHTS;
        const raw = f.ticketValue * w.ticketValue + f.complexity * w.complexity
            + f.conversationStage * w.conversationStage + f.sentiment * w.sentiment
            + f.intentType * w.intentType;
        return Math.max(0, Math.min(100, Math.round(raw)));
    }

    /** Desired tier for a composite score, clamped to what the plan allows (never escalates out of plan). */
    private targetTierForScore(score: number, allowedTiers: ModelTier[]): ModelTier {
        const RANK: ModelTier[] = ['tier_1_premium', 'tier_2_standard', 'tier_3_efficient', 'tier_4_budget'];
        const desired: ModelTier =
            score >= 85 ? 'tier_1_premium' :
            score >= 65 ? 'tier_2_standard' :
            score >= 40 ? 'tier_3_efficient' : 'tier_4_budget';
        // Best allowed tier that does NOT exceed the desired (plan-gating + "don't over-escalate").
        for (let i = RANK.indexOf(desired); i < RANK.length; i++) {
            if (allowedTiers.includes(RANK[i])) return RANK[i];
        }
        // Plan only has higher tiers than desired → cheapest allowed.
        for (let i = RANK.length - 1; i >= 0; i--) if (allowedTiers.includes(RANK[i])) return RANK[i];
        return 'tier_4_budget';
    }

    async execute(options: Omit<LLMRequestOptions, 'model'> & {
        model?: string;
        task?: TaskType;
        routingFactors?: RoutingFactors;
        allowedTiers?: ModelTier[];
        tenantId?: string;
        traceContext?: { conversationId?: string; kbSources?: string[]; stage?: string };
        executionContext?: ServiceExecutionContext;
        /**
         * The tenant is over its monthly LLM budget. Cheap models lead again —
         * the circuit breaker outranks the tool-calling floor, because replying
         * on a weaker model beats not replying at all.
         */
        budgetConstrained?: boolean;
        /**
         * Keep this exact provider+model for this call. The tool loop pins the
         * model chosen on its first iteration so a mid-turn failover cannot hand
         * the second half of the same turn to a different model with a different
         * idea of which tool to call.
         */
        pinnedModel?: { provider: string; model: string };
        /**
         * Este turno le esta contando al cliente el resultado de una escritura
         * ya cometida (una reserva creada, un pedido puesto).
         *
         * Las dos protecciones de abajo dependian de `task === 'tool_calling'`,
         * y el turno que CIERRA la venta no tiene herramientas: el servidor ya
         * ejecuto la operacion al recibir el "si" y las vacia. Entonces el
         * mensaje mas importante de la conversacion —"tu reserva quedo
         * confirmada"— caia en tarea 'conversation', el mensaje del cliente era
         * "si" (complejidad 0) y el ruteo por valor lo mandaba al modelo mas
         * barato del catalogo. El comentario de mas abajo ya describia el
         * riesgo; la excepcion que se escribio no cubria este caso.
         */
        voicedWrite?: boolean;
        /**
         * El servidor reconoce una escritura en juego en este turno: una
         * propuesta esperando su «sí», un pedido, una reserva en curso, una
         * cancelación (`writeInPlay` de conversations.service). Sólo entonces el
         * piso de herramientas puede saltar por encima de los tiers del plan
         * (ADR-0028).
         */
        writeInPlay?: boolean;
        withSourceAuthority?: LLMSourceAuthority;
    }): Promise<LLMResponse & { routingDecision?: RoutingDecision }> {

        const noPersistence = persistenceDisabled(options.executionContext);
        // Agent Test must not mutate business state, affinity, breaker health or
        // traces, but its real provider calls still count toward tenant spend.
        const accountOperationalUsage = !noPersistence
            || operationalUsageAccountingEnabled(options.executionContext);

        if (options.task) {
            const allowedTiers = options.allowedTiers || ALL_TIERS;
            const skippedForHealth: string[] = [];
            let candidates = await this.buildCandidates(options.task, allowedTiers, options.executionContext, skippedForHealth);
            const preferredModelId = candidates[0]?.id;

            if (candidates.length === 0) {
                throw new Error('No LLM provider is configured — set at least one API key from the super admin dashboard');
            }

            // Drop candidates whose context window can't fit this prompt (rough
            // chars/4 estimate). If nothing fits, keep the original list and try
            // anyway (largest-context models are first via the chain order).
            const estTokens = this.estimatePromptTokens(options.systemPrompt, options.messages);
            const fitting = candidates.filter(c => c.maxContextTokens >= estTokens);
            if (fitting.length && fitting.length < candidates.length) {
                this.logger.warn(`[LLM] Prompt ~${estTokens} tokens — excluding ${candidates.length - fitting.length} candidate(s) with smaller context`);
                candidates = fitting;
            }

            // Value-based routing: bias the tier toward the turn's value (hot lead /
            // closing stage / complexity → higher tier within the plan; small talk →
            // cheapest). Pure reorder of the already-filtered list, run BEFORE the sticky
            // bias so sticky keeps the final say (cache warmth). Plan-gating intact: a
            // tier not present in `candidates` is a no-op.
            const composite = this.scoreFactors(options.routingFactors);
            const targetTier = this.targetTierForScore(composite, allowedTiers);
            // Only ACT on the score when the caller actually supplied routing factors.
            // Callers that omit them (nurturing drip, customer-memory extraction) get a
            // neutral composite (50 → tier_3) which is NOT their chain's natural head, so
            // reordering would silently bias them toward gemini-flash. Keep their order.
            //
            // Never on a tool-calling turn. The score reads ticket value, sentiment
            // and complexity off the CURRENT message, and the message that closes a
            // sale is "sí": it scores ~19, which sent the turn holding the booking
            // to the cheapest model in the chain.
            const toolCallingTurn = options.task === 'tool_calling';
            // Un turno que vocea una escritura ya cometida se protege igual que
            // uno con herramientas: lo que esta en juego no es si hay tools, es
            // si el cliente va a creerle al mensaje.
            const protectedTurn = toolCallingTurn || options.voicedWrite === true;
            // A classification keeps its fixed chain: no value reorder, no floor, no affinity.
            const fixedChain = options.task === 'classify';
            if (options.routingFactors && !protectedTurn && !fixedChain) {
                const tIdx = candidates.findIndex(c => c.tier === targetTier);
                if (tIdx > 0) {
                    const [picked] = candidates.splice(tIdx, 1);
                    candidates.unshift(picked);
                    this.logger.debug(`[LLM] Value-routing composite=${composite} → ${targetTier} (${picked.id})`);
                }
            }

            // Hasta dónde puede subir este turno (ADR-0028). Por defecto, los
            // tiers del plan. Un turno con una escritura en juego (o que vocea
            // una ya cometida) puede subir además a tier_1/2 aunque el plan no
            // los incluya: es donde un modelo débil cambia los argumentos o
            // contesta en prosa mientras el cliente espera su reserva.
            const writeFloorAbovePlan = protectedTurn && !options.budgetConstrained
                && (options.writeInPlay === true || options.voicedWrite === true);
            const routingTiers: readonly ModelTier[] = writeFloorAbovePlan
                ? [...new Set([...allowedTiers, ...TOOL_CALLING_LEAD_TIERS])]
                : allowedTiers;

            // Tool-calling floor: models good enough to pick a tool and fill its
            // arguments lead; the cheap ones stay as fallback. Stable partition,
            // so the chain's own cost ordering survives inside each group.
            // Sólo entre los modelos a los que este turno puede subir.
            if (protectedTurn && !options.budgetConstrained) {
                const lead = candidates.filter(c => TOOL_CALLING_LEAD_TIERS.has(c.tier) && routingTiers.includes(c.tier));
                if (lead.length && lead.length < candidates.length) {
                    candidates = [...lead, ...candidates.filter(c => !lead.includes(c))];
                    this.logger.debug(`[LLM] Tool-calling floor → leading with ${candidates[0].id}`);
                }
            }

            // Sticky routing: bias the (already filtered: configured + healthy +
            // fits-context) candidate list toward the provider+model used last turn
            // of this conversation, keeping the provider-side prompt cache warm.
            // Pure reorder — if the sticky model isn't in `candidates` (provider
            // unconfigured, breaker open, or context too small) it's silently absent
            // and normal tier order applies. Never overrides the breaker.
            const convId = options.traceContext?.conversationId;
            const affinity = noPersistence || fixedChain ? null : await this.getAffinity(convId, options.task);
            if (affinity) {
                const stickyIdx = candidates.findIndex(c => c.provider === affinity.provider && c.id === affinity.model);
                if (stickyIdx > 0) {
                    const [sticky] = candidates.splice(stickyIdx, 1);
                    candidates.unshift(sticky);
                    this.logger.debug(`[LLM] Sticky routing — pinned ${sticky.id} (${sticky.provider}) for conv ${convId}`);
                }
            }

            // El plan manda sobre el orden (ADR-0028). Los modelos fuera del
            // plan quedan en la cadena sólo como último recurso ante un fallo:
            // el piso de herramientas (tier_1/2 primero) y la afinidad (el
            // modelo que atendió el turno anterior, quizá por escalada) los
            // subían a la cabeza, y así Emprendedor y Starter abrían sus turnos
            // con herramientas en gpt-4.1-mini contra topes de $3 y $8 —incluidas
            // las búsquedas y las preguntas, no sólo el «sí» que cierra una venta—.
            // Partición estable: no deshace ningún orden dentro de cada grupo.
            candidates = partitionByPlan(candidates, routingTiers);
            if (!fixedChain) candidates = leadWithModel(candidates, MEASUREMENT_LEAD_MODEL);

            // A model pinned by the caller wins over everything above: inside one
            // turn the tool loop must stay on the model that made the first
            // decision, or the second half of the turn is reasoned by someone
            // else about tool calls it never made.
            if (options.pinnedModel) {
                const pinIdx = candidates.findIndex(c => (
                    c.provider === options.pinnedModel!.provider && c.id === options.pinnedModel!.model
                ));
                if (pinIdx > 0) {
                    const [pin] = candidates.splice(pinIdx, 1);
                    candidates.unshift(pin);
                }
            }

            let lastError: Error | undefined;
            let failedAttempts = 0;
            // Una cuenta sin credito o con la clave mala no mejora con su
            // siguiente modelo: el resto de este turno salta ese proveedor.
            const accountFailed = new Set<string>();
            for (const candidate of candidates) {
                if (accountFailed.has(candidate.provider)) continue;
                const startTime = Date.now();
                try {
                    const rawProvider = this.getProvider(candidate.provider);
                    const provider = accountOperationalUsage && options.tenantId && this.spendGuard
                        ? this.spendGuard.wrap(rawProvider, options.tenantId, candidate) : rawProvider;
                    const reqOptions: LLMRequestOptions = {
                        ...options as Omit<LLMRequestOptions, 'model'>,
                        model: candidate.id,
                    };
                    delete (reqOptions as any).withSourceAuthority;
                    const response = await generateWithSourceAuthority(provider, reqOptions, options.withSourceAuthority);
                    const durationMs = Date.now() - startTime;

                    const escalated = !allowedTiers.includes(candidate.tier);
                    if (escalated) {
                        this.logger.warn(`[LLM] Auto-escalated to ${candidate.id} (${candidate.tier}) — no model in plan tiers`);
                    }

                    this.logger.log(`[LLM] ${options.task} via ${candidate.provider} (${candidate.id}) in ${durationMs}ms`);
                    if (this.providerHealth) {
                        const chain = FALLBACK_CHAINS[options.task];
                        const servedPos = chain.indexOf(candidate.id);
                        // Fallback = algo fallo antes en este turno, o un modelo que
                        // la cadena pone ANTES del servido quedo fuera por salud.
                        const fallback = failedAttempts > 0 || skippedForHealth.some(id => {
                            const pos = chain.indexOf(id);
                            return pos >= 0 && servedPos >= 0 && pos < servedPos;
                        });
                        if (failedAttempts > 0 || fallback) {
                            this.logger.warn(`[LLM] FALLBACK ${options.task} served by ${candidate.provider}/${candidate.id}`
                                + ` (preferred ${preferredModelId ?? '-'}; failed=${failedAttempts}; skipped=${skippedForHealth.join(',') || '-'})`);
                        }
                        this.providerHealth.recordSuccess(candidate.provider, candidate.id, 'traffic').catch(() => {});
                        this.providerHealth.recordRouting(candidate.provider, fallback).catch(() => {});
                    }
                    // Remember this provider+model for the conversation's next turn (cache
                    // warmth) — but NOT when it was an out-of-plan escalation, or the sticky
                    // would keep pinning a premium model ahead of healthy in-plan ones.
                    if (!noPersistence && !escalated && !fixedChain) {
                        this.setAffinity(convId, candidate.provider, candidate.id, options.task).catch(() => {});
                    }
                    if (accountOperationalUsage) {
                        this.trackStats(options.tenantId, candidate, durationMs, response.usage, false).catch(e => this.logger.warn(`AI stats tracking failed: ${e.message}`));
                    }
                    if (!noPersistence) {
                        this.emitTurnTrace(options, candidate, durationMs, response, escalated, options.task);
                    }

                    const decision: RoutingDecision = {
                        selectedTier: candidate.tier,
                        selectedModel: {
                            id: candidate.id,
                            provider: candidate.provider as any,
                            name: candidate.id,
                            tier: candidate.tier,
                            costPer1kTokens: candidate.costPer1kTokens,
                            maxContextTokens: candidate.maxContextTokens,
                            supportsTools: candidate.supportsTools,
                            supportsVision: candidate.tier === 'tier_1_premium',
                        },
                        compositeScore: composite,
                        factors: options.routingFactors ?? { ticketValue: 0, complexity: 0, conversationStage: 0, sentiment: 0, intentType: 0 },
                        reasoning: `task:${options.task} → ${candidate.id} (${candidate.provider}) | composite=${composite} target=${targetTier}`,
                    };

                    return { ...response, routingDecision: decision };
                } catch (err: any) {
                    const durationMs = Date.now() - startTime;
                    if (err instanceof LlmBudgetExceeded && options.tenantId) {
                        this.providerHealth?.recordBudgetExceeded(options.tenantId).catch(() => {});
                    }
                    if (err instanceof LlmBudgetExceeded || err instanceof LlmBudgetUnavailable) throw err;
                    if (err instanceof LLMSourceAuthorityUnavailable) {
                        if (accountOperationalUsage && err.usage) this.trackStats(options.tenantId,candidate,durationMs,err.usage,false)
                            .catch(e=>this.logger.warn(`AI stats tracking failed: ${e.message}`));
                        throw err;
                    }
                    if (accountOperationalUsage) {
                        this.trackStats(options.tenantId, candidate, durationMs, undefined, true).catch(e => this.logger.warn(`AI stats tracking failed: ${e.message}`));
                    }
                    failedAttempts++;
                    // La salud del proveedor es un hecho operativo, no estado de
                    // negocio: se registra tambien en Agent Test, que paga y ve
                    // los mismos errores reales. El breaker sigue sin tocarse ahi.
                    const kind = this.providerHealth
                        ? await this.providerHealth.recordFailure(candidate.provider, candidate.id, err, 'traffic').catch(() => undefined)
                        : undefined;
                    if (kind === 'quota' || kind === 'auth') accountFailed.add(candidate.provider);
                    if (!noPersistence) {
                        await this.markProviderFailure(candidate.provider, err, kind);
                    }
                    lastError = err;
                    this.logger.warn(`[LLM] ${candidate.provider}/${candidate.id} failed: ${err.message} — trying next`);
                }
            }

            if (!noPersistence) {
                // Cooldown 5 min: sin él, drenar un backlog con todos los
                // proveedores caídos emitía una alerta crítica POR TURNO a cada
                // admin conectado (y el relay del worker ahora las entrega todas).
                const alertAllowed = await this.redis.acquireLock('llm:alert:all', 300).catch(() => true);
                if (alertAllowed) {
                    this.eventEmitter.emit('llm.provider.alert', {
                        provider: 'all',
                        severity: 'critical',
                        failures: candidates.length,
                        error: `All ${candidates.length} LLM providers failed. Last: ${lastError?.message}`,
                        timestamp: new Date().toISOString(),
                    });
                }
            }

            throw lastError || new Error('All LLM providers failed');
        }

        // Direct model selection (backwards compat for copilot, widget, etc.)
        let modelConfig = options.model
            ? MODEL_REGISTRY.find(m => m.id === options.model)
            : undefined;

        if (!modelConfig) {
            // Unknown/unspecified model — don't blindly pick the premium
            // MODEL_REGISTRY[0]. Use the best CONFIGURED + healthy model from the
            // conversation chain so we never dispatch to an unconfigured provider.
            const fallbackCandidates = await this.buildCandidates(
                'conversation',
                ALL_TIERS,
                options.executionContext,
            );
            modelConfig = fallbackCandidates[0] || MODEL_REGISTRY[0];
            this.logger.warn(`Model ${options.model || '(none)'} not in registry, falling back to ${modelConfig.id}`);
        }

        const rawProvider = this.getProvider(modelConfig.provider);
        const provider = accountOperationalUsage && options.tenantId && this.spendGuard
            ? this.spendGuard.wrap(rawProvider, options.tenantId, modelConfig) : rawProvider;
        const reqOptions: LLMRequestOptions = {
            ...options as Omit<LLMRequestOptions, 'model'>,
            model: modelConfig.id,
        };
        delete (reqOptions as any).withSourceAuthority;
        const startTime = Date.now();
        try {
            const response = await generateWithSourceAuthority(provider, reqOptions, options.withSourceAuthority);
            const durationMs = Date.now() - startTime;
            this.logger.log(`[LLM] Direct via ${provider.providerName} (${modelConfig.id}) in ${durationMs}ms`);
            this.providerHealth?.recordSuccess(modelConfig.provider, modelConfig.id, 'traffic').catch(() => {});
            if (accountOperationalUsage) {
                this.trackStats(options.tenantId, modelConfig, durationMs, response.usage, false).catch(e => this.logger.warn(`AI stats tracking failed: ${e.message}`));
            }
            if (!noPersistence) {
                this.emitTurnTrace(options, modelConfig, durationMs, response, false, undefined);
            }
            return { ...response };
        } catch (e: any) {
            const durationMs = Date.now() - startTime;
            if (e instanceof LlmBudgetExceeded && options.tenantId) {
                this.providerHealth?.recordBudgetExceeded(options.tenantId).catch(() => {});
            }
            if (e instanceof LlmBudgetExceeded || e instanceof LlmBudgetUnavailable) throw e;
            if (e instanceof LLMSourceAuthorityUnavailable) {
                if (accountOperationalUsage && e.usage) this.trackStats(options.tenantId,modelConfig,durationMs,e.usage,false)
                    .catch(err=>this.logger.warn(`AI stats tracking failed: ${err.message}`));
                throw e;
            }
            if (accountOperationalUsage) {
                this.trackStats(options.tenantId, modelConfig, durationMs, undefined, true).catch(e => this.logger.warn(`AI stats tracking failed: ${e.message}`));
            }
            this.providerHealth?.recordFailure(modelConfig.provider, modelConfig.id, e, 'traffic').catch(() => {});
            throw e;
        }
    }

    /**
     * Persist a per-tenant per-provider per-day rollup of LLM usage to Redis.
     * Buckets:
     *   llm:stats:{tenantId}:{date}:{provider}:{counter}
     * Counters: calls, errors, tokens_in, tokens_out, cost_centi_usd,
     * latency_sum_ms (used to compute avg latency = sum / calls).
     *
     * Keys auto-expire 90 days after creation. Price data lives in cents
     * × 100 so we keep 2 decimals of precision via INCRBY (integers only).
     */
    private async trackStats(
        tenantId: string | undefined,
        modelConfig: ModelConfig,
        latencyMs: number,
        usage: LLMResponse['usage'] | undefined,
        errored: boolean,
    ): Promise<void> {
        if (!tenantId) return;
        const date = new Date().toISOString().slice(0, 10);
        const monthKey = date.slice(0, 7); // YYYY-MM (UTC) — matches TenantThrottleService.currentMonthKey
        const baseKey = `llm:stats:${tenantId}:${date}:${modelConfig.provider}`;
        const tokensIn = usage?.promptTokens || 0;
        const tokensOut = usage?.completionTokens || 0;
        const tokensCached = usage ? splitPromptTokens(usage).cached : 0;
        // Cost in centi-USD (USD * 10000) so we can use integer INCRBY.
        // Fresh input, cached input and output each have their own rate
        // (ADR-0027): the cached share used to be billed at full price.
        const costUsd = usageCostUsd(modelConfig, usage);
        const costCentiUsd = Math.round(costUsd * 10000);

        const ttl = 90 * 24 * 3600;
        const monthlyCostKey = `llm:cost:${tenantId}:${monthKey}`;
        const tenantsForDateKey = `llm:stats:tenants:${date}`;
        const providersForDateKey = `llm:stats:providers:${date}`;

        // One provider call is one accounting fact. Previously every counter
        // was an independent promise hidden behind allSettled: Redis could
        // accept the provider/day cost and lose only the monthly accumulator,
        // leaving the margin guard and the analytics with different totals.
        // MULTI makes all counters and their retention one atomic write. Redis
        // command errors are returned inside exec(), so inspect every result.
        const transaction = this.redis.getClient().multi()
            .incrby(`${baseKey}:calls`, 1)
            .incrby(`${baseKey}:tokens_in`, tokensIn)
            .incrby(`${baseKey}:tokens_out`, tokensOut)
            .incrby(`${baseKey}:tokens_cached`, tokensCached)
            .incrby(`${baseKey}:cost_centi_usd`, costCentiUsd)
            .incrby(monthlyCostKey, costCentiUsd)
            .incrby(`${baseKey}:latency_sum_ms`, latencyMs)
            .sadd('llm:stats:dates', date)
            .sadd(tenantsForDateKey, tenantId)
            .sadd(providersForDateKey, modelConfig.provider);
        if (errored) transaction.incrby(`${baseKey}:errors`, 1);

        const dayKeys = ['calls', 'tokens_in', 'tokens_out', 'tokens_cached', 'cost_centi_usd', 'latency_sum_ms'];
        if (errored) dayKeys.push('errors');
        for (const suffix of dayKeys) transaction.expire(`${baseKey}:${suffix}`, ttl);
        transaction.expire(tenantsForDateKey, ttl);
        transaction.expire(providersForDateKey, ttl);
        transaction.expire(monthlyCostKey, 40 * 24 * 3600);

        const results = await transaction.exec();
        if (!results) throw new Error('Redis discarded the LLM accounting transaction');
        const failed = results.find(([error]) => error);
        if (failed?.[0]) throw failed[0];
    }

    /**
     * Emit a per-turn trace event (T1.7 — Trace View) when the caller passes a
     * traceContext.conversationId. A listener persists it asynchronously, so this
     * never blocks the conversation hot path. Only opted-in call sites are traced.
     */
    private emitTurnTrace(
        opts: { tenantId?: string; traceContext?: { conversationId?: string; kbSources?: string[]; stage?: string } },
        model: ModelConfig,
        latencyMs: number,
        response: LLMResponse | undefined,
        fallbackUsed: boolean,
        task?: TaskType,
    ): void {
        const ctx = opts.traceContext;
        if (!ctx?.conversationId || !opts.tenantId) return;
        try {
            this.eventEmitter.emit('llm.turn', {
                tenantId: opts.tenantId,
                conversationId: ctx.conversationId,
                provider: model.provider,
                model: model.id,
                tier: model.tier,
                task: task || null,
                latencyMs,
                promptTokens: response?.usage?.promptTokens || 0,
                completionTokens: response?.usage?.completionTokens || 0,
                totalTokens: response?.usage?.totalTokens || 0,
                fallbackUsed,
                kbSources: Array.isArray(ctx.kbSources) ? ctx.kbSources.slice(0, 10) : [],
                stage: ctx.stage || null,
            });
        } catch {
            // tracing must never break generation
        }
    }

    /**
     * Aggregate Redis stats over a date range. Used by /admin/llm-stats.
     */
    async getStats(opts: { since: Date; until: Date; tenantId?: string }): Promise<{
        totals: { calls: number; tokensIn: number; tokensOut: number; costUsd: number; avgLatencyMs: number; errors: number };
        byProvider: Array<{ provider: string; calls: number; tokensIn: number; tokensOut: number; costUsd: number; avgLatencyMs: number; errors: number }>;
        byTenant: Array<{ tenantId: string; calls: number; costUsd: number }>;
        byDay: Array<{ date: string; calls: number; costUsd: number }>;
    }> {
        const days: string[] = [];
        const cur = new Date(opts.since);
        cur.setUTCHours(0, 0, 0, 0);
        const end = new Date(opts.until);
        end.setUTCHours(0, 0, 0, 0);
        while (cur <= end) {
            days.push(cur.toISOString().slice(0, 10));
            cur.setUTCDate(cur.getUTCDate() + 1);
        }

        const totals = { calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, avgLatencyMs: 0, errors: 0, latencySum: 0 };
        const byProvider = new Map<string, any>();
        const byTenant = new Map<string, any>();
        const byDay = new Map<string, any>();

        for (const date of days) {
            const tenantSet = await this.redis.smembers(`llm:stats:tenants:${date}`);
            const tenantsToScan = opts.tenantId ? [opts.tenantId] : (tenantSet || []);
            const providerSet = await this.redis.smembers(`llm:stats:providers:${date}`);

            for (const t of tenantsToScan) {
                for (const provider of providerSet || []) {
                    const baseKey = `llm:stats:${t}:${date}:${provider}`;
                    const [calls, tIn, tOut, costCenti, latSum, errors] = await Promise.all([
                        this.redis.get(`${baseKey}:calls`),
                        this.redis.get(`${baseKey}:tokens_in`),
                        this.redis.get(`${baseKey}:tokens_out`),
                        this.redis.get(`${baseKey}:cost_centi_usd`),
                        this.redis.get(`${baseKey}:latency_sum_ms`),
                        this.redis.get(`${baseKey}:errors`),
                    ]);
                    const c = Number(calls || 0);
                    if (c === 0) continue;
                    const ti = Number(tIn || 0);
                    const to = Number(tOut || 0);
                    const cost = Number(costCenti || 0) / 10000;  // back to USD
                    const ls = Number(latSum || 0);
                    const er = Number(errors || 0);

                    totals.calls += c;
                    totals.tokensIn += ti;
                    totals.tokensOut += to;
                    totals.costUsd += cost;
                    totals.latencySum += ls;
                    totals.errors += er;

                    const ap = byProvider.get(provider) || { provider, calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, latencySum: 0, errors: 0 };
                    ap.calls += c; ap.tokensIn += ti; ap.tokensOut += to; ap.costUsd += cost; ap.latencySum += ls; ap.errors += er;
                    byProvider.set(provider, ap);

                    const at = byTenant.get(t) || { tenantId: t, calls: 0, costUsd: 0 };
                    at.calls += c; at.costUsd += cost;
                    byTenant.set(t, at);

                    const ad = byDay.get(date) || { date, calls: 0, costUsd: 0 };
                    ad.calls += c; ad.costUsd += cost;
                    byDay.set(date, ad);
                }
            }
        }

        totals.avgLatencyMs = totals.calls > 0 ? Math.round(totals.latencySum / totals.calls) : 0;
        const byProviderArr = Array.from(byProvider.values()).map(p => ({
            ...p,
            avgLatencyMs: p.calls > 0 ? Math.round(p.latencySum / p.calls) : 0,
        }));
        delete (totals as any).latencySum;
        for (const p of byProviderArr) delete p.latencySum;

        return {
            totals,
            byProvider: byProviderArr.sort((a, b) => b.calls - a.calls),
            byTenant: Array.from(byTenant.values()).sort((a, b) => b.costUsd - a.costUsd).slice(0, 25),
            byDay: Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
        };
    }

    /**
     * Unified AI usage stats: LLM + media (audio/image) + embeddings.
     * Supports monthly breakdown for billing/planning.
     */
    async getUnifiedAiUsage(opts: {
        months?: number;
        tenantId?: string;
    }): Promise<{
        totals: { llmCostUsd: number; mediaCostUsd: number; embeddingsCostUsd: number; totalCostUsd: number; llmCalls: number; mediaCalls: number; embeddingsCalls: number };
        byMonth: Array<{ month: string; llmCostUsd: number; mediaCostUsd: number; embeddingsCostUsd: number; totalCostUsd: number; llmCalls: number; mediaCalls: number; embeddingsCalls: number }>;
        byCategory: Array<{ category: string; calls: number; costUsd: number; tokensIn: number; tokensOut: number }>;
        byProvider: Array<{ provider: string; calls: number; costUsd: number; tokensIn: number; tokensOut: number }>;
        byTenant: Array<{ tenantId: string; totalCostUsd: number; llmCalls: number; mediaCalls: number; embeddingsCalls: number }>;
    }> {
        const monthsBack = opts.months || 3;
        const months: string[] = [];
        const now = new Date();
        for (let i = 0; i < monthsBack; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            months.push(d.toISOString().slice(0, 7));
        }

        const allDays: string[] = [];
        for (const month of months) {
            const [y, m] = month.split('-').map(Number);
            const daysInMonth = new Date(y, m, 0).getDate();
            for (let d = 1; d <= daysInMonth; d++) {
                const dayStr = `${month}-${String(d).padStart(2, '0')}`;
                if (dayStr <= now.toISOString().slice(0, 10)) {
                    allDays.push(dayStr);
                }
            }
        }

        const totals = { llmCostUsd: 0, mediaCostUsd: 0, embeddingsCostUsd: 0, totalCostUsd: 0, llmCalls: 0, mediaCalls: 0, embeddingsCalls: 0 };
        const byMonthMap = new Map<string, { month: string; llmCostUsd: number; mediaCostUsd: number; embeddingsCostUsd: number; totalCostUsd: number; llmCalls: number; mediaCalls: number; embeddingsCalls: number }>();
        const byCategoryMap = new Map<string, { category: string; calls: number; costUsd: number; tokensIn: number; tokensOut: number }>();
        const byProviderMap = new Map<string, { provider: string; calls: number; costUsd: number; tokensIn: number; tokensOut: number }>();
        const byTenantMap = new Map<string, { tenantId: string; totalCostUsd: number; llmCalls: number; mediaCalls: number; embeddingsCalls: number }>();

        for (const month of months) {
            byMonthMap.set(month, { month, llmCostUsd: 0, mediaCostUsd: 0, embeddingsCostUsd: 0, totalCostUsd: 0, llmCalls: 0, mediaCalls: 0, embeddingsCalls: 0 });
        }

        for (const date of allDays) {
            const month = date.slice(0, 7);
            const monthEntry = byMonthMap.get(month)!;

            // --- LLM stats ---
            const tenantSet = opts.tenantId ? [opts.tenantId] : (await this.redis.smembers(`llm:stats:tenants:${date}`) || []);
            const providerSet = await this.redis.smembers(`llm:stats:providers:${date}`) || [];

            for (const t of tenantSet) {
                for (const provider of providerSet) {
                    const baseKey = `llm:stats:${t}:${date}:${provider}`;
                    const [calls, tIn, tOut, costCenti] = await Promise.all([
                        this.redis.get(`${baseKey}:calls`),
                        this.redis.get(`${baseKey}:tokens_in`),
                        this.redis.get(`${baseKey}:tokens_out`),
                        this.redis.get(`${baseKey}:cost_centi_usd`),
                    ]);
                    const c = Number(calls || 0);
                    if (c === 0) continue;
                    const ti = Number(tIn || 0);
                    const to = Number(tOut || 0);
                    const cost = Number(costCenti || 0) / 10000;

                    totals.llmCalls += c;
                    totals.llmCostUsd += cost;
                    monthEntry.llmCalls += c;
                    monthEntry.llmCostUsd += cost;

                    const prov = byProviderMap.get(provider) || { provider, calls: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 };
                    prov.calls += c; prov.costUsd += cost; prov.tokensIn += ti; prov.tokensOut += to;
                    byProviderMap.set(provider, prov);

                    const te = byTenantMap.get(t) || { tenantId: t, totalCostUsd: 0, llmCalls: 0, mediaCalls: 0, embeddingsCalls: 0 };
                    te.llmCalls += c; te.totalCostUsd += cost;
                    byTenantMap.set(t, te);
                }
            }

            // --- Media stats ---
            // Union the LLM tenant set with the media tenant set so tenants that
            // used ONLY media that day aren't missed.
            const mediaTenantSet = opts.tenantId ? [opts.tenantId] : (await this.redis.smembers(`media:stats:tenants:${date}`) || []);
            const mediaTenantsToScan = opts.tenantId ? [opts.tenantId] : [...new Set([...tenantSet, ...mediaTenantSet])];
            for (const t of mediaTenantsToScan) {
                const mediaBase = `media:stats:${t}:${date}`;
                const [audioCount, audioCost, imageCount, imageCost] = await Promise.all([
                    this.redis.get(`${mediaBase}:audio:count`),
                    this.redis.get(`${mediaBase}:audio:cost_cents`),
                    this.redis.get(`${mediaBase}:image:count`),
                    this.redis.get(`${mediaBase}:image:cost_cents`),
                ]);
                const ac = Number(audioCount || 0);
                const acost = Number(audioCost || 0) / 100;
                const ic = Number(imageCount || 0);
                const icost = Number(imageCost || 0) / 100;
                const totalMedia = ac + ic;
                const totalMediaCost = acost + icost;

                if (totalMedia > 0) {
                    totals.mediaCalls += totalMedia;
                    totals.mediaCostUsd += totalMediaCost;
                    monthEntry.mediaCalls += totalMedia;
                    monthEntry.mediaCostUsd += totalMediaCost;

                    if (ac > 0) {
                        const cat = byCategoryMap.get('audio') || { category: 'audio', calls: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 };
                        cat.calls += ac; cat.costUsd += acost;
                        byCategoryMap.set('audio', cat);
                    }
                    if (ic > 0) {
                        const cat = byCategoryMap.get('image') || { category: 'image', calls: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 };
                        cat.calls += ic; cat.costUsd += icost;
                        byCategoryMap.set('image', cat);
                    }

                    const te = byTenantMap.get(t) || { tenantId: t, totalCostUsd: 0, llmCalls: 0, mediaCalls: 0, embeddingsCalls: 0 };
                    te.mediaCalls += totalMedia; te.totalCostUsd += totalMediaCost;
                    byTenantMap.set(t, te);
                }
            }

            // --- Embeddings stats ---
            const embedTenantsRaw = opts.tenantId ? [opts.tenantId] : (await this.redis.smembers(`ai:stats:tenants:${date}`) || []);
            for (const t of embedTenantsRaw) {
                const embedBase = `ai:stats:${t}:${date}:embeddings`;
                const [eCalls, eCost] = await Promise.all([
                    this.redis.get(`${embedBase}:calls`),
                    this.redis.get(`${embedBase}:cost_centi_usd`),
                ]);
                const ec = Number(eCalls || 0);
                const ecost = Number(eCost || 0) / 10000;
                if (ec > 0) {
                    totals.embeddingsCalls += ec;
                    totals.embeddingsCostUsd += ecost;
                    monthEntry.embeddingsCalls += ec;
                    monthEntry.embeddingsCostUsd += ecost;

                    const cat = byCategoryMap.get('embeddings') || { category: 'embeddings', calls: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 };
                    cat.calls += ec; cat.costUsd += ecost;
                    byCategoryMap.set('embeddings', cat);

                    const te = byTenantMap.get(t) || { tenantId: t, totalCostUsd: 0, llmCalls: 0, mediaCalls: 0, embeddingsCalls: 0 };
                    te.embeddingsCalls += ec; te.totalCostUsd += ecost;
                    byTenantMap.set(t, te);
                }
            }
        }

        // Add LLM as category
        if (totals.llmCalls > 0) {
            const llmCat = { category: 'llm', calls: totals.llmCalls, costUsd: totals.llmCostUsd, tokensIn: 0, tokensOut: 0 };
            for (const p of byProviderMap.values()) { llmCat.tokensIn += p.tokensIn; llmCat.tokensOut += p.tokensOut; }
            byCategoryMap.set('llm', llmCat);
        }

        totals.totalCostUsd = totals.llmCostUsd + totals.mediaCostUsd + totals.embeddingsCostUsd;
        for (const m of byMonthMap.values()) {
            m.totalCostUsd = m.llmCostUsd + m.mediaCostUsd + m.embeddingsCostUsd;
        }

        return {
            totals,
            byMonth: Array.from(byMonthMap.values()).sort((a, b) => a.month.localeCompare(b.month)),
            byCategory: Array.from(byCategoryMap.values()).sort((a, b) => b.costUsd - a.costUsd),
            byProvider: Array.from(byProviderMap.values()).sort((a, b) => b.costUsd - a.costUsd),
            byTenant: Array.from(byTenantMap.values()).sort((a, b) => b.totalCostUsd - a.totalCostUsd).slice(0, 25),
        };
    }

    async *executeStream(options: Omit<LLMRequestOptions, 'model'> & {
        model?: string;
        task?: TaskType;
        allowedTiers?: ModelTier[];
        tenantId?: string;
    }): AsyncGenerator<string, void, unknown> {
        let modelConfig: ModelConfig | undefined;

        if (options.task) {
            const allowedTiers = options.allowedTiers || ALL_TIERS;
            const candidates = await this.buildCandidates(options.task, allowedTiers);
            modelConfig = candidates[0];
        }

        if (!modelConfig) {
            modelConfig = options.model
                ? MODEL_REGISTRY.find(m => m.id === options.model)
                : undefined;
        }

        if (!modelConfig) {
            modelConfig = MODEL_REGISTRY[0];
        }

        const reqOptions: LLMRequestOptions = {
            ...options as Omit<LLMRequestOptions, 'model'>,
            model: modelConfig.id,
        };
        const provider = this.getProvider(modelConfig.provider);
        const startMs = Date.now();
        let charCount = 0;
        let errored = false;
        let firstChunkMs: number | undefined;
        let streamReservation: string | undefined;
        let completed = false;
        let outputBytes = 0;
        if (options.tenantId && this.spendGuard) {
            Object.assign(reqOptions, this.spendGuard.bounded(reqOptions));
            streamReservation = await this.spendGuard.reserve(options.tenantId, modelConfig, reqOptions);
        }

        try {
            for await (const chunk of provider.generateStream(reqOptions, { maxRetries: 0 })) {
                if (firstChunkMs === undefined) firstChunkMs = Date.now() - startMs;
                charCount += chunk.length;
                outputBytes += Buffer.byteLength(chunk, 'utf8');
                yield chunk;
            }
            completed = true;
        } catch (e) {
            errored = true;
            this.providerHealth?.recordFailure(modelConfig.provider, modelConfig.id, e, 'traffic').catch(() => {});
            throw e;
        } finally {
            if (completed && streamReservation && this.spendGuard) await this.spendGuard.recordStream(streamReservation, modelConfig, reqOptions, outputBytes);
            const durationMs = Date.now() - startMs;
            const estimatedTokensOut = Math.ceil(charCount / 4);
            // TTFT breaker signal — only when a first chunk actually arrived (success).
            if (firstChunkMs !== undefined) this.recordTtftSample(modelConfig.provider, firstChunkMs).catch(() => {});
            this.trackStats(options.tenantId, modelConfig, durationMs, {
                promptTokens: 0,
                completionTokens: estimatedTokensOut,
                totalTokens: estimatedTokensOut,
            }, errored).catch(err => {
                this.logger.warn(`Failed to track stream stats: ${err.message}`);
            });
        }
    }

    analyzeComplexity(message: string): number {
        let score = 0;
        // Umbrales de CHAT, no de email. Los anteriores (>500 / >200 / >50)
        // venian de textos largos: en WhatsApp un mensaje de 200 caracteres ya
        // es una parrafada, asi que casi todo caia en el escalon mas bajo o en
        // cero y este eje no distinguia nada.
        if (message.length > 280) score += 30;
        else if (message.length > 120) score += 20;
        else if (message.length > 40) score += 10;

        const questionCount = (message.match(/\?/g) || []).length;
        if (questionCount > 2) score += 25;
        else if (questionCount > 0) score += 10;

        // `cotiaz` era un typo por `cotiz` y no casaba con nada: pedir una
        // cotizacion —de lo mas valioso que puede escribir un cliente— puntuaba
        // cero en este eje desde siempre.
        const technicalPatterns = /\b(cotiz|reserv|dispon|precio|factur|pago|devoluci|garant|especific|compar)/gi;
        const technicalMatches = (message.match(technicalPatterns) || []).length;
        score += Math.min(technicalMatches * 10, 30);

        const sentences = message.split(/[.!?]+/).filter(s => s.trim().length > 0);
        if (sentences.length > 3) score += 15;

        return Math.min(score, 100);
    }

    analyzeSentiment(message: string): number {
        const lowerMessage = message.toLowerCase();
        let score = 50;
        const frustrationWords = ['molest', 'queja', 'problema', 'mal', 'terrible', 'inaceptable', 'demand', 'urgen'];
        const positiveWords = ['gracias', 'excelente', 'perfecto', 'genial', 'bien', 'bueno'];
        for (const word of frustrationWords) {
            if (lowerMessage.includes(word)) score += 15;
        }
        for (const word of positiveWords) {
            if (lowerMessage.includes(word)) score -= 10;
        }
        return Math.max(0, Math.min(100, score));
    }

    stageToScore(stage: string): number {
        const stageScores: Record<string, number> = {
            greeting: 10, discovery: 40, negotiation: 80,
            closing: 90, support: 50, complaint: 85,
        };
        return stageScores[stage] || 50;
    }

    async getProviderHealth(): Promise<Array<{
        provider: string;
        configured: boolean;
        healthy: boolean;
        recentFailures: number;
        unhealthyUntil: string | null;
    }>> {
        const providers = ['openai', 'anthropic', 'google', 'xai', 'deepseek'];
        const result = [];
        for (const p of providers) {
            const configured = await this.llmKeys.isConfigured(p);
            const failKey = `llm:health:${p}:failures`;
            const failures = Number(await this.redis.get(failKey) || 0);
            // Breaker open-state lives in Redis (shared across processes). The key
            // stores the open timestamp and carries a TTL = CIRCUIT_BREAKER_TTL_MS.
            const openedAt = await this.redis.get(this.breakerOpenKey(p)).catch(() => null);
            const healthy = !openedAt;
            const unhealthyUntil = openedAt
                ? new Date(Number(openedAt) + this.CIRCUIT_BREAKER_TTL_MS).toISOString()
                : null;
            result.push({
                provider: p,
                configured,
                healthy: configured && healthy,
                recentFailures: failures,
                unhealthyUntil,
            });
        }
        return result;
    }

    getModels(): ModelConfig[] {
        return MODEL_REGISTRY;
    }
}
