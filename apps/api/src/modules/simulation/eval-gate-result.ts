/**
 * ═══ THE SHAPE `runGateV2` ACTUALLY RETURNS ═══
 *
 * It returned `{ scenarios }`. Two consumers read `gate.results`, and one of
 * them also read `gate.costUsdCents`, which the gate has never had. Both were
 * typed `any`, so nothing said a word.
 *
 * What that produced is worse than a crash. The certification runner turned a
 * PASSING scenario into `{passed: false, servedModel: '', costUsdCents: 0}` and
 * the ledger settled it as `failed` at zero cost — and settling at zero is the
 * part that matters, because the provider had already done the work. The
 * reservation was released, the budget refilled, and the next case was handed
 * out under a ceiling that had silently gone back up. The benchmark adapter had
 * the same read and turned it into a measured failure at zero cost, which then
 * satisfied `comparable: true` against an alternative: a fabricated comparison
 * that looks like evidence.
 *
 * So the shape is declared here, once, and both sides import it. A field neither
 * side can point at is a field that cannot silently be `undefined`.
 *
 * ── COST IS NOT A NUMBER, IT IS A NUMBER OR AN ADMISSION ─────────────────────
 *
 * The gate does not report usage. Neither does the judge it calls once per
 * attempt. That is a real gap and it is being named rather than papered over:
 * `usage.state` is `unknown` and `costUsdCents` is `null`, so nothing downstream
 * can read a zero that was never measured. Until the runtime reports usage, an
 * unknown-cost case keeps its reservation instead of releasing it.
 */

/** One model attempt inside a scenario. */
export interface EvalGateAttempt {
    readonly score?: number | null;
    readonly passed?: boolean;
    readonly flags?: readonly string[];
    /** Joined names, for display. `models` is the one to compute with. */
    readonly model?: string | null;
    /** Every model that actually answered this attempt, sorted. */
    readonly models?: readonly string[];
    readonly transcript?: unknown;
    readonly transcriptTruncated?: boolean;
    readonly actionChecks?: readonly unknown[];
    readonly executedTools?: readonly unknown[];
}

/** One scenario's verdict across its `k` attempts. */
export interface EvalGateScenario {
    readonly key: string;
    readonly title?: string;
    readonly score?: number | null;
    readonly passed?: boolean;
    readonly resolved?: boolean;
    readonly error?: string | null;
    readonly runs?: readonly EvalGateAttempt[];
    readonly contextHash?: string;
}

/**
 * What the gate hands back. The field is `scenarios`; there is no `results`, and
 * there is no cost.
 */
export interface EvalGateResult {
    readonly runId: string;
    readonly status: 'completed' | 'failed';
    readonly passed: boolean;
    readonly avgScore: number | null;
    readonly total: number;
    readonly k: number;
    readonly threshold: number;
    readonly passPolicy: 'all' | 'majority';
    readonly evalActivable: boolean;
    readonly scenarios: readonly EvalGateScenario[];
    readonly releaseEvidence?: unknown;
    readonly releaseReadiness?: unknown;
    readonly agentSnapshot?: unknown;
    readonly channelType?: string;
    readonly error?: string;
}

/**
 * Reading one scenario out of a gate result, in the one place that knows the
 * field is called `scenarios`.
 *
 * Returns `undefined` for "the gate did not run this scenario", which is a
 * different fact from "it ran and failed" and must not collapse into it.
 */
export function gateScenario(gate: EvalGateResult | null | undefined, key: string): EvalGateScenario | undefined {
    if (!gate || !Array.isArray(gate.scenarios)) return undefined;
    return gate.scenarios.find(row => row?.key === key);
}

/** Every model that answered, across every attempt of one scenario. */
export function servedModels(scenario: EvalGateScenario | undefined): string[] {
    const runs = Array.isArray(scenario?.runs) ? scenario!.runs : [];
    const names = runs.flatMap(run => Array.isArray(run?.models) ? run.models
        : (run?.model ? String(run.model).split('+') : []));
    return [...new Set(names.map(name => String(name).trim()).filter(Boolean))].sort();
}

/** How a case's cost is known, if it is. */
export type UsageState =
    /** The runtime reported usage and this is what it cost. */
    | 'reported'
    /** It ran and nothing reported what it cost. Exposure is retained. */
    | 'unknown'
    /** It did not run, so there is nothing to account for. */
    | 'not_run';

export interface EvalUsage {
    readonly state: UsageState;
    /** Only ever a number when the state is `reported`. */
    readonly costUsdCents: number | null;
}

export const USAGE_UNKNOWN: EvalUsage = Object.freeze({ state: 'unknown', costUsdCents: null });
export const USAGE_NOT_RUN: EvalUsage = Object.freeze({ state: 'not_run', costUsdCents: null });

/**
 * What this run cost, or the admission that nobody said.
 *
 * The gate carries no usage today. Rather than default to zero — which reads as
 * "free" to every accounting query downstream — this returns `unknown` and the
 * ledger holds the reservation. When the runtime starts reporting usage, this is
 * the one function that has to learn to read it.
 */
export function gateUsage(gate: EvalGateResult | null | undefined, scenario: EvalGateScenario | undefined): EvalUsage {
    if (!gate) return USAGE_NOT_RUN;
    if (!scenario) return USAGE_NOT_RUN;
    const reported = (gate as unknown as { costUsdCents?: unknown }).costUsdCents;
    if (typeof reported === 'number' && Number.isFinite(reported) && reported >= 0) {
        return Object.freeze({ state: 'reported' as const, costUsdCents: Math.round(reported) });
    }
    return USAGE_UNKNOWN;
}

/**
 * Did the models that answered include the one somebody paid to certify?
 *
 * Certification is per model. The router falls back between providers by
 * design, so a run can legitimately be answered by a different model from the
 * one requested — and evidence that does not notice is evidence about a model
 * nobody asked about.
 */
export function servedTheRequestedModel(requested: string, served: readonly string[]): boolean {
    if (!requested) return false;
    return served.some(name => name === requested);
}
