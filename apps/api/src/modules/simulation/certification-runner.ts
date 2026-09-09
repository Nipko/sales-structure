import { composeSubtypeEvalPack, type AddressForm } from '@parallext/shared';
import { revisionHash } from '../evaluation-revision/evaluation-revision';
import type { CertificationCaseResult, CertificationLease, CertificationSubject } from './certification-ledger';

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
    /** `EvalService.runGateV2` — the same gate a release runs through. */
    readonly runGate: (tenantId: string, agentId: string, opts: Record<string, unknown>) => Promise<any>;
    /** `AgentTestService.captureSnapshot`, so the run names the configuration it executed. */
    readonly captureSnapshot: (tenantId: string, agentId: string) => Promise<any>;
    readonly tenantId: string;
    readonly k: number;
    readonly threshold: number;
    /** Resolved per case, because the subject is per profile. */
    readonly subjectFor: (profileId: string) => CertificationSubject | undefined;
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
            return {
                passed: false, servedModel: '', costUsdCents: 0, latencyMs: 0,
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
        });
        const verification = (gate?.results ?? []).find((row: any) => row?.key === scenario.key) ?? null;
        const attempts: any[] = Array.isArray(verification?.runs) ? verification.runs : [];
        return {
            passed: verification?.passed === true,
            // The model that ANSWERED, which is not always the one asked for:
            // the router falls back, and a run that cannot name it proves
            // nothing about the model somebody paid for.
            servedModel: String(attempts.find((run: any) => run?.model)?.model ?? gate?.model ?? ''),
            costUsdCents: Math.max(0, Math.round(Number(gate?.costUsdCents ?? 0))),
            latencyMs: Date.now() - started,
            transcript: attempts.map((run: any) => run?.transcript ?? null),
            tools: attempts.flatMap((run: any) => run?.executedTools ?? []),
            verification,
            scenario,
            errorCode: verification?.error ? String(verification.error).slice(0, 200) : null,
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
            costUsdCents: 0,
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
