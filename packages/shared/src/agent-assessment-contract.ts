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

/**
 * Why a readiness requirement says what it says.
 *
 * A bare key told an owner nothing: `faq_content` names no table, no
 * condition and no screen. This carries the predicate the TOOL evaluates —
 * not the one the readiness check happens to run, which in thirteen of
 * eighteen cases is a different question — plus the verdict, the screen whose
 * write really moves it, and the divergence when the two disagree.
 *
 * It lives in the contract because the surfaces render it. It was reaching
 * them already, through a cast: the assessment handed its tools over as
 * `any`, so a field every screen depends on was outside the one shape they
 * are all supposed to read. The enums are `string` here on purpose — the
 * authority for their values is the API register, and a second copy of a
 * union in the contract is a second thing to keep in step.
 */
export interface ReadinessCitationV1 {
    key: string;
    /** The predicate the tool evaluates, e.g. `is_published = true`. */
    predicate: string;
    table: string;
    /** Which of active/availability/capacity/price/currency/ownership/account it decides. */
    dimensions: readonly string[];
    /** `satisfied`, `missing_data`, `read_error` — never a bare boolean. */
    verdict: string;
    /** The screen whose write moves this check, which is not always the CTA's. */
    writePath: string;
    /** Present when the shipped check decides less than its tool does. */
    auditedDivergence: {
        kind: string;
        missingDimensions: readonly string[];
        /** What a tenant experiences because of it. */
        consequence: string;
        /** The exact change that closes it. */
        correction: string;
        /** The file that has to change. */
        owner: string;
        absentColumn?: string;
    } | null;
}

/** Mirrors `buildAgentToolExplanations`; kept here so every surface reads one shape. */
export interface AgentToolExplanationV1 {
    tool: string;
    state: AgentOperationalState;
    achieves: { effect: string; commitsBusiness: boolean; confirmation: string; externalEffect: string };
    // ── READ-ONLY, BECAUSE THE PRODUCER FREEZES THEM ────────────────────
    //
    // The assessment builds these with `Object.freeze` and handed them over
    // through a cast, which is the only reason a frozen array satisfied a
    // mutable declaration. Removing the cast surfaced it. Read-only is also
    // what these are FOR: a surface renders an assessment, and one that
    // sorted a list in place would be editing a diagnosis.
    missionIntents: readonly string[];
    requires: { prerequisites: readonly string[]; readiness: readonly string[] };
    missing: {
        reason: string | null; detail: string | null; repairRoute: string | null;
        readiness: readonly string[];
    };
    /**
     * One citation per readiness requirement, in the order `requires.readiness`
     * lists them. REQUIRED: a surface that could omit it would go back to
     * printing key names, which is the state this replaced.
     */
    readinessAudit: readonly ReadinessCitationV1[];
    example: string | null;
    safeTest: { available: boolean; href: string | null };
    result: 'not_verified' | 'verified' | 'failed' | 'stale';
}

export type AgentSetupTaskKey = 'mission' | 'channel' | 'agent' | 'business' | 'knowledge' | 'catalog' | 'team' | 'hours' | 'appointments' | 'tests';
export interface AgentSetupTask {
    key: AgentSetupTaskKey;
    status: AgentQualityCheckStatus;
    /** The same task in the one vocabulary every surface renders. `status` stays
     *  because Salud and the editor already read it; this is the projection so
     *  three screens stop saying three different words about one task.
     *
     *  `null` for a task that does not apply to this business. "Does not apply"
     *  is not one of the six states and must not be squeezed into one: reporting
     *  it as `unknown` said "nobody could read this", and because `unknown`
     *  dominates the roll-up, a single inapplicable task made the whole agent
     *  permanently unreadable — a clinic with no catalogue could never be shown
     *  as operating. `status` already carries `not_applicable`; the absence of a
     *  state is what says the question was not asked. */
    state: AgentOperationalState | null;
    checks: AgentQualityCheck[];
    /** Check responsible for this task's current status and repair destination. */
    pendingCheckCode?: string;
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
        /**
         * Whether THIS task was proven, under the version being assessed.
         *
         * Aggregate scores cannot establish that a specific intent passed, which
         * is why this was a hard-coded `not_verified` — but a literal can never
         * say anything else either. `stale` is evidence from an older revision
         * of the agent: the configuration that passed is not the one on screen.
         */
        evidence: 'not_verified' | 'verified' | 'failed' | 'stale';
        /** The same answer in the vocabulary every surface shares. */
        state: AgentOperationalState;
        unavailableTools: string[];
    }>;
    /**
     * One entry per tool the mission needs or the contract published, saying
     * what it achieves, when it applies, what it needs, what is missing in the
     * words of the gate that refused it, an example from this business, whether
     * it can be exercised safely, and whether it has been shown to work.
     *
     * All of it already existed — the exclusions carry typed reasons and repair
     * routes, the domain contract knows which task uses which tool, and the eval
     * packs hold a sentence a customer of this subtype would say. It was being
     * reduced to two counts, so a switched-off tool could not be told apart from
     * one the plan excludes or one with no data behind it.
     */
    tools: AgentToolExplanationV1[];
    /** Whitelisted configuration for review; secrets and customer data never enter Assist. */
    configuration: Record<string, unknown> | null;
}

/**
 * The tasks without which the agent cannot answer a customer at all. These are
 * the day-0 essentials: the setup card on Home shows only these, in this order,
 * and only they decide whether the agent "can attend today". Everything else
 * (mission, knowledge, hours, appointments, catalog, tests) makes the agent
 * BETTER and lives in the health panel; a template-derived mission or a test
 * that was never run is unfinished polish, not a reason to tell a new owner
 * that their working agent "is not ready".
 */
export const AGENT_SETUP_ESSENTIAL_TASKS: readonly AgentSetupTaskKey[] = ['channel', 'agent', 'business', 'team'];

export function isEssentialSetupTask(key: AgentSetupTaskKey): boolean {
    return AGENT_SETUP_ESSENTIAL_TASKS.includes(key);
}

export const AGENT_SETUP_TASK_CHECKS: Readonly<Record<Exclude<AgentSetupTaskKey, 'mission' | 'catalog' | 'tests'>, readonly string[]>> = {
    channel: ['channel_assignment', 'channel_connection', 'channel_coverage', 'operational_channel_scope'],
    agent: ['agent_active', 'persona_identity', 'custom_prompt', 'fallback_message', 'behavior_rules', 'handoff_triggers'],
    business: ['business_identity', 'business_contact', 'business_context'],
    knowledge: ['knowledge_coverage', 'rag_knowledge', 'rag_configuration', 'tool_faqs', 'tool_policies', 'media_privacy_policy'],
    team: ['human_handoff_route'],
    hours: ['business_hours', 'after_hours_behavior'],
    appointments: ['tool_appointments', 'test_drive_permissions', 'test_drive_service', 'test_drive_staff'],
};
