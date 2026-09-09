import { composeSubtypeEvalPack, localizeCapabilityText, rollUpOperationalState,
    type AgentOperationalState, type EffectiveCapabilityContract,
    type VerticalDomainContractV2 } from '@parallext/shared';
import { TOOL_POLICY_REGISTRY } from '../conversations/tool-policy-registry';
import { CORE_PREREQUISITES } from '../conversations/tool-task-dependencies';
import type { IntentEvidence } from '../simulation/agent-release-evidence';

/**
 * What one tool is for, said in full.
 *
 * The capability contract already carries every exclusion with a typed reason,
 * a localized explanation and the route where the tenant fixes it; the domain
 * contract knows which task uses which tool; the eval packs hold a sentence a
 * customer would actually say. The editor reduced all of it to a title, a
 * one-line description and a toggle, and the assessment panel to two counts —
 * so a tenant looking at a switched-off tool could not tell "your plan does not
 * include this" from "you have no products loaded" from "this does not apply to
 * your business", which are three completely different things to do next.
 *
 * Nothing here is new information. It is the information that already existed,
 * assembled per tool instead of thrown away.
 */

export interface AgentToolExplanation {
    readonly tool: string;
    readonly state: AgentOperationalState;
    /** What it achieves: the effect, and whether it commits the business. */
    readonly achieves: {
        readonly effect: string;
        readonly commitsBusiness: boolean;
        readonly confirmation: string;
        readonly externalEffect: string;
    };
    /** When it applies to the mission: the tasks whose plan names it. */
    readonly missionIntents: readonly string[];
    /** What it needs before it can work. */
    readonly requires: {
        readonly prerequisites: readonly string[];
        readonly readiness: readonly string[];
    };
    /** What is missing, in the words of the gate that refused it. */
    readonly missing: {
        readonly reason: string | null;
        readonly detail: string | null;
        readonly repairRoute: string | null;
        readonly readiness: readonly string[];
    };
    /** A sentence from this business, not a generic one. */
    readonly example: string | null;
    /** Whether it can be exercised without touching a customer. */
    readonly safeTest: { readonly available: boolean; readonly href: string | null };
    /** Whether it has actually been shown to work, and under which version. */
    readonly result: IntentEvidence;
}

const NOT_PUBLISHED_STATES: Readonly<Record<string, AgentOperationalState>> = Object.freeze({
    // The tenant can act on these; they are pending, not broken.
    plan_missing_feature: 'pending',
    readiness_unmet: 'pending',
    agent_disabled: 'pending',
    not_approved: 'pending',
    // These say the tool will not apply here at all.
    not_in_subtype: 'pending',
    external_system_of_record: 'pending',
    role_not_operational: 'pending',
    channel_not_certified: 'pending',
    profile_blocked: 'pending',
    // Something that used to work stopped.
    provider_unavailable: 'degraded',
});

/**
 * A sentence a customer of THIS business would say for this task.
 *
 * Taken from the canonical positive case of the eval pack, which is written per
 * subtype — so a dentist reads about a consultation and a workshop reads about a
 * repair, instead of both reading the same invented example.
 */
function businessExample(profileId: string | null, intentKey: string | undefined,
    language: string): string | null {
    if (!profileId || !intentKey) return null;
    const [industry, subtype] = profileId.split('/');
    if (!industry || !subtype) return null;
    try {
        const pack = composeSubtypeEvalPack({ industry, subtype, language });
        const canonical = pack.find(scenario => scenario.key.startsWith(`intent_${intentKey}_canonical_`))
            ?? pack.find(scenario => scenario.key.startsWith(`intent_${intentKey}_`));
        const first = canonical?.messages?.[0];
        return typeof first === 'string' && first.trim() ? first : null;
    } catch { return null; }
}

export function buildAgentToolExplanations(input: {
    contract: EffectiveCapabilityContract | null;
    domain: VerticalDomainContractV2;
    missionIntentKeys: readonly string[];
    /** Per intent, what the stored runs prove. */
    evidenceByIntent: Readonly<Record<string, IntentEvidence>>;
    agentId: string;
    language?: string;
    /** Tools Agent Test may exercise without reaching a customer. */
    safeToolNames: ReadonlySet<string>;
}): readonly AgentToolExplanation[] {
    const language = input.language || 'es';
    const intents = input.domain.intents.filter(intent => input.missionIntentKeys.includes(intent.key));
    // Every tool the mission needs, plus everything the contract published for
    // it: a tool that is published and used by no task is worth seeing too.
    const wanted = new Set<string>([
        ...intents.flatMap(intent => intent.toolPlan),
        ...(input.contract?.publishedTools ?? []),
    ]);
    const published = new Set(input.contract?.publishedTools ?? []);
    const excluded = new Map((input.contract?.excluded ?? []).map(entry => [entry.subject, entry]));

    return Object.freeze([...wanted].sort().map(tool => {
        const policy = (TOOL_POLICY_REGISTRY as any)[tool];
        const using = intents.filter(intent => intent.toolPlan.includes(tool));
        const prerequisites = CORE_PREREQUISITES[tool] ?? [];
        // A family exclusion names the family, a tool exclusion names the tool.
        const exclusion = excluded.get(tool)
            ?? [...excluded.values()].find(entry => tool.includes(entry.subject));
        const evidence = using.map(intent => input.evidenceByIntent[intent.key] ?? 'not_verified');
        const worstEvidence: IntentEvidence = evidence.includes('failed') ? 'failed'
            : evidence.includes('not_verified') || !evidence.length ? 'not_verified'
                : evidence.includes('stale') ? 'stale' : 'verified';

        const state: AgentOperationalState = !input.contract ? 'unknown'
            : input.contract.degraded ? 'unknown'
                : !published.has(tool)
                    ? (exclusion ? NOT_PUBLISHED_STATES[exclusion.reason] ?? 'pending' : 'pending')
                    : worstEvidence === 'verified' ? 'operating'
                        : worstEvidence === 'failed' ? 'degraded'
                            : worstEvidence === 'stale' ? 'degraded' : 'prepared';

        return Object.freeze({
            tool,
            state,
            achieves: Object.freeze({
                effect: policy?.effect ?? 'unknown',
                commitsBusiness: policy?.commitsBusiness === true,
                confirmation: policy?.confirmation ?? 'unknown',
                externalEffect: policy?.externalEffect ?? 'unknown',
            }),
            missionIntents: Object.freeze(using.map(intent => intent.key)),
            requires: Object.freeze({
                prerequisites: Object.freeze([...prerequisites]),
                readiness: Object.freeze([...(input.contract?.unmetReadiness ?? [])]
                    .filter(() => !!exclusion && exclusion.reason === 'readiness_unmet')),
            }),
            missing: Object.freeze({
                reason: exclusion?.reason ?? null,
                detail: exclusion ? localizeCapabilityText(exclusion.detail, language) : null,
                repairRoute: exclusion?.repairRoute ?? null,
                readiness: Object.freeze([...(input.contract?.unmetReadiness ?? [])]),
            }),
            example: businessExample(input.contract?.subtypeProfileId ?? null, using[0]?.key, language),
            safeTest: Object.freeze({
                available: input.safeToolNames.has(tool),
                href: input.safeToolNames.has(tool) ? `/admin/agent/${input.agentId}/test` : null,
            }),
            result: worstEvidence,
        });
    }));
}

/** The state of the toolset as a whole, under the same two rules as everything else. */
export function rollUpToolExplanations(explanations: readonly AgentToolExplanation[]): AgentOperationalState {
    return rollUpOperationalState(explanations.map(entry => entry.state));
}
