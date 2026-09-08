import type { AgentQualityCheck, AgentQualityOverview, AgentQualityCheckStatus } from './agent-quality-contract';
import type { AgentOperationalState } from './agent-operational-state';
import type { EffectiveCapabilityContract } from './effective-capability-contract';
import type { GuidedTourId } from './guided-tour-contract';
import type { GuidedTourStartDetail } from './guided-tour-contract';

/** Reviewed business objective within the profile. It never grants tool authority. */
export interface AgentMissionV1 {
    version: 1;
    objective: string;
    intentKeys: string[];
    successCriteria: string[];
    handoffConditions: string[];
}

export function isAgentMissionV1(value: unknown): value is AgentMissionV1 {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const mission = value as AgentMissionV1;
    const list = (items: unknown): items is string[] => Array.isArray(items) && items.length > 0 && items.length <= 20
        && items.every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= 1500);
    return Object.keys(value).every(key => ['version', 'objective', 'intentKeys', 'successCriteria', 'handoffConditions'].includes(key))
        && mission.version === 1 && typeof mission.objective === 'string' && mission.objective.trim().length > 0 && mission.objective.length <= 2000
        && list(mission.intentKeys) && new Set(mission.intentKeys).size === mission.intentKeys.length
        && list(mission.successCriteria) && list(mission.handoffConditions);
}

export type AgentSetupTaskKey = 'mission' | 'channel' | 'agent' | 'business' | 'knowledge' | 'catalog' | 'team' | 'hours' | 'appointments' | 'tests';
export interface AgentSetupTask {
    key: AgentSetupTaskKey;
    status: AgentQualityCheckStatus;
    /** The same task in the one vocabulary every surface renders. `status` stays
     *  because Salud and the editor already read it; this is the projection so
     *  three screens stop saying three different words about one task. */
    state: AgentOperationalState;
    checks: AgentQualityCheck[];
    href: string;
    tourId: GuidedTourId | null;
    dependsOn: AgentSetupTaskKey[];
    channelType?: GuidedTourStartDetail['channelType'];
}

export interface AgentAssessment {
    version: 1;
    revision: string;
    generatedAt: string;
    agent: AgentQualityOverview['agent'] | null;
    overview: AgentQualityOverview | null;
    mission: {
        source: 'configured' | 'template_derived' | 'not_configured';
        templateId: string | null;
        profileId: string | null;
        definition: AgentMissionV1 | null;
        availableIntentKeys: string[];
        unsupportedIntents: string[];
    };
    /** One immutable runtime projection per assigned channel, or an explicit preview. */
    channels: Array<{ channelType: string | null; scope: 'assigned' | 'preview'; contract: EffectiveCapabilityContract | null; status: 'known' | 'unavailable';
        /** `unknown` when the projection could not be read: a channel nobody
         *  could look at is not a channel that is ready. */
        state: AgentOperationalState }>;
    tasks: AgentSetupTask[];
    /** What the agent as a whole is doing, rolled up from the parts above under
     *  the two rules that make the word mean anything: a part nobody could read
     *  never lets the whole be called operating, and one broken part is never
     *  averaged away by the green ones around it. */
    state: AgentOperationalState;
    nextTask: AgentSetupTaskKey | null;
    requiredTests: Array<{
        intentKey: string;
        toolPlan: string[];
        terminalStates: string[];
        confirmation: string;
        fallback: string;
        /** Aggregate scores cannot establish that a specific intent passed. */
        evidence: 'not_verified';
        unavailableTools: string[];
    }>;
    /** Whitelisted configuration for review; secrets and customer data never enter Assist. */
    configuration: Record<string, unknown> | null;
}

export const AGENT_SETUP_TASK_CHECKS: Readonly<Record<Exclude<AgentSetupTaskKey, 'mission' | 'catalog' | 'tests'>, readonly string[]>> = {
    channel: ['channel_assignment', 'channel_connection', 'channel_coverage', 'operational_channel_scope'],
    agent: ['agent_active', 'persona_identity', 'custom_prompt', 'fallback_message', 'behavior_rules', 'handoff_triggers'],
    business: ['business_identity', 'business_contact'],
    knowledge: ['knowledge_coverage', 'rag_knowledge', 'rag_configuration', 'tool_faqs', 'tool_policies'],
    team: ['human_handoff_route'],
    hours: ['business_hours', 'after_hours_behavior'],
    appointments: ['tool_appointments', 'test_drive_permissions', 'test_drive_service', 'test_drive_staff'],
};
