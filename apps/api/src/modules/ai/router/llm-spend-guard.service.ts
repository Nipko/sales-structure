import { Injectable, Logger, ServiceUnavailableException, HttpException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import type { ILLMProvider, LLMRequestOptions, LLMResponse } from '../interfaces/illm-provider.interface';

export class LlmBudgetUnavailable extends ServiceUnavailableException {
    constructor() { super({ error: 'llm_budget_unavailable' }); }
}
export class LlmBudgetExceeded extends HttpException {
    constructor() { super({ error: 'llm_budget_exceeded' }, 429); }
}
export type ModelPrice = { id: string; costInPer1k: number; costOutPer1k: number; maxContextTokens: number };

/** Micro-USD, rounded upwards. The catalogue is an estimate, not a provider invoice. */
export function modelCostMicro(price: ModelPrice, input: number, output: number): number {
    if (![input, output].every(n => Number.isSafeInteger(n) && n >= 0)) throw new LlmBudgetUnavailable();
    const cost = Math.ceil(input * price.costInPer1k * 1000 + output * price.costOutPer1k * 1000);
    if (!Number.isSafeInteger(cost) || cost < 0) throw new LlmBudgetUnavailable();
    return cost;
}

export function inputTokenUpperEstimate(price: ModelPrice, request: LLMRequestOptions): number {
    const payload = JSON.stringify({ messages: request.messages, systemPrompt: request.systemPrompt, tools: request.tools });
    // Images/audio are priced by provider-specific expansion, not URL/JSON length.
    if (/"(?:image_url|input_audio|image|audio)"/.test(payload)) return price.maxContextTokens;
    return Math.min(price.maxContextTokens, Buffer.byteLength(payload, 'utf8') + 1024 + request.messages.length * 128);
}

@Injectable()
export class LlmSpendGuardService {
    private readonly logger = new Logger(LlmSpendGuardService.name);
    constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

    /** Every actual generate invocation (including source retries) gets its own reservation. */
    wrap(provider: ILLMProvider, tenantId: string, price: ModelPrice): ILLMProvider {
        return {
            providerName: provider.providerName,
            generate: async request => {
                const bounded = this.bounded(request);
                const id = await this.reserve(tenantId, price, bounded);
                // Unknown failures retain the full estimate. A timeout cannot create budget.
                const response = await provider.generate(bounded, { maxRetries: 0 });
                await this.recordUsage(id, price, response.usage);
                return response;
            },
            generateStream: provider.generateStream.bind(provider),
        };
    }

    bounded(request: LLMRequestOptions): LLMRequestOptions {
        const maxTokens = request.maxTokens ?? 2048;
        if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) throw new LlmBudgetUnavailable();
        return { ...request, maxTokens };
    }

    async reserve(tenantId: string, price: ModelPrice, request: LLMRequestOptions, transportAttempts = 1): Promise<string> {
        const reserved = modelCostMicro(price, inputTokenUpperEstimate(price, request), request.maxTokens ?? 2048) * transportAttempts;
        const month = new Date().toISOString().slice(0, 7);
        const id = randomUUID();
        try {
            await this.prisma.$transaction(async tx => {
                await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text', `llm-budget:${tenantId}:${month}`);
                const rows = await tx.$queryRawUnsafe(`SELECT p.features, t.settings
                    FROM public.tenants t JOIN public.billing_plans p ON p.slug=t.plan
                    WHERE t.id::uuid=$1::uuid AND t.is_active=true`, tenantId) as any[];
                if (!rows[0]) throw new LlmBudgetUnavailable();
                const configured = rows[0].settings?.quotaOverrides?.llmHardBudgetUsdCents
                    ?? rows[0].features?.llmHardBudgetUsdCents ?? -1;
                if (!Number.isSafeInteger(configured) || configured < -1) throw new LlmBudgetUnavailable();
                const baselineId = `opening:${tenantId}:${month}`;
                const baseline = await tx.$queryRawUnsafe('SELECT id FROM public.llm_spend_reservations WHERE id=$1', baselineId) as any[];
                if (!baseline.length) {
                    const prior = Number(await this.redis.get(`llm:cost:${tenantId}:${month}`) ?? 0);
                    if (!Number.isSafeInteger(prior) || prior < 0) throw new LlmBudgetUnavailable();
                    await tx.$executeRawUnsafe(`INSERT INTO public.llm_spend_reservations
                        (id,tenant_id,month,model,reserved_micro,accounted_micro,basis)
                        VALUES ($1,$2::uuid,$3,'opening_redis_estimate',$4,$4,'opening_estimate')`, baselineId,tenantId,month,prior*100);
                }
                const totals = await tx.$queryRawUnsafe(`SELECT COALESCE(SUM(accounted_micro),0)::text total
                    FROM public.llm_spend_reservations WHERE tenant_id::uuid=$1::uuid AND month=$2`,tenantId,month) as any[];
                if (configured >= 0 && Number(totals[0].total) + reserved > configured * 10000) throw new LlmBudgetExceeded();
                await tx.$executeRawUnsafe(`INSERT INTO public.llm_spend_reservations
                    (id,tenant_id,month,model,reserved_micro,accounted_micro,basis)
                    VALUES ($1,$2::uuid,$3,$4,$5,$5,'reserved_estimate')`,id,tenantId,month,price.id,reserved);
            });
            return id;
        } catch (error) {
            if (error instanceof LlmBudgetExceeded || error instanceof LlmBudgetUnavailable) throw error;
            this.logger.error(`LLM budget storage unavailable (${String((error as any)?.code ?? 'unknown')})`);
            throw new LlmBudgetUnavailable();
        }
    }

    async recordStream(id: string, price: ModelPrice, request: LLMRequestOptions, outputBytes: number) {
        await this.recordUsage(id, price, { promptTokens: inputTokenUpperEstimate(price,request),
            completionTokens: request.maxTokens ?? 2048, totalTokens: 0 }, 'stream_upper_estimate');
    }

    private async recordUsage(id: string, price: ModelPrice, usage: LLMResponse['usage'], basis = 'reported_tokens_estimate'): Promise<void> {
        if (!usage) return; // No usage is not free usage.
        try {
            const actual = modelCostMicro(price, usage.promptTokens, usage.completionTokens);
            await this.prisma.$executeRawUnsafe(`UPDATE public.llm_spend_reservations
                SET accounted_micro=$2, basis=$3, updated_at=clock_timestamp()
                WHERE id=$1 AND basis='reserved_estimate'`,id,actual,basis);
        } catch {
            // Never retry a successful model call because accounting was unavailable.
            this.logger.error(`LLM usage reconciliation pending for reservation ${id}`);
        }
    }
}
