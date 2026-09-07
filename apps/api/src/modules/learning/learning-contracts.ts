import { createHash } from 'crypto';
import type { ServiceExecutionContext } from '../../common/types/execution-context';

export const LEARNING_DIMENSIONS = [
    'accuracy', 'toolUse', 'understanding', 'clarity', 'brevity', 'empathy', 'brandTone', 'uncertainty', 'closure',
] as const;
export type LearningDimension = typeof LEARNING_DIMENSIONS[number];
export type LearningKind = 'brand_style' | 'operational_pattern' | 'business_fact' | 'customer_memory' | 'regression';
export type LearningLanguage = 'es' | 'en' | 'pt' | 'fr';
export interface LearningMessage { role: 'customer' | 'assistant'; text: string; timestamp?: string; }
export interface LearningFileImport {
    sourceKey: string;
    contactKey?: string;
    contactId?: string;
    channel: string;
    language: LearningLanguage;
    messages: LearningMessage[];
    redactTerms?: string[];
}
export interface LearningJudgment {
    kind: LearningKind;
    scores: Record<LearningDimension, number>;
    exclusions: string[];
    responsePattern: string;
    rationale: string;
    factsRequired: string[];
    requiredTool?: string | null;
}
export interface LearningReview {
    decision: 'approved' | 'rejected';
    revision: number;
    note: string;
    privacyChecked: boolean;
    correctnessChecked: boolean;
    responsePattern?: string;
    kind?: LearningKind;
}
export interface RuntimeLearningQuery {
    language: string;
    intent?: string;
    contactId?: string;
    /** Candidate override is accepted only for an evaluation with persistence disabled. */
    releaseId?: string | null;
    executionContext?: ServiceExecutionContext;
    operation?: { toolName: string; status: string };
}
export interface RuntimeLearningExample {
    id: string;
    releaseId: string;
    releaseHash: string;
    situation: string;
    responsePattern: string;
    rationale: string;
    factsRequired: string[];
    /** Examples guide presentation only. Their text never establishes business facts. */
    authority: 'style_only';
}

/** Produced by the server-side full-runtime evaluator, never accepted from the UI. */
export interface LearningEvaluationEvidence {
    attemptId: string;
    releaseHash: string;
    baselineReleaseId: string | null;
    agentRevision: string;
    dependencyHash: string;
    results: Array<{
        sourceId: string;
        candidateCompleted: boolean;
        baselineCompleted: boolean;
        candidateScore: number;
        baselineScore: number;
        criticalFailures: string[];
        traceHash: string;
        traces?: unknown;
    }>;
}

export const learningHash = (value: string) => createHash('sha256').update(value).digest('hex');
export function learningSnapshotHash(value: unknown): string {
    const canonical = (item: any): any => Array.isArray(item) ? item.map(canonical)
        : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(key=>[key,canonical(item[key])])) : item;
    return learningHash(JSON.stringify(canonical(value)));
}
export const normalizeLearningText = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\[[^\]]+\]/g, '[value]').replace(/[^a-z\s[\]]/g, ' ').replace(/\s+/g, ' ').trim();

/** Assign the whole customer's source group before producing any excerpts. */
export function learningSplit(groupKey: string): 'train' | 'holdout' {
    return parseInt(learningHash(groupKey).slice(0, 8), 16) % 5 === 0 ? 'holdout' : 'train';
}

export function sanitizeLearningText(text: string, redactTerms: string[] = []): string {
    let clean = text.replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ')
        .replace(/https?:\/\/\S+/gi, '[link]')
        .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[contact]');
    for (const term of redactTerms.filter(t => t.trim().length >= 2).sort((a, b) => b.length - a.length)) {
        clean = clean.replace(new RegExp(`(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'giu'), '[person]');
    }
    return clean.replace(/https?:\/\/\S+/gi, '[link]')
        .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[contact]')
        .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[reference]')
        .replace(/\b(?:me llamo|mi nombre es|my name is|je m'appelle|me chamo)\s+[\p{L}]+(?:\s+[\p{L}]+){0,2}/giu, '[customer introduction]')
        .replace(/[+]?\d[\d\s.,:/()%-]*\d|\b\d\b/g, '[value]')
        .replace(/\s+/g, ' ').trim();
}

export function learningIntent(text: string): string {
    const normalized = normalizeLearningText(text);
    if (/\b(cita|reserva|agend|appointment|booking|rendez|agendamento)/.test(normalized)) return 'booking';
    if (/\b(reclamo|queja|problema|error|complaint|issue|reclamacao)/.test(normalized)) return 'support';
    if (/\b(precio|compr|producto|pedido|price|product|order|prix|commande|preco)/.test(normalized)) return 'sales';
    if (/\b(cancel|devol|refund|rembours)/.test(normalized)) return 'cancellation';
    if (/\b(persona|humano|asesor|human|conseiller)/.test(normalized)) return 'handoff';
    return 'general';
}

export function claimsCompletedOperation(text: string): boolean {
    return /\b(confirmad[oa]|reservad[oa]|agendad[oa]|cancelad[oa]|reembolsad[oa]|pedido creado|pago recibido|confirmed|booked|refunded|payment received|annule|rembourse|confirmé|réservé|remboursé)\b/i.test(text);
}

export function learningExclusions(text: string): string[] {
    const flags: string[] = [];
    if (/ignore.{0,30}(instructions|instrucciones|reglas)|system prompt|reveal.{0,20}(secret|token)|ignora.{0,30}(instrucciones|reglas)/i.test(text)) flags.push('instruction_injection');
    if (/\b(password|contraseña|senha|mot de passe|api[_ -]?key|secret[_ -]?key)\b/i.test(text)) flags.push('sensitive_information');
    if (/\b\d{3,}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text)) flags.push('unredacted_identifiers');
    return flags;
}

export function segmentLearningConversation(messages: LearningMessage[]) {
    const segments: Array<{ messages: LearningMessage[]; intent: string; fingerprint: string }> = [];
    let current: LearningMessage[] = [];
    let intent = 'general';
    const flush = () => {
        if (current.some(m => m.role === 'customer') && current.some(m => m.role === 'assistant')) {
            segments.push({ messages: current, intent, fingerprint: learningHash(normalizeLearningText(current.map(m => m.text).join(' '))) });
        }
        current = [];
    };
    for (const message of messages) {
        const nextIntent = learningIntent(message.text);
        const prior = current.at(-1);
        const gap = prior?.timestamp && message.timestamp
            ? Date.parse(message.timestamp) - Date.parse(prior.timestamp) : 0;
        if (message.role === 'customer' && current.length && (current.length >= 8 || gap > 30 * 60_000 ||
            (nextIntent !== 'general' && intent !== 'general' && intent !== nextIntent))) flush();
        if (!current.length) intent = nextIntent;
        if (message.role === 'customer' && nextIntent !== 'general') intent = nextIntent;
        current.push(message);
    }
    flush();
    return segments.slice(0, 30);
}

/** Lexical near duplicates supplement exact hashes; semantic checks run before review. */
export function learningTextSimilarity(a: string, b: string): number {
    const grams = (text: string) => {
        const words = normalizeLearningText(text).split(' ');
        return new Set(words.length < 3 ? words : words.slice(0, -2).map((word, i) => `${word} ${words[i + 1]} ${words[i + 2]}`));
    };
    const left = grams(a), right = grams(b);
    if (!left.size || !right.size) return 0;
    const intersection = [...left].filter(g => right.has(g)).length;
    return intersection / (left.size + right.size - intersection);
}
