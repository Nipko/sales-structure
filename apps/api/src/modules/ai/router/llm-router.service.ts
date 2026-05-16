import { Injectable, Logger, Inject } from '@nestjs/common';
import { ModelTier, RoutingFactors, RoutingDecision, RoutingWeights } from '@parallext/shared';
import { ILLMProvider, LLMRequestOptions, LLMResponse } from '../interfaces/illm-provider.interface';
import { RedisService } from '../../redis/redis.service';
import { LlmKeyService } from '../../settings/llm-key.service';

interface ModelConfig {
    id: string;
    provider: string;
    tier: ModelTier;
    costPer1kTokens: number;
    maxContextTokens: number;
}

const MODEL_REGISTRY: ModelConfig[] = [
    // Tier 1 - Premium (best quality, highest cost)
    { id: 'gpt-4o', provider: 'openai', tier: 'tier_1_premium', costPer1kTokens: 0.015, maxContextTokens: 128000 },
    { id: 'claude-3-5-sonnet-20241022', provider: 'anthropic', tier: 'tier_1_premium', costPer1kTokens: 0.015, maxContextTokens: 200000 },
    { id: 'gemini-2.5-pro', provider: 'google', tier: 'tier_1_premium', costPer1kTokens: 0.010, maxContextTokens: 1000000 },
    // Tier 2 - Conversational (natural dialogue, good value)
    { id: 'grok-4-1-fast-non-reasoning', provider: 'xai', tier: 'tier_2_standard', costPer1kTokens: 0.0005, maxContextTokens: 131072 },
    { id: 'gpt-4.1-mini', provider: 'openai', tier: 'tier_2_standard', costPer1kTokens: 0.004, maxContextTokens: 1000000 },
    { id: 'gpt-4o-mini', provider: 'openai', tier: 'tier_2_standard', costPer1kTokens: 0.003, maxContextTokens: 128000 },
    // Tier 3 - Efficient (fast, cheap)
    { id: 'gemini-2.5-flash', provider: 'google', tier: 'tier_3_efficient', costPer1kTokens: 0.0005, maxContextTokens: 1000000 },
    // Tier 4 - Budget
    { id: 'deepseek-chat', provider: 'deepseek', tier: 'tier_4_budget', costPer1kTokens: 0.0001, maxContextTokens: 64000 },
];

const DEFAULT_WEIGHTS: RoutingWeights = {
    ticketValue: 0.30,
    complexity: 0.30,
    conversationStage: 0.20,
    sentiment: 0.10,
    intentType: 0.10,
};

@Injectable()
export class LLMRouterService {
    private readonly logger = new Logger(LLMRouterService.name);

    constructor(
        @Inject('LLM_PROVIDERS') private providers: ILLMProvider[],
        private redis: RedisService,
        private llmKeys: LlmKeyService,
    ) { }

    /**
     * Get a registered provider by name
     */
    getProvider(name: string): ILLMProvider {
        const provider = this.providers.find(p => p.providerName === name);
        if (!provider) {
            throw new Error(`Provider \${name} not found`);
        }
        return provider;
    }

    /**
     * Execute completion against the dynamically selected model.
     * If tenantId is supplied, usage stats (calls, tokens, cost, latency)
     * are persisted to Redis under the daily aggregation key so the
     * super_admin observability page can show per-tenant LLM consumption.
     */
    async execute(options: LLMRequestOptions & {
        routingFactors?: RoutingFactors;
        allowedTiers?: ModelTier[];
        tenantId?: string;
    }): Promise<LLMResponse & { routingDecision?: RoutingDecision }> {
        let modelConfig: ModelConfig | undefined;
        let routingDecision: RoutingDecision | undefined;

        if (options.routingFactors) {
            routingDecision = await this.selectModel(options.routingFactors, undefined, options.allowedTiers);
            modelConfig = MODEL_REGISTRY.find(m => m.id === routingDecision!.selectedModel.id);
        } else {
            modelConfig = MODEL_REGISTRY.find(m => m.id === options.model);
        }

        if (!modelConfig) {
            // Fallback
            modelConfig = MODEL_REGISTRY[0];
            this.logger.warn(`Model config not found, falling back to ${modelConfig.id}`);
        }

        options.model = modelConfig.id;
        const provider = this.getProvider(modelConfig.provider);
        const startTime = Date.now();
        let response: LLMResponse;
        let errored = false;
        try {
            response = await provider.generate(options);
        } catch (e) {
            errored = true;
            const durationMs = Date.now() - startTime;
            this.trackStats(options.tenantId, modelConfig, durationMs, undefined, true).catch(() => {});
            throw e;
        }
        const durationMs = Date.now() - startTime;

        this.logger.log(`[LLM] Generated via ${provider.providerName} (${modelConfig.id}) in ${durationMs}ms`);
        // Fire-and-forget — never block the caller on telemetry
        this.trackStats(options.tenantId, modelConfig, durationMs, response.usage, errored).catch(err => {
            this.logger.warn(`Failed to track LLM stats: ${err.message}`);
        });

        return { ...response, routingDecision };
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
        const baseKey = `llm:stats:${tenantId}:${date}:${modelConfig.provider}`;
        const tokens = usage?.totalTokens || 0;
        const tokensIn = usage?.promptTokens || 0;
        const tokensOut = usage?.completionTokens || 0;
        // Cost in centi-USD (USD * 10000) so we can use integer INCRBY.
        // costPer1kTokens is dollars per 1000 tokens.
        const costCentiUsd = Math.round((tokens / 1000) * modelConfig.costPer1kTokens * 10000);

        const ttl = 90 * 24 * 3600;
        const incrs: Promise<any>[] = [
            this.redis.incrBy(`${baseKey}:calls`, 1),
            this.redis.incrBy(`${baseKey}:tokens_in`, tokensIn),
            this.redis.incrBy(`${baseKey}:tokens_out`, tokensOut),
            this.redis.incrBy(`${baseKey}:cost_centi_usd`, costCentiUsd),
            this.redis.incrBy(`${baseKey}:latency_sum_ms`, latencyMs),
            this.redis.sadd('llm:stats:dates', date),
            this.redis.sadd(`llm:stats:tenants:${date}`, tenantId),
            this.redis.sadd(`llm:stats:providers:${date}`, modelConfig.provider),
        ];
        if (errored) incrs.push(this.redis.incrBy(`${baseKey}:errors`, 1));
        await Promise.allSettled(incrs);
        // TTL on the day-scoped keys
        await Promise.allSettled([
            this.redis.expire(`${baseKey}:calls`, ttl),
            this.redis.expire(`${baseKey}:tokens_in`, ttl),
            this.redis.expire(`${baseKey}:tokens_out`, ttl),
            this.redis.expire(`${baseKey}:cost_centi_usd`, ttl),
            this.redis.expire(`${baseKey}:latency_sum_ms`, ttl),
        ]);
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
     * Execute streamed completion
     */
    async *executeStream(options: LLMRequestOptions & { routingFactors?: RoutingFactors, allowedTiers?: ModelTier[] }): AsyncGenerator<string, void, unknown> {
        let modelConfig: ModelConfig | undefined;

        if (options.routingFactors) {
            const decision = await this.selectModel(options.routingFactors, undefined, options.allowedTiers);
            modelConfig = MODEL_REGISTRY.find(m => m.id === decision.selectedModel.id);
        } else {
            modelConfig = MODEL_REGISTRY.find(m => m.id === options.model);
        }

        if (!modelConfig) {
            modelConfig = MODEL_REGISTRY[0];
        }

        options.model = modelConfig.id;
        const provider = this.getProvider(modelConfig.provider);
        
        yield* provider.generateStream(options);
    }

    /**
     * Select the optimal model based on multi-factor analysis
     */
    async selectModel(factors: RoutingFactors, weights?: RoutingWeights, allowedTiers?: ModelTier[]): Promise<RoutingDecision> {
        const w = weights || DEFAULT_WEIGHTS;

        // Calculate composite score (0-100)
        const compositeScore = Math.round(
            factors.ticketValue * w.ticketValue +
            factors.complexity * w.complexity +
            factors.conversationStage * w.conversationStage +
            factors.sentiment * w.sentiment +
            factors.intentType * w.intentType
        );

        // Map score to tier
        let selectedTier: ModelTier;
        if (compositeScore >= 80) {
            selectedTier = 'tier_1_premium';
        } else if (compositeScore >= 50) {
            selectedTier = 'tier_2_standard';
        } else if (compositeScore >= 25) {
            selectedTier = 'tier_3_efficient';
        } else {
            selectedTier = 'tier_4_budget';
        }

        // Filter by allowed tiers if specified
        if (allowedTiers && !allowedTiers.includes(selectedTier)) {
            selectedTier = allowedTiers[0];
        }

        // Build set of configured providers (single cache read)
        const configuredProviders = new Set<string>();
        for (const p of ['openai', 'anthropic', 'google', 'xai', 'deepseek']) {
            if (await this.llmKeys.isConfigured(p)) configuredProviders.add(p);
        }

        // Select model from tier — only include models whose provider has an API key
        let availableModels = MODEL_REGISTRY
            .filter(m => m.tier === selectedTier)
            .filter(m => configuredProviders.has(m.provider));

        // If no configured provider in this tier, try upgrading tiers
        if (availableModels.length === 0) {
            const tierOrder: ModelTier[] = ['tier_4_budget', 'tier_3_efficient', 'tier_2_standard', 'tier_1_premium'];
            const startIdx = tierOrder.indexOf(selectedTier) + 1;
            for (let i = startIdx; i < tierOrder.length; i++) {
                availableModels = MODEL_REGISTRY
                    .filter(m => m.tier === tierOrder[i])
                    .filter(m => configuredProviders.has(m.provider));
                if (availableModels.length > 0) {
                    selectedTier = tierOrder[i];
                    this.logger.warn(`No configured provider in original tier — upgraded to ${selectedTier}`);
                    break;
                }
            }
        }

        // Last resort: pick any model with a configured provider
        if (availableModels.length === 0) {
            availableModels = MODEL_REGISTRY.filter(m => configuredProviders.has(m.provider));
        }

        if (availableModels.length === 0) {
            throw new Error('No LLM provider is configured — set at least one API key from the super admin dashboard');
        }

        const selectedModel = availableModels[0];

        const decision: RoutingDecision = {
            selectedTier,
            selectedModel: {
                id: selectedModel.id,
                provider: selectedModel.provider as any,
                name: selectedModel.id,
                tier: selectedTier,
                costPer1kTokens: selectedModel.costPer1kTokens,
                maxContextTokens: selectedModel.maxContextTokens,
                supportsTools: true,
                supportsVision: selectedModel.tier === 'tier_1_premium',
            },
            compositeScore,
            factors,
            reasoning: `Score ${compositeScore}/100 → ${selectedTier} → ${selectedModel.id}`,
        };

        this.logger.debug(`Routing decision: ${decision.reasoning}`);
        return decision;
    }

    /**
     * Get fallback model (one tier higher)
     */
    getUpgradedModel(currentTier: ModelTier): ModelConfig | null {
        const tierOrder: ModelTier[] = ['tier_4_budget', 'tier_3_efficient', 'tier_2_standard', 'tier_1_premium'];
        const currentIndex = tierOrder.indexOf(currentTier);

        if (currentIndex >= tierOrder.length - 1) return null;

        const upgradedTier = tierOrder[currentIndex + 1];
        return MODEL_REGISTRY.find(m => m.tier === upgradedTier) || null;
    }

    /**
     * Analyze message complexity
     */
    analyzeComplexity(message: string): number {
        let score = 0;

        // Length factor
        if (message.length > 500) score += 30;
        else if (message.length > 200) score += 20;
        else if (message.length > 50) score += 10;

        // Question marks (multiple questions)
        const questionCount = (message.match(/\?/g) || []).length;
        if (questionCount > 2) score += 25;
        else if (questionCount > 0) score += 10;

        // Technical/specific terms
        const technicalPatterns = /\b(cotiaz|reserv|dispon|precio|factur|pago|devoluci|garant|especific|compar)/gi;
        const technicalMatches = (message.match(technicalPatterns) || []).length;
        score += Math.min(technicalMatches * 10, 30);

        // Multiple topics/intenciones
        const sentences = message.split(/[.!?]+/).filter(s => s.trim().length > 0);
        if (sentences.length > 3) score += 15;

        return Math.min(score, 100);
    }

    /**
     * Analyze sentiment
     */
    analyzeSentiment(message: string): number {
        const lowerMessage = message.toLowerCase();
        let score = 50; // Neutral baseline

        // Frustration indicators → higher score = needs better model
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

    /**
     * Map conversation stage to score
     */
    stageToScore(stage: string): number {
        const stageScores: Record<string, number> = {
            greeting: 10,
            discovery: 40,
            negotiation: 80,
            closing: 90,
            support: 50,
            complaint: 85,
        };
        return stageScores[stage] || 50;
    }

    /**
     * Get all available models
     */
    getModels(): ModelConfig[] {
        return MODEL_REGISTRY;
    }
}
