import { createHash } from 'crypto';
import {
    CONVERSATIONAL_CHANNELS, EVAL_LANGUAGES, buildDomainContractDraft,
    composeSubtypeEvalPack, listCanonicalSubtypeExperienceProfileIds,
} from '@parallext/shared';
import {
    freezeBenchmarkCorpus, summariseBenchmark,
    type BenchmarkAttempt, type BenchmarkCorpus, type BenchmarkReview, type BenchmarkSubject, type BenchmarkTask,
} from './agent-benchmark';

/**
 * The half of the benchmark that can be built and run without an account
 * anywhere.
 *
 * `agent-benchmark.ts` validates a comparison and refuses to summarise one that
 * is not comparable, which is the right thing to have and is not a harness: it
 * freezes a corpus somebody else assembled, and summarises attempts somebody
 * else produced. Nothing generated the corpus, nothing ran a subject, and
 * nothing stored an attempt — so the "benchmark" was a scoring function with no
 * subject on either side of it.
 *
 * This is the rest of the local half:
 *
 *  · a corpus GENERATED from the certifiable catalogue, stratified so one
 *    vertical cannot dominate the sample, and deterministic from a seed so two
 *    people asking for the same comparison get the same one;
 *  · outcome verifiers taken from the packs' own `db_effect` assertions, so a
 *    task counts as done where the row lands and not where the transcript
 *    sounds convincing — a task without one is refused rather than included;
 *  · a synthetic subject, so the whole pipeline runs end to end with no
 *    provider, no key and no spend;
 *  · durable attempts and blind reviews, because a comparison that lives in a
 *    process is a comparison nobody can audit afterwards.
 *
 * What is deliberately NOT here: the alternatives. Running a competitor needs
 * that competitor's account, and no amount of local code substitutes for it.
 * That is gate 4, and the package for it is written from what this produces.
 */

export type BenchmarkQuery = <R = any[]>(sql: string, params?: any[]) => Promise<R>;

export interface BenchmarkCorpusInput {
    readonly id: string;
    /** Defaults to the canonical catalogue. */
    readonly profiles?: readonly string[];
    readonly languages?: readonly string[];
    readonly channels: readonly string[];
    /** Tasks kept per (profile, language, channel). The stratum. */
    readonly perStratum?: number;
    /** Same seed, same corpus. A comparison nobody can reproduce is an anecdote. */
    readonly seed: string;
}

export interface BenchmarkCorpusResult {
    readonly corpus: BenchmarkCorpus;
    /** Strata that produced no confirmable task, named rather than dropped. */
    readonly emptyStrata: readonly string[];
    /** Why a candidate scenario was not eligible, counted by reason. */
    readonly refusals: Readonly<Record<string, number>>;
}

/** Deterministic order from a seed. Not random: a benchmark has to be repeatable. */
const seededRank = (seed: string, key: string): string =>
    createHash('sha256').update(`${seed}:${key}`).digest('hex');

/**
 * Turns one pack scenario into a benchmark task, or explains why it cannot.
 *
 * The `db_effect` assertions become the confirmations, and the `tool_call`
 * assertions become the grants every subject must be given. A scenario with no
 * `db_effect` is refused: it may be a perfectly good evaluation case and it is
 * still not a benchmark task, because there is nothing to check afterwards
 * except how the answer reads.
 */
function taskFromScenario(
    scenario: any, profileId: string, language: string, channel: string,
): { task: BenchmarkTask } | { refusal: string } {
    const actions: any[] = Array.isArray(scenario.expectedActions) ? scenario.expectedActions : [];
    const confirms = actions
        .filter(action => action?.kind === 'db_effect' && action.type !== 'no_row' && action.table)
        .map(action => ({
            table: String(action.table),
            where: Object.fromEntries(Object.entries(action.where ?? {})
                .map(([field, value]) => [field, String(value)])),
        }));
    if (!confirms.length) return { refusal: 'no_confirmable_outcome' };
    const messages = (Array.isArray(scenario.messages) ? scenario.messages : []).map((message: any) => String(message));
    if (!messages.length) return { refusal: 'no_customer_messages' };
    const grants = [...new Set(actions
        .filter(action => action?.kind === 'tool_call' && action.type === 'called' && action.tool)
        .map(action => String(action.tool)))].sort();
    return {
        task: Object.freeze({
            key: `${profileId}|${language}|${channel}|${scenario.key}`,
            profileId, language, channel,
            messages: Object.freeze(messages),
            confirms: Object.freeze(confirms.map(entry => Object.freeze(entry))),
            grants: Object.freeze(grants),
        }),
    };
}

/**
 * Builds the frozen corpus from the catalogue.
 *
 * Stratified by (profile, language, channel) rather than sampled from the whole
 * pool: a flat sample of 78.120 cases would be dominated by whichever verticals
 * have the most scenarios, and a comparison weighted that way measures the
 * catalogue's shape rather than the subjects'.
 */
export function generateBenchmarkCorpus(input: BenchmarkCorpusInput): BenchmarkCorpusResult {
    const canonical = listCanonicalSubtypeExperienceProfileIds();
    const profiles = (input.profiles?.length ? [...new Set(input.profiles)] : canonical)
        .filter(profile => canonical.includes(profile)).sort();
    const languages = (input.languages?.length ? [...new Set(input.languages)] : [...EVAL_LANGUAGES])
        .filter(language => (EVAL_LANGUAGES as readonly string[]).includes(language)).sort();
    const channels = [...new Set(input.channels)]
        .filter(channel => (CONVERSATIONAL_CHANNELS as readonly string[]).includes(channel)).sort();
    const perStratum = Math.max(1, Math.trunc(input.perStratum ?? 2));

    const refusals: Record<string, number> = {};
    const emptyStrata: string[] = [];
    const tasks: BenchmarkTask[] = [];

    for (const profileId of profiles) {
        const [industry, subtype] = profileId.split('/');
        // The domain contract is what says this profile has committing tasks at
        // all. A profile whose intents commit nothing has nothing to confirm.
        const domain = buildDomainContractDraft(industry, subtype);
        for (const language of languages) {
            const scenarios = composeSubtypeEvalPack({ industry, subtype, language, addressForm: null });
            for (const channel of channels) {
                const eligible: BenchmarkTask[] = [];
                for (const scenario of scenarios) {
                    const built = taskFromScenario(scenario, profileId, language, channel);
                    if ('refusal' in built) {
                        refusals[built.refusal] = (refusals[built.refusal] ?? 0) + 1;
                        continue;
                    }
                    eligible.push(built.task);
                }
                if (!eligible.length) {
                    emptyStrata.push(`${profileId}|${language}|${channel}`);
                    if (!domain.intents.length) refusals.profile_without_intents = (refusals.profile_without_intents ?? 0) + 1;
                    continue;
                }
                eligible
                    .sort((a, b) => seededRank(input.seed, a.key).localeCompare(seededRank(input.seed, b.key)))
                    .slice(0, perStratum)
                    .forEach(task => tasks.push(task));
            }
        }
    }
    if (!tasks.length) {
        // `freezeBenchmarkCorpus` would throw, and an empty corpus is a fact
        // worth reporting rather than an exception to catch.
        return Object.freeze({
            corpus: Object.freeze({ id: input.id, tasks: Object.freeze([]), contentHash: '' }) as BenchmarkCorpus,
            emptyStrata: Object.freeze(emptyStrata), refusals: Object.freeze(refusals),
        });
    }
    return Object.freeze({
        corpus: freezeBenchmarkCorpus(input.id, tasks),
        emptyStrata: Object.freeze(emptyStrata),
        refusals: Object.freeze(refusals),
    });
}

/**
 * What runs one task for one subject. Injected for the same reason the
 * certification runner is: Parallly's own runner spends money, and an
 * alternative's needs that alternative's account.
 */
export type BenchmarkRunner = (
    subject: BenchmarkSubject, task: BenchmarkTask,
) => Promise<Omit<BenchmarkAttempt, 'subjectId' | 'taskKey' | 'corpusHash'>>;

/**
 * A subject with no provider behind it, for exercising the harness itself.
 *
 * It is deliberately crude and deliberately honest about being crude: it
 * confirms a fixed proportion of tasks, chosen by seed so the result is stable.
 * Its purpose is to prove the pipeline runs end to end — corpus, attempts,
 * persistence, blind review, refusal to summarise — without a key. Nobody may
 * report its numbers as a comparison, and `summariseBenchmark` will not let
 * them: a synthetic subject alone is one subject, and one subject is not a
 * comparison.
 */
export function syntheticBenchmarkRunner(options: {
    seed: string; confirmRate: number; costUsdCents?: number; latencyMs?: number;
}): BenchmarkRunner {
    const rate = Math.max(0, Math.min(1, options.confirmRate));
    return async (subject, task) => {
        const draw = parseInt(seededRank(options.seed, `${subject.id}:${task.key}`).slice(0, 8), 16) / 0xffffffff;
        const confirmed = draw < rate;
        return {
            confirmed,
            costUsdCents: options.costUsdCents ?? 1,
            latencyMs: options.latencyMs ?? 1200,
            transcript: task.messages.flatMap(message => ([
                { role: 'user' as const, content: message },
                { role: 'assistant' as const, content: confirmed ? 'listo' : 'no pude' },
            ])),
            error: null,
        };
    };
}

// ─── Durable attempts and blind reviews ─────────────────────────────────────

export const BENCHMARK_LEDGER_DDL: readonly string[] = Object.freeze([
    `CREATE TABLE IF NOT EXISTS benchmark_attempts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        corpus_id TEXT NOT NULL,
        corpus_hash TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        task_key TEXT NOT NULL,
        run_index INTEGER NOT NULL DEFAULT 1,
        confirmed BOOLEAN,
        cost_usd_cents INTEGER,
        latency_ms INTEGER,
        transcript JSONB NOT NULL DEFAULT '[]'::jsonb,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT benchmark_attempts_run CHECK (run_index >= 1)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uidx_benchmark_attempt
        ON benchmark_attempts (corpus_hash, subject_id, task_key, run_index)`,
    `CREATE TABLE IF NOT EXISTS benchmark_reviews (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        corpus_hash TEXT NOT NULL,
        task_key TEXT NOT NULL,
        blind_label TEXT NOT NULL,
        reviewer_id TEXT NOT NULL,
        score NUMERIC NOT NULL,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT benchmark_reviews_score CHECK (score >= 0 AND score <= 10)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uidx_benchmark_review
        ON benchmark_reviews (corpus_hash, task_key, blind_label, reviewer_id)`,
]);

export async function ensureBenchmarkLedger(query: BenchmarkQuery): Promise<void> {
    for (const statement of BENCHMARK_LEDGER_DDL) await query(statement);
}

/**
 * Runs a corpus for one subject and stores every attempt.
 *
 * `run_index` makes a repeat a new row rather than an overwrite: reliability is
 * literally "did the same subject agree with itself on the same task", and it
 * cannot be measured by a table that keeps only the last answer.
 */
export async function runBenchmarkSubject(input: {
    readonly query: BenchmarkQuery;
    readonly corpus: BenchmarkCorpus;
    readonly subject: BenchmarkSubject;
    readonly runner: BenchmarkRunner;
    readonly runIndex?: number;
}): Promise<{ attempts: number; confirmed: number }> {
    const runIndex = Math.max(1, Math.trunc(input.runIndex ?? 1));
    let attempts = 0, confirmed = 0;
    for (const task of input.corpus.tasks) {
        let outcome: Awaited<ReturnType<BenchmarkRunner>>;
        try {
            outcome = await input.runner(input.subject, task);
        } catch (error: any) {
            // `confirmed: null` is not `false`. "The subject failed" and "nobody
            // checked" are different findings and the summary treats them so.
            outcome = {
                confirmed: null, costUsdCents: null, latencyMs: null, transcript: [],
                error: String(error?.message ?? 'runner_failed').slice(0, 200),
            };
        }
        await input.query(
            `INSERT INTO benchmark_attempts
                (corpus_id, corpus_hash, subject_id, task_key, run_index, confirmed, cost_usd_cents, latency_ms, transcript, error)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
             ON CONFLICT (corpus_hash, subject_id, task_key, run_index) DO NOTHING`,
            [input.corpus.id, input.corpus.contentHash, input.subject.id, task.key, runIndex,
                outcome.confirmed, outcome.costUsdCents, outcome.latencyMs,
                JSON.stringify(outcome.transcript ?? []), outcome.error ?? null]);
        attempts++;
        if (outcome.confirmed === true) confirmed++;
    }
    return { attempts, confirmed };
}

/**
 * Stores one blind score.
 *
 * The corpus hash is a separate argument rather than a field of the review: a
 * reviewer sees a transcript and a label, not a corpus, and inventing a field
 * for them to carry would be inventing something they cannot know. The insert
 * refuses a review for a task nobody attempted, because a score with no attempt
 * behind it is a score of nothing.
 */
export async function recordBenchmarkReview(
    query: BenchmarkQuery, corpusHash: string, review: BenchmarkReview,
): Promise<void> {
    await query(
        `INSERT INTO benchmark_reviews (corpus_hash, task_key, blind_label, reviewer_id, score, notes)
         SELECT $1,$2,$3,$4,$5,$6
         WHERE EXISTS (SELECT 1 FROM benchmark_attempts WHERE corpus_hash = $1 AND task_key = $2)
         ON CONFLICT (corpus_hash, task_key, blind_label, reviewer_id) DO NOTHING`,
        [corpusHash, review.taskKey, review.blindLabel, review.reviewerId, review.score, review.notes ?? null]);
}

/** Reads the stored attempts and reviews back into the shapes the summary takes. */
export async function loadBenchmarkEvidence(
    query: BenchmarkQuery, corpusHash: string,
): Promise<{ attempts: readonly BenchmarkAttempt[]; reviews: readonly BenchmarkReview[] }> {
    const attemptRows = await query<any[]>(
        `SELECT subject_id, task_key, corpus_hash, confirmed, cost_usd_cents, latency_ms, transcript, error
           FROM benchmark_attempts WHERE corpus_hash = $1 ORDER BY subject_id, task_key, run_index`, [corpusHash]);
    const reviewRows = await query<any[]>(
        `SELECT task_key, blind_label, reviewer_id, score, notes
           FROM benchmark_reviews WHERE corpus_hash = $1 ORDER BY task_key, blind_label`, [corpusHash]);
    return {
        attempts: Object.freeze((attemptRows ?? []).map(row => Object.freeze({
            subjectId: String(row.subject_id), taskKey: String(row.task_key), corpusHash: String(row.corpus_hash),
            confirmed: row.confirmed === null ? null : Boolean(row.confirmed),
            costUsdCents: row.cost_usd_cents === null ? null : Number(row.cost_usd_cents),
            latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
            transcript: Object.freeze(row.transcript ?? []),
            error: row.error ?? null,
        }) as BenchmarkAttempt)),
        reviews: Object.freeze((reviewRows ?? []).map(row => Object.freeze({
            taskKey: String(row.task_key), blindLabel: String(row.blind_label),
            reviewerId: String(row.reviewer_id), score: Number(row.score),
            notes: row.notes ?? undefined,
        }) as BenchmarkReview)),
    };
}

/** The whole local pipeline: stored evidence in, the validated summary out. */
export async function summariseStoredBenchmark(input: {
    readonly query: BenchmarkQuery;
    readonly corpus: BenchmarkCorpus;
    readonly subjects: readonly BenchmarkSubject[];
}) {
    const { attempts, reviews } = await loadBenchmarkEvidence(input.query, input.corpus.contentHash);
    return summariseBenchmark({ corpus: input.corpus, subjects: input.subjects, attempts, reviews });
}
