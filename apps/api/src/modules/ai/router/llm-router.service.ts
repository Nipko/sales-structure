import { Injectable, Logger, Inject } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ModelTier, RoutingFactors, RoutingDecision } from '@parallext/shared';
import { ILLMProvider, LLMRequestOptions, LLMResponse } from '../interfaces/illm-provider.interface';
import { RedisService } from '../../redis/redis.service';
import { LlmKeyService } from '../../settings/llm-key.service';

type TaskType = 'conversation' | 'tool_calling';

interface ModelConfig {
    id: string;
    provider: string;
    tier: ModelTier;
    costPer1kTokens: number;
    maxContextTokens: number;
    supportsTools: boolean;
}

const MODEL_REGISTRY: ModelConfig[] = [
    // Tier 1 — Premium (best quality, reserved for enterprise/custom plans)
    { id: 'claude-sonnet-4-6', provider: 'anthropic', tier: 'tier_1_premium', costPer1kTokens: 0.015, maxContextTokens: 200000, supportsTools: true },
    { id: 'gpt-4o', provider: 'openai', tier: 'tier_1_premium', costPer1kTokens: 0.0125, maxContextTokens: 128000, supportsTools: true },
    { id: 'gemini-2.5-pro', provider: 'google', tier: 'tier_1_premium', costPer1kTokens: 0.010, maxContextTokens: 1000000, supportsTools: false },
    // Tier 2 — Standard (good quality, good value — pro plans)
    { id: 'grok-4-1-fast-non-reasoning', provider: 'xai', tier: 'tier_2_standard', costPer1kTokens: 0.0005, maxContextTokens: 131072, supportsTools: true },
    { id: 'gpt-4.1-mini', provider: 'openai', tier: 'tier_2_standard', costPer1kTokens: 0.004, maxContextTokens: 1000000, supportsTools: true },
    { id: 'gpt-4o-mini', provider: 'openai', tier: 'tier_2_standard', costPer1kTokens: 0.003, maxContextTokens: 128000, supportsTools: true },
    // Tier 3 — Efficient (fast, cheap — starter plans)
    { id: 'gemini-2.5-flash', provider: 'google', tier: 'tier_3_efficient', costPer1kTokens: 0.0005, maxContextTokens: 1000000, supportsTools: false },
    // Tier 4 — Budget (cheapest available)
    { id: 'deepseek-chat', provider: 'deepseek', tier: 'tier_4_budget', costPer1kTokens: 0.0001, maxContextTokens: 64000, supportsTools: true },
];

// Task-based fallback chains ordered by cost-effectiveness.
// Conversation: natural tone + low cost. Gemini included (no tools needed).
// Tool calling: only models with supportsTools:true. Gemini excluded.
const FALLBACK_CHAINS: Record<TaskType, string[]> = {
    conversation: [
        'grok-4-1-fast-non-reasoning',   // tier_2 — most natural conversational, $0.0005/1k
        'gemini-2.5-flash',              // tier_3 — fast + cheap, $0.0005/1k
        'gpt-4o-mini',                   // tier_2 — reliable all-around, $0.003/1k
        'deepseek-chat',                 // tier_4 — budget fallback, $0.0001/1k
        'gpt-4.1-mini',                  // tier_2 — solid backup, $0.004/1k
        'gemini-2.5-pro',                // tier_1 — premium conversation, $0.010/1k
        'gpt-4o',                        // tier_1 — premium, $0.0125/1k
        'claude-sonnet-4-6',             // tier_1 — premium reasoning, $0.015/1k
    ],
    tool_calling: [
        'gpt-4.1-mini',                  // tier_2 — best tool/cost ratio, $0.004/1k
        'gpt-4o-mini',                   // tier_2 — reliable tools, $0.003/1k
        'grok-4-1-fast-non-reasoning',   // tier_2 — OpenAI-compat tools, $0.0005/1k
        'deepseek-chat',                 // tier_4 — basic tools, $0.0001/1k
        'gpt-4o',                        // tier_1 — gold standard tools, $0.0125/1k
        'claude-sonnet-4-6',             // tier_1 — excellent tools, $0.015/1k
    ],
};

const ALL_TIERS: ModelTier[] = ['tier_1_premium', 'tier_2_standard', 'tier_3_efficient', 'tier_4_budget'];

@Injectable()
export class LLMRouterService {
    private readonly logger = new Logger(LLMRouterService.name);
    private providerHealth = new Map<string, number>();
    private readonly CIRCUIT_BREAKER_TTL_MS = 120_000;

    constructor(
        @Inject('LLM_PROVIDERS') private providers: ILLMProvider[],
        private redis: RedisService,
        private llmKeys: LlmKeyService,
        private eventEmitter: EventEmitter2,
    ) { }

    getProvider(name: string): ILLMProvider {
        const provider = this.providers.find(p => p.providerName === name);
        if (!provider) throw new Error(`Provider ${name} not found`);
        return provider;
    }

    private isProviderHealthy(provider: string): boolean {
        const unhealthyUntil = this.providerHealth.get(provider);
        if (!unhealthyUntil) return true;
        if (Date.now() >= unhealthyUntil) {
            this.providerHealth.delete(provider);
            return true;
        }
        return false;
    }

    private markProviderUnhealthy(provider: string, errorMessage?: string): void {
        this.providerHealth.set(provider, Date.now() + this.CIRCUIT_BREAKER_TTL_MS);
        this.logger.warn(`[CircuitBreaker] ${provider} marked unhealthy for ${this.CIRCUIT_BREAKER_TTL_MS / 1000}s`);

        const failKey = `llm:health:${provider}:failures`;
        this.redis.incrBy(failKey, 1).then(count => {
            this.redis.expire(failKey, 600).catch(e => this.logger.warn(`Redis expire failed for ${failKey}: ${e.message}`));
            if (count === 3 || count === 10 || count === 25) {
                this.eventEmitter.emit('llm.provider.alert', {
                    provider,
                    severity: count >= 10 ? 'critical' : 'warning',
                    failures: count,
                    error: errorMessage || 'Provider unavailable',
                    timestamp: new Date().toISOString(),
                });
            }
        }).catch(e => this.logger.warn(`Redis circuit breaker tracking failed for ${provider}: ${e.message}`));
    }

    private async buildCandidates(
        task: TaskType,
        allowedTiers: ModelTier[],
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

        const available = eligible.filter(m =>
            configuredProviders.has(m.provider) && this.isProviderHealthy(m.provider),
        );

        const primary = available.filter(m => allowedTiers.includes(m.tier));
        const escalation = available.filter(m => !allowedTiers.includes(m.tier));

        return [...primary, ...escalation];
    }

    async execute(options: Omit<LLMRequestOptions, 'model'> & {
        model?: string;
        task?: TaskType;
        routingFactors?: RoutingFactors;
        allowedTiers?: ModelTier[];
        tenantId?: string;
        traceContext?: { conversationId?: string; kbSources?: string[]; stage?: string };
    }): Promise<LLMResponse & { routingDecision?: RoutingDecision }> {

        if (options.task) {
            const allowedTiers = options.allowedTiers || ALL_TIERS;
            const candidates = await this.buildCandidates(options.task, allowedTiers);

            if (candidates.length === 0) {
                throw new Error('No LLM provider is configured — set at least one API key from the super admin dashboard');
            }

            let lastError: Error | undefined;
            for (const candidate of candidates) {
                const startTime = Date.now();
                try {
                    const provider = this.getProvider(candidate.provider);
                    const reqOptions: LLMRequestOptions = {
                        ...options as Omit<LLMRequestOptions, 'model'>,
                        model: candidate.id,
                    };

                    const response = await provider.generate(reqOptions);
                    const durationMs = Date.now() - startTime;

                    const escalated = !allowedTiers.includes(candidate.tier);
                    if (escalated) {
                        this.logger.warn(`[LLM] Auto-escalated to ${candidate.id} (${candidate.tier}) — no model in plan tiers`);
                    }

                    this.logger.log(`[LLM] ${options.task} via ${candidate.provider} (${candidate.id}) in ${durationMs}ms`);
                    this.trackStats(options.tenantId, candidate, durationMs, response.usage, false).catch(e => this.logger.warn(`AI stats tracking failed: ${e.message}`));
                    this.emitTurnTrace(options, candidate, durationMs, response, escalated, options.task);

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
                        compositeScore: 0,
                        factors: { ticketValue: 0, complexity: 0, conversationStage: 0, sentiment: 0, intentType: 0 },
                        reasoning: `task:${options.task} → ${candidate.id} (${candidate.provider})`,
                    };

                    return { ...response, routingDecision: decision };
                } catch (err: any) {
                    const durationMs = Date.now() - startTime;
                    this.trackStats(options.tenantId, candidate, durationMs, undefined, true).catch(e => this.logger.warn(`AI stats tracking failed: ${e.message}`));
                    this.markProviderUnhealthy(candidate.provider, err.message);
                    lastError = err;
                    this.logger.warn(`[LLM] ${candidate.provider}/${candidate.id} failed: ${err.message} — trying next`);
                }
            }

            this.eventEmitter.emit('llm.provider.alert', {
                provider: 'all',
                severity: 'critical',
                failures: candidates.length,
                error: `All ${candidates.length} LLM providers failed. Last: ${lastError?.message}`,
                timestamp: new Date().toISOString(),
            });

            throw lastError || new Error('All LLM providers failed');
        }

        // Direct model selection (backwards compat for copilot, widget, etc.)
        let modelConfig = options.model
            ? MODEL_REGISTRY.find(m => m.id === options.model)
            : undefined;

        if (!modelConfig) {
            modelConfig = MODEL_REGISTRY[0];
            this.logger.warn(`Model ${options.model || '(none)'} not in registry, falling back to ${modelConfig.id}`);
        }

        const provider = this.getProvider(modelConfig.provider);
        const reqOptions: LLMRequestOptions = {
            ...options as Omit<LLMRequestOptions, 'model'>,
            model: modelConfig.id,
        };
        const startTime = Date.now();
        try {
            const response = await provider.generate(reqOptions);
            const durationMs = Date.now() - startTime;
            this.logger.log(`[LLM] Direct via ${provider.providerName} (${modelConfig.id}) in ${durationMs}ms`);
            this.trackStats(options.tenantId, modelConfig, durationMs, response.usage, false).catch(e => this.logger.warn(`AI stats tracking failed: ${e.message}`));
            this.emitTurnTrace(options, modelConfig, durationMs, response, false, undefined);
            return { ...response };
        } catch (e: any) {
            const durationMs = Date.now() - startTime;
            this.trackStats(options.tenantId, modelConfig, durationMs, undefined, true).catch(e => this.logger.warn(`AI stats tracking failed: ${e.message}`));
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
            const mediaTenantsToScan = opts.tenantId ? [opts.tenantId] : tenantSet;
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

        try {
            for await (const chunk of provider.generateStream(reqOptions)) {
                charCount += chunk.length;
                yield chunk;
            }
        } catch (e) {
            errored = true;
            throw e;
        } finally {
            const durationMs = Date.now() - startMs;
            const estimatedTokensOut = Math.ceil(charCount / 4);
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
        if (message.length > 500) score += 30;
        else if (message.length > 200) score += 20;
        else if (message.length > 50) score += 10;

        const questionCount = (message.match(/\?/g) || []).length;
        if (questionCount > 2) score += 25;
        else if (questionCount > 0) score += 10;

        const technicalPatterns = /\b(cotiaz|reserv|dispon|precio|factur|pago|devoluci|garant|especific|compar)/gi;
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
            const healthy = this.isProviderHealthy(p);
            const failKey = `llm:health:${p}:failures`;
            const failures = Number(await this.redis.get(failKey) || 0);
            const unhealthyTs = this.providerHealth.get(p);
            result.push({
                provider: p,
                configured,
                healthy: configured && healthy,
                recentFailures: failures,
                unhealthyUntil: unhealthyTs ? new Date(unhealthyTs).toISOString() : null,
            });
        }
        return result;
    }

    getModels(): ModelConfig[] {
        return MODEL_REGISTRY;
    }
}
