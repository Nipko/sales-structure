import { LLMSourceAuthorityUnavailable } from '../ai/interfaces/llm-source-authority';
import { classifyProviderError, type ProviderErrorKind } from '../ai/health/llm-provider-error';

/**
 * Embeddings outage handling (ADR-0033).
 *
 * Every stored vector is OpenAI `text-embedding-3-small` (1536 dims). A query
 * vector from any other model lives in a different space, so there is no
 * drop-in secondary provider: when OpenAI cannot embed, search degrades to the
 * lexical (tsvector) index that already exists, and callers that need a
 * vector (ingestion, learning) fail as before.
 */

/** OpenAI could not produce an embedding for a reason outside our request. */
export class EmbeddingProviderUnavailable extends Error {
    constructor(readonly kind: ProviderErrorKind | 'no_key' | 'breaker_open', readonly cause?: unknown) {
        super(`embedding_provider_unavailable:${kind}`);
        this.name = 'EmbeddingProviderUnavailable';
    }
}

const OUTAGE_KINDS: ReadonlySet<ProviderErrorKind> = new Set(['quota', 'auth', 'rate_limit', 'unavailable', 'model_not_found']);

/**
 * True when a failed embedding call means "the provider is unavailable", so a
 * search may continue without a vector. Never true for a revoked data source:
 * that is evidence the caller must not keep using, not an outage.
 */
export function isEmbeddingOutage(error: unknown): boolean {
    if (error instanceof LLMSourceAuthorityUnavailable) return false;
    if (error instanceof EmbeddingProviderUnavailable) return true;
    const response = (error as any)?.getResponse?.();
    if (response && typeof response === 'object' && (response as any).error === 'embeddings_unavailable') return true;
    return OUTAGE_KINDS.has(classifyProviderError(error, 'openai'));
}

/** Seconds the in-process breaker keeps skipping OpenAI after an outage. */
export const EMBEDDING_BREAKER_MS = 60_000;

/**
 * Per-process breaker. The router's shared Redis breaker (ADR-0026) only opens
 * on account failures; this one also covers rate limits and 5xx, so a burst of
 * searches during an outage pays one failed call, not one per search.
 */
export class EmbeddingBreaker {
    private openUntil = 0;
    private lastKind: EmbeddingProviderUnavailable['kind'] = 'unavailable';

    constructor(private readonly now: () => number = Date.now, private readonly ttlMs = EMBEDDING_BREAKER_MS) {}

    isOpen(): boolean {
        return this.now() < this.openUntil;
    }

    kind(): EmbeddingProviderUnavailable['kind'] {
        return this.lastKind;
    }

    trip(kind: EmbeddingProviderUnavailable['kind']): void {
        this.openUntil = this.now() + this.ttlMs;
        this.lastKind = kind;
    }

    reset(): void {
        this.openUntil = 0;
    }
}

/**
 * Lexical-only score for a chunk when there is no query vector: the share of
 * the query's lexemes the chunk contains (0–1). It stands in for cosine
 * similarity against `similarityThreshold`, so "0.35" still means "a
 * meaningful part of the question is here", not "one shared word".
 */
export function lexicalCoverage(matched: unknown, total: unknown): number {
    const m = Number(matched ?? 0);
    const t = Number(total ?? 0);
    if (!Number.isFinite(m) || !Number.isFinite(t) || t <= 0) return 0;
    return Math.min(1, Math.max(0, m / t));
}
