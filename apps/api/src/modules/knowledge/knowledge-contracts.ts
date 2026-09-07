import type { ServiceExecutionContext } from '../../common/types/execution-context';

/** Shared retrieval contract for automatic context, explicit tools and evaluation. */
export interface KnowledgeSearchOptions {
    similarityThreshold?: number;
    poolSize?: number;
    conversationId?: string;
    language?: string;
    rerank?: boolean;
    rerankTopN?: number;
    executionContext?: ServiceExecutionContext;
    jurisdiction?: string | null;
    agentId?: string | null;
    audience?: 'customer' | 'internal';
}

export interface KnowledgeSourceMetadata {
    isRegulated?: boolean;
    jurisdiction?: string | null;
    authority?: string | null;
    validFrom?: string | null;
    validTo?: string | null;
    agentIds?: string[];
    audience?: 'customer' | 'internal';
}

export interface KnowledgeHit {
    id: string;
    document_id: string;
    title: string;
    chunk_text: string;
    chunk_index: number;
    metadata: Record<string, unknown> | null;
    similarity: number;
    keywordHit: boolean;
    score: number;
    doc_language: string | null;
    doc_jurisdiction: string | null;
    doc_authority: string | null;
    doc_valid_from: string | Date | null;
    doc_valid_to: string | Date | null;
    doc_is_regulated: boolean;
    doc_version: number;
    doc_source_url: string | null;
    doc_audience: 'customer' | 'internal';
    doc_agent_ids: string[];
}

/** Rechecked after vector/keyword fusion so no retrieval path drops source limits. */
export function knowledgeSourceAvailable(
    source: Pick<KnowledgeHit, 'doc_audience' | 'doc_agent_ids' | 'doc_is_regulated' | 'doc_jurisdiction' | 'doc_valid_from' | 'doc_valid_to'>,
    options?: KnowledgeSearchOptions,
    now = new Date(),
): boolean {
    if ((source.doc_audience ?? 'customer') !== (options?.audience ?? 'customer')) return false;
    if (source.doc_agent_ids?.length && (!options?.agentId || !source.doc_agent_ids.includes(options.agentId))) return false;
    if (source.doc_is_regulated && (!options?.jurisdiction ||
        source.doc_jurisdiction !== options.jurisdiction.trim().toUpperCase())) return false;
    const today = now.toISOString().slice(0, 10);
    for (const [value, isStart] of [[source.doc_valid_from, true], [source.doc_valid_to, false]] as const) {
        if (value == null) continue;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return false;
        const day = date.toISOString().slice(0, 10);
        if (isStart ? day > today : day < today) return false;
    }
    return true;
}
