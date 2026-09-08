import { revisionHash } from '../evaluation-revision/evaluation-revision';

/**
 * The protocol for comparing this agent with an alternative.
 *
 * "Best on the market" is a claim about other people's products, and nothing in
 * this repository could support it: passing our own tests says what our own
 * tests ask. This module exists to make the difference structural rather than a
 * matter of remembering to be careful — it can hold a comparison, and it
 * refuses to summarise one that is not comparable.
 *
 * Three rules do the work:
 *
 *   1. Every subject answers the SAME frozen corpus. A corpus is identified by
 *      the hash of its tasks, and a run against a different hash is not part of
 *      this comparison at all.
 *   2. Success is confirmed, never asserted. A task counts only when the
 *      business result was verified where it lands — a row, a receipt — the way
 *      the eval verifier checks it. A transcript that sounds successful is not
 *      evidence, and a judge's score is a separate axis.
 *   3. The rubric is blind. A human review carries the subject's blind label,
 *      and a review whose label resolves to a subject the reviewer could name
 *      is discarded rather than counted.
 *
 * Nothing here calls a provider. Running it against a real alternative needs an
 * authorised account for that alternative, which is a gate the owner holds.
 */

export const BENCHMARK_AXES = ['confirmedSuccess', 'reliability', 'cost', 'latency', 'setupTime'] as const;
export type BenchmarkAxis = (typeof BENCHMARK_AXES)[number];

export interface BenchmarkTask {
    readonly key: string;
    /** The profile whose contract this task belongs to. */
    readonly profileId: string;
    readonly language: string;
    readonly channel: string;
    /** What the customer says, in order. Frozen with the corpus. */
    readonly messages: readonly string[];
    /**
     * What must be true afterwards for this to count as done — checked where
     * the result lands, not in the transcript.
     */
    readonly confirms: readonly { table: string; where: Readonly<Record<string, string>> }[];
    /** Tools and permissions every subject is given. Differences invalidate. */
    readonly grants: readonly string[];
}

export interface BenchmarkCorpus {
    readonly id: string;
    readonly tasks: readonly BenchmarkTask[];
    /** Identity of the frozen content. Two corpora with the same id and
     *  different tasks are not the same comparison. */
    readonly contentHash: string;
}

export interface BenchmarkSubject {
    readonly id: string;
    /** `self` is this platform; anything else names a product. */
    readonly kind: 'self' | 'alternative';
    readonly label: string;
    /** What the reviewer sees. Must not identify the subject. */
    readonly blindLabel: string;
    /** Minutes a person needed to get this subject ready to answer at all. */
    readonly setupMinutes: number | null;
}

export interface BenchmarkAttempt {
    readonly subjectId: string;
    readonly taskKey: string;
    readonly corpusHash: string;
    /** Verified where the result lands. `null` means nobody checked. */
    readonly confirmed: boolean | null;
    readonly costUsdCents: number | null;
    readonly latencyMs: number | null;
    readonly transcript: readonly { role: 'user' | 'assistant'; content: string }[];
    readonly error?: string | null;
}

export interface BenchmarkReview {
    readonly taskKey: string;
    /** The blind label the reviewer saw. Never a subject id. */
    readonly blindLabel: string;
    readonly reviewerId: string;
    readonly score: number;
    readonly notes?: string;
}

export interface SubjectResult {
    readonly subjectId: string;
    readonly attempts: number;
    readonly confirmedSuccesses: number;
    readonly unconfirmed: number;
    readonly failures: number;
    /** Same task attempted more than once, and how often it agreed with itself. */
    readonly reliability: number | null;
    readonly medianLatencyMs: number | null;
    readonly totalCostUsdCents: number | null;
    readonly setupMinutes: number | null;
    readonly blindScore: number | null;
}

export interface BenchmarkReport {
    readonly version: 1;
    readonly corpusId: string;
    readonly corpusHash: string;
    readonly comparable: boolean;
    /** Why no comparison may be summarised from this. Empty means it may. */
    readonly blockers: readonly string[];
    readonly subjects: readonly SubjectResult[];
}

export class BenchmarkError extends Error {
    constructor(readonly code: string) { super(code); }
}
const fail = (code: string): never => { throw new BenchmarkError(code); };

/** Freeze a corpus and give it the identity every attempt has to name. */
export function freezeBenchmarkCorpus(id: string, tasks: readonly BenchmarkTask[]): BenchmarkCorpus {
    if (!id || typeof id !== 'string') fail('benchmark_corpus_id_required');
    if (!Array.isArray(tasks) || !tasks.length) fail('benchmark_corpus_empty');
    const keys = new Set<string>();
    for (const task of tasks) {
        if (!task?.key || keys.has(task.key)) fail('benchmark_task_key_invalid');
        keys.add(task.key);
        if (!task.messages?.length) fail('benchmark_task_messages_required');
        // A task nobody can confirm measures how a transcript reads.
        if (!task.confirms?.length) fail('benchmark_task_confirmation_required');
    }
    const ordered = [...tasks].sort((a, b) => a.key.localeCompare(b.key));
    return Object.freeze({
        id, tasks: Object.freeze(ordered),
        contentHash: revisionHash(JSON.parse(JSON.stringify(ordered))),
    });
}

const median = (values: readonly number[]): number | null => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

/**
 * Summarise a comparison, or refuse to.
 *
 * The refusal is the feature. A single subject, a subject that skipped tasks,
 * an attempt against a different corpus, a review that could name its subject,
 * or a task nobody confirmed all make the numbers incomparable — and reporting
 * them anyway is exactly how "best on the market" gets said without evidence.
 */
export function summariseBenchmark(input: {
    corpus: BenchmarkCorpus;
    subjects: readonly BenchmarkSubject[];
    attempts: readonly BenchmarkAttempt[];
    reviews?: readonly BenchmarkReview[];
}): BenchmarkReport {
    const blockers: string[] = [];
    const subjects = input.subjects ?? [];
    if (subjects.length < 2) blockers.push('single_subject');
    if (!subjects.some(subject => subject.kind === 'alternative')) blockers.push('no_alternative_subject');
    if (new Set(subjects.map(subject => subject.blindLabel)).size !== subjects.length) {
        blockers.push('blind_labels_not_unique');
    }
    // A label a reviewer can decode is not blind.
    if (subjects.some(subject => subject.blindLabel.toLowerCase().includes(subject.label.toLowerCase())
        || subject.blindLabel === subject.id)) blockers.push('blind_label_reveals_subject');

    const own = input.attempts.filter(attempt => attempt.corpusHash === input.corpus.contentHash);
    if (own.length !== input.attempts.length) blockers.push('attempts_from_another_corpus');

    const byBlindLabel = new Map(subjects.map(subject => [subject.blindLabel, subject.id]));
    const reviews = (input.reviews ?? []).filter(review => byBlindLabel.has(review.blindLabel));
    if (reviews.length !== (input.reviews ?? []).length) blockers.push('review_without_known_label');

    const results: SubjectResult[] = subjects.map(subject => {
        const mine = own.filter(attempt => attempt.subjectId === subject.id);
        const answered = new Set(mine.map(attempt => attempt.taskKey));
        if (answered.size !== input.corpus.tasks.length) blockers.push(`incomplete_corpus:${subject.id}`);
        if (mine.some(attempt => attempt.confirmed === null)) blockers.push(`unconfirmed_result:${subject.id}`);

        const repeats = [...answered].map(key => mine.filter(attempt => attempt.taskKey === key))
            .filter(group => group.length > 1);
        const agreed = repeats.filter(group =>
            group.every(attempt => attempt.confirmed === group[0].confirmed)).length;
        const latencies = mine.map(attempt => attempt.latencyMs).filter((value): value is number => value !== null);
        const costs = mine.map(attempt => attempt.costUsdCents).filter((value): value is number => value !== null);
        const scores = reviews.filter(review => byBlindLabel.get(review.blindLabel) === subject.id)
            .map(review => review.score);

        return Object.freeze({
            subjectId: subject.id,
            attempts: mine.length,
            confirmedSuccesses: mine.filter(attempt => attempt.confirmed === true).length,
            unconfirmed: mine.filter(attempt => attempt.confirmed === null).length,
            failures: mine.filter(attempt => attempt.confirmed === false).length,
            reliability: repeats.length ? Math.round((agreed / repeats.length) * 100) / 100 : null,
            medianLatencyMs: median(latencies),
            totalCostUsdCents: costs.length ? costs.reduce((sum, value) => sum + value, 0) : null,
            setupMinutes: subject.setupMinutes,
            blindScore: scores.length ? Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 100) / 100 : null,
        });
    });

    return Object.freeze({
        version: 1 as const,
        corpusId: input.corpus.id,
        corpusHash: input.corpus.contentHash,
        comparable: blockers.length === 0,
        blockers: Object.freeze([...new Set(blockers)].sort()),
        subjects: Object.freeze(results),
    });
}

/**
 * The sentence a report is allowed to support.
 *
 * Never a superlative from an incomparable run, and never a superlative at all
 * from one subject. Callers that want a headline get a verifiable statement or
 * an explanation of what is missing to earn one.
 */
export function benchmarkStatement(report: BenchmarkReport): string {
    if (!report.comparable) {
        return `No comparison can be stated from this run: ${report.blockers.join(', ')}.`;
    }
    const ranked = [...report.subjects].sort((a, b) => b.confirmedSuccesses - a.confirmedSuccesses);
    const [best, second] = ranked;
    if (!second || best.confirmedSuccesses === second.confirmedSuccesses) {
        return `No subject confirmed more results than the others on corpus ${report.corpusId}.`;
    }
    return `On corpus ${report.corpusId}, ${best.subjectId} confirmed ${best.confirmedSuccesses} of `
        + `${best.attempts} attempts against ${second.subjectId}'s ${second.confirmedSuccesses} of ${second.attempts}.`;
}
