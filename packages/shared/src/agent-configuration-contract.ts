import type { AgentMissionV1, AgentAssessment } from './agent-assessment-contract';
import type { SavedAgentDraft } from './agent-draft-contract';
import { VERTICAL_TOOL_GROUPS } from './vertical-capability-manifest';

export const AGENT_CONFIG_TOOL_FAMILIES = [...VERTICAL_TOOL_GROUPS, 'knowledge', 'policies', 'orders', 'crm', 'offers', 'ecommerce', 'payments'] as const;
export const AGENT_ACCOUNT_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export interface AgentAccountBusinessHours {
    is247: boolean;
    timezone: string;
    schedule: Record<typeof AGENT_ACCOUNT_DAYS[number], { enabled: boolean; open: string; close: string }>;
    afterHoursMessage: string;
}
export function isAgentAccountBusinessHours(value: unknown): value is AgentAccountBusinessHours {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const hours = value as AgentAccountBusinessHours;
    if (Object.keys(value).some(key => !['is247', 'timezone', 'schedule', 'afterHoursMessage'].includes(key))
        || typeof hours.is247 !== 'boolean' || typeof hours.timezone !== 'string' || hours.timezone.length > 100
        || typeof hours.afterHoursMessage !== 'string' || hours.afterHoursMessage.length > 2000
        || (!hours.is247 && !hours.afterHoursMessage.trim()) || !hours.schedule || typeof hours.schedule !== 'object'
        || Object.keys(hours.schedule).length !== 7) return false;
    try { new Intl.DateTimeFormat('en', { timeZone: hours.timezone }).format(); } catch { return false; }
    const time = (value: unknown) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    return AGENT_ACCOUNT_DAYS.every(day => {
        const item = hours.schedule[day];
        return item && typeof item === 'object' && Object.keys(item).every(key => ['enabled', 'open', 'close'].includes(key))
            && typeof item.enabled === 'boolean' && time(item.open) && time(item.close)
            && (!item.enabled || item.open < item.close);
    }) && (hours.is247 || AGENT_ACCOUNT_DAYS.some(day => hours.schedule[day].enabled));
}

/** Reviewed reversible settings. Credentials and connection bindings are excluded. */
export const AGENT_CONFIGURATION_PATHS = [
    'persona.name', 'persona.role', 'persona.greeting', 'persona.fallbackMessage',
    'persona.personality.tone', 'persona.personality.formality',
    'behavior.rules', 'behavior.forbiddenTopics', 'behavior.handoffTriggers', 'mission',
    'account.businessHours',
    ...AGENT_CONFIG_TOOL_FAMILIES.map(family => `tools.${family}.enabled` as const),
    'tools.appointments.canBook', 'tools.appointments.canCancel', 'tools.catalog.canCheckStock', 'tools.ecommerce.canRecommend', 'tools.payments.canCreateLinks',
] as const;
export type AgentConfigurationPath = typeof AGENT_CONFIGURATION_PATHS[number];
export interface AgentConfigurationChange { path: AgentConfigurationPath; value: string | string[] | boolean | AgentMissionV1 | AgentAccountBusinessHours }
export interface AgentConfigurationProposal {
    id: string;
    agentId: string;
    agentName: string;
    expectedVersion: number;
    targetScope: 'agent_draft' | 'account';
    expectedDraftRevision: string | null;
    digest: string;
    status: 'proposed' | 'applied' | 'expired';
    expiresAt: string;
    changes: Array<AgentConfigurationChange & { before: unknown }>;
    appliedVersion?: number;
    appliedDraftRevision?: string;
}
export type AppliedDraftVerificationState =
    /**
     * The applied revision itself ran the real turn pipeline with tools disabled
     * and answered. It is a smoke check of the edited configuration, not proof
     * that each mission task passes — task-level proof stays in
     * `AgentAssessment.requiredTests`, which only counts sealed release runs.
     */
    | 'verified'
    /** The run happened and produced no usable answer: the edit is saved and does not reply. */
    | 'failed'
    /** No run was possible here. Nothing was proven, so it can never be reported as `verified`. */
    | 'unavailable'
    /** There is no draft to exercise: the proposal changed tenant account settings. */
    | 'not_applicable';

export type AppliedDraftVerificationReason =
    | 'account_scope'
    | 'runner_unavailable'
    | 'revision_changed'
    | 'quota_exhausted'
    | 'timed_out'
    | 'empty_reply'
    /**
     * The run could not complete: no provider configured, a provider error, a
     * snapshot that is no longer executable. Deliberately coarse — the apply
     * path cannot tell those apart, and naming one of them would put a cause in
     * a receipt that nothing established.
     */
    | 'run_failed';

/**
 * Evidence about the configuration that was just applied.
 *
 * `assessmentScope: 'operational'` marks the assessment as describing the
 * configuration that keeps serving customers — the one the edit did not touch.
 * This is the other half, and the only field in the receipt that answers "did
 * that break anything?". It carries the revision it was produced against so it
 * expires on its own: the moment the draft moves past `revisionId`, this says
 * nothing about the current draft.
 */
export interface AppliedDraftVerification {
    /** Never 'operational'. Evidence here is about the edited revision alone. */
    scope: 'applied_draft';
    state: AppliedDraftVerificationState;
    revisionId: string | null;
    revisionHash: string | null;
    reason: AppliedDraftVerificationReason | null;
    checkedAt: string;
}

export interface AppliedAgentConfiguration {
    proposal: AgentConfigurationProposal;
    assessment: AgentAssessment | null;
    /**
     * Whether the apply itself finished cleanly — caches invalidated, the saved
     * draft or the operational assessment readable. It says nothing about how
     * the agent behaves: `draftVerification` is the field that answers that, and
     * neither value here may be read as behavioural evidence.
     */
    verification: 'verified' | 'unavailable';
    /** Operational assessment must never be presented as evidence for the edited draft. */
    assessmentScope: 'operational';
    /** Scoped to the applied revision, so it is never confused with `assessment`. */
    draftVerification: AppliedDraftVerification;
    draft?: SavedAgentDraft;
}
