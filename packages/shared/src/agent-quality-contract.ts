/**
 * Framework-neutral wire contract for the Agent Quality Center.
 *
 * The API emits bounded codes and numeric evidence only. User-facing labels
 * are resolved through dashboard i18n so free-form judge/customer text never
 * crosses this boundary.
 */

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
    resolvedRate: number;
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

export interface AgentQualitySignal {
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

export interface AgentQualityAttentionAgent {
    id: string;
    name: string;
    version: number;
    status: AgentQualityStatus;
    criticalCount: number;
    highCount: number;
    topSignalCode?: string;
}

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
    topAction?: {
        signalId: string;
        agentId: string;
        agentName: string;
        code: string;
        severity: AgentQualitySeverity;
        href: string;
        evidenceCount: number;
    };
    agents: AgentQualityAttentionAgent[];
}
