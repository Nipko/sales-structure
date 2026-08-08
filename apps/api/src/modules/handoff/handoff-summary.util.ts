import { createHash } from 'crypto';
import {
    HandoffSourceCitation,
    HandoffToolOutcome,
    StructuredHandoffSummary,
} from '@parallext/shared';

export const HANDOFF_SUMMARY_MAX_BYTES = 12_000;
const MAX_FACTS = 6;
const MAX_SOURCES = 8;
const MAX_TOOL_OUTCOMES = 5;
const MAX_PENDING_ACTIONS = 5;
const MAX_UNCERTAINTIES = 4;

export interface HandoffMessageEvidence {
    id?: string | null;
    direction: string;
    content_text?: string | null;
    metadata?: Record<string, unknown> | null;
    created_at?: string | Date | null;
}

export interface HandoffTraceEvidence {
    id?: string | null;
    steps?: unknown;
    kb_sources?: unknown;
    created_at?: string | Date | null;
}

export interface HandoffSummaryContext {
    tenantId: string;
    conversationId: string;
    reason: string;
    language: string;
    messages: HandoffMessageEvidence[];
    messageMetadata?: Record<string, unknown>;
    turnTrace?: HandoffTraceEvidence | null;
    conversationTrace?: HandoffTraceEvidence | null;
    generatedAt?: string;
}

const SECRET_ASSIGNMENT_RE = /\b(password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|client[_-]?secret)\b\s*[:=]\s*([^\s,;]+)/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\b/g;
const LONG_TOKEN_RE = /\b[A-Za-z0-9_-]{32,}\b/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/g;
const LONG_NUMBER_RE = /\b\d{12,19}\b/g;

function replaceUnsafeControlCharacters(value: string): string {
    return [...value].map((character) => {
        const code = character.charCodeAt(0);
        return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127
            ? ' '
            : character;
    }).join('');
}

export function sanitizeHandoffText(value: unknown, maxLength = 240): string {
    if (value === null || value === undefined) return '';
    return replaceUnsafeControlCharacters(String(value))
        .replace(SECRET_ASSIGNMENT_RE, '$1=[redacted-secret]')
        .replace(BEARER_RE, 'Bearer [redacted-secret]')
        .replace(JWT_RE, '[redacted-secret]')
        .replace(EMAIL_RE, '[redacted-email]')
        .replace(PHONE_RE, '[redacted-phone]')
        .replace(LONG_NUMBER_RE, '[redacted-number]')
        .replace(LONG_TOKEN_RE, '[redacted-secret]')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, maxLength);
}

function sanitizeIdentifier(value: unknown, fallback: string): string {
    const normalized = String(value ?? '').replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 128);
    return normalized || fallback;
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function uniqueStrings(values: unknown[], limit: number, maxLength = 240): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
        const clean = sanitizeHandoffText(value, maxLength);
        const key = clean.toLowerCase();
        if (!clean || seen.has(key)) continue;
        seen.add(key);
        result.push(clean);
        if (result.length >= limit) break;
    }
    return result;
}

function findMetadataTraceId(value: unknown, depth = 0): string | null {
    if (!value || typeof value !== 'object' || depth > 4) return null;
    const record = value as Record<string, unknown>;
    for (const key of ['traceId', 'trace_id', 'requestId', 'request_id']) {
        if (typeof record[key] === 'string' && record[key]) {
            return sanitizeIdentifier(record[key], '');
        }
    }
    for (const nested of Object.values(record)) {
        const found = findMetadataTraceId(nested, depth + 1);
        if (found) return found;
    }
    return null;
}

function deterministicTraceId(context: HandoffSummaryContext): string {
    const seed = JSON.stringify({
        tenantId: context.tenantId,
        conversationId: context.conversationId,
        reason: context.reason,
        messages: context.messages.slice(0, 20).map((message) => ({
            id: message.id || null,
            direction: message.direction,
            content: String(message.content_text || '').slice(0, 300),
        })),
    });
    return `handoff_${createHash('sha256').update(seed).digest('hex').slice(0, 32)}`;
}

function resolveTraceId(context: HandoffSummaryContext): string {
    const metadataTrace = findMetadataTraceId(context.messageMetadata)
        || context.messages.map((message) => findMetadataTraceId(message.metadata)).find(Boolean);
    return metadataTrace
        || sanitizeIdentifier(context.turnTrace?.id, '')
        || sanitizeIdentifier(context.conversationTrace?.id, '')
        || deterministicTraceId(context);
}

function traceSteps(trace?: HandoffTraceEvidence | null): Array<Record<string, any>> {
    if (Array.isArray(trace?.steps)) return trace.steps.filter((step) => step && typeof step === 'object') as any[];
    if (typeof trace?.steps === 'string') {
        try {
            const parsed = JSON.parse(trace.steps);
            return Array.isArray(parsed) ? parsed.filter((step) => step && typeof step === 'object') : [];
        } catch { return []; }
    }
    return [];
}

function buildSources(context: HandoffSummaryContext, chronological: HandoffMessageEvidence[]): HandoffSourceCitation[] {
    const sources: HandoffSourceCitation[] = [];
    const add = (source: HandoffSourceCitation) => {
        if (!sources.some((existing) => existing.citation === source.citation)) sources.push(source);
    };

    for (const message of chronological.filter((entry) => entry.direction === 'inbound').slice(-4)) {
        const id = sanitizeIdentifier(message.id, `message-${sources.length + 1}`);
        add({
            type: 'message',
            id,
            label: sanitizeHandoffText(message.content_text, 160) || 'Customer message',
            citation: `[message:${id}]`,
        });
    }

    const knowledgeLabels: unknown[] = [];
    for (const step of traceSteps(context.turnTrace)) {
        if (step.type === 'kb_retrieval') knowledgeLabels.push(...asArray(step.metadata?.sources));
    }
    knowledgeLabels.push(...asArray(context.conversationTrace?.kb_sources));
    for (const labelValue of uniqueStrings(knowledgeLabels, MAX_SOURCES, 160)) {
        const id = `kb-${createHash('sha256').update(labelValue).digest('hex').slice(0, 12)}`;
        add({ type: 'knowledge', id, label: labelValue, citation: `[knowledge:${id}]` });
    }

    if (context.turnTrace?.id) {
        const id = sanitizeIdentifier(context.turnTrace.id, 'turn-trace');
        add({ type: 'trace', id, label: 'Conversation turn trace', citation: `[trace:${id}]` });
    }
    return sources.slice(0, MAX_SOURCES);
}

function buildToolOutcomes(context: HandoffSummaryContext): HandoffToolOutcome[] {
    const outcomes = traceSteps(context.turnTrace)
        .filter((step) => step.type === 'tool_result')
        .slice(-MAX_TOOL_OUTCOMES)
        .map((step): HandoffToolOutcome => {
            const ok = step.metadata?.ok;
            const status: HandoffToolOutcome['status'] = ok === true ? 'success' : ok === false ? 'failed' : 'unknown';
            const rawOutcome = step.metadata?.error
                ? `Error: ${step.metadata.error}`
                : status === 'success' ? 'Completed' : 'Outcome unavailable';
            return {
                tool: sanitizeHandoffText(step.label || 'unknown_tool', 80),
                status,
                outcome: sanitizeHandoffText(rawOutcome, 240),
                occurredAt: step.startedAt ? String(step.startedAt).slice(0, 40) : undefined,
            };
        });
    return outcomes;
}

function fallbackAction(language: string): string {
    const code = language.split('-')[0].toLowerCase();
    if (code === 'en') return 'Review the escalation reason and continue with the customer.';
    if (code === 'pt') return 'Revisar o motivo da escalação e continuar com o cliente.';
    if (code === 'fr') return 'Examiner le motif du transfert et reprendre avec le client.';
    return 'Revisar la razón de escalación y continuar con el cliente.';
}

function boundSummary(summary: StructuredHandoffSummary): StructuredHandoffSummary {
    const bounded: StructuredHandoffSummary = {
        ...summary,
        reason: sanitizeHandoffText(summary.reason, 200),
        customerIntent: sanitizeHandoffText(summary.customerIntent, 400),
        knownFacts: uniqueStrings(summary.knownFacts, MAX_FACTS),
        sources: summary.sources.slice(0, MAX_SOURCES).map((source, index) => {
            const type: HandoffSourceCitation['type'] = ['message', 'knowledge', 'trace', 'system'].includes(source.type)
                ? source.type
                : 'trace';
            const id = sanitizeIdentifier(source.id, `source-${index + 1}`);
            return {
                type,
                id,
                label: sanitizeHandoffText(source.label, 160),
                // Citations contain only a server-built enum and identifier. The
                // prose sanitizer would otherwise mistake UUIDs for phone PII.
                citation: `[${type}:${id}]`,
            };
        }),
        lastToolOutcomes: summary.lastToolOutcomes.slice(0, MAX_TOOL_OUTCOMES).map((outcome) => ({
            tool: sanitizeHandoffText(outcome.tool, 80),
            status: ['success', 'failed', 'unknown'].includes(outcome.status) ? outcome.status : 'unknown',
            outcome: sanitizeHandoffText(outcome.outcome, 240),
            occurredAt: outcome.occurredAt ? String(outcome.occurredAt).slice(0, 40) : undefined,
        })),
        pendingActions: uniqueStrings(summary.pendingActions, MAX_PENDING_ACTIONS),
        confidence: Math.max(0, Math.min(1, Number(summary.confidence) || 0)),
        uncertainty: uniqueStrings(summary.uncertainty, MAX_UNCERTAINTIES),
        language: sanitizeIdentifier(summary.language, 'es').slice(0, 12),
        traceId: sanitizeIdentifier(summary.traceId, 'handoff-untraced'),
        generatedAt: String(summary.generatedAt).slice(0, 40),
    };
    if (Buffer.byteLength(JSON.stringify(bounded), 'utf8') <= HANDOFF_SUMMARY_MAX_BYTES) return bounded;
    return {
        ...bounded,
        customerIntent: bounded.customerIntent.slice(0, 200),
        knownFacts: bounded.knownFacts.slice(0, 4).map((fact) => fact.slice(0, 160)),
        sources: bounded.sources.slice(0, 4),
        lastToolOutcomes: bounded.lastToolOutcomes.slice(0, 3),
        pendingActions: bounded.pendingActions.slice(0, 3),
        uncertainty: bounded.uncertainty.slice(0, 2),
    };
}

export function buildDeterministicHandoffSummary(context: HandoffSummaryContext): StructuredHandoffSummary {
    const chronological = [...context.messages].reverse();
    const inbound = chronological.filter((message) => message.direction === 'inbound');
    const intent = sanitizeHandoffText(inbound.at(-1)?.content_text, 400);
    const facts = uniqueStrings(inbound.slice(-MAX_FACTS).map((message) => message.content_text), MAX_FACTS);
    const uncertainty: string[] = [];
    if (!intent) uncertainty.push('Customer intent is unavailable.');
    if (!context.turnTrace) uncertainty.push('No persisted turn trace was available.');

    return boundSummary({
        version: 1,
        reason: context.reason,
        customerIntent: intent || 'Customer intent unavailable.',
        knownFacts: facts,
        sources: buildSources(context, chronological),
        lastToolOutcomes: buildToolOutcomes(context),
        pendingActions: [fallbackAction(context.language)],
        confidence: intent ? (context.turnTrace ? 0.65 : 0.45) : 0.2,
        uncertainty,
        language: context.language || 'es',
        traceId: resolveTraceId(context),
        generatedAt: context.generatedAt || new Date().toISOString(),
        generatedBy: 'deterministic_fallback',
    });
}

export function parseLlmHandoffSummary(
    content: string,
    fallback: StructuredHandoffSummary,
): StructuredHandoffSummary | null {
    try {
        const unfenced = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        const start = unfenced.indexOf('{');
        const end = unfenced.lastIndexOf('}');
        if (start < 0 || end <= start) return null;
        const parsed = JSON.parse(unfenced.slice(start, end + 1));
        if (!parsed || typeof parsed !== 'object') return null;
        const summary = boundSummary({
            ...fallback,
            customerIntent: parsed.customerIntent ?? fallback.customerIntent,
            knownFacts: Array.isArray(parsed.knownFacts) ? parsed.knownFacts : fallback.knownFacts,
            pendingActions: Array.isArray(parsed.pendingActions) ? parsed.pendingActions : fallback.pendingActions,
            confidence: parsed.confidence ?? fallback.confidence,
            uncertainty: Array.isArray(parsed.uncertainty) ? parsed.uncertainty : fallback.uncertainty,
            // Evidence, identity and timestamps remain authoritative server data.
            sources: fallback.sources,
            lastToolOutcomes: fallback.lastToolOutcomes,
            reason: fallback.reason,
            language: fallback.language,
            traceId: fallback.traceId,
            generatedAt: fallback.generatedAt,
            generatedBy: 'llm',
            version: 1,
        });
        return summary.customerIntent ? summary : null;
    } catch {
        return null;
    }
}

export function formatLegacyHandoffSummary(summary: StructuredHandoffSummary): string {
    const facts = summary.knownFacts.length
        ? summary.knownFacts.map((fact) => `- ${fact}`).join('\n')
        : '- No verified facts available.';
    const actions = summary.pendingActions.length
        ? summary.pendingActions.map((action) => `- ${action}`).join('\n')
        : '- Review the conversation.';
    const citations = summary.sources.length
        ? summary.sources.map((source) => source.citation).join(' ')
        : 'No traceable sources available.';
    return [
        `**Tema**: ${summary.customerIntent}`,
        `**Contexto**:\n${facts}`,
        `**Pendiente**:\n${actions}`,
        `**Razón de escalación**: ${summary.reason}`,
        `**Confianza**: ${Math.round(summary.confidence * 100)}%`,
        `**Fuentes**: ${citations}`,
    ].join('\n').slice(0, 4_000);
}
