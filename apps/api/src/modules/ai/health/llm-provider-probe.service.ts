import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import { CronLockService } from '../../redis/cron-lock.service';
import { LlmKeyService } from '../../settings/llm-key.service';
import { activeLlmCatalog } from '../router/llm-catalog';
import {
    ACCOUNT_FAILURE_BREAKER_SEC, LLM_PROVIDERS, LlmProviderHealthService, llmBreakerOpenKey,
} from './llm-provider-health.service';
import { deepseekChatExtras, geminiThinkingConfig, openAIChatParams, xaiChatParams } from '../providers/model-request-params';
import { isAccountFailure } from './llm-provider-error';

/** `redis-cli SET llm:probe:drill openai EX 900` -> la proxima sonda corre un simulacro con una clave invalida. */
export const LLM_PROBE_DRILL_KEY = 'llm:probe:drill';
/** Clave que ningun proveedor acepta: el simulacro nunca toca la clave real ni la config de un tenant. */
const DRILL_INVALID_KEY = 'sk-parallext-drill-invalid-key-000000000000';
const PROBE_TIMEOUT_MS = 20_000;
/** Si el trafico tuvo exito hace menos de esto, la llamada minima sobra. */
const SKIP_PROBE_IF_SUCCESS_WITHIN_MS = 4 * 60 * 1000;

export interface ProbeResult {
    ok: boolean;
    model: string;
    /** Cuenta a la que factura la clave, si el proveedor la dice (OpenAI: cabeceras openai-organization / openai-project). */
    account?: string;
    error?: { status?: number; code?: string; type?: string; message: string; name?: string };
}

/**
 * Sonda proactiva de proveedores LLM (ADR-0026).
 *
 * Cada 5 minutos, por proveedor configurado, una llamada minima (max 1 token)
 * al modelo mas barato que tenemos de ese proveedor. Detecta "sin creditos" y
 * "clave invalida" aunque no haya trafico. Donde el proveedor lo expone sin
 * clave de administracion, ademas se lee el saldo o el estado de la clave:
 * - DeepSeek: GET /user/balance (saldo real -> aviso de saldo bajo).
 * - xAI: GET /v1/api-key (clave o equipo bloqueados).
 * OpenAI, Anthropic y Google no exponen saldo con una API key normal.
 */
@Injectable()
export class LlmProviderProbeService {
    private readonly logger = new Logger(LlmProviderProbeService.name);

    constructor(
        private readonly health: LlmProviderHealthService,
        private readonly llmKeys: LlmKeyService,
        private readonly redis: RedisService,
        private readonly cronLock: CronLockService,
        private readonly config: ConfigService,
    ) { }

    private get enabled(): boolean {
        return String(this.config.get('LLM_PROVIDER_PROBE_ENABLED') ?? 'true').toLowerCase() !== 'false';
    }

    private get lowBalanceThreshold(): number {
        const n = Number(this.config.get('LLM_LOW_BALANCE_USD') ?? 5);
        return Number.isFinite(n) ? n : 5;
    }

    @Cron('1,6,11,16,21,26,31,36,41,46,51,56 * * * *')
    async probeCron(): Promise<void> {
        await this.cronLock.runExclusive('llm-provider-probe', 240, () => this.runOnce());
    }

    async runOnce(): Promise<void> {
        const drill = await this.redis.getDel(LLM_PROBE_DRILL_KEY).catch(() => null);
        if (drill) await this.runDrill(drill.trim());
        if (!this.enabled) return;
        for (const provider of LLM_PROVIDERS) {
            try {
                const key = await this.llmKeys.getKey(provider);
                if (!key) continue;
                await this.probeProvider(provider, key);
            } catch (e: any) {
                this.logger.warn(`Probe of ${provider} crashed: ${e?.message}`);
            }
        }
        await this.health.checkFallbackShare().catch(e => this.logger.warn(`Fallback check failed: ${e?.message}`));
    }

    private async probeProvider(provider: string, key: string): Promise<void> {
        // Fuentes gratuitas primero.
        if (provider === 'deepseek') await this.readDeepseekBalance(key);
        if (provider === 'xai') {
            const blocked = await this.readXaiKeyStatus(key);
            if (blocked) {
                await this.health.recordFailure(provider, undefined, { status: 403, message: blocked }, 'probe');
                await this.redis.set(llmBreakerOpenKey(provider), String(Date.now()), ACCOUNT_FAILURE_BREAKER_SEC).catch(() => undefined);
                return;
            }
        }

        const state = await this.health.getState(provider);
        if (state.status === 'healthy' && state.lastSuccessAt && Date.now() - state.lastSuccessAt < SKIP_PROBE_IF_SUCCESS_WITHIN_MS) return;

        const result = await this.callMinimal(provider, key);
        if (result.account) await this.health.recordAccount(provider, result.account);
        if (result.ok) {
            await this.health.recordSuccess(provider, result.model, 'probe');
            // La cuenta responde: vuelve a rotacion ya, sin esperar el TTL del breaker.
            if (state.status === 'no_credits' || state.status === 'auth_invalid') {
                await this.redis.del(llmBreakerOpenKey(provider)).catch(() => undefined);
            }
            return;
        }
        const kind = await this.health.recordFailure(provider, result.model, result.error, 'probe');
        if (isAccountFailure(kind)) {
            await this.redis.set(llmBreakerOpenKey(provider), String(Date.now()), ACCOUNT_FAILURE_BREAKER_SEC).catch(() => undefined);
        }
    }

    /** Simulacro: misma sonda y mismo camino de aviso, con una clave invalida y un proveedor `drill:*`. */
    async runDrill(provider: string): Promise<ProbeResult | null> {
        if (!(LLM_PROVIDERS as readonly string[]).includes(provider)) {
            this.logger.warn(`Drill ignored: unknown provider "${provider}"`);
            return null;
        }
        this.logger.warn(`LLM provider alert drill against ${provider} with an invalid key`);
        const result = await this.callMinimal(provider, DRILL_INVALID_KEY);
        const drillId = `drill:${provider}`;
        if (result.ok) {
            await this.health.recordSuccess(drillId, result.model, 'probe');
        } else {
            await this.health.recordFailure(drillId, result.model, result.error, 'probe');
        }
        return result;
    }

    private probeModel(provider: string): string {
        const models = activeLlmCatalog().models.filter(m => m.provider === provider)
            .slice()
            .sort((a, b) => a.costOutPer1k - b.costOutPer1k);
        return models[0]?.id ?? '';
    }

    async callMinimal(provider: string, key: string): Promise<ProbeResult> {
        const model = this.probeModel(provider);
        const prompt = [{ role: 'user', content: 'ping' }];
        let url: string;
        let headers: Record<string, string> = { 'Content-Type': 'application/json' };
        let body: unknown;
        switch (provider) {
            case 'openai':
            case 'xai':
            case 'deepseek':
                url = provider === 'openai' ? 'https://api.openai.com/v1/chat/completions'
                    : provider === 'xai' ? 'https://api.x.ai/v1/chat/completions'
                        : 'https://api.deepseek.com/chat/completions';
                headers = { ...headers, Authorization: `Bearer ${key}` };
                // Con los parámetros que acepta cada familia (ADR-0029): gpt-6-luna rechaza
                // `max_tokens` y un tope de 1 («Could not finish the message»); 16 basta.
                body = { model, messages: prompt,
                    ...(provider === 'openai' ? openAIChatParams(model, { temperature: 0, maxTokens: 16 })
                        : provider === 'xai' ? xaiChatParams(model, { temperature: 0, maxTokens: 1 })
                            : { temperature: 0, max_tokens: 1, ...deepseekChatExtras(model) }) };
                break;
            case 'anthropic':
                url = 'https://api.anthropic.com/v1/messages';
                headers = { ...headers, 'x-api-key': key, 'anthropic-version': '2023-06-01' };
                body = { model, messages: prompt, max_tokens: 16 };
                break;
            case 'google':
                url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
                headers = { ...headers, 'x-goog-api-key': key };
                body = {
                    contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
                    generationConfig: { maxOutputTokens: 1, thinkingConfig: geminiThinkingConfig(model) },
                };
                break;
            default:
                return { ok: false, model, error: { message: `Unknown provider ${provider}` } };
        }
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
            });
            const org = res.headers?.get?.('openai-organization');
            const project = res.headers?.get?.('openai-project');
            const account = org ? [org, project].filter(Boolean).join(' / ') : undefined;
            if (res.ok) {
                await res.text().catch(() => '');
                return { ok: true, model, account };
            }
            return { ok: false, model, account, error: await errorFromResponse(res) };
        } catch (e: any) {
            return { ok: false, model, error: { name: e?.name, code: e?.cause?.code ?? e?.code, message: e?.message ?? 'network error' } };
        }
    }

    private async readDeepseekBalance(key: string): Promise<void> {
        try {
            const res = await fetch('https://api.deepseek.com/user/balance', {
                headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
                signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
            });
            if (!res.ok) return;
            const json: any = await res.json();
            const infos: any[] = Array.isArray(json?.balance_infos) ? json.balance_infos : [];
            const info = infos.find(i => i?.currency === 'USD') ?? infos[0];
            if (!info) return;
            const amount = Number(info.total_balance);
            if (!Number.isFinite(amount)) return;
            await this.health.recordBalance('deepseek', { amount, currency: String(info.currency ?? 'USD'), at: Date.now() }, this.lowBalanceThreshold);
        } catch (e: any) {
            this.logger.debug(`DeepSeek balance read failed: ${e?.message}`);
        }
    }

    /** Devuelve un motivo si xAI dice que la clave o el equipo estan bloqueados; null si no se sabe o esta bien. */
    private async readXaiKeyStatus(key: string): Promise<string | null> {
        try {
            const res = await fetch('https://api.x.ai/v1/api-key', {
                headers: { Authorization: `Bearer ${key}` },
                signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
            });
            if (!res.ok) return null;
            const json: any = await res.json();
            if (json?.team_blocked) return 'xAI team blocked (no credits or spending limit reached)';
            if (json?.api_key_blocked) return 'xAI API key blocked';
            if (json?.api_key_disabled) return 'xAI API key disabled (permission denied)';
            return null;
        } catch {
            return null;
        }
    }
}

async function errorFromResponse(res: Response): Promise<NonNullable<ProbeResult['error']>> {
    const text = await res.text().catch(() => '');
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* not json */ }
    const e = parsed?.error ?? parsed;
    const code = typeof e?.code === 'string' ? e.code : undefined;
    const type = typeof e?.type === 'string' ? e.type : (typeof e?.status === 'string' ? e.status : undefined);
    const message = (typeof e?.message === 'string' ? e.message : (typeof e === 'string' ? e : text)) || res.statusText;
    return { status: res.status, code, type, message: `${res.status} ${message}`.slice(0, 500) };
}
