/**
 * In-memory accumulator for a single turn's step-by-step trace
 * (reasoning → tool → result → decision). Plain object, no DI — instantiated per
 * turn inside generateResponse. Adding a step is a cheap array push; persistence
 * happens later, fire-and-forget, off the hot path.
 */
export type TurnStepType =
    | 'media' | 'intent' | 'booking' | 'procedure'
    | 'kb_retrieval' | 'reasoning' | 'tool_call' | 'tool_result'
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

/** Mask emails/phones and bound size so traces never leak raw PII or bloat the row. */
function redact(v: any): any {
    if (typeof v === 'string') return v.replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[phone]').slice(0, 500);
    if (Array.isArray(v)) return v.slice(0, 20).map(redact);
    if (v && typeof v === 'object') {
        const o: any = {};
        for (const k of Object.keys(v).slice(0, 30)) o[k] = redact(v[k]);
        return o;
    }
    return v;
}

export class TurnTraceContext {
    readonly startedAt = Date.now();
    readonly steps: TurnStep[] = [];

    constructor(private readonly meta: { tenantId: string; conversationId: string; messageId?: string | null }) {}

    add(type: TurnStepType, label?: string, metadata?: Record<string, any>, durationMs?: number): void {
        this.steps.push({
            type,
            label,
            startedAt: new Date().toISOString(),
            durationMs,
            metadata: metadata ? redact(metadata) : undefined,
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
            this.add(type, label, { ...metaFn(), error: e?.message }, Date.now() - t0);
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
