import type { AgentMissionV1, AgentAssessment } from './agent-assessment-contract';

/** Small reversible commands. Credentials, bindings and authority are excluded. */
export const AGENT_CONFIGURATION_PATHS = [
    'persona.name', 'persona.role', 'persona.greeting', 'persona.fallbackMessage',
    'persona.personality.tone', 'persona.personality.formality',
    'behavior.rules', 'behavior.forbiddenTopics', 'behavior.handoffTriggers', 'mission',
] as const;
export type AgentConfigurationPath = typeof AGENT_CONFIGURATION_PATHS[number];
export interface AgentConfigurationChange { path: AgentConfigurationPath; value: string | string[] | AgentMissionV1 }
export interface AgentConfigurationProposal {
    id: string;
    agentId: string;
    agentName: string;
    expectedVersion: number;
    digest: string;
    status: 'proposed' | 'applied' | 'expired';
    expiresAt: string;
    changes: Array<AgentConfigurationChange & { before: unknown }>;
    appliedVersion?: number;
}
export interface AppliedAgentConfiguration {
    proposal: AgentConfigurationProposal;
    assessment: AgentAssessment | null;
    verification: 'verified' | 'unavailable';
}
