import { randomUUID } from 'crypto';
import { revisionHash } from '../evaluation-revision/evaluation-revision';
import { requiredScenarios } from './agent-certification';
import { planCertificationRun, type CertificationPlan, type CertificationPlanInput } from './certification-plan';
import { sealReleaseRun, type AgentReleaseRunEvidence } from './agent-release-policy';

/**
 * The durable ledger a catalogue certification run is made of.
 *
 * `certifyProfiles` consumes `AgentReleaseRunEvidence` and answers `no_evidence`
 * for all 76 profiles, because nothing in this repository ever produced that
 * evidence: outside specs, only the competence matrix consumed the function, and
 * no service, job, CLI or endpoint walked the catalogue. `certification-plan.ts`
 * answered "what would that cost" — 78.120 cases, 139.940 model calls, a
 * US$677,40 ceiling and 233 hours. This is the other half: where the answers go
 * while that is running, and how it survives being interrupted.
 *
 * The shape follows from what a 233-hour run does when something goes wrong.
 *
 *  · **Every case is a row before anything runs.** A plan held in memory is a
 *    plan that dies with the process. Enumerating first makes the checkpoint the
 *    table itself rather than a separate file somebody has to remember to write.
 *  · **A worker leases a case; it does not take it.** `FOR UPDATE SKIP LOCKED`
 *    plus a lease read against `clock_timestamp()`, because a lease compared to
 *    `NOW()` is compared to the clock of the transaction that started before the
 *    work did — the same defect this codebase already fixed once in dispatch.
 *  · **A result may be written once.** The lease token is part of the update, so
 *    a worker that stalled past its lease and woke up cannot overwrite the
 *    result of the worker that replaced it. That is what makes a retry safe: an
 *    attempt is a new row, never a second write to the old one.
 *  · **Evidence knows what it was evidence OF.** Each case stores the hash of
 *    the scenario definitions it was run against. When a pack is edited, the
 *    hash stops matching and the case is stale — proven, but not in the form
 *    that exists now, which is not the same as proven.
 *  · **A budget and a deadline are checked before handing out work**, not after
 *    spending it, and cancellation is a state rather than a signal.
 *
 * What this file does NOT do: run anything. It takes a `CertificationCaseRunner`
 * and has no opinion about what is on the other side, so the executor can be
 * built, tested and reasoned about without a model key or a cent of spend. The
 * runner that calls real providers is authorised separately; the plan's dry-run
 * exists so that authorisation is asked for with an exact number.
 */

export type CertificationQuery = <R = any[]>(sql: string, params?: any[]) => Promise<R>;

export const CERTIFICATION_RUN_STATES = ['planned', 'running', 'finished', 'cancelled'] as const;
export type CertificationRunState = (typeof CERTIFICATION_RUN_STATES)[number];

export const CERTIFICATION_CASE_STATES = ['pending', 'leased', 'passed', 'failed', 'error'] as const;
export type CertificationCaseState = (typeof CERTIFICATION_CASE_STATES)[number];

/** Why the executor stopped handing out work. Never inferred by a caller. */
export const CERTIFICATION_STOP_REASONS =
    ['cancelled', 'budget_exhausted', 'deadline_passed', 'complete', 'batch_limit'] as const;
export type CertificationStopReason = (typeof CERTIFICATION_STOP_REASONS)[number];

export const CERTIFICATION_LEDGER_DDL: readonly string[] = Object.freeze([
    `CREATE TABLE IF NOT EXISTS agent_certification_runs (
        id UUID PRIMARY KEY,
        plan_hash TEXT NOT NULL,
        agent_id UUID NOT NULL,
        config_hash TEXT NOT NULL,
        dependency_revision TEXT NOT NULL,
        k INTEGER NOT NULL,
        threshold NUMERIC NOT NULL,
        state TEXT NOT NULL,
        stop_reason TEXT,
        budget_usd_cents INTEGER,
        deadline_at TIMESTAMPTZ,
        planned_cases INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT agent_certification_runs_state CHECK (state IN ('planned','running','finished','cancelled')),
        CONSTRAINT agent_certification_runs_k CHECK (k >= 1 AND k <= 5),
        CONSTRAINT agent_certification_runs_threshold CHECK (threshold >= 7 AND threshold <= 10)
    )`,
    `CREATE TABLE IF NOT EXISTS agent_certification_cases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id UUID NOT NULL,
        case_key TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        profile_id TEXT NOT NULL,
        scenario_key TEXT NOT NULL,
        language TEXT NOT NULL,
        channel_type TEXT NOT NULL,
        model TEXT NOT NULL,
        definition_hash TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',
        lease_token UUID,
        lease_expires_at TIMESTAMPTZ,
        served_model TEXT,
        cost_usd_cents INTEGER,
        latency_ms INTEGER,
        transcript JSONB,
        tools JSONB,
        verification JSONB,
        scenario JSONB,
        error_code TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT agent_certification_cases_state
            CHECK (state IN ('pending','leased','passed','failed','error')),
        CONSTRAINT agent_certification_cases_attempt CHECK (attempt >= 1)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uidx_certification_case_attempt
        ON agent_certification_cases (run_id, case_key, attempt)`,
    `CREATE INDEX IF NOT EXISTS idx_certification_case_claimable
        ON agent_certification_cases (run_id, state, lease_expires_at)`,
]);

export async function ensureCertificationLedger(query: CertificationQuery): Promise<void> {
    for (const statement of CERTIFICATION_LEDGER_DDL) await query(statement);
}

/**
 * The identity of one case, stable across runs and across process restarts.
 *
 * Deliberately excludes the attempt: an attempt is how many times we tried the
 * same case, and a key that changed per attempt would make "did we already do
 * this" unanswerable — which is the question a resume asks.
 */
export function certificationCaseKey(cell: {
    profileId: string; language: string; channel: string; model: string; scenarioKey: string;
}): string {
    return revisionHash({
        profileId: cell.profileId, language: cell.language,
        channel: cell.channel, model: cell.model, scenarioKey: cell.scenarioKey,
    });
}

export interface CertificationRunInput extends CertificationPlanInput {
    /** The agent whose configuration this run is evidence about. */
    readonly agentId: string;
    readonly configHash: string;
    readonly dependencyRevision: string;
    /** Hard ceiling in US cents. No case is leased once the spend would exceed it. */
    readonly budgetUsdCents?: number;
    readonly deadlineAt?: Date | string | null;
    readonly threshold?: number;
}

export interface CertificationRunRecord {
    readonly id: string;
    readonly planHash: string;
    readonly state: CertificationRunState;
    readonly plannedCases: number;
    readonly plan: CertificationPlan;
}

/**
 * Writes the plan out as rows. Idempotent by `(run_id, case_key, attempt)`, so
 * re-planning an interrupted run adds what is missing and touches nothing that
 * already has a result.
 */
export async function planCertificationLedger(
    query: CertificationQuery, input: CertificationRunInput, runId = randomUUID(),
): Promise<CertificationRunRecord> {
    const plan = planCertificationRun(input);
    const threshold = input.threshold ?? 7;
    await query(
        `INSERT INTO agent_certification_runs
            (id, plan_hash, agent_id, config_hash, dependency_revision, k, threshold, state,
             budget_usd_cents, deadline_at, planned_cases)
         VALUES ($1::uuid,$2,$3::uuid,$4,$5,$6,$7,'planned',$8,$9::timestamptz,0)
         ON CONFLICT (id) DO NOTHING`,
        [runId, plan.planHash, input.agentId, input.configHash, input.dependencyRevision,
            plan.k, threshold, input.budgetUsdCents ?? null,
            input.deadlineAt ? new Date(input.deadlineAt).toISOString() : null],
    );
    let planned = 0;
    for (const cell of plan.cells) {
        // The scenario universe comes from the same function certification
        // demands, so a case can never be planned for a scenario the report
        // will not ask about.
        const demanded = requiredScenarios(cell.profileId, cell.language);
        for (const [scenarioKey, required] of demanded) {
            const definitionHash = revisionHash([...required.definitions].sort());
            const caseKey = certificationCaseKey({ ...cell, scenarioKey });
            const rows = await query<any[]>(
                `INSERT INTO agent_certification_cases
                    (run_id, case_key, attempt, profile_id, scenario_key, language, channel_type, model, definition_hash)
                 VALUES ($1::uuid,$2,1,$3,$4,$5,$6,$7,$8)
                 ON CONFLICT (run_id, case_key, attempt) DO NOTHING
                 RETURNING id`,
                [runId, caseKey, cell.profileId, scenarioKey, cell.language, cell.channel, cell.model, definitionHash],
            );
            if (rows?.length) planned++;
        }
    }
    await query(
        `UPDATE agent_certification_runs
            SET planned_cases = (SELECT count(*)::int FROM agent_certification_cases WHERE run_id = $1::uuid),
                updated_at = NOW()
          WHERE id = $1::uuid`, [runId]);
    const [row] = await query<any[]>('SELECT planned_cases, state FROM agent_certification_runs WHERE id=$1::uuid', [runId]);
    return Object.freeze({
        id: runId, planHash: plan.planHash, state: row?.state ?? 'planned',
        plannedCases: Number(row?.planned_cases ?? planned), plan,
    });
}

export interface CertificationLease {
    readonly caseId: string;
    readonly runId: string;
    readonly caseKey: string;
    readonly attempt: number;
    readonly profileId: string;
    readonly scenarioKey: string;
    readonly language: string;
    readonly channelType: string;
    readonly model: string;
    readonly definitionHash: string;
    readonly leaseToken: string;
}

/**
 * Hands out one case, or says why it will not.
 *
 * The three refusals are checked BEFORE the work, because a budget checked
 * afterwards is a budget that has already been exceeded. `spent` is the sum of
 * what recorded cases actually cost, not what the plan predicted: the plan's
 * number is a ceiling and stopping at the ceiling would stop early.
 */
export async function leaseCertificationCase(
    query: CertificationQuery, runId: string, leaseSeconds = 900,
): Promise<{ ok: true; lease: CertificationLease } | { ok: false; stopReason: CertificationStopReason }> {
    const [run] = await query<any[]>(
        `SELECT state, budget_usd_cents, deadline_at,
                (SELECT COALESCE(SUM(cost_usd_cents),0)::int FROM agent_certification_cases
                  WHERE run_id = r.id) AS spent
           FROM agent_certification_runs r WHERE id = $1::uuid FOR UPDATE`, [runId]);
    if (!run) return { ok: false, stopReason: 'cancelled' };
    if (run.state === 'cancelled') return { ok: false, stopReason: 'cancelled' };
    if (run.budget_usd_cents != null && Number(run.spent) >= Number(run.budget_usd_cents)) {
        await stopCertificationRun(query, runId, 'budget_exhausted');
        return { ok: false, stopReason: 'budget_exhausted' };
    }
    if (run.deadline_at) {
        // `clock_timestamp()`, not `NOW()`: the deadline is about the wall, and
        // `NOW()` is frozen at the start of this transaction.
        const [expired] = await query<any[]>(
            'SELECT (clock_timestamp() >= $1::timestamptz) AS passed', [new Date(run.deadline_at).toISOString()]);
        if (expired?.passed) {
            await stopCertificationRun(query, runId, 'deadline_passed');
            return { ok: false, stopReason: 'deadline_passed' };
        }
    }
    const rows = await query<any[]>(
        `UPDATE agent_certification_cases SET state='leased', lease_token=gen_random_uuid(),
                lease_expires_at = clock_timestamp() + ($2 || ' seconds')::interval, updated_at = NOW()
          WHERE id = (
              SELECT id FROM agent_certification_cases
               WHERE run_id = $1::uuid
                 AND (state = 'pending'
                      OR (state = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at < clock_timestamp()))
               ORDER BY created_at, attempt
               FOR UPDATE SKIP LOCKED
               LIMIT 1)
      RETURNING id, run_id, case_key, attempt, profile_id, scenario_key, language, channel_type, model,
                definition_hash, lease_token`,
        [runId, String(Math.max(1, Math.trunc(leaseSeconds)))],
    );
    if (!rows?.length) {
        await stopCertificationRun(query, runId, 'complete');
        return { ok: false, stopReason: 'complete' };
    }
    const row = rows[0];
    await query(`UPDATE agent_certification_runs SET state='running', updated_at=NOW()
                  WHERE id=$1::uuid AND state='planned'`, [runId]);
    return {
        ok: true,
        lease: Object.freeze({
            caseId: String(row.id), runId: String(row.run_id), caseKey: String(row.case_key),
            attempt: Number(row.attempt), profileId: String(row.profile_id), scenarioKey: String(row.scenario_key),
            language: String(row.language), channelType: String(row.channel_type), model: String(row.model),
            definitionHash: String(row.definition_hash), leaseToken: String(row.lease_token),
        }),
    };
}

export interface CertificationCaseResult {
    readonly passed: boolean;
    /** The model that actually answered. A run that cannot name one proves nothing. */
    readonly servedModel: string;
    readonly costUsdCents: number;
    readonly latencyMs: number;
    readonly transcript: unknown;
    readonly tools: unknown;
    readonly verification: unknown;
    /** The scenario exactly as executed, so the definition can be re-derived. */
    readonly scenario: Record<string, unknown>;
    readonly errorCode?: string | null;
}

/**
 * Records one outcome, once.
 *
 * The lease token is in the WHERE clause. A worker whose lease expired and whose
 * case was handed to somebody else writes nothing and is told so, instead of
 * overwriting a result that was already produced — which is the difference
 * between a retry and a duplicate.
 */
export async function recordCertificationCase(
    query: CertificationQuery, lease: Pick<CertificationLease, 'caseId' | 'leaseToken'>, result: CertificationCaseResult,
): Promise<{ ok: boolean; reason?: 'lease_lost' }> {
    const state = result.errorCode ? 'error' : result.passed ? 'passed' : 'failed';
    const rows = await query<any[]>(
        `UPDATE agent_certification_cases
            SET state=$3, served_model=$4, cost_usd_cents=$5, latency_ms=$6,
                transcript=$7::jsonb, tools=$8::jsonb, verification=$9::jsonb, scenario=$10::jsonb,
                error_code=$11, lease_token=NULL, lease_expires_at=NULL, updated_at=NOW()
          WHERE id=$1::uuid AND lease_token=$2::uuid
      RETURNING id`,
        [lease.caseId, lease.leaseToken, state, result.servedModel,
            Math.max(0, Math.trunc(result.costUsdCents)), Math.max(0, Math.trunc(result.latencyMs)),
            JSON.stringify(result.transcript ?? null), JSON.stringify(result.tools ?? null),
            JSON.stringify(result.verification ?? null), JSON.stringify(result.scenario ?? null),
            result.errorCode ?? null],
    );
    return rows?.length ? { ok: true } : { ok: false, reason: 'lease_lost' };
}

/**
 * Queues one more attempt at a case that did not pass.
 *
 * A new row rather than a reset, so the history of what was tried survives and
 * an effect already produced is never produced again by rewinding a row that
 * recorded it.
 */
export async function retryCertificationCase(
    query: CertificationQuery, runId: string, caseKey: string,
): Promise<{ ok: boolean; attempt?: number; reason?: 'not_retryable' }> {
    const [row] = await query<any[]>(
        `SELECT profile_id, scenario_key, language, channel_type, model, definition_hash,
                MAX(attempt) OVER () AS last_attempt, state
           FROM agent_certification_cases
          WHERE run_id=$1::uuid AND case_key=$2
          ORDER BY attempt DESC LIMIT 1`, [runId, caseKey]);
    if (!row || !['failed', 'error'].includes(String(row.state))) return { ok: false, reason: 'not_retryable' };
    const attempt = Number(row.last_attempt) + 1;
    await query(
        `INSERT INTO agent_certification_cases
            (run_id, case_key, attempt, profile_id, scenario_key, language, channel_type, model, definition_hash)
         VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (run_id, case_key, attempt) DO NOTHING`,
        [runId, caseKey, attempt, row.profile_id, row.scenario_key, row.language,
            row.channel_type, row.model, row.definition_hash]);
    return { ok: true, attempt };
}

export async function stopCertificationRun(
    query: CertificationQuery, runId: string, reason: CertificationStopReason,
): Promise<void> {
    await query(
        `UPDATE agent_certification_runs
            SET state = CASE WHEN $2 = 'cancelled' THEN 'cancelled' ELSE 'finished' END,
                stop_reason = $2, updated_at = NOW()
          WHERE id = $1::uuid AND state IN ('planned','running')`, [runId, reason]);
}

export const cancelCertificationRun = (query: CertificationQuery, runId: string) =>
    stopCertificationRun(query, runId, 'cancelled');

export interface CertificationProgress {
    readonly runId: string;
    readonly state: CertificationRunState;
    readonly stopReason: CertificationStopReason | null;
    readonly planned: number;
    readonly passed: number;
    readonly failed: number;
    readonly errored: number;
    readonly pending: number;
    readonly leased: number;
    readonly spentUsdCents: number;
    readonly budgetUsdCents: number | null;
    /** What is still unproven, per dimension, so a gap is a list and not a feeling. */
    readonly gaps: {
        readonly byProfile: Readonly<Record<string, number>>;
        /** The task the scenario exercises, read off its key rather than guessed. */
        readonly byTask: Readonly<Record<string, number>>;
        readonly byLanguage: Readonly<Record<string, number>>;
        readonly byChannel: Readonly<Record<string, number>>;
        readonly byModel: Readonly<Record<string, number>>;
    };
}

export async function certificationProgress(
    query: CertificationQuery, runId: string,
): Promise<CertificationProgress | null> {
    const [run] = await query<any[]>(
        `SELECT state, stop_reason, planned_cases, budget_usd_cents FROM agent_certification_runs WHERE id=$1::uuid`,
        [runId]);
    if (!run) return null;
    const [totals] = await query<any[]>(
        `SELECT COUNT(*) FILTER (WHERE state='passed')::int AS passed,
                COUNT(*) FILTER (WHERE state='failed')::int AS failed,
                COUNT(*) FILTER (WHERE state='error')::int AS errored,
                COUNT(*) FILTER (WHERE state='pending')::int AS pending,
                COUNT(*) FILTER (WHERE state='leased')::int AS leased,
                COALESCE(SUM(cost_usd_cents),0)::int AS spent
           FROM agent_certification_cases WHERE run_id=$1::uuid`, [runId]);
    // A case counts as a gap when NO attempt of it has passed. Counting rows
    // instead would report a case retried twice as two gaps.
    const gapRows = await query<any[]>(
        `SELECT profile_id, language, channel_type, model, scenario_key FROM (
            SELECT case_key, MIN(profile_id) AS profile_id, MIN(language) AS language,
                   MIN(channel_type) AS channel_type, MIN(model) AS model, MIN(scenario_key) AS scenario_key,
                   BOOL_OR(state = 'passed') AS proven
              FROM agent_certification_cases WHERE run_id=$1::uuid GROUP BY case_key
         ) cases WHERE proven = false`, [runId]);
    // `intent_<task>_<variant>` is how the packs name a managed case, so the
    // task is read off the key. A key that does not carry one is counted under
    // `other` rather than dropped: a gap nobody can attribute is still a gap.
    const tallyTasks = (rows: readonly any[]) => {
        const out: Record<string, number> = {};
        for (const row of rows) {
            const match = /^intent_(.+?)_[^_]+$/.exec(String(row.scenario_key ?? ''));
            const task = match?.[1] ?? 'other';
            out[task] = (out[task] ?? 0) + 1;
        }
        return Object.freeze(out);
    };
    const tally = (key: string) => {
        const out: Record<string, number> = {};
        for (const row of gapRows ?? []) out[String(row[key])] = (out[String(row[key])] ?? 0) + 1;
        return Object.freeze(out);
    };
    return Object.freeze({
        runId, state: run.state, stopReason: run.stop_reason ?? null,
        planned: Number(run.planned_cases ?? 0),
        passed: Number(totals?.passed ?? 0), failed: Number(totals?.failed ?? 0),
        errored: Number(totals?.errored ?? 0), pending: Number(totals?.pending ?? 0),
        leased: Number(totals?.leased ?? 0),
        spentUsdCents: Number(totals?.spent ?? 0),
        budgetUsdCents: run.budget_usd_cents == null ? null : Number(run.budget_usd_cents),
        gaps: Object.freeze({
            byProfile: tally('profile_id'), byTask: tallyTasks(gapRows ?? []),
            byLanguage: tally('language'),
            byChannel: tally('channel_type'), byModel: tally('model'),
        }),
    });
}

/**
 * Turns the ledger into the evidence the certification report reads.
 *
 * One sealed run per channel, because that is how `certifyProfile` slices
 * evidence, and only cases whose stored definition hash still matches the pack
 * today: a scenario rewritten since it passed was proven in a form that no
 * longer exists, which is not proof of the form that does. Those are dropped
 * here rather than counted, and `staleCases` says how many so the drop is
 * visible instead of silent.
 */
export async function certificationEvidenceFromLedger(
    query: CertificationQuery, runId: string,
    /**
     * The authorities as they stand NOW. When either has moved, the whole run
     * is evidence about a configuration that no longer exists and none of it is
     * returned — invalidation is the run, not a per-case judgement, because
     * every case in it ran against the same agent.
     */
    current?: { configHash?: string; dependencyRevision?: string },
): Promise<{ evidence: readonly AgentReleaseRunEvidence[]; staleCases: number; staleRun?: string }> {
    const [run] = await query<any[]>(
        `SELECT agent_id, config_hash, dependency_revision, k, threshold
           FROM agent_certification_runs WHERE id=$1::uuid`, [runId]);
    if (!run) return { evidence: Object.freeze([]), staleCases: 0 };
    if (current?.configHash && current.configHash !== String(run.config_hash)) {
        return { evidence: Object.freeze([]), staleCases: 0, staleRun: 'config_changed' };
    }
    if (current?.dependencyRevision && current.dependencyRevision !== String(run.dependency_revision)) {
        return { evidence: Object.freeze([]), staleCases: 0, staleRun: 'dependency_changed' };
    }
    const rows = await query<any[]>(
        `SELECT case_key, profile_id, scenario_key, language, channel_type, model, definition_hash,
                served_model, scenario, verification
           FROM agent_certification_cases
          WHERE run_id=$1::uuid AND state='passed' AND scenario IS NOT NULL
          ORDER BY channel_type, profile_id, language, scenario_key, attempt`, [runId]);

    const currentDefinitions = new Map<string, string>();
    const definitionFor = (profileId: string, language: string, scenarioKey: string): string | null => {
        const cacheKey = `${profileId}|${language}`;
        if (!currentDefinitions.has(cacheKey)) {
            for (const [key, required] of requiredScenarios(profileId, language)) {
                currentDefinitions.set(`${cacheKey}|${key}`, revisionHash([...required.definitions].sort()));
            }
            currentDefinitions.set(cacheKey, 'loaded');
        }
        return currentDefinitions.get(`${cacheKey}|${scenarioKey}`) ?? null;
    };

    const byChannel = new Map<string, { scenarios: any[]; results: any[]; models: Set<string> }>();
    let staleCases = 0;
    for (const row of rows ?? []) {
        if (definitionFor(row.profile_id, row.language, row.scenario_key) !== row.definition_hash) {
            staleCases++;
            continue;
        }
        const channel = String(row.channel_type);
        const bucket = byChannel.get(channel) ?? { scenarios: [], results: [], models: new Set<string>() };
        bucket.scenarios.push(row.scenario);
        bucket.results.push((row.verification as any) ?? null);
        bucket.models.add(String(row.served_model || row.model));
        byChannel.set(channel, bucket);
    }
    const evidence = [...byChannel.entries()].map(([channelType, bucket]) => sealReleaseRun({
        agentId: String(run.agent_id), dependencyRevision: String(run.dependency_revision),
        configHash: String(run.config_hash), channelType, status: 'completed',
        k: Number(run.k), passPolicy: 'all', threshold: Number(run.threshold),
        models: [...bucket.models].sort(),
        scenarios: bucket.scenarios, results: bucket.results.filter(Boolean),
    }));
    return { evidence: Object.freeze(evidence), staleCases };
}

/**
 * What actually executes one case. Injected, and deliberately not implemented
 * here: the runner that calls real providers spends money, and this file has to
 * be buildable, testable and reviewable without any.
 */
export type CertificationCaseRunner = (lease: CertificationLease) => Promise<CertificationCaseResult>;

export interface CertificationDriverInput {
    /** One transaction per step. Never held across a model call. */
    readonly transaction: <T>(work: (query: CertificationQuery) => Promise<T>) => Promise<T>;
    readonly runner: CertificationCaseRunner;
    readonly runId: string;
    /** Stop after this many cases, so a worker can be a short-lived job. */
    readonly maxCases?: number;
    readonly leaseSeconds?: number;
}

/**
 * The loop.
 *
 * Lease in one transaction, run outside every transaction, record in another.
 * Holding a transaction across a model call would pin a connection for the
 * length of a conversation and turn a 233-hour run into a pool outage — and it
 * would make the lease pointless, since the row would be locked anyway.
 *
 * A runner that throws is recorded as an error rather than losing the lease:
 * a crashed case that stays `leased` is invisible until its lease expires, and
 * "we do not know what happened" is a result somebody has to see.
 */
export async function driveCertificationRun(
    input: CertificationDriverInput,
): Promise<{ processed: number; stopReason: CertificationStopReason }> {
    const limit = Math.max(1, Math.trunc(input.maxCases ?? 1));
    let processed = 0;
    for (;;) {
        const claim = await input.transaction(query =>
            leaseCertificationCase(query, input.runId, input.leaseSeconds));
        if (!claim.ok) return { processed, stopReason: claim.stopReason };
        let result: CertificationCaseResult;
        try {
            result = await input.runner(claim.lease);
        } catch (error: any) {
            result = {
                passed: false, servedModel: '', costUsdCents: 0, latencyMs: 0,
                transcript: null, tools: null, verification: null, scenario: {},
                errorCode: String(error?.message ?? 'runner_failed').slice(0, 200),
            };
        }
        await input.transaction(query => recordCertificationCase(query, claim.lease, result));
        processed++;
        // Not `complete`: this worker did its share, which is a different fact
        // from the run having no work left. Reporting them the same would make
        // a short-lived job look like a finished catalogue.
        if (processed >= limit) return { processed, stopReason: 'batch_limit' };
    }
}
