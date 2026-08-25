import type { CountryMarketPolicyV1, CountryPackStatus } from './tenant-regional-profile';
import type { IntentContract, SlotSchema } from './vertical-domain-contract';

/** Versioned, auditable composition of every profile-authoring dimension. */
export const VERTICAL_AUTHORING_PACKAGE_VERSION = 1 as const;

export type AuthoringSourceKind =
    | 'profile_explicit'
    | 'manifest_explicit'
    | 'domain_derived'
    | 'operation_derived'
    | 'vertical_default'
    | 'universal_component'
    | 'country_overlay'
    | 'legacy_alias'
    | 'unresolved';

export interface AuthoringSource {
    kind: AuthoringSourceKind;
    /** Stable registry/component path, never a prose-only explanation. */
    reference: string;
    /** True when a broader default is used for this exact profile. */
    inherited: boolean;
    /** Human/domain review remains necessary before promotion. */
    expertReviewRequired: boolean;
}

export interface AuthoredField<T> {
    value: T;
    source: AuthoringSource;
}

export type AuthoringTemplateKind =
    | 'welcome'
    | 'discovery'
    | 'confirmation'
    | 'blocked'
    | 'handoff'
    | 'success'
    | 'follow_up';

export interface AuthoringNavigationItemV1 {
    id: string;
    route: string;
    order: number;
    classification: 'daily_work' | 'catalog' | 'supporting';
    labels: Readonly<Record<string, string>> | null;
    roles: readonly string[];
    mobileProjection: 'capability_workspace' | 'web_only';
}

export interface AuthoringToolGapV1 {
    tool: string;
    reasons: readonly string[];
}

export interface VerticalAuthoringPackageV1 {
    version: typeof VERTICAL_AUTHORING_PACKAGE_VERSION;
    packageId: string;
    requestedProfileId: string;
    profileId: string;
    profileVersion: number;
    manifestVersion: number;
    domainContractVersion: number;
    operationContractVersion: number;
    compatibility: {
        legacy: boolean;
        resolvesTo: string;
        migrationNote: string | null;
    };
    identity: {
        business: AuthoredField<{ industry: string; subtype: string; personaRole: Readonly<Record<string, string>> }>;
        targetCustomer: AuthoredField<Readonly<Record<string, string>>>;
        jobsToBeDone: AuthoredField<readonly string[]>;
    };
    objects: {
        primary: AuthoredField<string>;
        related: AuthoredField<readonly string[]>;
    };
    commercial: {
        scope: AuthoredField<string>;
        claims: AuthoredField<readonly string[]>;
        exclusions: AuthoredField<readonly string[]>;
        availability: string;
    };
    intents: {
        all: readonly IntentContract[];
        informational: readonly string[];
        guided: readonly string[];
        transactional: readonly string[];
        regulated: readonly string[];
    };
    slots: {
        all: readonly SlotSchema[];
        required: readonly string[];
        optional: readonly string[];
        sensitive: readonly string[];
        derived: readonly string[];
        /** L1 owns the universal deny-list; profiles may only add to it. */
        prohibitedComponent: 'l1.privacy.prohibited_data';
    };
    authority: {
        sourcesOfTruth: ReadonlyArray<{
            tool: string;
            owner: string;
            boundary: string;
            freshness: string;
            conflict: string;
        }>;
        fallbackComponent: 'l1.authority.fail_closed_handoff';
    };
    tools: {
        readers: readonly string[];
        writers: readonly string[];
        expected: readonly string[];
        activeObjects: readonly string[];
        missingTools: readonly AuthoringToolGapV1[];
        degradedComponent: 'l1.tools.degraded_honesty';
    };
    navigation: {
        items: readonly AuthoringNavigationItemV1[];
        dailyWorkFirst: boolean;
        catalogSeparated: boolean;
        roleContract: 'dashboard.route_access.v1';
        mobileContract: 'mobile.capability_workspaces.v1';
        gaps: readonly string[];
    };
    terminology: {
        primaryObject: AuthoredField<Readonly<Record<string, string>> | null>;
        customerNoun: AuthoredField<Readonly<Record<string, string>> | null>;
        transactionNoun: AuthoredField<Readonly<Record<string, string>> | null>;
        recognizedAliasesComponent: 'country_language_pack.aliases';
        prohibitedTerms: AuthoredField<readonly string[]>;
        neverConsentPhrases: readonly string[];
    };
    templates: ReadonlyArray<{
        kind: AuthoringTemplateKind;
        component: string;
        source: AuthoringSource;
    }>;
    localization: {
        baseLanguages: readonly ('es' | 'en' | 'pt' | 'fr')[];
        countryOverlays: ReadonlyArray<{
            country: string;
            packId: string;
            packStatus: CountryPackStatus;
            market: CountryMarketPolicyV1;
            recognizedAliases: ReadonlyArray<{
                value: string;
                intent: string;
                confidence: string;
            }>;
            /** Local phrases that cannot authorise a transactional/high-impact effect alone. */
            ambiguousConsentPhrases: readonly string[];
            preferredTerms: Readonly<Record<string, string>>;
            prohibitedRegisters: readonly string[];
        }>;
        fallbackPack: 'es-419';
    };
    privacy: {
        disclosureComponent: 'l1.role_disclosure';
        regulatedSlots: readonly string[];
        neverPersistSlots: readonly string[];
        retentionSource: 'slot.persistence';
    };
    evals: {
        contractVersion: number;
        byLanguage: Readonly<Record<'es' | 'en' | 'pt' | 'fr', number>>;
        positive: number;
        negative: number;
        adversarial: number;
        toolHonesty: number;
    };
    benchmark: {
        competitor: string;
        auditedReadiness: number;
        auditedDemand: number;
        confidence: string;
        authorisedClaim: string;
        certificationStatus: string;
    };
    governance: {
        stage: 'mechanically_complete';
        criticalFieldSources: Readonly<Record<string, AuthoringSource>>;
        expertReviewsRequired: readonly string[];
        implementationBlockers: readonly string[];
        promotionBlockers: readonly string[];
    };
}
