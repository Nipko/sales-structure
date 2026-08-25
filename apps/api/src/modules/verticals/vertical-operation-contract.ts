import {
    TOOL_GROUP_READINESS,
    VERTICAL_OPERATION_CONTRACT_VERSION,
    buildDomainContractDraft,
    deepLinkForActiveObject,
    profileSystemOfRecordDeclaration,
    resolveSubtypeExperienceProfile,
    type ToolControlCatalogV1,
    type VerticalOperationActionV1,
    type VerticalOperationContractV1,
    type VerticalToolGroup,
} from '@parallext/shared';
import {
    STATIC_TOOL_NAMES,
    TOOL_POLICY_REGISTRY,
    getMissingToolControls,
    getToolPolicy,
} from '../conversations/tool-policy-registry';
import {
    toolFamilyForTool,
    toolSubpermissionForTool,
} from '../conversations/agent-tool-registry';
import { WRITER_ACTIVE_OBJECTS } from '../conversations/writer-active-object';

const NATIVE_SOR = Object.freeze({
    boundary: 'native' as const,
    owner: 'parallly' as const,
    freshness: 'transactional' as const,
    conflict: 'native_atomic' as const,
    providerKinds: Object.freeze([] as string[]),
});

function unique(values: readonly string[]): string[] {
    return [...new Set(values)];
}

/**
 * Compose existing executable registries; never author a second tool policy.
 * Missing links are returned as gaps so promotion fails visibly.
 */
export function buildVerticalOperationContract(
    industry: string,
    subtype?: string | null,
): VerticalOperationContractV1 {
    const profile = resolveSubtypeExperienceProfile(industry, subtype);
    const domain = buildDomainContractDraft(profile.industry, profile.subtype);
    const sor = profileSystemOfRecordDeclaration(profile.id);
    const sorSnapshot = sor ? {
        boundary: sor.boundary,
        owner: sor.owner,
        freshness: sor.freshness.mode,
        conflict: sor.conflict,
        providerKinds: Object.freeze([...sor.providerKinds]),
    } : NATIVE_SOR;

    const intentKeysByTool = new Map<string, string[]>();
    for (const intent of domain.intents) {
        for (const tool of intent.toolPlan) {
            const keys = intentKeysByTool.get(tool) || [];
            keys.push(intent.key);
            intentKeysByTool.set(tool, keys);
        }
    }

    const actions: VerticalOperationActionV1[] = [];
    for (const [tool, intentKeys] of intentKeysByTool) {
        const policy = getToolPolicy(tool);
        const family = toolFamilyForTool(tool) || null;
        const subpermission = toolSubpermissionForTool(tool);
        const object = WRITER_ACTIVE_OBJECTS[tool]?.kind ?? null;
        const gaps: string[] = [];
        if (!policy) gaps.push('tool_policy_missing');
        if (policy?.commitsBusiness && !Object.prototype.hasOwnProperty.call(WRITER_ACTIVE_OBJECTS, tool)) {
            gaps.push('active_object_classification_missing');
        }
        if (policy?.idempotency === 'missing') gaps.push('idempotency_missing');
        if (policy?.confirmation === 'required_missing') gaps.push('confirmation_missing');
        if (policy?.humanApproval === 'required_missing') gaps.push('human_approval_missing');

        const readiness = family && Object.prototype.hasOwnProperty.call(TOOL_GROUP_READINESS, family)
            ? TOOL_GROUP_READINESS[family as VerticalToolGroup] || null
            : null;
        actions.push(Object.freeze({
            tool,
            intentKeys: Object.freeze(unique(intentKeys)),
            family,
            effect: policy?.effect || 'unknown',
            commitsBusiness: policy?.commitsBusiness === true,
            primaryObject: profile.capability.primaryObject,
            activeObject: object,
            deepLink: object ? deepLinkForActiveObject(object) : null,
            permission: Object.freeze({
                familyEnabled: family,
                subpermission: subpermission?.flag || null,
            }),
            readiness,
            assurance: policy?.assurance || null,
            confirmation: policy?.confirmation || 'unknown',
            humanApproval: policy?.humanApproval || 'unknown',
            idempotency: policy?.idempotency || 'unknown',
            ownership: policy?.ownership || 'unknown',
            externalEffect: policy?.externalEffect || 'unknown',
            systemOfRecord: Object.freeze(sorSnapshot),
            gaps: Object.freeze(gaps),
        }));
    }

    const gaps = unique([
        ...domain.unresolved,
        ...actions.flatMap(action => action.gaps.map(gap => `${action.tool}.${gap}`)),
    ]);
    return Object.freeze({
        version: VERTICAL_OPERATION_CONTRACT_VERSION,
        profileId: profile.id,
        manifestVersion: profile.manifestVersion,
        domainContractVersion: domain.contractVersion,
        primaryObject: profile.capability.primaryObject,
        actions: Object.freeze(actions),
        gaps: Object.freeze(gaps),
    });
}

/** Global writer/control inventory used by Ops and contract tests. */
export function buildToolControlCatalog(): ToolControlCatalogV1 {
    const missingByTool = new Map(
        getMissingToolControls().map(entry => [entry.name, entry.missing]),
    );
    const entries = STATIC_TOOL_NAMES.map((tool) => {
        const policy = TOOL_POLICY_REGISTRY[tool];
        const family = toolFamilyForTool(tool) || null;
        const subpermission = toolSubpermissionForTool(tool) || null;
        const object = WRITER_ACTIVE_OBJECTS[tool]?.kind ?? null;
        return Object.freeze({
            tool,
            family,
            effect: policy.effect,
            commitsBusiness: policy.commitsBusiness,
            assurance: policy.assurance,
            confirmation: policy.confirmation,
            humanApproval: policy.humanApproval,
            idempotency: policy.idempotency,
            ownership: policy.ownership,
            externalEffect: policy.externalEffect,
            activeObject: object,
            deepLink: object ? deepLinkForActiveObject(object) : null,
            subpermission,
            gaps: Object.freeze([...(missingByTool.get(tool) || [])]),
        });
    });
    return Object.freeze({
        version: VERTICAL_OPERATION_CONTRACT_VERSION,
        entries: Object.freeze(entries),
    });
}
