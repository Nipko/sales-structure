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
    `CREATE TABLE IF NOT EXISTS benchmark_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        corpus_id TEXT NOT NULL,
        corpus_hash TEXT NOT NULL,
        run_index INTEGER NOT NULL DEFAULT 1,
        /** Stable across retries, so a re-published start joins the same run. */
        request_key TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'running',
        stop_reason TEXT,
        /** The ceiling. A live run without one is refused, like certification. */
        budget_usd_cents INTEGER,
        spent_usd_cents INTEGER NOT NULL DEFAULT 0,
        deadline_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT benchmark_runs_state
            CHECK (state IN ('running','paused','cancelled','finished')),
        CONSTRAINT benchmark_runs_spent CHECK (spent_usd_cents >= 0)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uidx_benchmark_run_request
        ON benchmark_runs (request_key)`,
    /**
     * `state`, `run_id` and `lease_expires_at` are claimed BEFORE the model is
     * called, not written after it.
     *
     * The original loop ran the runner and THEN inserted with `ON CONFLICT DO
     * NOTHING`. On a retried job that meant every task was answered again — by
     * a real model, for a real price — and the answer thrown away by the
     * conflict. The most expensive path in the programme paid twice for work it
     * already had.
     *
     * A claimed row also gives the budget something to charge and the lease
     * something to expire, which is what makes a dead worker recoverable
     * instead of a run that never finishes.
     *
     * No CHECK on `state`. It has two values, both written by one function in
     * this file, and a constraint that existed only on tenants created after
     * today would be worse than none: the parity between a fresh schema and an
     * upgraded one is the thing that has to hold.
     */
    `CREATE TABLE IF NOT EXISTS benchmark_attempts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        corpus_id TEXT NOT NULL,
        corpus_hash TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        task_key TEXT NOT NULL,
        run_index INTEGER NOT NULL DEFAULT 1,
        run_id UUID,
        state TEXT NOT NULL DEFAULT 'recorded',
        lease_expires_at TIMESTAMPTZ,
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

/**
 * The same three columns, for a tenant whose `benchmark_attempts` predates them.
 *
 * Separate from the create list because they are a different risk and belong in
 * a different migration: `CREATE TABLE IF NOT EXISTS` on a table that exists is
 * a no-op, while `ADD COLUMN` on one that exists is a change to live rows.
 * Additive and nullable, which is what expand-contract permits in one deploy —
 * the old code never reads them.
 */
export const BENCHMARK_ATTEMPT_UPGRADE_DDL: readonly string[] = Object.freeze([
    `ALTER TABLE benchmark_attempts
        ADD COLUMN IF NOT EXISTS run_id UUID,
        ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'recorded',
        ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ`,
]);

export async function ensureBenchmarkLedger(query: BenchmarkQuery): Promise<void> {
    for (const statement of BENCHMARK_LEDGER_DDL) await query(statement);
    for (const statement of BENCHMARK_ATTEMPT_UPGRADE_DDL) await query(statement);
}

export type BenchmarkStopReason =
    | 'complete' | 'cancelled' | 'paused' | 'budget_exhausted' | 'deadline_passed';

export interface BenchmarkRunRecord {
    readonly id: string;
    readonly state: 'running' | 'paused' | 'cancelled' | 'finished';
    readonly stopReason: BenchmarkStopReason | null;
    readonly budgetUsdCents: number | null;
    readonly spentUsdCents: number;
    readonly deadlineAt: string | null;
}

const projectRun = (row: any): BenchmarkRunRecord => Object.freeze({
    id: String(row.id),
    state: row.state,
    stopReason: row.stop_reason ?? null,
    budgetUsdCents: row.budget_usd_cents == null ? null : Number(row.budget_usd_cents),
    spentUsdCents: Number(row.spent_usd_cents ?? 0),
    deadlineAt: row.deadline_at ? new Date(row.deadline_at).toISOString() : null,
});

/**
 * Opens the run, or returns the one this request already opened.
 *
 * Idempotent by `request_key` for the same reason certification is: a start
 * that failed after publishing half its jobs has to be safe to call again, and
 * a second run over the same corpus would double the spend and make the
 * reliability count — "did the subject agree with itself" — meaningless.
 */
export async function openBenchmarkRun(query: BenchmarkQuery, input: {
    corpusId: string; corpusHash: string; requestKey: string; runIndex?: number;
    budgetUsdCents?: number | null; deadlineAt?: string | null;
}): Promise<BenchmarkRunRecord> {
    const rows = await query<any[]>(
        `INSERT INTO benchmark_runs
            (corpus_id, corpus_hash, run_index, request_key, budget_usd_cents, deadline_at)
         VALUES ($1,$2,$3,$4,$5,$6::timestamptz)
         ON CONFLICT (request_key) DO UPDATE SET updated_at = NOW()
         RETURNING *`,
        [input.corpusId, input.corpusHash, Math.max(1, Math.trunc(input.runIndex ?? 1)),
            input.requestKey, input.budgetUsdCents ?? null, input.deadlineAt ?? null]);
    return projectRun(rows[0]);
}

export async function benchmarkRunProgress(
    query: BenchmarkQuery, runId: string,
): Promise<BenchmarkRunRecord | null> {
    const [row] = await query<any[]>('SELECT * FROM benchmark_runs WHERE id = $1::uuid', [runId]);
    return row ? projectRun(row) : null;
}

/**
 * May another task run, and if not, why.
 *
 * Asked before every task rather than once per subject: a ceiling checked at
 * the start of a hundred-task pass is a ceiling that authorises the whole pass.
 */
export async function benchmarkRunGate(
    query: BenchmarkQuery, runId: string, reserveUsdCents = 0,
): Promise<{ allowed: boolean; reason: BenchmarkStopReason | null }> {
    const [row] = await query<any[]>(
        `SELECT state, budget_usd_cents, spent_usd_cents,
                deadline_at IS NOT NULL AND deadline_at <= clock_timestamp() AS expired
           FROM benchmark_runs WHERE id = $1::uuid`, [runId]);
    if (!row) return { allowed: false, reason: 'cancelled' };
    if (row.state === 'cancelled') return { allowed: false, reason: 'cancelled' };
    if (row.state === 'paused') return { allowed: false, reason: 'paused' };
    // `clock_timestamp()`, not `NOW()`: inside a long transaction `NOW()` is
    // frozen at BEGIN, so a deadline that passed mid-pass would never be seen.
    if (row.expired) return { allowed: false, reason: 'deadline_passed' };
    if (row.budget_usd_cents != null) {
        const spent = Number(row.spent_usd_cents);
        const budget = Number(row.budget_usd_cents);
        // Two conditions, and the first one is the one that is easy to miss:
        // with nothing reserved, `spent + 0 > budget` still lets a task run when
        // the ceiling is exactly reached, and that task then spends past it. A
        // ceiling overshot by one task is a ceiling.
        if (spent >= budget || spent + Math.max(0, reserveUsdCents) > budget) {
            return { allowed: false, reason: 'budget_exhausted' };
        }
    }
    return { allowed: true, reason: null };
}

/** Adds what a task actually cost. Atomic, so two workers cannot both fit. */
export async function chargeBenchmarkRun(
    query: BenchmarkQuery, runId: string, usdCents: number,
): Promise<void> {
    if (!Number.isFinite(usdCents) || usdCents <= 0) return;
    await query(
        `UPDATE benchmark_runs SET spent_usd_cents = spent_usd_cents + $2, updated_at = NOW()
          WHERE id = $1::uuid`, [runId, Math.round(usdCents)]);
}

const setRunState = async (
    query: BenchmarkQuery, runId: string, state: string, reason: BenchmarkStopReason | null,
): Promise<boolean> => {
    const rows = await query<any[]>(
        `UPDATE benchmark_runs SET state = $2, stop_reason = $3, updated_at = NOW()
          WHERE id = $1::uuid AND state <> 'cancelled' RETURNING id`, [runId, state, reason]);
    return !!rows?.length;
};

/** Terminal. A worker that arrives afterwards takes nothing. */
export const cancelBenchmarkRun = (query: BenchmarkQuery, runId: string) =>
    setRunState(query, runId, 'cancelled', 'cancelled');
export const pauseBenchmarkRun = (query: BenchmarkQuery, runId: string) =>
    setRunState(query, runId, 'paused', 'paused');
export const resumeBenchmarkRun = (query: BenchmarkQuery, runId: string) =>
    setRunState(query, runId, 'running', null);

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
    /** When present, every task is gated and charged against this run. */
    readonly runId?: string;
    /** How long a claimed task may be held before another worker may take it. */
    readonly leaseSeconds?: number;
}): Promise<{ attempts: number; confirmed: number; skipped: number; stopReason: BenchmarkStopReason }> {
    const runIndex = Math.max(1, Math.trunc(input.runIndex ?? 1));
    const leaseSeconds = Math.max(30, Math.trunc(input.leaseSeconds ?? 900));
    let attempts = 0, confirmed = 0, skipped = 0;
    let stopReason: BenchmarkStopReason = 'complete';

    for (const task of input.corpus.tasks) {
        if (input.runId) {
            const gate = await benchmarkRunGate(input.query, input.runId);
            if (!gate.allowed) { stopReason = gate.reason ?? 'cancelled'; break; }
        }

        // Claim BEFORE the runner. The loop used to call the model and then
        // insert with `ON CONFLICT DO NOTHING`, so a retried job answered every
        // task again — at a real price — and threw the answer away on the
        // conflict. Claiming first makes a retry skip what is already done, and
        // gives a dead worker's task an expiry somebody else can take.
        const claimed = await input.query<any[]>(
            `INSERT INTO benchmark_attempts
                (corpus_id, corpus_hash, subject_id, task_key, run_index, run_id, state, lease_expires_at)
             VALUES ($1,$2,$3,$4,$5,$6::uuid,'claimed', clock_timestamp() + ($7 || ' seconds')::interval)
             ON CONFLICT (corpus_hash, subject_id, task_key, run_index) DO UPDATE
                 SET lease_expires_at = clock_timestamp() + ($7 || ' seconds')::interval,
                     run_id = COALESCE(benchmark_attempts.run_id, EXCLUDED.run_id)
               WHERE benchmark_attempts.state = 'claimed'
                 AND benchmark_attempts.lease_expires_at IS NOT NULL
                 AND benchmark_attempts.lease_expires_at < clock_timestamp()
             RETURNING id`,
            [input.corpus.id, input.corpus.contentHash, input.subject.id, task.key, runIndex,
                input.runId ?? null, String(leaseSeconds)]);
        if (!claimed?.length) { skipped++; continue; }

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
            `UPDATE benchmark_attempts
                SET state = 'recorded', lease_expires_at = NULL, confirmed = $2,
                    cost_usd_cents = $3, latency_ms = $4, transcript = $5::jsonb, error = $6
              WHERE id = $1::uuid`,
            [claimed[0].id, outcome.confirmed, outcome.costUsdCents, outcome.latencyMs,
                JSON.stringify(outcome.transcript ?? []), outcome.error ?? null]);
        // Charged after the fact, at what it actually cost: the reservation is
        // the gate above, and a run that pretended to spend its estimate would
        // stop early on work it never did.
        if (input.runId && outcome.costUsdCents) {
            await chargeBenchmarkRun(input.query, input.runId, outcome.costUsdCents);
        }
        attempts++;
        if (outcome.confirmed === true) confirmed++;
    }
    return { attempts, confirmed, skipped, stopReason };
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
        // `state = 'recorded'`: a claimed row is a task somebody is holding, not
        // an attempt. Counting it would report an answer nobody has given yet.
        `SELECT subject_id, task_key, corpus_hash, confirmed, cost_usd_cents, latency_ms, transcript, error
           FROM benchmark_attempts WHERE corpus_hash = $1 AND state = 'recorded'
          ORDER BY subject_id, task_key, run_index`, [corpusHash]);
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
