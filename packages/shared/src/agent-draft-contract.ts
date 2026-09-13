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
}

export interface SavedAgentDraft {
    savedRevision: AgentDraftRevision;
    idempotentReplay: boolean;
    /** Re-read inside the commit transaction; an old replay does not move this pointer. */
    workspace: AgentConfigurationWorkspace;
}
