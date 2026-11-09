import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RedisService } from '../../redis/redis.service';
import {
    classifyProviderError, isAccountFailure, summarizeProviderError,
    PROVIDER_ERROR_LABEL_ES, ProviderErrorKind,
} from './llm-provider-error';
import {
    alertForTransition, fallbackIsSignificant, INITIAL_PROVIDER_STATE, nextProviderState,
    ObservationSource, PROVIDER_STATUS_LABEL_ES, ProviderObservation, ProviderState,
    SEVERE_STATUSES, FallbackWindow,
} from './llm-provider-state';

/** Marca fija en los logs: buscar `LLM_PROVIDER_ALERT` en Loki/Dozzle. */
export const LLM_PROVIDER_ALERT_MARKER = '[LLM_PROVIDER_ALERT]';

/** Evento que el HealthModule convierte en incidente + Telegram + email. */
export const LLM_PROVIDER_HEALTH_ALERT_EVENT = 'llm.provider.health_alert';

export interface LlmProviderHealthAlert {
    /** Clave del incidente (dedupe en platform_incidents). */
    key: string;
    severity: 'critical' | 'warning' | 'info';
    subject: string;
    html: string;
    value: number;
    /** Incidentes que este aviso cierra (p. ej. al recuperarse). */
    resolveKeys?: string[];
    /** Aviso sin incidente abierto (recuperacion). */
    noIncident?: boolean;
    /** Solo cerrar `resolveKeys`, sin mandar nada. */
    resolveOnly?: boolean;
    /** Simulacro: se avisa y el incidente se cierra al momento. */
    drill?: boolean;
}

export const LLM_PROVIDERS = ['openai', 'anthropic', 'google', 'xai', 'deepseek'] as const;

/** Clave del breaker del router (compartida). */
export function llmBreakerOpenKey(provider: string): string {
    return `llm:health:${provider}:open`;
}

/** Un proveedor sin credito o con la clave mala queda fuera de rotacion este tiempo, renovable. */
export const ACCOUNT_FAILURE_BREAKER_SEC = 600;
/** Recordatorio mientras un proveedor siga en estado grave. */
const OUTAGE_REMINDER_SEC = 6 * 3600;
const RECOVERY_DEDUP_SEC = 600;
/** Guardia local si Redis no responde: nunca mas de un aviso por clave cada 5 min por proceso. */
const LOCAL_MIN_INTERVAL_MS = 5 * 60 * 1000;
const STATE_TTL_SEC = 30 * 24 * 3600;
const DRILL_STATE_TTL_SEC = 3600;
const ERRORS_TTL_SEC = 8 * 24 * 3600;
const ROUTING_BUCKET_SEC = 300;
const ROUTING_TTL_SEC = 26 * 3600;

export interface ProviderBalance {
    amount: number;
    currency: string;
    at: number;
}

export interface ProviderSnapshot extends ProviderState {
    provider: string;
    statusLabel: string;
    lastErrorLabel: string | null;
    breakerOpen: boolean;
    lastProbeAt: number | null;
    lastProbeOk: boolean | null;
    balance: ProviderBalance | null;
    /** Errores de hoy (UTC) por tipo. */
    errorsToday: Partial<Record<ProviderErrorKind, number>>;
    /** Errores de hoy (UTC) por modelo. */
    errorsTodayByModel: Record<string, number>;
}

export interface RoutingSummary extends FallbackWindow {
    pct: number;
}

@Injectable()
export class LlmProviderHealthService {
    private readonly logger = new Logger(LlmProviderHealthService.name);
    private readonly localAlertAt = new Map<string, number>();

    constructor(
        private readonly redis: RedisService,
        private readonly events: EventEmitter2,
    ) { }

    private stateKey(provider: string): string {
        return `llm:provider:state:${provider}`;
    }

    private errorsKey(day: string): string {
        return `llm:provider:errors:${day}`;
    }

    private routingKey(bucket: number): string {
        return `llm:routing:${bucket}`;
    }

    private isDrill(provider: string): boolean {
        return provider.startsWith('drill:');
    }

    async getState(provider: string): Promise<ProviderState> {
        try {
            const raw = await this.redis.get(this.stateKey(provider));
            if (!raw) return { ...INITIAL_PROVIDER_STATE };
            return { ...INITIAL_PROVIDER_STATE, ...JSON.parse(raw) };
        } catch {
            return { ...INITIAL_PROVIDER_STATE };
        }
    }

    /** Un exito de trafico o de la sonda. Nunca lanza. */
    async recordSuccess(provider: string, model: string | undefined, source: ObservationSource): Promise<void> {
        await this.observe(provider, { ok: true, at: Date.now(), source, model });
    }

    /**
     * Un error de trafico o de la sonda. Devuelve la clasificacion para que el
     * router decida si saca al proveedor de rotacion. Nunca lanza.
     */
    async recordFailure(provider: string, model: string | undefined, err: unknown, source: ObservationSource): Promise<ProviderErrorKind> {
        const kind = classifyProviderError(err, provider.replace(/^drill:/, ''));
        const message = summarizeProviderError(err);
        await this.observe(provider, { ok: false, at: Date.now(), source, model, kind, message });
        return kind;
    }

    private async observe(provider: string, obs: ProviderObservation): Promise<void> {
        try {
            const prev = await this.getState(provider);
            const { state, transition } = nextProviderState(prev, obs);
            const ttl = this.isDrill(provider) ? DRILL_STATE_TTL_SEC : STATE_TTL_SEC;
            await this.redis.set(this.stateKey(provider), JSON.stringify(state), ttl);
            if (obs.source === 'probe') {
                await this.redis.set(`llm:provider:probe:${provider}`, JSON.stringify({ at: obs.at, ok: obs.ok }), ttl);
            }
            if (!obs.ok) {
                const day = new Date(obs.at).toISOString().slice(0, 10);
                const key = this.errorsKey(day);
                await this.redis.hincrBy(key, `${provider}|${obs.model ?? '-'}|${obs.kind}`, 1);
                await this.redis.expire(key, ERRORS_TTL_SEC);
                if (obs.kind === 'model_not_found' && obs.model) await this.alertModelGone(provider, obs.model, obs.message);
            }

            const decision = alertForTransition(transition);
            if (decision === 'recovery') {
                await this.alertRecovery(provider, prev, state);
            } else if (!obs.ok && SEVERE_STATUSES.has(state.status)) {
                // Entrada a un estado grave, o recordatorio cada 6 h si sigue.
                await this.alertOutage(provider, state, transition !== null);
            }
        } catch (e: any) {
            this.logger.warn(`Provider health tracking failed for ${provider}: ${e?.message}`);
        }
    }

    private async gate(key: string, ttlSec: number): Promise<boolean> {
        const last = this.localAlertAt.get(key) ?? 0;
        if (Date.now() - last < LOCAL_MIN_INTERVAL_MS) return false;
        const got = await this.redis.acquireLock(key, ttlSec).catch(() => true);
        if (got) this.localAlertAt.set(key, Date.now());
        return got;
    }

    private providerLabel(provider: string): string {
        const base = provider.replace(/^drill:/, '');
        const names: Record<string, string> = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google Gemini', xai: 'xAI (Grok)', deepseek: 'DeepSeek' };
        return (names[base] ?? base) + (this.isDrill(provider) ? ' (simulacro)' : '');
    }

    private remedy(provider: string, status: string): string {
        const base = provider.replace(/^drill:/, '');
        const billing: Record<string, string> = {
            openai: 'https://platform.openai.com/settings/organization/billing',
            anthropic: 'https://console.anthropic.com/settings/billing',
            google: 'https://aistudio.google.com/app/plan_information',
            xai: 'https://console.x.ai',
            deepseek: 'https://platform.deepseek.com/top_up',
        };
        if (status === 'no_credits') return `Recargar saldo en ${billing[base] ?? 'la consola del proveedor'}.`;
        if (status === 'auth_invalid') return 'Revisar o rotar la API key en el superadmin (Configuracion &gt; Claves LLM).';
        return 'Revisar la pagina de estado del proveedor; el router lo reintenta solo cuando vence el breaker.';
    }

    private fmt(ts: number | null): string {
        return ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '-';
    }

    private async alertOutage(provider: string, state: ProviderState, isTransition: boolean): Promise<void> {
        const status = state.status;
        const gateKey = `llm:provider:alerted:${provider}:${status}`;
        if (!(await this.gate(gateKey, OUTAGE_REMINDER_SEC))) return;
        const label = this.providerLabel(provider);
        const statusLabel = PROVIDER_STATUS_LABEL_ES[status];
        const drill = this.isDrill(provider);
        const prefix = drill ? '[SIMULACRO] ' : '';
        const subject = `${prefix}Proveedor LLM ${label}: ${statusLabel}${isTransition ? '' : ' (sigue)'}`;
        const html = `El proveedor <b>${label}</b> esta <b>${statusLabel}</b> desde ${this.fmt(state.since)}.<br>`
            + `Primer error: ${this.fmt(state.firstErrorAt)} · ultimo: ${this.fmt(state.lastErrorAt)}`
            + ` (${state.lastErrorSource === 'probe' ? 'sonda' : 'trafico'}${state.lastErrorModel ? `, modelo ${state.lastErrorModel}` : ''}).<br>`
            + `Ultimo error: <code>${escapeHtml(state.lastErrorMessage ?? '')}</code><br><br>`
            + `El router sigue atendiendo con los otros proveedores (fallback), pero este queda fuera de rotacion `
            + `hasta que la sonda o un turno vuelvan a tener exito.<br>`
            + `<b>Que hacer:</b> ${this.remedy(provider, status)}`;
        this.logger.error(`${LLM_PROVIDER_ALERT_MARKER} provider=${provider} status=${status} kind=${state.lastErrorKind} `
            + `since=${this.fmt(state.since)} last="${state.lastErrorMessage ?? ''}"`);
        this.emit({
            key: `llm:provider:${provider}:${status}`,
            severity: drill ? 'warning' : 'critical',
            subject,
            html,
            value: state.consecutiveFailures,
            drill,
        });
        // Toast en tiempo real para los admins conectados (gateway existente).
        if (!drill) {
            this.events.emit('llm.provider.alert', {
                provider,
                severity: 'critical',
                failures: state.consecutiveFailures,
                error: `${statusLabel}: ${state.lastErrorMessage ?? ''}`,
                timestamp: new Date().toISOString(),
            });
        }
    }

    private async alertRecovery(provider: string, prev: ProviderState, state: ProviderState): Promise<void> {
        const severe = [...SEVERE_STATUSES];
        await Promise.all(severe.map(s => this.redis.del(`llm:provider:alerted:${provider}:${s}`).catch(() => undefined)));
        for (const s of severe) this.localAlertAt.delete(`llm:provider:alerted:${provider}:${s}`);
        const resolveKeys = severe.map(s => `llm:provider:${provider}:${s}`);
        if (!(await this.gate(`llm:provider:alerted:${provider}:recovered`, RECOVERY_DEDUP_SEC))) {
            this.emit({ key: `llm:provider:${provider}:recovered`, severity: 'info', subject: '', html: '', value: 0, resolveKeys, resolveOnly: true });
            return;
        }
        const label = this.providerLabel(provider);
        const minutes = prev.since ? Math.round((state.lastSuccessAt! - prev.since) / 60000) : null;
        this.logger.error(`${LLM_PROVIDER_ALERT_MARKER} provider=${provider} status=healthy recovered_from=${prev.status}`);
        this.emit({
            key: `llm:provider:${provider}:recovered`,
            severity: 'info',
            subject: `Proveedor LLM ${label} recuperado`,
            html: `<b>${label}</b> vuelve a responder (${state.lastErrorSource === 'probe' ? 'sonda' : 'trafico'}). `
                + `Estuvo <b>${PROVIDER_STATUS_LABEL_ES[prev.status]}</b>${minutes !== null ? ` unos ${minutes} min` : ''}.`,
            value: 0,
            resolveKeys,
            noIncident: true,
        });
    }

    private async alertModelGone(provider: string, model: string, message: string): Promise<void> {
        if (this.isDrill(provider)) return;
        if (!(await this.gate(`llm:provider:alerted:model:${model}`, 24 * 3600))) return;
        this.logger.error(`${LLM_PROVIDER_ALERT_MARKER} provider=${provider} model=${model} status=model_not_found last="${message}"`);
        this.emit({
            key: `llm:model:${model}:not_found`,
            severity: 'warning',
            subject: `Modelo ${model} no disponible en ${this.providerLabel(provider)}`,
            html: `El modelo <b>${model}</b> responde "no encontrado / retirado". El router lo salta y usa el siguiente de la cadena.<br>`
                + `Ultimo error: <code>${escapeHtml(message)}</code><br><b>Que hacer:</b> sacarlo del catalogo (MODEL_REGISTRY) o reemplazarlo.`,
            value: 1,
        });
    }

    private emit(alert: LlmProviderHealthAlert): void {
        try {
            this.events.emit(LLM_PROVIDER_HEALTH_ALERT_EVENT, alert);
        } catch (e: any) {
            this.logger.warn(`Provider alert emit failed: ${e?.message}`);
        }
    }

    // ── Saldo (solo donde el proveedor lo expone) ──

    async recordBalance(provider: string, balance: ProviderBalance, lowThreshold: number): Promise<void> {
        try {
            await this.redis.set(`llm:provider:balance:${provider}`, JSON.stringify(balance), STATE_TTL_SEC);
            const key = `llm:provider:${provider}:low_balance`;
            if (balance.amount < lowThreshold) {
                if (!(await this.gate(`llm:provider:alerted:${provider}:low_balance`, 24 * 3600))) return;
                const label = this.providerLabel(provider);
                this.logger.error(`${LLM_PROVIDER_ALERT_MARKER} provider=${provider} status=low_balance balance=${balance.amount} ${balance.currency}`);
                this.emit({
                    key,
                    severity: 'warning',
                    subject: `Saldo bajo en ${label}: ${balance.amount.toFixed(2)} ${balance.currency}`,
                    html: `El saldo de <b>${label}</b> es <b>${balance.amount.toFixed(2)} ${balance.currency}</b>, por debajo del umbral de `
                        + `${lowThreshold} (LLM_LOW_BALANCE_USD).<br><b>Que hacer:</b> ${this.remedy(provider, 'no_credits')}`,
                    value: balance.amount,
                });
            } else {
                await this.redis.del(`llm:provider:alerted:${provider}:low_balance`).catch(() => undefined);
                this.emit({ key, severity: 'info', subject: '', html: '', value: 0, resolveKeys: [key], resolveOnly: true });
            }
        } catch (e: any) {
            this.logger.warn(`Balance tracking failed for ${provider}: ${e?.message}`);
        }
    }

    // ── Fallback: que parte del trafico no lo atiende el modelo preferido ──

    async recordRouting(servedProvider: string, fallback: boolean, at = Date.now()): Promise<void> {
        try {
            const bucket = Math.floor(at / 1000 / ROUTING_BUCKET_SEC) * ROUTING_BUCKET_SEC;
            const key = this.routingKey(bucket);
            await this.redis.hincrBy(key, 'total', 1);
            if (fallback) {
                await this.redis.hincrBy(key, 'fallback', 1);
                await this.redis.hincrBy(key, `fallback:${servedProvider}`, 1);
            }
            await this.redis.expire(key, ROUTING_TTL_SEC);
        } catch { /* best-effort */ }
    }

    async routingWindow(minutes: number, now = Date.now()): Promise<RoutingSummary & { byServedProvider: Record<string, number> }> {
        const buckets = Math.max(1, Math.ceil((minutes * 60) / ROUTING_BUCKET_SEC));
        const current = Math.floor(now / 1000 / ROUTING_BUCKET_SEC) * ROUTING_BUCKET_SEC;
        let total = 0;
        let fallback = 0;
        const byServedProvider: Record<string, number> = {};
        const rows = await Promise.all(Array.from({ length: buckets }, (_, i) =>
            this.redis.hgetall(this.routingKey(current - i * ROUTING_BUCKET_SEC)).catch(() => ({} as Record<string, string>))));
        for (const row of rows) {
            total += Number(row?.total ?? 0);
            fallback += Number(row?.fallback ?? 0);
            for (const [field, v] of Object.entries(row ?? {})) {
                if (field.startsWith('fallback:')) {
                    const p = field.slice('fallback:'.length);
                    byServedProvider[p] = (byServedProvider[p] ?? 0) + Number(v);
                }
            }
        }
        return { total, fallback, pct: total ? Math.round((fallback / total) * 1000) / 10 : 0, byServedProvider };
    }

    /** Lo llama la sonda cada 5 min: avisa si el fallback es sostenido y lo resuelve cuando baja. */
    async checkFallbackShare(): Promise<RoutingSummary> {
        const w = await this.routingWindow(15);
        const key = 'llm:fallback';
        if (fallbackIsSignificant(w)) {
            if (await this.gate('llm:provider:alerted:fallback', 3600)) {
                const served = Object.entries(w.byServedProvider).map(([p, n]) => `${p}: ${n}`).join(', ') || '-';
                this.logger.error(`${LLM_PROVIDER_ALERT_MARKER} fallback pct=${w.pct} total=${w.total} served=${served}`);
                this.emit({
                    key,
                    severity: 'warning',
                    subject: `${w.pct}% de los turnos LLM van por fallback (15 min)`,
                    html: `En los ultimos 15 minutos <b>${w.fallback}</b> de <b>${w.total}</b> turnos (${w.pct}%) no los atendio el modelo `
                        + `preferido sino uno de respaldo. Atendidos por: ${served}.<br>`
                        + 'El servicio sigue respondiendo, pero con otro modelo (otra calidad y otro costo). Revisar el estado de proveedores en el Centro de Operaciones.',
                    value: w.pct,
                });
            }
        } else if (w.total >= 1) {
            await this.redis.del('llm:provider:alerted:fallback').catch(() => undefined);
            this.localAlertAt.delete('llm:provider:alerted:fallback');
            this.emit({ key, severity: 'info', subject: '', html: '', value: 0, resolveKeys: [key], resolveOnly: true });
        }
        return { total: w.total, fallback: w.fallback, pct: w.pct };
    }

    // ── Vista del superadmin ──

    async snapshot(configured: Record<string, boolean>): Promise<{
        providers: Array<ProviderSnapshot & { configured: boolean }>;
        routing: { lastHour: RoutingSummary & { byServedProvider: Record<string, number> }; last24h: RoutingSummary & { byServedProvider: Record<string, number> } };
        generatedAt: string;
    }> {
        const day = new Date().toISOString().slice(0, 10);
        const errors = await this.redis.hgetall(this.errorsKey(day)).catch(() => ({} as Record<string, string>));
        const providers = await Promise.all(LLM_PROVIDERS.map(async provider => {
            const state = await this.getState(provider);
            const [breaker, probeRaw, balanceRaw] = await Promise.all([
                this.redis.get(llmBreakerOpenKey(provider)).catch(() => null),
                this.redis.get(`llm:provider:probe:${provider}`).catch(() => null),
                this.redis.get(`llm:provider:balance:${provider}`).catch(() => null),
            ]);
            const probe = safeJson<{ at: number; ok: boolean }>(probeRaw);
            const errorsToday: Partial<Record<ProviderErrorKind, number>> = {};
            const errorsTodayByModel: Record<string, number> = {};
            for (const [field, v] of Object.entries(errors ?? {})) {
                const [p, model, kind] = field.split('|');
                if (p !== provider) continue;
                errorsToday[kind as ProviderErrorKind] = (errorsToday[kind as ProviderErrorKind] ?? 0) + Number(v);
                errorsTodayByModel[model] = (errorsTodayByModel[model] ?? 0) + Number(v);
            }
            return {
                ...state,
                provider,
                configured: !!configured[provider],
                statusLabel: PROVIDER_STATUS_LABEL_ES[state.status],
                lastErrorLabel: state.lastErrorKind ? PROVIDER_ERROR_LABEL_ES[state.lastErrorKind] : null,
                breakerOpen: !!breaker,
                lastProbeAt: probe?.at ?? null,
                lastProbeOk: probe?.ok ?? null,
                balance: safeJson<ProviderBalance>(balanceRaw),
                errorsToday,
                errorsTodayByModel,
            };
        }));
        const [lastHour, last24h] = await Promise.all([this.routingWindow(60), this.routingWindow(24 * 60)]);
        return { providers, routing: { lastHour, last24h }, generatedAt: new Date().toISOString() };
    }
}

export { isAccountFailure };

function safeJson<T>(raw: string | null): T | null {
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
