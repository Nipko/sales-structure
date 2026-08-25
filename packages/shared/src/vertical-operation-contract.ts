import type { ActiveObjectKind } from './index';
import type { VerticalAssuranceLevel, VerticalPrimaryObject } from './vertical-capability-manifest';
import type { SorBoundaryKind, SorConflictMode, SorFreshnessMode } from './system-of-record-policy';

/** Versioned projection of action/object/permission/readiness/SoR controls. */
export const VERTICAL_OPERATION_CONTRACT_VERSION = 1 as const;

export interface VerticalOperationActionV1 {
    tool: string;
    intentKeys: readonly string[];
    family: string | null;
    effect: 'read' | 'write' | 'conditional_write' | 'unknown';
    commitsBusiness: boolean;
    primaryObject: VerticalPrimaryObject;
    activeObject: ActiveObjectKind | null;
    deepLink: string | null;
    permission: {
        familyEnabled: string | null;
        subpermission: string | null;
    };
    readiness: string | null;
    assurance: VerticalAssuranceLevel | null;
    confirmation: string;
    humanApproval: string;
    idempotency: string;
    ownership: string;
    externalEffect: string;
    systemOfRecord: {
        boundary: SorBoundaryKind;
        owner: 'parallly' | 'conditional_binding' | 'external_provider';
        freshness: SorFreshnessMode;
        conflict: SorConflictMode;
        providerKinds: readonly string[];
    };
    gaps: readonly string[];
}

export interface VerticalOperationContractV1 {
    version: typeof VERTICAL_OPERATION_CONTRACT_VERSION;
    profileId: string;
    manifestVersion: number;
    domainContractVersion: number;
    primaryObject: VerticalPrimaryObject;
    actions: readonly VerticalOperationActionV1[];
    gaps: readonly string[];
}

export interface ToolControlCatalogEntryV1 {
    tool: string;
    family: string | null;
    effect: string;
    commitsBusiness: boolean;
    assurance: VerticalAssuranceLevel;
    confirmation: string;
    humanApproval: string;
    idempotency: string;
    ownership: string;
    externalEffect: string;
    activeObject: ActiveObjectKind | null;
    deepLink: string | null;
    subpermission: { family: string; flag: string } | null;
    gaps: readonly string[];
}

export interface ToolControlCatalogV1 {
    version: typeof VERTICAL_OPERATION_CONTRACT_VERSION;
    entries: readonly ToolControlCatalogEntryV1[];
}
