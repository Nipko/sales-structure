/**
 * Framework-neutral wire contract for the Agent Quality Center.
 *
 * The API emits bounded codes and numeric evidence only. User-facing labels
 * are resolved through dashboard i18n so free-form judge/customer text never
 * crosses this boundary.
 */

import type { ChannelCredentialHealth } from './channel-credential-health';

export const AGENT_QUALITY_DIMENSIONS = [
    'business_scope',
    'knowledge_grounding',
    'conversation_brand',
    'actions_outcomes',
    'safety_handoff',
    'robustness_operations',
] as const;

export type AgentQualityDimension = typeof AGENT_QUALITY_DIMENSIONS[number];

export const AGENT_QUALITY_STATUSES = [
    'not_evaluated',
    'configuration_incomplete',
    'at_risk',
    'ready_for_pilot',
    'operating_with_evidence',
    'review_required',
] as const;
export type AgentQualityStatus = typeof AGENT_QUALITY_STATUSES[number];

export type AgentQualityPillar = 'preparation' | 'tested' | 'production';
export type AgentQualityCheckStatus = 'pass' | 'warning' | 'fail' | 'unknown' | 'not_applicable';
export type AgentQualityPillarStatus =
    | 'unknown'
    | 'blocked'
    | 'needs_attention'
    | 'ready'
    | 'stale'
    | 'insufficient_evidence'
    | 'evidenced';
export type AgentQualitySeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Why a WhatsApp number an agent answers cannot deliver: the `reason` of the
 * `whatsapp_delivery` check and the `deliveryIssue` of a top action. Bounded,
 * translated by the panel, never free text.
 *
 * Every value is read from the authority that actually stops the message, never
 * re-derived:
 *
 * - `funding_restricted` — Meta refused to bill the business (131042) and the
 *   send admission paused the number: every chargeable send is refused, in
 *   `observe` and in `enforce` alike.
 * - `funding_absent` — Meta answered that the WhatsApp Business Account has no
 *   payment method. From the pricing change's effective date (1-oct-2026) Meta
 *   stops delivering; before it the check is a `warning`, not a failure.
 * - `timezone_missing` — the number has no usable billing time zone, and the
 *   admission refuses every chargeable send in both modes.
 * - `currency_unknown` — the billing currency is not established AND the tenant
 *   enforces spend protection, so the admission defers every send. Under
 *   `observe` (the default) the same gap is priced as unknown and the message
 *   goes out, so it is not reported.
 */
export const WHATSAPP_DELIVERY_BLOCK_REASONS = [
    'funding_restricted',
    'funding_absent',
    'timezone_missing',
    'currency_unknown',
] as const;
export type WhatsappDeliveryBlockReason = typeof WHATSAPP_DELIVERY_BLOCK_REASONS[number];

/**
 * The recommendation codes that mean "the agent cannot answer through a
 * channel this account connected": the connection cannot send, a connected
 * channel has no agent answering it, or WhatsApp refuses every reply. The one
 * class of alert a day-0 account must see even while every other quality nag
 * waits for the first real reply, and the one the banner puts first after it.
 *
 * `fix_channel_assignment` is deliberately NOT here. "This agent has no channel
 * assigned" is a fact about one agent, not about who answers: with two active
 * agents the signup binds neither (it must not pick one), the check fails for
 * both, and the pipeline still delivers every message to the default agent.
 * Listing it put a red "your agent can't answer the channel you connected" over
 * an agent that was answering, and could win `deliveryAction` over the real
 * WhatsApp reason. Whether ANYBODY answers a connected channel is
 * `fix_channel_unanswered`, computed with the pipeline's own resolution.
 *
 * One list for the API (which picks `deliveryAction` from it) and the panel
 * (which decides what the banner puts first), so they cannot disagree.
 */
export const AGENT_QUALITY_DELIVERY_FAILURE_CODES = [
    'fix_channel_connection',
    'fix_channel_unanswered',
    'fix_whatsapp_delivery',
] as const;
export type AgentQualityDeliveryFailureCode = typeof AGENT_QUALITY_DELIVERY_FAILURE_CODES[number];

export type AgentQualityNextMilestone =
    | 'complete_configuration'
    | 'pass_critical_tests'
    | 'collect_production_evidence'
    | 'maintain_quality';

export interface AgentQualityAgentSummary {
    id: string;
    name: string;
    is_default: boolean;
    is_active: boolean;
}

export interface AgentQualityCheck {
    code: string;
    dimension: AgentQualityDimension;
    status: AgentQualityCheckStatus;
    critical: boolean;
    weight: number;
    href?: string;
    evidence?: Record<string, string | number | boolean | null>;
}

export interface AgentQualityDimensionResult {
    dimension: AgentQualityDimension;
    score: number | null;
    status: AgentQualityPillarStatus;
    passed: number;
    applicable: number;
    checks: AgentQualityCheck[];
}

export interface AgentQualityPreparationPillar {
    status: AgentQualityPillarStatus;
    score: number | null;
    passed: number;
    applicable: number;
    criticalBlockers: string[];
    dimensions: AgentQualityDimensionResult[];
}

export interface AgentQualityEvalEvidence {
    runId: string;
    createdAt: string;
    trigger: string | null;
    passed: boolean;
    score: number;
    threshold: number;
    trials: number;
    activable: boolean;
}

export interface AgentQualitySimulationEvidence {
    runId: string;
    createdAt: string;
    completedAt: string | null;
    scenarioCount: number;
    averageScore: number;
    resolvedRate: number | null;
    source: string;
}

export interface AgentQualityTestedPillar {
    status: AgentQualityPillarStatus;
    score: number | null;
    stale: boolean;
    staleReasons: string[];
    latestEval: AgentQualityEvalEvidence | null;
    latestSimulation: AgentQualitySimulationEvidence | null;
}

export interface AgentQualityProductionMetric {
    code: string;
    value: number | null;
    numerator?: number;
    denominator?: number;
    unit: 'percent' | 'score_10' | 'milliseconds' | 'count';
}

export interface AgentQualityProductionIssue {
    code: string;
    label: string;
    count: number;
    conversationIds: string[];
}

export interface AgentQualityProductionPillar {
    status: AgentQualityPillarStatus;
    observedScore: number | null;
    sampleSize: number;
    minimumSample: number;
    periodDays: number;
    attributedSince: string | null;
    metrics: AgentQualityProductionMetric[];
    topIssues: AgentQualityProductionIssue[];
}

export interface AgentQualityRecommendation {
    code: string;
    pillar: AgentQualityPillar;
    dimension: AgentQualityDimension;
    severity: AgentQualitySeverity;
    href: string;
    evidenceCount?: number;
    conversationIds?: string[];
    params?: Record<string, string | number | boolean | null>;
    /**
     * Status of the preparation check this recommendation fixes. `unknown`
     * means the check could not be run — a lookup failed — which is not the
     * same as `fail`, although both are `critical` on a critical check. Absent
     * on the tested and production recommendations, which have no check.
     */
    checkStatus?: AgentQualityCheckStatus;
}

export interface AgentQualityOverview {
    generatedAt: string;
    agent: {
        id: string;
        name: string;
        version: number;
        isActive: boolean;
        updatedAt: string;
    };
    status: AgentQualityStatus;
    nextMilestone: AgentQualityNextMilestone;
    preparation: AgentQualityPreparationPillar;
    tested: AgentQualityTestedPillar;
    production: AgentQualityProductionPillar;
    recommendations: AgentQualityRecommendation[];
}

/**
 * Durable, bounded attention signals derived from an AgentQualityOverview.
 *
 * This contract deliberately excludes transcripts, judge prose, prompts,
 * retrieval queries and conversation identifiers. Those details stay behind
 * their purpose-built, tenant-authorized surfaces.
 */
export type AgentQualitySignalState =
    | 'open'
    | 'acknowledged'
    | 'snoozed'
    | 'resolved'
    | 'superseded';

export interface AgentQualitySignal extends AgentQualitySignalDetail {
    id: string;
    agent: {
        id: string;
        name: string;
        version: number;
    };
    code: string;
    severity: AgentQualitySeverity;
    pillar: AgentQualityPillar;
    dimension: AgentQualityDimension;
    state: AgentQualitySignalState;
    href: string;
    evidenceCount: number;
    firstSeenAt: string;
    lastSeenAt: string;
    occurrenceCount: number;
    acknowledgedAt?: string;
    snoozedUntil?: string;
}

/**
 * What a signal says beyond its code and severity, so a reader can tell apart
 * outcomes that share both. All optional and additive: a signal persisted
 * before these existed simply has none of them, and a reader must treat that
 * as "not known", never as `fail`.
 */
export interface AgentQualitySignalDetail {
    /**
     * Status of the preparation check behind the signal. A critical check that
     * FAILED and one that could not be CHECKED (a channel lookup that errored)
     * both surface as `critical`; this is how they are told apart.
     */
    checkStatus?: AgentQualityCheckStatus;
    /**
     * `channel_connection` only: which credential problem makes the channel
     * unable to send (`expired`, `revoked`, `missing`, …), or `multiple`.
     */
    credentialIssue?: ChannelCredentialHealth | 'multiple';
    /**
     * `whatsapp_delivery` only: why the WhatsApp number cannot deliver, or
     * `multiple` when numbers fail for different reasons.
     */
    deliveryIssue?: WhatsappDeliveryBlockReason | 'multiple';
}

export interface AgentQualityAttentionAgent {
    id: string;
    name: string;
    version: number;
    status: AgentQualityStatus;
    criticalCount: number;
    highCount: number;
    topSignalCode?: string;
}

/** One persisted signal as the attention summary exposes it. */
export type AgentQualityAttentionAction = {
    signalId: string;
    agentId: string;
    agentName: string;
    code: string;
    severity: AgentQualitySeverity;
    href: string;
    evidenceCount: number;
} & AgentQualitySignalDetail;

export interface AgentQualityAttentionSummary {
    generatedAt: string;
    worstStatus: AgentQualityStatus | null;
    agentsTotal: number;
    /** Active agents with at least one snapshot for their current config version. */
    evaluatedAgents: number;
    agentsNeedingAttention: number;
    openCritical: number;
    openHigh: number;
    /** Number used by global badges: open critical + high signals only. */
    attentionCount: number;
    /**
     * The one action the banner shows. `checkStatus`, `credentialIssue` and
     * `deliveryIssue` ({@link AgentQualitySignalDetail}) are optional and
     * additive: present only where they exist and where the signal was stored
     * with them.
     */
    topAction?: AgentQualityAttentionAction;
    /**
     * The most urgent open CRITICAL signal whose code is in
     * {@link AGENT_QUALITY_DELIVERY_FAILURE_CODES}, even when `topAction` is
     * something else. `topAction` is one row ordered by severity and recency, so
     * a delivery failure could sit behind an unrelated critical (a missing
     * business description) that the day-0 banner hides — and the silent agent
     * would never be explained. A failed check outranks one that could not be
     * run. Absent when there is none. Optional and additive.
     */
    deliveryAction?: AgentQualityAttentionAction;
    agents: AgentQualityAttentionAgent[];
}
