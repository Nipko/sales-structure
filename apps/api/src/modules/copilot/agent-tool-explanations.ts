import { composeSubtypeEvalPack, localizeCapabilityText, rollUpOperationalState, TOOL_GROUP_READINESS,
    type AgentOperationalState, type EffectiveCapabilityContract,
    type VerticalDomainContractV2, type VerticalToolGroup } from '@parallext/shared';
import { TOOL_POLICY_REGISTRY, toolOrigin } from '../conversations/tool-policy-registry';
import { TOOL_FAMILIES } from '../conversations/agent-tool-registry';
import { PAYMENT_CREATE_TOOLS, PAYMENT_STATUS_TOOLS, REFUND_PAYMENT_TOOL } from '../conversations/tools/payment-tools';
import { APPLY_DISCOUNT_TOOL } from '../conversations/tools/ecommerce-tools';
import { CORE_PREREQUISITES } from '../conversations/tool-task-dependencies';
import { PROVIDER_INTEGRATION_POLICIES } from '../conversations/effective-capability.service';
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

/** Exact ownership from the same definitions the runtime publishes. */
function exclusionFamilies(tool: string): ReadonlySet<string> {
    const families = new Set(TOOL_FAMILIES.filter(family => family.tools.some(definition => definition.name === tool))
        .map(family => String(family.key)));
    if ([...PAYMENT_CREATE_TOOLS, ...PAYMENT_STATUS_TOOLS, REFUND_PAYMENT_TOOL].some(definition => definition.name === tool)) {
        families.add('payments');
    }
    if (tool === APPLY_DISCOUNT_TOOL.name) families.add('ecommerce');
    if (toolOrigin(tool) === 'mcp') families.add('mcp');
    for (const policy of Object.values(PROVIDER_INTEGRATION_POLICIES)) {
        if (policy.tools.includes(tool)) families.add(policy.toolGroup);
    }
    return families;
}

function providerSubjects(tool: string): ReadonlySet<string> {
    return new Set(Object.entries(PROVIDER_INTEGRATION_POLICIES)
        .filter(([, policy]) => policy.tools.includes(tool)).map(([name]) => name));
}

/** Provider reads have their own health gate, not a native-table prerequisite. */
function readinessForTools(tools: readonly string[]): readonly string[] {
    return [...new Set(tools.flatMap(tool => TOOL_FAMILIES
        .filter(family => family.tools.some(definition => definition.name === tool))
        .map(family => TOOL_GROUP_READINESS[family.key as VerticalToolGroup])
        .filter((key): key is NonNullable<typeof key> => !!key)))];
}

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
        // Fixtures require the evaluation snapshot, which the explanation does
        // not own. Do not expose placeholders or invent tenant data to fill them.
        return typeof first === 'string' && first.trim() && !/\{\{|\}\}|\[EVAL\]/i.test(first)
            ? first : null;
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
    /** Explain the same tool universe on each real channel before aggregating. */
    toolNames?: readonly string[];
}): readonly AgentToolExplanation[] {
    const language = input.language || 'es';
    const intents = input.domain.intents.filter(intent => input.missionIntentKeys.includes(intent.key));
    // Every tool the mission needs, plus everything the contract published for
    // it: a tool that is published and used by no task is worth seeing too.
    const wanted = new Set<string>([
        ...intents.flatMap(intent => intent.toolPlan),
        ...(input.contract?.publishedTools ?? []),
        ...(input.toolNames ?? []),
    ]);
    const published = new Set(input.contract?.publishedTools ?? []);
    const excluded = input.contract?.excluded ?? [];

    return Object.freeze([...wanted].sort().map(tool => {
        const policy = (TOOL_POLICY_REGISTRY as any)[tool];
        const using = intents.filter(intent => intent.toolPlan.includes(tool));
        const prerequisites = CORE_PREREQUISITES[tool] ?? [];
        const readiness = readinessForTools([tool, ...prerequisites]);
        const missingReadiness = (input.contract?.unmetReadiness ?? []).filter(key => readiness.includes(key));
        // A writer displaced by an external system can be named in a list;
        // prefer that specific decision over a broad family exclusion. A family
        // name is not a substring contract: appointments owns check_availability.
        const families = exclusionFamilies(tool);
        const providers = providerSubjects(tool);
        const exclusion = excluded.find(entry => entry.subject === tool)
            ?? excluded.find(entry => entry.subject.split(',').some(subject => subject.trim() === tool))
            ?? excluded.find(entry => providers.has(entry.subject))
            ?? excluded.find(entry => families.has(entry.subject));
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
                readiness: Object.freeze([...readiness]),
            }),
            missing: Object.freeze({
                reason: exclusion?.reason ?? null,
                detail: exclusion ? localizeCapabilityText(exclusion.detail, language) : null,
                repairRoute: exclusion?.repairRoute ?? null,
                readiness: Object.freeze(missingReadiness),
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
