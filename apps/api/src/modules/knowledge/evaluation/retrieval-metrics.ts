/**
 * What a retrieval run scored, kept as separate numbers on purpose.
 *
 * There is a strong pull toward one "RAG quality" percentage, and it is the
 * wrong shape for this. The failures underneath it are not degrees of the same
 * thing:
 *
 *   · a MISS is the right passage not coming back. It costs an answer;
 *   · a LEAK is the wrong passage coming back — a withdrawn promise, an
 *     internal margin, a foreign regulation. It costs more than an answer, and
 *     averaging it into recall makes a system with one leak look like a system
 *     with a slightly lower score;
 *   · an UNGROUNDED answer is the right passage coming back and the reply
 *     saying something it does not support;
 *   · a WRONG ABSTENTION is silence when the corpus had the answer, and a
 *     MISSING abstention is confidence when it did not. They are opposites and
 *     a single "accuracy" number lets one hide the other.
 *
 * So each one is its own column, and the report refuses to collapse them.
 *
 * ── What this file will not claim ───────────────────────────────────────────
 *
 * Groundedness here is LEXICAL: it asks whether the passages that came back
 * actually contain the text the case says supports the answer. That is a real
 * and useful check — an answer whose supporting words are nowhere in what was
 * retrieved is ungrounded by any definition — but it is NOT entailment, and
 * this module never says it is. `semanticEntailment` stays `not_evaluated`
 * unless a judge run fills it in, which is exactly the line
 * `knowledge-attribution.ts` already draws and for the same reason: a literal
 * overlap is not a proof of meaning.
 */

import type { RetrievalCase } from './retrieval-dataset';

export interface RetrievedChunk {
    readonly chunkId: string;
    /** 1-based, in the order retrieval returned them after its own threshold. */
    readonly rank: number;
    readonly score: number;
}

export interface CaseOutcome {
    readonly caseId: string;
    /** Everything retrieval returned above its threshold, ordered. */
    readonly retrieved: readonly RetrievedChunk[];
    readonly latencyMs: number;
    /** Set when retrieval itself failed. Such a case scores nothing; it is counted as an error. */
    readonly error?: string;
    /**
     * What an answering step produced, when the run had one.
     *
     * Absent means this was a retrieval-only run, and the answer-shaped metrics
     * report `not_evaluated` rather than zero — a metric nobody measured must
     * not read as a metric something failed.
     */
    readonly answer?: { readonly citations: readonly string[]; readonly text: string };
}

export type Verdict = 'pass' | 'fail' | 'not_evaluated';

export interface CaseScore {
    readonly caseId: string;
    readonly error: string | null;
    /** Undefined for a case with no relevant chunks: recall over an empty truth is not zero, it is undefined. */
    readonly recallAtK: number | null;
    readonly reciprocalRank: number | null;
    readonly citationPrecision: number | null;
    readonly lexicalSupport: Verdict;
    readonly semanticEntailment: 'not_evaluated';
    readonly answerCorrect: Verdict;
    readonly abstentionCorrect: Verdict;
    readonly leaked: readonly string[];
    readonly latencyMs: number;
}

const unique = (values: readonly string[]): string[] => [...new Set(values)];

/**
 * Nearest rank, no interpolation.
 *
 * A published p99 has to be a latency the run actually saw; interpolating
 * invents a number between two real ones and then somebody puts it in an SLO.
 * Same definition as `common/__fixtures__/load-metrics.ts`, deliberately, so a
 * percentile from the load harness and one from here mean the same thing.
 */
export function percentile(values: readonly number[], p: number): number {
    if (!values.length) return 0;
    if (!(p > 0 && p <= 100)) throw new Error('percentile_out_of_range');
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

/**
 * Scores one case against its labels.
 *
 * `k` is the cut-off recall and MRR are measured at. It is an argument rather
 * than a constant because the answer to "does the right passage come back" and
 * the answer to "does it come back in the first three" are different questions,
 * and a report that only ever asks one of them hides the ranking.
 */
export function scoreCase(row: RetrievalCase, outcome: CaseOutcome, k: number): CaseScore {
    if (!Number.isInteger(k) || k < 1) throw new Error('retrieval_k_invalid');
    const leaked = unique(outcome.retrieved.map(hit => hit.chunkId)).filter(id => row.forbidden.includes(id));
    if (outcome.error) {
        // An error is not a zero. A run that fell over tells you nothing about
        // ranking, and folding it in as a miss would make an outage look like a
        // quality regression.
        return Object.freeze({
            caseId: row.id, error: outcome.error,
            recallAtK: null, reciprocalRank: null, citationPrecision: null,
            lexicalSupport: 'not_evaluated' as const, semanticEntailment: 'not_evaluated' as const,
            answerCorrect: 'not_evaluated' as const, abstentionCorrect: 'not_evaluated' as const,
            leaked: Object.freeze(leaked), latencyMs: outcome.latencyMs,
        });
    }

    const ordered = [...outcome.retrieved].sort((a, b) => a.rank - b.rank);
    const topK = ordered.slice(0, k).map(hit => hit.chunkId);
    const relevant = new Set(row.relevant);

    const recallAtK = relevant.size
        ? topK.filter(id => relevant.has(id)).length / relevant.size
        : null;
    const firstRelevant = ordered.findIndex(hit => relevant.has(hit.chunkId));
    const reciprocalRank = relevant.size ? (firstRelevant < 0 ? 0 : 1 / (firstRelevant + 1)) : null;

    const authorised = row.expected.kind === 'answer' ? new Set(row.expected.authorisedCitations) : new Set<string>();
    const cited = outcome.answer ? unique(outcome.answer.citations) : null;
    const citationPrecision = cited && cited.length
        ? cited.filter(id => authorised.has(id)).length / cited.length
        : null;

    // Lexical support is checked against what came back, not against the corpus:
    // an answer supported by a passage retrieval never returned is an answer the
    // agent could not have grounded.
    let lexicalSupport: Verdict = 'not_evaluated';
    if (row.expected.kind === 'answer' && outcome.answer) {
        const retrievedIds = new Set(ordered.map(hit => hit.chunkId));
        const supportingRetrieved = row.expected.authorisedCitations.some(id => retrievedIds.has(id));
        const claimed = outcome.answer.text.toLowerCase();
        const supported = supportingRetrieved
            && row.expected.support.every(fragment => claimed.includes(fragment.toLowerCase()));
        lexicalSupport = supported ? 'pass' : 'fail';
    }

    const abstained = ordered.length === 0;
    const abstentionCorrect: Verdict = row.expected.kind === 'abstain'
        ? (abstained && !leaked.length ? 'pass' : 'fail')
        : 'not_evaluated';

    // "Correct" for an answer case means all three at once: the right passage
    // came back, nothing forbidden did, and — when there is an answer to check —
    // it cited only what it was allowed to.
    const answerCorrect: Verdict = row.expected.kind === 'answer'
        ? (recallAtK === 1 && !leaked.length && (citationPrecision === null || citationPrecision === 1) ? 'pass' : 'fail')
        : 'not_evaluated';

    return Object.freeze({
        caseId: row.id, error: null, recallAtK, reciprocalRank, citationPrecision,
        lexicalSupport, semanticEntailment: 'not_evaluated' as const,
        answerCorrect, abstentionCorrect, leaked: Object.freeze(leaked), latencyMs: outcome.latencyMs,
    });
}

export interface RetrievalMetrics {
    readonly cases: number;
    readonly k: number;
    /** Mean recall@k over the cases that have a truth set. */
    readonly recallAtK: number | null;
    readonly mrr: number | null;
    readonly citationPrecision: number | null;
    readonly lexicalSupportRate: number | null;
    readonly semanticEntailment: 'not_evaluated';
    readonly answerAccuracy: number | null;
    readonly abstentionAccuracy: number | null;
    /** Cases where a forbidden chunk came back. Never averaged into recall. */
    readonly leaks: number;
    readonly leakedCaseIds: readonly string[];
    readonly errors: number;
    readonly latency: { readonly p50: number; readonly p95: number; readonly p99: number; readonly max: number };
}

const mean = (values: readonly number[]): number | null =>
    values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;

const rate = (scores: readonly CaseScore[], pick: (score: CaseScore) => Verdict): number | null => {
    const judged = scores.filter(score => pick(score) !== 'not_evaluated');
    return judged.length ? judged.filter(score => pick(score) === 'pass').length / judged.length : null;
};

/** Rolls a set of case scores into the numbers a report publishes. */
export function summariseRetrieval(scores: readonly CaseScore[], k: number): RetrievalMetrics {
    const latencies = scores.map(score => score.latencyMs);
    const leakedCaseIds = scores.filter(score => score.leaked.length).map(score => score.caseId);
    return Object.freeze({
        cases: scores.length,
        k,
        recallAtK: mean(scores.map(score => score.recallAtK).filter((value): value is number => value !== null)),
        mrr: mean(scores.map(score => score.reciprocalRank).filter((value): value is number => value !== null)),
        citationPrecision: mean(scores.map(score => score.citationPrecision).filter((value): value is number => value !== null)),
        lexicalSupportRate: rate(scores, score => score.lexicalSupport),
        semanticEntailment: 'not_evaluated' as const,
        answerAccuracy: rate(scores, score => score.answerCorrect),
        abstentionAccuracy: rate(scores, score => score.abstentionCorrect),
        leaks: leakedCaseIds.length,
        leakedCaseIds: Object.freeze(leakedCaseIds),
        errors: scores.filter(score => score.error).length,
        latency: Object.freeze({
            p50: percentile(latencies, 50), p95: percentile(latencies, 95),
            p99: percentile(latencies, 99), max: latencies.length ? Math.max(...latencies) : 0,
        }),
    });
}

/**
 * The same numbers, split by whatever dimension the reader is asking about.
 *
 * The report is published per language and per challenge because those are the
 * two splits where a good average hides a bad cell: a suite that answers every
 * Spanish question and no French one, or one that handles every plain question
 * and leaks on every retired document, both average out to respectable.
 */
export function summariseBy<K extends string>(
    scores: readonly CaseScore[], k: number, key: (caseId: string) => K,
): Readonly<Record<K, RetrievalMetrics>> {
    const groups = new Map<K, CaseScore[]>();
    for (const score of scores) {
        const group = key(score.caseId);
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group)!.push(score);
    }
    const out = {} as Record<K, RetrievalMetrics>;
    for (const [group, rows] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
        out[group] = summariseRetrieval(rows, k);
    }
    return Object.freeze(out);
}
