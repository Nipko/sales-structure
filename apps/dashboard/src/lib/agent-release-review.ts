import type { AgentConfigurationWorkspace, AgentReleaseReviewSubject } from '@parallext/shared';
import { isAdmin } from './roles';

export const RELEASE_REVIEW_CHECKS = ['objective', 'instructions', 'facts', 'tools', 'style', 'limits'] as const;
export type ReleaseReviewChecks = Record<(typeof RELEASE_REVIEW_CHECKS)[number], boolean>;
export const emptyReleaseReviewChecks = (): ReleaseReviewChecks => Object.fromEntries(RELEASE_REVIEW_CHECKS.map(key => [key, false])) as ReleaseReviewChecks;
export interface AgentReleaseRequest { configurationRevisionId: string; requestKey: string }
export interface AgentReleaseReviewRequest {
    expectedVersion: number; evidenceHash: string; decision: 'approve' | 'reject'; requestKey: string;
    checks: ReleaseReviewChecks; sampleHashes: string[];
}
export interface AgentReleaseListItem {
    id: string; configuration_revision_id: string; status: string; version: number; error: string | null; created_at: string;
}
export interface AgentReleaseSample {
    channel: string; language: string; scenario: string; hash: string;
    transcript: Array<{ role: string; content: string }>;
}
export interface AgentReleaseReadiness {
    eligibleForReview: boolean; requiredCases: number; verifiedCases: number;
    gaps: Array<{ code: string; channel?: string; language?: string; task?: string; scenario?: string }>;
}
export interface AgentReleaseDetail {
    id: string; agentId: string; configurationRevisionId: string; status: string; version: number;
    revisionState: 'current' | 'changed' | 'unavailable' | 'invalidated'; channels: string[]; createdAt: string; error: string | null;
    evaluations: Array<{ id: string; channel: string; status: string; attempts: number; error: string | null;
        runId: string | null; nextAttemptAt: string | null; completedScenarios: number }>;
    review: { evidenceHash: string; configurationHash: string | null; dependencyRevision: string | null; subject: AgentReleaseReviewSubject;
        operationChecks: Array<{ channel: string; language: string | null; scenario: string; assertion: string; family: string | null; tool: string | null;
            required: number; passed: number; failed: number; unknown: number; status: string }>;
        sampleHashes: string[]; samples: AgentReleaseSample[]; readiness: AgentReleaseReadiness; eligibleForReview: boolean } | null;
    activationAllowed: false; certified: false;
}
export interface ReleaseCommandAttempt<T> { fingerprint: string; body: T }
const HASH = /^[a-f0-9]{64}$/;

/** Retries have the same request identity; a new revision is always a different request. */
export function prepareReleaseRequest(workspace: AgentConfigurationWorkspace, previous?: ReleaseCommandAttempt<AgentReleaseRequest> | null): ReleaseCommandAttempt<AgentReleaseRequest> {
    if (!workspace.draft?.currentBase || !workspace.evaluationRevisionId || workspace.evaluationRevisionId !== workspace.draft.id)
        throw new Error('agent_release_draft_required');
    const fingerprint = JSON.stringify({ agentId: workspace.agentId, configurationRevisionId: workspace.evaluationRevisionId });
    return previous?.fingerprint === fingerprint ? previous : { fingerprint,
        body: { configurationRevisionId: workspace.evaluationRevisionId, requestKey: crypto.randomUUID() } };
}

export function canReviewRelease(candidate: AgentReleaseDetail, role: string | null | undefined, decision: 'approve' | 'reject', checks: ReleaseReviewChecks, seen: string[]): boolean {
    if (!isAdmin(role) || candidate.revisionState !== 'current' || candidate.status !== 'evaluated'
        || !Number.isInteger(candidate.version) || candidate.version < 1 || !candidate.review || !HASH.test(candidate.review.evidenceHash)) return false;
    if (decision === 'reject') return true;
    const evidence = candidate.review, actualHashes = evidence.samples.map(sample => sample.hash);
    return evidence.eligibleForReview === true && evidence.readiness.eligibleForReview === true
        && evidence.operationChecks.every(check => check.required > 0 && check.passed === check.required && check.failed === 0 && check.unknown === 0 && check.status === 'verified')
        && evidence.sampleHashes.length > 0 && new Set(evidence.sampleHashes).size === evidence.sampleHashes.length
        && evidence.sampleHashes.every(hash => HASH.test(hash))
        && JSON.stringify([...evidence.sampleHashes].sort()) === JSON.stringify([...actualHashes].sort())
        && JSON.stringify([...new Set(seen)].sort()) === JSON.stringify([...evidence.sampleHashes].sort())
        && RELEASE_REVIEW_CHECKS.every(key => checks[key] === true);
}

/** The command seals only acknowledgements of server evidence, never scores, configuration or transcripts. */
export function prepareReleaseReview(candidate: AgentReleaseDetail, role: string | null | undefined, decision: 'approve' | 'reject',
    checks: ReleaseReviewChecks, seen: string[], previous?: ReleaseCommandAttempt<AgentReleaseReviewRequest> | null): ReleaseCommandAttempt<AgentReleaseReviewRequest> {
    if (!canReviewRelease(candidate, role, decision, checks, seen)) throw new Error('agent_release_review_incomplete');
    const values = { expectedVersion: candidate.version, evidenceHash: candidate.review!.evidenceHash, decision,
        checks: { ...checks }, sampleHashes: [...new Set(seen)].filter(hash => candidate.review!.sampleHashes.includes(hash)).sort() };
    const fingerprint = JSON.stringify({ candidateId: candidate.id, ...values });
    return previous?.fingerprint === fingerprint ? previous : { fingerprint, body: { ...values, requestKey: crypto.randomUUID() } };
}

/** Fixed categories only: API/provider error text must not become UI instructions or diagnostics. */
export function releaseErrorKind(code: string | null | undefined): 'changed' | 'budget' | 'unavailable' {
    if (code === 'eval_autorun_budget_exhausted') return 'budget';
    if (['agent_release_source_changed', 'agent_release_revision_changed', 'agent_release_version_changed', 'agent_release_evidence_changed',
        'agent_operational_configuration_changed', 'agent_draft_revision_changed', 'agent_release_request_conflict'].includes(code || '')) return 'changed';
    return 'unavailable';
}
