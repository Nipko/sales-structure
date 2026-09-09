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

export const CERTIFICATION_RUN_STATES = ['planned', 'running', 'paused', 'finished', 'cancelled'] as const;
export type CertificationRunState = (typeof CERTIFICATION_RUN_STATES)[number];

export const CERTIFICATION_CASE_STATES = ['pending', 'leased', 'passed', 'failed', 'error'] as const;
export type CertificationCaseState = (typeof CERTIFICATION_CASE_STATES)[number];

/**
 * Why the executor stopped handing out work. Never inferred by a caller, and
 * deliberately more than one kind of "nothing to give you":
 *
 *  · `in_flight` — every case is out with another worker. The run is NOT
 *    finished; saying so once closed a run whose results were still coming;
 *  · `awaiting_retry_decision` — nothing is pending or leased, but cases failed
 *    and nobody has decided whether to try them again. A run whose last word is
 *    a failure has not run out of work, it has run out of instructions;
 *  · `batch_limit` — this worker did its share, which is not the run's state;
 *  · `lease_lost` — this worker's result was refused because its lease had been
 *    given to somebody else. It did no work and must not claim any.
 */
export const CERTIFICATION_STOP_REASONS = [
    'cancelled', 'budget_exhausted', 'deadline_passed', 'complete',
    'batch_limit', 'in_flight', 'awaiting_retry_decision', 'lease_lost', 'paused',
] as const;
export type CertificationStopReason = (typeof CERTIFICATION_STOP_REASONS)[number];

/** The reasons that end a run. The others mean "not now", not "not ever". */
export const CERTIFICATION_TERMINAL_REASONS: readonly CertificationStopReason[] =
    Object.freeze(['cancelled', 'budget_exhausted', 'deadline_passed', 'complete']);

export const CERTIFICATION_LEDGER_DDL: readonly string[] = Object.freeze([
    `CREATE TABLE IF NOT EXISTS agent_certification_runs (
        id UUID PRIMARY KEY,
        plan_hash TEXT NOT NULL,
        /**
         * The caller's idempotency key. A retried request, a double-clicked
         * button and a redelivered job all resolve to this run rather than to a
         * second catalogue nobody meant to pay for.
         */
        request_key TEXT UNIQUE,
        agent_id UUID NOT NULL,
        config_hash TEXT NOT NULL,
        dependency_revision TEXT NOT NULL,
        k INTEGER NOT NULL,
        threshold NUMERIC NOT NULL,
        state TEXT NOT NULL,
        /**
         * A rehearsal contacts no provider. It writes real rows on purpose — the
         * point is to prove the wiring — so what stops it certifying the
         * catalogue is this column, checked where the evidence is built rather
         * than trusted to whoever started it.
         */
        mode TEXT NOT NULL DEFAULT 'live',
        stop_reason TEXT,
        budget_usd_cents INTEGER,
        deadline_at TIMESTAMPTZ,
        planned_cases INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT agent_certification_runs_state
            CHECK (state IN ('planned','running','paused','finished','cancelled')),
        CONSTRAINT agent_certification_runs_mode CHECK (mode IN ('dry_run','live')),
        CONSTRAINT agent_certification_runs_k CHECK (k >= 1 AND k <= 5),
        CONSTRAINT agent_certification_runs_threshold CHECK (threshold >= 7 AND threshold <= 10)
    )`,
    /**
     * One subject per profile, because a profile IS a template and a template is
     * a different agent. A single agentId on the run proved one configuration
     * and was silently read as proof of the other 75; the run row keeps its
     * columns as the DEFAULT subject for a single-profile run, and a run that
     * covers more than one profile must name a subject for each.
     */
    `CREATE TABLE IF NOT EXISTS agent_certification_subjects (
        run_id UUID NOT NULL,
        profile_id TEXT NOT NULL,
        agent_id UUID NOT NULL,
        config_hash TEXT NOT NULL,
        dependency_revision TEXT NOT NULL,
        mission JSONB,
        tool_grants JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (run_id, profile_id)
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
        /**
         * The ceiling this case may cost, taken from the plan and held from the
         * moment it is leased. The budget check adds this to what has already
         * been spent, because a case being run has not been paid for yet and a
         * ceiling compared only against settled cost lets every worker in the
         * fleet pass the same check at the same time.
         */
        reserve_usd_cents INTEGER NOT NULL DEFAULT 0,
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

/**
 * The agent one profile's cases actually ran against.
 *
 * A profile is a template: a clinic and a car dealership are not the same agent
 * with a different label, they are different configurations, different missions
 * and different tool grants. Evidence that cannot say which one answered proves
 * nothing about any of them, which is why this is per profile and not per run.
 */
export interface CertificationSubject {
    readonly agentId: string;
    readonly configHash: string;
    readonly dependencyRevision: string;
    /** The mission the subject was given, for a reader auditing the evidence. */
    readonly mission?: Record<string, unknown> | null;
    /** The tools it was allowed. Two subjects with different grants are two subjects. */
    readonly toolGrants?: readonly string[] | null;
}

export interface CertificationRunInput extends CertificationPlanInput {
    /**
     * The default subject. Enough for a single-profile run; a run covering more
     * than one profile must name a subject for each in `subjects`, and is
     * refused otherwise rather than quietly attributing 76 profiles to one agent.
     */
    readonly agentId: string;
    readonly configHash: string;
    readonly dependencyRevision: string;
    /** Subject per profile id. Required when the plan covers more than one. */
    readonly subjects?: Readonly<Record<string, CertificationSubject>>;
    /** `dry_run` writes rows and certifies nothing; `live` calls a provider. */
    readonly mode?: 'dry_run' | 'live';
    /** Hard ceiling in US cents, reserved at lease time rather than counted after. */
    readonly budgetUsdCents?: number;
    readonly deadlineAt?: Date | string | null;
    readonly threshold?: number;
}

/** A plan that would produce evidence nobody could attribute is not planned. */
export class CertificationPlanRefused extends Error {
    constructor(readonly code: string, readonly detail: readonly string[] = []) {
        super(code);
    }
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

    // The default subject only stands in for a run about ONE profile. Beyond
    // that it would be a claim about agents nobody configured, and the point of
    // the whole ledger is that evidence names what produced it.
    const subjects = new Map<string, CertificationSubject | null>();
    for (const profileId of plan.profiles) {
        const named = input.subjects?.[profileId];
        if (named) { subjects.set(profileId, named); continue; }
        subjects.set(profileId, plan.profiles.length === 1
            ? { agentId: input.agentId, configHash: input.configHash, dependencyRevision: input.dependencyRevision }
            : null);
    }
    const unnamed = [...subjects.entries()].filter(([, subject]) => !subject).map(([profileId]) => profileId);
    if (unnamed.length) throw new CertificationPlanRefused('certification_subject_required', unnamed.sort());

    await query(
        `INSERT INTO agent_certification_runs
            (id, plan_hash, agent_id, config_hash, dependency_revision, k, threshold, state, mode,
             budget_usd_cents, deadline_at, planned_cases)
         VALUES ($1::uuid,$2,$3::uuid,$4,$5,$6,$7,'planned',$8,$9,$10::timestamptz,0)
         ON CONFLICT (id) DO NOTHING`,
        [runId, plan.planHash, input.agentId, input.configHash, input.dependencyRevision,
            plan.k, threshold, input.mode ?? 'live', input.budgetUsdCents ?? null,
            input.deadlineAt ? new Date(input.deadlineAt).toISOString() : null],
    );
    for (const [profileId, subject] of subjects) {
        await query(
            `INSERT INTO agent_certification_subjects
                (run_id, profile_id, agent_id, config_hash, dependency_revision, mission, tool_grants)
             VALUES ($1::uuid,$2,$3::uuid,$4,$5,$6::jsonb,$7::jsonb)
             ON CONFLICT (run_id, profile_id) DO NOTHING`,
            [runId, profileId, subject!.agentId, subject!.configHash, subject!.dependencyRevision,
                JSON.stringify(subject!.mission ?? null),
                JSON.stringify(subject!.toolGrants ? [...subject!.toolGrants] : null)]);
    }
    let planned = 0;
    for (const cell of plan.cells) {
        // The scenario universe comes from the same function certification
        // demands, so a case can never be planned for a scenario the report
        // will not ask about.
        const demanded = requiredScenarios(cell.profileId, cell.language);
        for (const [scenarioKey, required] of demanded) {
            const definitionHash = revisionHash([...required.definitions].sort());
            const caseKey = certificationCaseKey({ ...cell, scenarioKey });
            // This case's share of the cell's ceiling, by the turns it takes.
            // Derived from the plan rather than from a second price list, so the
            // number reserved and the number authorised are the same number.
            const reserve = cell.turns > 0
                ? Math.ceil(cell.maxCostUsdCents * (required.turns / cell.turns))
                : 0;
            const rows = await query<any[]>(
                `INSERT INTO agent_certification_cases
                    (run_id, case_key, attempt, profile_id, scenario_key, language, channel_type, model,
                     definition_hash, reserve_usd_cents)
                 VALUES ($1::uuid,$2,1,$3,$4,$5,$6,$7,$8,$9)
                 ON CONFLICT (run_id, case_key, attempt) DO NOTHING
                 RETURNING id`,
                [runId, caseKey, cell.profileId, scenarioKey, cell.language, cell.channel, cell.model,
                    definitionHash, reserve],
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
 * Everything is checked BEFORE the work, because a budget checked afterwards is
 * a budget that has already been exceeded. The committed total is what settled
 * cases COST plus what leased cases have RESERVED: a case being run has not been
 * paid for yet, and comparing only against settled cost let every worker in the
 * fleet pass the same check at the same instant. Four workers on a four-cent
 * budget took four two-cent cases that way.
 *
 * The whole thing is serialised on the run row, so two workers cannot both read
 * the same committed total and both decide there is room.
 */
export async function leaseCertificationCase(
    query: CertificationQuery, runId: string, leaseSeconds = 900,
): Promise<{ ok: true; lease: CertificationLease } | { ok: false; stopReason: CertificationStopReason }> {
    const [run] = await query<any[]>(
        `SELECT state, budget_usd_cents, deadline_at, mode,
                (SELECT COALESCE(SUM(cost_usd_cents),0)::int FROM agent_certification_cases
                  WHERE run_id = r.id) AS spent,
                (SELECT COALESCE(SUM(reserve_usd_cents),0)::int FROM agent_certification_cases
                  WHERE run_id = r.id AND state = 'leased'
                    AND (lease_expires_at IS NULL OR lease_expires_at >= clock_timestamp())) AS reserved
           FROM agent_certification_runs r WHERE id = $1::uuid FOR UPDATE`, [runId]);
    if (!run) return { ok: false, stopReason: 'cancelled' };
    if (run.state === 'cancelled') return { ok: false, stopReason: 'cancelled' };
    // Paused is not stopped: the cases keep their state and the run resumes
    // where it was, which is the difference between an operator taking a look
    // and an operator giving up.
    if (run.state === 'paused') return { ok: false, stopReason: 'paused' };
    const committed = Number(run.spent) + Number(run.reserved);
    if (run.budget_usd_cents != null && committed >= Number(run.budget_usd_cents)) {
        // Only terminal when nothing is still out: a worker may yet come back
        // under its reservation and leave room for the next case.
        if (Number(run.reserved) === 0) await stopCertificationRun(query, runId, 'budget_exhausted');
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
    // Only a case whose reservation still fits. Handing out a case that cannot
    // be paid for would make the ceiling advisory.
    const remaining = run.budget_usd_cents == null
        ? null
        : Number(run.budget_usd_cents) - committed;
    const rows = await query<any[]>(
        `UPDATE agent_certification_cases SET state='leased', lease_token=gen_random_uuid(),
                lease_expires_at = clock_timestamp() + ($2 || ' seconds')::interval, updated_at = NOW()
          WHERE id = (
              SELECT id FROM agent_certification_cases
               WHERE run_id = $1::uuid
                 AND ($3::int IS NULL OR reserve_usd_cents <= $3::int)
                 AND (state = 'pending'
                      OR (state = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at < clock_timestamp()))
               ORDER BY created_at, attempt
               FOR UPDATE SKIP LOCKED
               LIMIT 1)
      RETURNING id, run_id, case_key, attempt, profile_id, scenario_key, language, channel_type, model,
                definition_hash, lease_token`,
        [runId, String(Math.max(1, Math.trunc(leaseSeconds))), remaining],
    );
    if (!rows?.length) {
        // Nothing claimable is not the same as nothing left. Three different
        // facts used to arrive here as one word, and the word was `complete`.
        const [outstanding] = await query<any[]>(
            `SELECT COUNT(*) FILTER (WHERE state = 'pending')::int AS pending,
                    COUNT(*) FILTER (WHERE state = 'leased'
                        AND (lease_expires_at IS NULL OR lease_expires_at >= clock_timestamp()))::int AS leased,
                    COUNT(*)::int AS total
               FROM agent_certification_cases WHERE run_id = $1::uuid`, [runId]);
        if (Number(outstanding?.leased ?? 0) > 0) return { ok: false, stopReason: 'in_flight' };
        if (Number(outstanding?.pending ?? 0) > 0) {
            // Pending but unaffordable: the ceiling, not the queue, is what
            // stopped this, and it stopped for good since nothing is out.
            await stopCertificationRun(query, runId, 'budget_exhausted');
            return { ok: false, stopReason: 'budget_exhausted' };
        }
        // Nothing pending, nothing out. A case that failed every attempt is a
        // decision somebody owes, not work the run has run out of.
        const [unresolved] = await query<any[]>(
            `SELECT COUNT(*)::int AS n FROM (
                SELECT case_key, BOOL_OR(state = 'passed') AS proven
                  FROM agent_certification_cases WHERE run_id = $1::uuid GROUP BY case_key
             ) c WHERE proven = false`, [runId]);
        if (Number(unresolved?.n ?? 0) > 0) return { ok: false, stopReason: 'awaiting_retry_decision' };
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
        // `lease_expires_at=NULL` releases the reservation as well as the lease:
        // the case has a real cost now, and holding both would count it twice.
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

/**
 * Stops handing out work without ending the run. Leases already out are left
 * alone: interrupting a case mid-flight would waste what it has already spent.
 */
export async function pauseCertificationRun(query: CertificationQuery, runId: string): Promise<void> {
    await query(`UPDATE agent_certification_runs SET state='paused', stop_reason='paused', updated_at=NOW()
                  WHERE id=$1::uuid AND state IN ('planned','running')`, [runId]);
}

export async function resumeCertificationRun(query: CertificationQuery, runId: string): Promise<void> {
    await query(`UPDATE agent_certification_runs SET state='running', stop_reason=NULL, updated_at=NOW()
                  WHERE id=$1::uuid AND state='paused'`, [runId]);
}

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

export interface CertificationEvidenceAuthorities {
    /** The subject each profile stands on today, by profile id. */
    readonly subjects?: Readonly<Record<string, { configHash?: string; dependencyRevision?: string }>>;
    /** Applied to every profile that has no entry in `subjects`. */
    readonly configHash?: string;
    readonly dependencyRevision?: string;
}

export interface CertificationEvidenceResult {
    /** True when the run was a rehearsal: real rows, no provider, no evidence. */
    readonly dryRun?: boolean;
    readonly evidence: readonly AgentReleaseRunEvidence[];
    /** Cases dropped because the scenario they proved has since been rewritten. */
    readonly staleCases: number;
    /** Profiles dropped because the agent they were proven against has changed. */
    readonly staleSubjects: readonly string[];
}

/**
 * Turns the ledger into the evidence the certification report reads.
 *
 * One sealed run per channel AND per profile, because the subject is per
 * profile: a sealed run names one agentId and one configHash, so a seal
 * covering two profiles would be claiming that one agent answered for both.
 * `certifyProfile` iterates every row it is given and filters by scenario
 * profile, so several seals per channel are exactly what it expects.
 *
 * Two independent authorities decide what still counts:
 *
 *  · the SCENARIO. A case whose stored definition hash no longer matches the
 *    pack was proven in a form that does not exist any more. Dropped per case,
 *    counted in `staleCases`;
 *  · the SUBJECT. A profile whose agent has been reconfigured since is no
 *    longer evidenced by that run. Dropped per profile, named in
 *    `staleSubjects` — and, crucially, without taking the other profiles with
 *    it. A shared authority used to invalidate all 76 for one edit.
 */
export async function certificationEvidenceFromLedger(
    query: CertificationQuery, runId: string,
    current?: CertificationEvidenceAuthorities,
): Promise<CertificationEvidenceResult> {
    const empty = { evidence: Object.freeze([]), staleCases: 0, staleSubjects: Object.freeze([]) };
    const [run] = await query<any[]>(
        `SELECT agent_id, config_hash, dependency_revision, k, threshold, mode
           FROM agent_certification_runs WHERE id=$1::uuid`, [runId]);
    if (!run) return empty;
    // The rehearsal wrote real rows so the wiring could be proven. It did not
    // ask a model anything, so it proves nothing about one, and no argument
    // from the caller can turn it into evidence.
    if (String(run.mode) === 'dry_run') return { ...empty, dryRun: true };
    const subjectRows = await query<any[]>(
        `SELECT profile_id, agent_id, config_hash, dependency_revision
           FROM agent_certification_subjects WHERE run_id=$1::uuid`, [runId]);
    const subjects = new Map<string, { agentId: string; configHash: string; dependencyRevision: string }>(
        (subjectRows ?? []).map(row => [String(row.profile_id), {
            agentId: String(row.agent_id), configHash: String(row.config_hash),
            dependencyRevision: String(row.dependency_revision),
        }]));
    // A run planned before subjects existed still has the run-level columns.
    const fallback = {
        agentId: String(run.agent_id), configHash: String(run.config_hash),
        dependencyRevision: String(run.dependency_revision),
    };
    const staleSubjects = new Set<string>();
    const subjectFor = (profileId: string) => {
        const subject = subjects.get(profileId) ?? fallback;
        const expected = current?.subjects?.[profileId]
            ?? (current?.configHash || current?.dependencyRevision
                ? { configHash: current?.configHash, dependencyRevision: current?.dependencyRevision }
                : undefined);
        if (expected?.configHash && expected.configHash !== subject.configHash) {
            staleSubjects.add(profileId);
            return null;
        }
        if (expected?.dependencyRevision && expected.dependencyRevision !== subject.dependencyRevision) {
            staleSubjects.add(profileId);
            return null;
        }
        return subject;
    };
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

    type Bucket = {
        channelType: string; profileId: string;
        subject: { agentId: string; configHash: string; dependencyRevision: string };
        scenarios: any[]; results: any[]; models: Set<string>;
    };
    const buckets = new Map<string, Bucket>();
    let staleCases = 0;
    for (const row of rows ?? []) {
        const profileId = String(row.profile_id);
        const subject = subjectFor(profileId);
        if (!subject) continue;
        if (definitionFor(profileId, row.language, row.scenario_key) !== row.definition_hash) {
            staleCases++;
            continue;
        }
        const channelType = String(row.channel_type);
        const key = `${channelType}|${profileId}`;
        const bucket = buckets.get(key)
            ?? { channelType, profileId, subject, scenarios: [], results: [], models: new Set<string>() };
        bucket.scenarios.push(row.scenario);
        bucket.results.push((row.verification as any) ?? null);
        bucket.models.add(String(row.served_model || row.model));
        buckets.set(key, bucket);
    }
    const evidence = [...buckets.values()]
        .sort((a, b) => `${a.channelType}|${a.profileId}`.localeCompare(`${b.channelType}|${b.profileId}`))
        .map(bucket => sealReleaseRun({
            agentId: bucket.subject.agentId,
            dependencyRevision: bucket.subject.dependencyRevision,
            configHash: bucket.subject.configHash,
            channelType: bucket.channelType, status: 'completed',
            k: Number(run.k), passPolicy: 'all', threshold: Number(run.threshold),
            models: [...bucket.models].sort(),
            scenarios: bucket.scenarios, results: bucket.results.filter(Boolean),
        }));
    return {
        evidence: Object.freeze(evidence),
        staleCases,
        staleSubjects: Object.freeze([...staleSubjects].sort()),
    };
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
        const written = await input.transaction(query =>
            recordCertificationCase(query, claim.lease, result));
        if (!written.ok) {
            // The lease was given to somebody else while this worker was
            // running. It produced nothing the ledger accepted, so it counts
            // nothing — and it stops, because a worker this far behind will
            // most likely lose the next lease too.
            return { processed, stopReason: 'lease_lost' };
        }
        processed++;
        // Not `complete`: this worker did its share, which is a different fact
        // from the run having no work left. Reporting them the same would make
        // a short-lived job look like a finished catalogue.
        if (processed >= limit) return { processed, stopReason: 'batch_limit' };
    }
}
