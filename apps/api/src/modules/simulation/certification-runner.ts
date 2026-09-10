import { composeSubtypeEvalPack, type AddressForm } from '@parallext/shared';
import { revisionHash } from '../evaluation-revision/evaluation-revision';
import type { CertificationCaseResult, CertificationLease, CertificationSubject } from './certification-ledger';
import {
    gateScenario, gateUsage, servedModels, servedTheRequestedModel, USAGE_NOT_RUN,
    type EvalGateResult,
} from './eval-gate-result';

/**
 * What actually runs a certification case, and the rehearsal that runs none.
 *
 * Two runners, and the difference between them is the whole reason this file is
 * separate from the ledger:
 *
 *  · `parallelyCertificationRunner` puts the case through the SAME evaluation
 *    gate the product uses — real prompt assembly, real tools, real effect
 *    verifiers — and therefore calls a model and spends money;
 *  · `dryRunCertificationRunner` contacts nothing. It exists so the entire path
 *    from the HTTP entrypoint through the queue, the lease, the ledger and the
 *    report can be exercised before anybody is asked for a credential.
 *
 * The rehearsal is deliberately unable to certify anything. It records real
 * rows, so the wiring is genuinely proven, and the run it belongs to is marked
 * `dry_run`, which `certificationEvidenceFromLedger` refuses to turn into
 * evidence. A rehearsal that could certify the catalogue would be worse than no
 * rehearsal at all.
 */

/** The scenario a case names, composed from the same packs the plan counted. */
export function certificationScenario(
    profileId: string, language: string, scenarioKey: string,
): any | null {
    const [industry, subtype] = profileId.split('/');
    const forms = (language === 'es' ? [null, 'tu', 'usted', 'vos'] : [null]) as Array<AddressForm | null>;
    for (const addressForm of forms) {
        for (const scenario of composeSubtypeEvalPack({ industry, subtype, language, addressForm })) {
            if (scenario.key === scenarioKey) return scenario;
        }
    }
    return null;
}

export interface CertificationRuntimeDeps {
    /**
     * `EvalService.runGateV2` — the same gate a release runs through.
     *
     * Typed as what it returns, not `any`. It was `any` on both sides of this
     * boundary, and that is how a consumer came to read `gate.results` from a
     * producer that returns `scenarios`, and `gate.costUsdCents` from a producer
     * that has never reported cost.
     */
    readonly runGate: (tenantId: string, agentId: string, opts: Record<string, unknown>) => Promise<EvalGateResult>;
    /** `AgentTestService.captureSnapshot`, so the run names the configuration it executed. */
    readonly captureSnapshot: (tenantId: string, agentId: string) => Promise<any>;
    readonly tenantId: string;
    readonly k: number;
    readonly threshold: number;
    /** Resolved per case, because the subject is per profile. */
    readonly subjectFor: (profileId: string) => CertificationSubject | undefined;
    /**
     * Checked before every model call, not once per case.
     *
     * A cancelled run, a lost lease and an exhausted budget are all facts that
     * can become true in the middle of a case, and a case that only checks at
     * the start keeps spending after each of them. The gate already takes these
     * callbacks for a release; the certification runner simply never passed
     * them, so a certification run had neither a lease check nor a budget
     * decrement between its calls.
     */
    readonly assertExecutionAuthority?: () => Promise<void>;
    readonly beforeModelUnits?: (units: number) => Promise<void>;
}

export class CertificationSubjectMismatch extends Error {
    constructor(readonly detail: Record<string, string>) { super('certification_subject_mismatch'); }
}

/**
 * Runs one case against the real runtime.
 *
 * The snapshot it captures must be the subject the ledger recorded: a case
 * proven against a configuration nobody declared is a case nobody can attribute,
 * and silently accepting the drift would put exactly that into the evidence. So
 * it is compared and refused.
 */
export function parallelyCertificationRunner(deps: CertificationRuntimeDeps) {
    return async (lease: CertificationLease): Promise<CertificationCaseResult> => {
        const subject = deps.subjectFor(lease.profileId);
        if (!subject) throw new CertificationSubjectMismatch({ profileId: lease.profileId, reason: 'no_subject' });
        const scenario = certificationScenario(lease.profileId, lease.language, lease.scenarioKey);
        if (!scenario) {
            // Nothing ran, so there is nothing to account for. `not_run` rather
            // than a zero cost, which would read downstream as "we ran it and it
            // was free".
            return {
                passed: false, servedModel: '', usage: USAGE_NOT_RUN, latencyMs: 0,
                transcript: null, tools: null, verification: null, scenario: {},
                errorCode: 'certification_scenario_missing',
            };
        }
        const snapshot = await deps.captureSnapshot(deps.tenantId, subject.agentId);
        if (snapshot?.configHash && snapshot.configHash !== subject.configHash) {
            throw new CertificationSubjectMismatch({
                profileId: lease.profileId, expected: subject.configHash, actual: String(snapshot.configHash),
            });
        }
        const started = Date.now();
        const gate = await deps.runGate(deps.tenantId, subject.agentId, {
            // Every value that goes into `releaseRunContext` has to match what
            // the ledger will seal, or the report will refuse a case that
            // actually passed.
            channelType: lease.channelType, k: deps.k, passPolicy: 'all', threshold: deps.threshold,
            agentSnapshot: snapshot, scenarios: [scenario],
            // The three the runner never passed. Without them a certification
            // run spends past a cancellation, past a lost lease and past its own
            // ceiling, because nothing is consulted between calls.
            assertExecutionAuthority: deps.assertExecutionAuthority,
            beforeModelUnits: deps.beforeModelUnits,
        });
        // `scenarios`, which is what the gate returns. Reading `results` here
        // produced `undefined` for every case, and `undefined` became a failure
        // at zero cost that released its reservation.
        const verification = gateScenario(gate, scenario.key) ?? null;
        const attempts = Array.isArray(verification?.runs) ? verification!.runs : [];
        const answered = servedModels(verification ?? undefined);
        // A case the gate did not run at all is not a case that failed. Saying
        // so keeps `awaiting_retry_decision` meaningful instead of recording a
        // verdict nobody produced.
        const usage = verification ? gateUsage(gate, verification) : USAGE_NOT_RUN;
        const modelMismatch = verification && answered.length > 0
            && !servedTheRequestedModel(lease.model, answered);
        return {
            passed: verification?.passed === true && !modelMismatch,
            // The models that ANSWERED, which are not always the one asked for:
            // the router falls back between providers by design, and evidence
            // that does not notice is evidence about a model nobody asked about.
            servedModel: answered.join('+'),
            usage,
            latencyMs: Date.now() - started,
            transcript: attempts.map(run => run?.transcript ?? null),
            tools: attempts.flatMap(run => [...(run?.executedTools ?? [])]),
            verification,
            scenario,
            errorCode: !verification ? 'certification_gate_returned_no_scenario'
                : modelMismatch ? `certification_model_mismatch:${lease.model}:${answered.join('+')}`
                    : verification.error ? String(verification.error).slice(0, 200) : null,
        };
    };
}

/**
 * The rehearsal.
 *
 * It writes rows shaped exactly like a real result, including a verification
 * that would satisfy the report, so the ledger, the progress view and the
 * evidence assembly are all genuinely exercised. What stops it certifying
 * anything is not this function: it is the run's `dry_run` mode, checked where
 * the evidence is built.
 *
 * `passes` is deterministic from the case key so a rehearsal is reproducible and
 * can be asserted on, and so a fixed pass rate can be asked for when the point
 * of the test is what happens to failures.
 */
export function dryRunCertificationRunner(options: {
    readonly passRate?: number;
    readonly seed?: string;
    readonly k: number;
    readonly threshold: number;
    readonly contextHash: (lease: CertificationLease) => string;
} ) {
    const rate = Math.max(0, Math.min(1, options.passRate ?? 1));
    return async (lease: CertificationLease): Promise<CertificationCaseResult> => {
        const scenario = certificationScenario(lease.profileId, lease.language, lease.scenarioKey)
            ?? { key: lease.scenarioKey, messages: [], criteria: '' };
        const draw = parseInt(
            revisionHash({ seed: options.seed ?? 'dry-run', caseKey: lease.caseKey }).slice(0, 8), 16) / 0xffffffff;
        const passed = draw < rate;
        const runs = Array.from({ length: options.k }, () => ({
            passed, error: null, flags: [], score: passed ? options.threshold : 0,
            model: 'dry-run', transcript: [], executedTools: [],
            actionChecks: (scenario.expectedActions ?? []).map(() => ({ ok: passed })),
        }));
        return {
            passed,
            servedModel: 'dry-run',
            // A rehearsal contacts no provider, so zero is a measurement rather
            // than an absence: `reported`, and genuinely nothing.
            usage: { state: 'reported' as const, costUsdCents: 0 },
            latencyMs: 0,
            transcript: [],
            tools: [],
            verification: {
                key: scenario.key, contextHash: options.contextHash(lease), scenarioHash: revisionHash(scenario),
                error: null, passed, k: options.k, passes: passed ? options.k : 0, runs,
            },
            scenario,
            errorCode: null,
        };
    };
}
