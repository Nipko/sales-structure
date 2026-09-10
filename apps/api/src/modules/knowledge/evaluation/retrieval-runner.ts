/**
 * Running the labelled cases against a real retrieval path, and reporting what
 * happened in a shape somebody can act on.
 *
 * Two halves, kept apart on purpose.
 *
 * `seedRetrievalCorpus` writes the corpus into a tenant schema exactly the way
 * an ingested document lands: `knowledge_documents` with its language,
 * jurisdiction, audience and validity, `knowledge_embeddings` with a vector and
 * the BM25 column. Nothing here is a shortcut around the real tables, because
 * the gates being measured — regulated, audience, agent, retired, expired — are
 * enforced in the retrieval SQL against those exact columns. Seeding a
 * simplified corpus would measure a simplified pipeline.
 *
 * `runRetrievalCases` takes a `search` function and knows nothing about NestJS,
 * pgvector or the service graph. That is what lets the same runner drive the
 * real `KnowledgeService.searchRelevant`, a frozen evaluation replica, or a
 * deliberately degraded reranker, and produce reports that are comparable
 * because only one thing changed between them.
 *
 * ── Why the report carries its own conditions ───────────────────────────────
 *
 * A retrieval number is meaningless without the four things that produced it:
 * which labels, which embedding, how big the corpus was, and where the
 * threshold sat. Publish the number alone and somebody will compare a run at
 * threshold 0.1 over fourteen documents with a run at 0.35 over four thousand,
 * conclude that quality dropped, and go looking for a regression that is not
 * there. So every report states all four, and the dataset revision is a hash
 * rather than a version anybody can forget to bump.
 */

import {
    RETRIEVAL_CASES, RETRIEVAL_CORPUS, datasetRevision, retrievalChunkIndex,
    type RetrievalCase, type RetrievalDocument, type RetrievalLanguage,
} from './retrieval-dataset';
import { DETERMINISTIC_EMBEDDING_ID, deterministicEmbedding, embeddingLiteral } from './retrieval-embedding';
import {
    scoreCase, summariseBy, summariseRetrieval,
    type CaseOutcome, type CaseScore, type RetrievalMetrics, type RetrievedChunk,
} from './retrieval-metrics';

export type EvaluationQuery = <R = any[]>(sql: string, params?: any[]) => Promise<R>;

/** What a retrieval implementation has to look like to be measurable here. */
export interface RetrievalHit {
    readonly metadata: Record<string, unknown> | null;
    readonly score: number;
}
export type RetrievalSearch = (
    row: RetrievalCase,
) => Promise<readonly RetrievalHit[]>;

// ─── Seeding ────────────────────────────────────────────────────────────────

/**
 * Writes the corpus into a tenant schema, as ingestion would.
 *
 * `chunkId` goes into the embedding's metadata, and that is how a hit is
 * matched back to a label. The alternative — deriving a UUID from the chunk id
 * — would work until the day somebody changes the derivation and every label in
 * every past report silently points at a different row.
 */
export async function seedRetrievalCorpus(
    query: EvaluationQuery,
    corpus: readonly RetrievalDocument[] = RETRIEVAL_CORPUS,
    embed: (text: string) => number[] = deterministicEmbedding,
): Promise<number> {
    let chunks = 0;
    for (const document of corpus) {
        const [row] = await query<any[]>(
            `INSERT INTO knowledge_documents
                (title, content_text, status, language, jurisdiction, authority,
                 valid_from, valid_to, is_regulated, audience, chunk_count, metadata)
             VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11,$12::jsonb)
             RETURNING id`,
            [document.title, document.chunks.map(chunk => chunk.text).join('\n'),
                document.status, document.language, document.jurisdiction ?? null,
                document.authority ?? null, document.validFrom ?? null, document.validTo ?? null,
                !!document.isRegulated, document.audience ?? 'customer', document.chunks.length,
                JSON.stringify({ evaluationDocumentId: document.id, vertical: document.vertical, kind: document.kind })]);
        for (const [index, chunk] of document.chunks.entries()) {
            await query(
                `INSERT INTO knowledge_embeddings (document_id, chunk_index, chunk_text, embedding, metadata)
                 VALUES ($1::uuid,$2,$3,$4::vector,$5::jsonb)`,
                [row.id, index, chunk.text, embeddingLiteral(embed(chunk.text)),
                    JSON.stringify({ chunkId: chunk.id, evaluationDocumentId: document.id })]);
            chunks += 1;
        }
    }
    // The BM25 half of hybrid retrieval reads this column, and a run with it
    // empty is a vector-only run wearing a hybrid label.
    await query(`UPDATE knowledge_embeddings SET search_tsv = to_tsvector('simple', chunk_text)
                  WHERE search_tsv IS NULL`);
    return chunks;
}

/** The chunk a hit belongs to, or null when it is not part of the labelled corpus. */
export const hitChunkId = (hit: RetrievalHit): string | null => {
    const value = (hit.metadata as any)?.chunkId;
    return typeof value === 'string' && value ? value : null;
};

// ─── Running ────────────────────────────────────────────────────────────────

export interface RetrievalRunConditions {
    /** Which labels. A hash, so it cannot be forgotten the way a version number can. */
    readonly datasetRevision: string;
    /** Which vectors. Never omitted: a pipeline number is not a model number. */
    readonly embeddingModel: string;
    /** How many documents were in the way, including distractors. */
    readonly corpusDocuments: number;
    readonly corpusChunks: number;
    /** Where the cut sat. Changing it moves every number in the report. */
    readonly similarityThreshold: number;
    readonly k: number;
    readonly topK: number;
}

export interface RetrievalReport {
    readonly conditions: RetrievalRunConditions;
    readonly overall: RetrievalMetrics;
    readonly byLanguage: Readonly<Record<string, RetrievalMetrics>>;
    readonly byChallenge: Readonly<Record<string, RetrievalMetrics>>;
    readonly scores: readonly CaseScore[];
}

export interface RetrievalRunOptions {
    readonly cases?: readonly RetrievalCase[];
    readonly corpus?: readonly RetrievalDocument[];
    readonly k?: number;
    readonly topK?: number;
    readonly similarityThreshold: number;
    readonly embeddingModel?: string;
    /** Present only when an answering step ran; retrieval-only runs leave it out. */
    readonly answer?: (row: RetrievalCase, hits: readonly RetrievalHit[]) => { citations: string[]; text: string };
}

/**
 * Runs every case and scores it.
 *
 * A case that throws is recorded as an error rather than allowed to end the
 * run: one query failing tells you about that query, and losing the other
 * fifteen results to it tells you nothing about anything.
 */
export async function runRetrievalCases(
    search: RetrievalSearch, options: RetrievalRunOptions,
): Promise<RetrievalReport> {
    const cases = options.cases ?? RETRIEVAL_CASES;
    const corpus = options.corpus ?? RETRIEVAL_CORPUS;
    const k = options.k ?? 5;
    const topK = options.topK ?? 10;
    const byId = new Map(cases.map(row => [row.id, row]));
    const outcomes: CaseOutcome[] = [];

    for (const row of cases) {
        const started = Date.now();
        try {
            const hits = await search(row);
            const retrieved: RetrievedChunk[] = [];
            for (const [index, hit] of hits.entries()) {
                const chunkId = hitChunkId(hit);
                // A hit with no label is a distractor doing its job. It still
                // occupies a rank, which is exactly the pressure it is there to
                // apply, so it is not removed from the ordering.
                if (chunkId) retrieved.push({ chunkId, rank: index + 1, score: hit.score });
            }
            outcomes.push({
                caseId: row.id, retrieved, latencyMs: Date.now() - started,
                ...(options.answer ? { answer: options.answer(row, hits) } : {}),
            });
        } catch (error: any) {
            outcomes.push({ caseId: row.id, retrieved: [], latencyMs: Date.now() - started,
                error: String(error?.message ?? error) });
        }
    }

    const scores = outcomes.map(outcome => scoreCase(byId.get(outcome.caseId)!, outcome, k));
    return Object.freeze({
        conditions: Object.freeze({
            datasetRevision: datasetRevision(corpus, cases),
            embeddingModel: options.embeddingModel ?? DETERMINISTIC_EMBEDDING_ID,
            corpusDocuments: corpus.length,
            corpusChunks: [...retrievalChunkIndex(corpus).keys()].length,
            similarityThreshold: options.similarityThreshold,
            k, topK,
        }),
        overall: summariseRetrieval(scores, k),
        byLanguage: summariseBy(scores, k, caseId => byId.get(caseId)!.language as RetrievalLanguage),
        byChallenge: summariseBy(scores, k, caseId => byId.get(caseId)!.challenge),
        scores: Object.freeze(scores),
    });
}

// ─── Reporting ──────────────────────────────────────────────────────────────

const show = (value: number | null): string => value === null ? '—' : value.toFixed(3);

/** One table a person can read, with the conditions above it rather than lost. */
export function renderRetrievalReport(report: RetrievalReport): string {
    const line = (name: string, metrics: RetrievalMetrics) =>
        `| ${name} | ${metrics.cases} | ${show(metrics.recallAtK)} | ${show(metrics.mrr)} | `
        + `${show(metrics.answerAccuracy)} | ${show(metrics.abstentionAccuracy)} | ${metrics.leaks} | `
        + `${metrics.errors} | ${metrics.latency.p50} | ${metrics.latency.p95} | ${metrics.latency.p99} |`;
    const header = ['| split | cases | recall@k | MRR | answer | abstention | leaks | errors | p50 | p95 | p99 |',
        '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'];
    return [
        `dataset ${report.conditions.datasetRevision.slice(0, 12)} · embedding ${report.conditions.embeddingModel}`
        + ` · ${report.conditions.corpusDocuments} docs / ${report.conditions.corpusChunks} chunks`
        + ` · threshold ${report.conditions.similarityThreshold} · k=${report.conditions.k}`,
        '',
        ...header,
        line('overall', report.overall),
        ...Object.entries(report.byLanguage).map(([name, metrics]) => line(`lang:${name}`, metrics)),
        ...Object.entries(report.byChallenge).map(([name, metrics]) => line(`chal:${name}`, metrics)),
        '',
        `entailment: ${report.overall.semanticEntailment} (no judge ran)`,
        report.overall.leaks
            ? `LEAKED: ${report.overall.leakedCaseIds.join(', ')}`
            : 'no leaks',
    ].join('\n');
}
