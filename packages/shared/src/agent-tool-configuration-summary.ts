import { AGENT_CONFIG_TOOL_FAMILIES } from './agent-configuration-contract';

export type AgentToolFamily = typeof AGENT_CONFIG_TOOL_FAMILIES[number];

/** Published owner settings, NOT runtime readiness, channel coverage or permission
 * for a human to use a business module. No drafts, prompts or credentials. */
export interface AgentToolConfigurationSummary {
    source: 'operational';
    totalAgents: number;
    families: Record<AgentToolFamily, {
        activeEnabledAgents: number;
        pausedEnabledAgents: number;
        unknownAgents: number;
    }>;
}
