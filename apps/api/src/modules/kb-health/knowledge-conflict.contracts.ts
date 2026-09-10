import { createHash } from 'crypto';

export type ConflictSourceKind = 'document' | 'faq' | 'policy' | 'business';
export interface ConflictSource {
    kind: ConflictSourceKind;
    id: string;
    title: string;
    revision: string;
    hash: string;
    text: string;
    authority: string | null;
    jurisdiction: string | null;
    regulated: boolean;
    validFrom: string | null;
    validTo: string | null;
    audience: 'customer' | 'internal';
    agentIds: string[];
    active: boolean;
}

export interface ConflictScanReport {
    id: string;
    status: 'completed_sample' | 'partial' | 'unavailable';
    sourceCounts: Record<ConflictSourceKind, number | null>;
    sampledSources: number;
    candidatePairs: number;
    checkedPairs: number;
    unknownPairs: number;
    newIssues: number;
    errors: string[];
    exhaustive: false;
    correctness: 'not_verified';
    createdAt: string;
}

export type ConflictReviewDecision = 'prefer_a' | 'prefer_b' | 'different_scope' | 'defer';
export interface ConflictReviewInput {
    revision: number;
    decision: ConflictReviewDecision;
    reason: string;
    sourceAHash: string;
    sourceBHash: string;
    scope: { audience: 'customer' | 'internal'; agentId: string | null; jurisdiction: string | null };
}

export function conflictSourceHash(value: Omit<ConflictSource, 'hash'>): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function conflictPairKey(a: ConflictSource, b: ConflictSource): string {
    return createHash('sha256').update([`${a.kind}:${a.id}:${a.hash}`, `${b.kind}:${b.id}:${b.hash}`].sort().join('|')).digest('hex');
}

/** Different jurisdictions, non-overlapping validity, or disjoint audiences are
 * different scopes, not evidence that either source is false. */
export function conflictScopesOverlap(a: ConflictSource, b: ConflictSource): boolean {
    if (!a.active || !b.active || a.audience !== b.audience) return false;
    if (a.agentIds.length && b.agentIds.length && !a.agentIds.some(id => b.agentIds.includes(id))) return false;
    if (a.regulated && b.regulated && a.jurisdiction !== b.jurisdiction) return false;
    if (a.validTo && b.validFrom && a.validTo < b.validFrom || b.validTo && a.validFrom && b.validTo < a.validFrom) return false;
    return true;
}

export function conflictSourceVisible(source: ConflictSource, scope: ConflictReviewInput['scope'], today = new Date().toISOString().slice(0, 10)): boolean {
    return source.active && source.audience === scope.audience &&
        (!source.agentIds.length || Boolean(scope.agentId && source.agentIds.includes(scope.agentId))) &&
        (!source.regulated || Boolean(scope.jurisdiction && source.jurisdiction === scope.jurisdiction)) &&
        (!source.validFrom || source.validFrom <= today) && (!source.validTo || source.validTo >= today);
}

export type ConflictVerdict = { state: 'potential_conflict'; quoteA: string; quoteB: string; detail: string; suggestion: string }
    | { state: 'no_conflict_observed' } | { state: 'unknown'; error: string };

/** Quotes prove source provenance only. They do not establish truth or entailment. */
export function parseConflictVerdict(raw: string, a: ConflictSource, b: ConflictSource): ConflictVerdict {
    let value: any;
    try { value = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()); }
    catch { return { state: 'unknown', error: 'invalid_judge_output' }; }
    if (!value || typeof value.contradicts !== 'boolean') return { state: 'unknown', error: 'invalid_judge_output' };
    if (!value.contradicts) return { state: 'no_conflict_observed' };
    const quoteValid = (quote: unknown, text: string): quote is string => typeof quote === 'string' && quote.length >= 8 && quote.length <= 500 && text.includes(quote);
    if (!quoteValid(value.quoteA, a.text) || !quoteValid(value.quoteB, b.text)) return { state: 'unknown', error: 'evidence_not_found' };
    if (typeof value.detail !== 'string' || !value.detail.trim()) return { state: 'unknown', error: 'invalid_judge_output' };
    return { state: 'potential_conflict', quoteA: value.quoteA, quoteB: value.quoteB,
        detail: value.detail.slice(0, 1000), suggestion: typeof value.suggestion === 'string' ? value.suggestion.slice(0, 500) : '' };
}

const STOP = new Set('para como esta este esto desde sobre porque donde cual cuando that with what this from your about como uma para dans avec pour vous nous'.split(' '));
function tokens(source: ConflictSource): Set<string> {
    return new Set(`${source.title} ${source.text}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 4 && !STOP.has(word)).slice(0, 400));
}

/** A bounded lexical shortlist is a sampling method, never a completeness claim. */
export function candidateConflictPairs(sources: ConflictSource[], maxPairs: number): Array<{ a: ConflictSource; b: ConflictSource }> {
    const tokenSets = sources.map(tokens);
    const candidates: Array<{ a: ConflictSource; b: ConflictSource; score: number }> = [];
    for (let i = 0; i < sources.length; i++) for (let j = i + 1; j < sources.length; j++) {
        const a = sources[i], b = sources[j];
        if (a.kind === b.kind && a.id === b.id || !conflictScopesOverlap(a, b)) continue;
        const overlap = [...tokenSets[i]].filter(word => tokenSets[j].has(word)).length;
        if (overlap < 2) continue;
        candidates.push({ a, b, score: overlap / Math.max(1, Math.min(tokenSets[i].size, tokenSets[j].size)) });
    }
    return candidates.sort((a,b) => b.score - a.score || conflictPairKey(a.a,a.b).localeCompare(conflictPairKey(b.a,b.b))).slice(0,maxPairs);
}
