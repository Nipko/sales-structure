import type { AgentConfigurationWorkspace, AgentDraftBody, SaveAgentDraftRequest } from '@parallext/shared';

export interface DraftSaveAttempt { fingerprint: string; request: SaveAgentDraftRequest }

/** A network retry reuses its exact command; changing either content or base starts another. */
export function prepareDraftSave(workspace: AgentConfigurationWorkspace, body: AgentDraftBody, previous?: DraftSaveAttempt | null): DraftSaveAttempt {
    if (workspace.draft && !workspace.draft.currentBase) throw new Error('agent_operational_configuration_changed');
    const content = { expectedOperationalVersion: workspace.operational.version, expectedDraftRevision: workspace.draft?.id ?? null, body };
    const fingerprint = JSON.stringify(content);
    if (previous?.fingerprint === fingerprint) return previous;
    return { fingerprint, request: { ...JSON.parse(fingerprint), requestKey: crypto.randomUUID() } };
}

export function agentDraftTestHref(workspace: AgentConfigurationWorkspace): string {
    const path = `/admin/agent/${encodeURIComponent(workspace.agentId)}/test`;
    return workspace.evaluationRevisionId ? `${path}?configurationRevisionId=${encodeURIComponent(workspace.evaluationRevisionId)}` : path;
}
