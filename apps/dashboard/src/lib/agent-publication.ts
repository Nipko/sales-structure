import type { AgentConfigurationWorkspace } from "@parallext/shared";
import type { ApiEnvelope } from "./api";
import type { AgentReleaseDetail } from "./agent-release-review";
import { isAdmin } from "./roles";

/**
 * Publication and rollback of an approved agent configuration, from the side
 * that has to build the request.
 *
 * The endpoints are compare-and-swap: every field is an expectation about what
 * is serving right now, and a stale one is a 409 rather than a silent
 * overwrite of somebody else's publication. So the request may only be built
 * from values read in this session — never from what the screen remembers —
 * and the two reads it needs (the live configuration and the publication head)
 * must agree with each other before anything is sent. That reconciliation is
 * this module's whole job, and it is here so it can be tested without a
 * browser.
 *
 * Configuration bodies are deliberately absent: the history says what happened
 * and the editor is where a configuration is read.
 */

export type AgentPublicationKind = "publish" | "rollback";

export interface AgentPublicationEvent {
    id: string;
    kind: AgentPublicationKind;
    candidateId: string | null;
    rollbackOf: string | null;
    baseVersion: number;
    operationalVersion: number;
    beforeHash: string;
    afterHash: string;
    evidenceHash: string | null;
    requestedBy: string;
    createdAt: string;
}

export interface AgentPublicationHead {
    id: string;
    kind: AgentPublicationKind;
    operationalVersion: number;
    operationalHash: string;
    createdAt: string;
}

export interface AgentPublicationHistory {
    agentId: string;
    /** The agent's version right now, not the head's. They can differ. */
    operationalVersion: number;
    head: AgentPublicationHead | null;
    events: AgentPublicationEvent[];
}

export type AgentActivation = "preserve" | "activate";

export interface PublishAgentConfigurationRequest {
    expectedOperationalVersion: number;
    expectedOperationalHash: string;
    requestKey: string;
    expectedCandidateVersion: number;
    evidenceHash: string;
    activation: AgentActivation;
}

export interface RollbackAgentConfigurationRequest {
    expectedOperationalVersion: number;
    expectedOperationalHash: string;
    requestKey: string;
    expectedPublicationId: string;
}

export interface AgentPublicationReceipt {
    id: string;
    agentId: string;
    kind: AgentPublicationKind;
    operationalVersion: number;
    operationalHash: string;
    idempotentReplay: boolean;
}

/** A retry is the same request; anything different is a different request. */
export interface PublicationAttempt<T> { fingerprint: string; body: T }

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/**
 * Why publication is not on offer for this candidate right now.
 * `null` means it is, with the values currently on screen.
 */
export type PublishBlock =
    | "adminRequired"
    | "reloadRequired"
    | "candidateNotApproved"
    | "candidateChanged"
    | "evidenceMissing";

/**
 * The live configuration and the publication history are two reads. If their
 * idea of the operational version already disagrees, something committed
 * between them, and sending one value paired with the other's hash is exactly
 * the stale expectation CAS exists to catch. Refuse locally and ask for a
 * reload instead of spending an irreversible attempt to learn it.
 */
export function publishBlock(
    workspace: AgentConfigurationWorkspace | null,
    history: AgentPublicationHistory | null,
    candidate: AgentReleaseDetail | null,
    role: string | null | undefined,
): PublishBlock | null {
    if (!isAdmin(role)) return "adminRequired";
    if (!workspace || !history) return "reloadRequired";
    if (!Number.isInteger(workspace.operational.version) || workspace.operational.version < 1
        || !HASH.test(workspace.operational.hash)) return "reloadRequired";
    if (workspace.operational.version !== history.operationalVersion) return "reloadRequired";
    if (!candidate) return "candidateNotApproved";
    if (candidate.status !== "approved") return "candidateNotApproved";
    if (candidate.revisionState !== "current") return "candidateChanged";
    if (!Number.isInteger(candidate.version) || candidate.version < 1) return "candidateChanged";
    if (!candidate.review || !HASH.test(candidate.review.evidenceHash)) return "evidenceMissing";
    return null;
}

export function preparePublish(
    workspace: AgentConfigurationWorkspace,
    history: AgentPublicationHistory,
    candidate: AgentReleaseDetail,
    role: string | null | undefined,
    activation: AgentActivation,
    previous?: PublicationAttempt<PublishAgentConfigurationRequest> | null,
): PublicationAttempt<PublishAgentConfigurationRequest> {
    const block = publishBlock(workspace, history, candidate, role);
    if (block) throw new Error(`agent_publication_blocked:${block}`);
    // Exactly these keys: the store rejects an unknown one outright rather than
    // ignoring it, so a helpful extra field would fail the whole publication.
    const values = {
        expectedOperationalVersion: workspace.operational.version,
        expectedOperationalHash: workspace.operational.hash,
        expectedCandidateVersion: candidate.version,
        evidenceHash: candidate.review!.evidenceHash,
        activation,
    };
    const fingerprint = JSON.stringify({ candidateId: candidate.id, ...values });
    return previous?.fingerprint === fingerprint
        ? previous
        : { fingerprint, body: { ...values, requestKey: crypto.randomUUID() } };
}

export type RollbackBlock =
    | "adminRequired"
    | "reloadRequired"
    | "noPublication"
    | "headIsRollback"
    | "configurationDiverged";

/**
 * Rollback restores what the head publication replaced, and the store compares
 * ONE expected hash against both the head's `after_hash` and the agent's hash
 * right now. So it is only possible while nothing has touched the operational
 * configuration since that publication: if the two have diverged, no value can
 * satisfy both comparisons, and the honest answer is to publish a reviewed
 * candidate rather than to fire a request that cannot succeed.
 */
export function rollbackBlock(
    workspace: AgentConfigurationWorkspace | null,
    history: AgentPublicationHistory | null,
    role: string | null | undefined,
): RollbackBlock | null {
    if (!isAdmin(role)) return "adminRequired";
    if (!workspace || !history) return "reloadRequired";
    if (!Number.isInteger(workspace.operational.version) || workspace.operational.version < 1
        || !HASH.test(workspace.operational.hash)) return "reloadRequired";
    if (workspace.operational.version !== history.operationalVersion) return "reloadRequired";
    if (!history.head) return "noPublication";
    if (!UUID.test(history.head.id)) return "reloadRequired";
    if (history.head.kind !== "publish") return "headIsRollback";
    if (history.head.operationalHash !== workspace.operational.hash) return "configurationDiverged";
    return null;
}

export function prepareRollback(
    workspace: AgentConfigurationWorkspace,
    history: AgentPublicationHistory,
    role: string | null | undefined,
    previous?: PublicationAttempt<RollbackAgentConfigurationRequest> | null,
): PublicationAttempt<RollbackAgentConfigurationRequest> {
    const block = rollbackBlock(workspace, history, role);
    if (block) throw new Error(`agent_publication_blocked:${block}`);
    const values = {
        expectedOperationalVersion: workspace.operational.version,
        expectedOperationalHash: workspace.operational.hash,
        expectedPublicationId: history.head!.id,
    };
    const fingerprint = JSON.stringify({ kind: "rollback", ...values });
    return previous?.fingerprint === fingerprint
        ? previous
        : { fingerprint, body: { ...values, requestKey: crypto.randomUUID() } };
}

/**
 * Fixed categories only: a backend code never becomes screen copy.
 *
 * `conflict` is the one that must not be flattened into a generic failure —
 * it means somebody else moved the configuration and the only correct action
 * is to read the current values again.
 */
export type PublicationErrorKind =
    | "conflict"
    | "assignmentConflict"
    | "adminRequired"
    | "scopeInvalid"
    | "scopeMismatch"
    | "subscriptionRestricted"
    | "evidenceStale"
    | "notFound"
    | "requestInvalid"
    | "unavailable";

const CONFLICT_CODES = [
    "agent_publication_request_conflict",
    "agent_publication_head_changed",
    "agent_publication_history_invalid",
    "agent_operational_configuration_changed",
    "agent_release_version_changed",
    "agent_release_evidence_changed",
    "agent_release_draft_mismatch",
    "agent_draft_revision_changed",
];

export function publicationErrorKind(
    envelope: Pick<ApiEnvelope<unknown>, "error" | "errorCode">,
): PublicationErrorKind {
    const code = envelope.errorCode || "";
    if (CONFLICT_CODES.includes(code)) return "conflict";
    if (code === "agent_connection_assignment_conflict") return "assignmentConflict";
    if (code === "agent_publication_admin_required" || code === "agent_release_role_required") return "adminRequired";
    if (code === "agent_publication_scope_invalid" || code === "agent_release_scope_invalid") return "scopeInvalid";
    if (code === "agent_publication_scope_mismatch") return "scopeMismatch";
    if (code === "agent_publication_subscription_restricted") return "subscriptionRestricted";
    if (code === "evaluation_revision_manifest_required") return "evidenceStale";
    if (code === "tenant_not_found" || code === "agent_not_found" || code === "agent_release_not_found") return "notFound";
    if (code === "agent_publication_request_invalid") return "requestInvalid";
    return "unavailable";
}

/** A conflict is the only refusal that is fixed by reading everything again. */
export const publicationRequiresReload = (kind: PublicationErrorKind): boolean => kind === "conflict";

/** Short, stable reference for a hash or id shown next to a decision. */
export const publicationReference = (value: string | null | undefined): string =>
    typeof value === "string" && value.length >= 8 ? value.slice(0, 8) : "—";
