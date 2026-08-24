/**
 * In-memory accumulator for a single turn's step-by-step trace
 * (reasoning → tool → result → decision). Plain object, no DI — instantiated per
 * turn inside generateResponse. Adding a step is a cheap array push; persistence
 * happens later, fire-and-forget, off the hot path.
 */
export type TurnStepType =
    | 'media' | 'intent' | 'booking' | 'procedure'
    | 'turn_context'
    | 'kb_retrieval' | 'reasoning' | 'tool_call' | 'tool_result'
    // Which tools the effective contract published, and what it excluded.
    // Without it in the trace, "why didn't the agent use X" is unanswerable
    // after the fact — and that question is most of agent support.
    | 'capability_contract'
    | 'guardrail' | 'decision';

export interface TurnStep {
    type: TurnStepType;
    label?: string;
    startedAt: string;
    durationMs?: number;
    metadata?: Record<string, any>;
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/g;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const AUTH_RE = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const PROVIDER_KEY_RE = /\b(?:sk-[A-Za-z0-9_-]{12,}|pk_live_[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g;
const URL_CREDENTIAL_RE = /(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const QUERY_SECRET_RE = /([?&](?:access_?token|refresh_?token|api_?key|secret|password|signature|authorization)=)[^&#\s]+/gi;
const ADDRESS_RE = /\b(?:calle|carrera|avenida|autopista|transversal|diagonal|cra\.?|cl\.?|av\.?|street|road|avenue|rua|rue)\s+[^,;\n]{3,80}/gi;
const MAX_STEPS = 100;

function isSecretKey(key: string): boolean {
    const compact = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    return [
        'token',
        'accesstoken',
        'refreshtoken',
        'idtoken',
        'apikey',
        'clientsecret',
        'secret',
        'password',
        'authorization',
        'credential',
        'credentials',
    ].includes(compact)
        || compact.endsWith('token')
        || compact.endsWith('apikey')
        || compact.endsWith('secret')
        || compact.endsWith('password');
}

function redactText(value: string): string {
    return value
        .replace(AUTH_RE, '[authorization]')
        .replace(JWT_RE, '[token]')
        .replace(PROVIDER_KEY_RE, '[secret]')
        .replace(URL_CREDENTIAL_RE, '$1[credentials]@')
        .replace(QUERY_SECRET_RE, '$1[secret]')
        .replace(EMAIL_RE, '[email]')
        .replace(PHONE_RE, '[phone]')
        .replace(IPV4_RE, '[ip]')
        .replace(ADDRESS_RE, '[address]')
        .slice(0, 500);
}

/** Mask free-form PII/secrets and bound size before any trace persistence. */
export function redactTraceValue(v: any): any {
    if (typeof v === 'string') return redactText(v);
    if (Array.isArray(v)) return v.slice(0, 20).map(redactTraceValue);
    if (v && typeof v === 'object') {
        const o: any = {};
        for (const k of Object.keys(v).slice(0, 30)) {
            o[k] = isSecretKey(k) ? '[secret]' : redactTraceValue(v[k]);
        }
        return o;
    }
    return v;
}

export class TurnTraceContext {
    readonly startedAt = Date.now();
    readonly steps: TurnStep[] = [];

    constructor(private readonly meta: { tenantId: string; conversationId: string; messageId?: string | null }) {}

    add(type: TurnStepType, label?: string, metadata?: Record<string, any>, durationMs?: number): void {
        if (this.steps.length >= MAX_STEPS) return;
        this.steps.push({
            type,
            label: label ? redactText(label) : undefined,
            startedAt: new Date().toISOString(),
            durationMs,
            metadata: metadata ? redactTraceValue(metadata) : undefined,
        });
    }

    /** Measure durationMs around a promise and record a step (re-throws on error). */
    async time<T>(type: TurnStepType, label: string, metaFn: () => Record<string, any>, fn: () => Promise<T>): Promise<T> {
        const t0 = Date.now();
        try {
            const r = await fn();
            this.add(type, label, metaFn(), Date.now() - t0);
            return r;
        } catch (e: any) {
            // Exception messages routinely include upstream URLs, payload
            // fragments and customer data. Persist only a stable class/code.
            this.add(type, label, {
                ...metaFn(),
                errorType: typeof e?.name === 'string' ? e.name : 'Error',
                errorCode: typeof e?.code === 'string' ? e.code : undefined,
            }, Date.now() - t0);
            throw e;
        }
    }

    toEvent() {
        return {
            tenantId: this.meta.tenantId,
            conversationId: this.meta.conversationId,
            messageId: this.meta.messageId || null,
            totalDurationMs: Date.now() - this.startedAt,
            stepCount: this.steps.length,
            steps: this.steps,
        };
    }
}
