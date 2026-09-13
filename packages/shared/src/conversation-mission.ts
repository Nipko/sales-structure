/** Server-owned dialogue focus. References domain state; never grants tool authority. */
export interface ConversationMissionRefV1 {
    id: string;
    kind: 'booking' | 'procedure' | 'tool';
    reference?: string;
    domain?: string;
    toolName?: string;
}

export interface MissionExpectedReplyV1 {
    missionId: string;
    proposalId: string;
    sourceMessageId: string;
    kind: 'slot' | 'confirmation' | 'flow';
    slot?: string;
    ledgerId?: string;
}

export interface ConversationMissionFocusV1 {
    version: 1;
    /** Changes whenever the selected task or its accepted terms are invalidated. */
    revision: number;
    /** Compare-and-set version for persistence, independent from consent revision. */
    writeVersion: number;
    selected: ConversationMissionRefV1 | null;
    expectedReply: MissionExpectedReplyV1 | null;
    /** Paused tool intents have no separate collection engine. IDs only. */
    pausedTools?: Array<{ ref: ConversationMissionRefV1; pausedAt: string }>;
    updatedAt: string;
    /** IDs only: one inbound cannot be reused by another mission. */
    lastConsumed?: { messageId: string; missionId: string; revision: number };
}

/** Supplied by the core/execution adapter, never accepted from tool arguments. */
export interface MissionExecutionScopeV1 {
    version: 1;
    missionId: string;
    kind: ConversationMissionRefV1['kind'];
    /** Actual server port invoking the executor; the model cannot choose this. */
    executionOwner: ConversationMissionRefV1['kind'];
    domain?: string;
    toolName?: string;
    revision: number;
    writeBlocked?: boolean;
    inboundMessageId: string;
    expectedReply: MissionExpectedReplyV1 | null;
}
