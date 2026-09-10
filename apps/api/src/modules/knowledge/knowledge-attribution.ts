import { createHash } from 'crypto';
import type { RetrievedKnowledgeItem } from '@parallext/shared';

export type KnowledgeResponseSignal = 'unobserved' | 'citation' | 'literal_overlap' | 'citation_and_literal_overlap';
export interface KnowledgeResponseEvidence {
    retrievalId: string;
    documentId: string;
    signal: KnowledgeResponseSignal;
    /** Citation attribution is document-level; a literal match identifies a chunk. */
    granularity: 'document' | 'chunk' | 'none';
    evidenceHash: string | null;
}

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const words = (value: string) => normalize(value).match(/[\p{L}\p{N}]+/gu) || [];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Observable signals only. A citation or shared phrase never proves a claim is true,
 * supported, or even causally taken from this source. Absence does not prove non-use. */
export function attributeKnowledgeResponse(reply: string, items: RetrievedKnowledgeItem[]) {
    const sources = items.filter(item => item.source === 'kb_article' && item.retrievalId && item.documentId);
    const byDocument = new Map<string, RetrievedKnowledgeItem[]>();
    for (const source of sources) {
        const entries = byDocument.get(source.documentId!) || [];
        entries.push(source);
        byDocument.set(source.documentId!, entries);
    }
    const citationDocs = new Set<string>();
    let unknownCitations = 0;
    let ambiguousCitations = 0;
    const citations = [...reply.matchAll(/\[(?:Article|Artículo|Artigo|Articolo)\s*:\s*([^\]\n]{1,300})\]/giu)];
    for (const match of citations) {
        const target = normalize(match[1]);
        const matching = [...byDocument.entries()].filter(([id, chunks]) =>
            normalize(id) === target || chunks.some(chunk => normalize(chunk.title || '') === target));
        if (matching.length === 1) citationDocs.add(matching[0][0]);
        else if (matching.length > 1) ambiguousCitations++;
        else unknownCitations++;
    }
    // Only substantial exact normalized spans are reported. These may still be
    // negated, contradicted or generic; the UI must not label this entailment.
    const responseWords = words(reply.replace(/\[[^\]\n]*\]/g, ''));
    const spans = new Set<string>();
    for (let i = 0; i <= responseWords.length - 12; i++) spans.add(responseWords.slice(i, i + 12).join(' '));
    const seen = new Set<string>();
    const evidence: KnowledgeResponseEvidence[] = [];
    for (const source of sources) {
        if (seen.has(source.retrievalId!)) continue;
        seen.add(source.retrievalId!);
        const contentWords = words(source.content);
        let overlap: string | undefined;
        for (let i = 0; i <= contentWords.length - 12; i++) {
            const candidate = contentWords.slice(i, i + 12).join(' ');
            if (candidate.length >= 60 && spans.has(candidate)) { overlap = candidate; break; }
        }
        const cited = citationDocs.has(source.documentId!);
        evidence.push({
            retrievalId: source.retrievalId!, documentId: source.documentId!,
            signal: cited ? (overlap ? 'citation_and_literal_overlap' : 'citation') : (overlap ? 'literal_overlap' : 'unobserved'),
            granularity: overlap ? 'chunk' : cited ? 'document' : 'none',
            evidenceHash: overlap ? hash(overlap) : cited ? hash(`citation:${source.documentId}`) : null,
        });
    }
    return {
        version: 1 as const,
        responseHash: hash(reply),
        presentedDocuments: byDocument.size,
        observedDocuments: new Set(evidence.filter(e => e.signal !== 'unobserved').map(e => e.documentId)).size,
        citedDocuments: citationDocs.size,
        literalOverlapDocuments: new Set(evidence.filter(e => e.signal.includes('literal_overlap')).map(e => e.documentId)).size,
        unknownCitations, ambiguousCitations,
        semanticSupport: 'not_evaluated' as const,
        evidence,
    };
}

/** Technical availability and actionable checks, deliberately not a truth score. */
export function knowledgeDocumentReadiness(document: any, now = new Date()) {
    const reasons: string[] = [];
    if (document.status !== 'ready') reasons.push(document.status === 'error' ? 'index_failed' : 'index_not_ready');
    if (!Number(document.chunk_count)) reasons.push('no_chunks');
    if (document.error_message && document.status === 'ready') reasons.push('reindex_failed_previous_version_active');
    const today = now.toISOString().slice(0, 10);
    for (const [value, before, key] of [[document.valid_from, true, 'not_yet_valid'], [document.valid_to, false, 'expired']] as const) {
        if (!value) continue;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) reasons.push('invalid_validity');
        else if (before ? date.toISOString().slice(0, 10) > today : date.toISOString().slice(0, 10) < today) reasons.push(key);
    }
    if (document.is_regulated && (!document.authority || !document.jurisdiction)) reasons.push('regulated_provenance_missing');
    if (Number(document.false_positive_count)) reasons.push('retrieval_corrections');
    if (Number(document.feedback_count) && Number(document.satisfaction_score) < 3) reasons.push('negative_feedback');
    const unavailable = reasons.some(reason => ['index_failed', 'index_not_ready', 'no_chunks', 'expired', 'not_yet_valid', 'invalid_validity'].includes(reason));
    return { readiness: unavailable ? 'unavailable' : reasons.length ? 'review_required' : 'ready', reasons, correctnessStatus: 'unverified' as const };
}
