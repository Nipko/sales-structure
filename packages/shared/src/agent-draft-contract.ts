/** A saved draft describes a candidate. It never changes the operational agent. */
export interface AgentDraftBody {
    name: string;
    configJson: Record<string, any>;
    channels: string[];
    channelBindings: string[];
    scheduleMode: string;
    isActive: boolean;
    isDefault: boolean;
}

export interface SaveAgentDraftRequest {
    expectedOperationalVersion: number;
    expectedDraftRevision: string | null;
    requestKey: string;
    body: AgentDraftBody;
    /**
     * Immediate mode only: the connections of `body` (a channel type such as
     * `whatsapp`, or one account as `whatsapp:<accountId>`) the owner was told
     * would move to this agent from another one. The commit takes exactly these
     * from the other agents in the same transaction; any other connection that
     * another active agent serves refuses the save with
     * `agent_connection_owned_by_other_agent`. Ignored in reviewed mode, where
     * publication refuses every overlap.
     */
    reassignConnections?: string[];
}
export interface DiscardAgentDraftRequest {
    expectedOperationalVersion: number;
    expectedOperationalHash: string;
    expectedDraftRevision: string;
    requestKey: string;
}

export interface AgentDraftRevision {
    id: string;
    baseOperationalVersion: number;
    baseOperationalHash: string;
    bodyHash: string;
    body: AgentDraftBody;
    createdAt: string;
    currentBase: boolean;
}

export interface AgentConfigurationWorkspace {
    agentId: string;
    operational: { version: number; hash: string; body: AgentDraftBody };
    draft: AgentDraftRevision | null;
    /** Only this UUID can select the current draft for a server-side evaluation. */
    evaluationRevisionId: string | null;
    /**
     * True when a save is applied to the serving agent immediately (the
     * default: "cambiar es tocar y guardar"). False only when the tenant opted
     * into reviewed changes (`tenant.settings.agentReviewMode === 'reviewed'`),
     * in which case a save produces a draft that goes live through evaluation,
     * review and publication. Every surface reads this instead of guessing.
     */
    directCommit: boolean;
}

export interface SavedAgentDraft {
    savedRevision: AgentDraftRevision;
    idempotentReplay: boolean;
    /** Re-read inside the commit transaction; an old replay does not move this pointer. */
    workspace: AgentConfigurationWorkspace;
}
