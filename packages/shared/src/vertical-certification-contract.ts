import {
    buildDomainContractDraft,
    VERTICAL_DOMAIN_CONTRACT_VERSION,
} from './vertical-domain-contract';
import {
    listCanonicalSubtypeExperienceProfileIds,
    listSubtypeExperienceProfileIds,
    resolveSubtypeExperienceProfile,
    type SubtypeAvailability,
} from './subtype-experience-profile';
import {
    countryPackIdFor,
    countryPackStatusFor,
    type CountryPackStatus,
} from './tenant-regional-profile';
import { profileSystemOfRecordDeclaration, type SorBoundaryKind } from './system-of-record-policy';

/**
 * One portable answer to "how far may this profile be represented today?".
 *
 * Product availability, country-pack evidence and provider certification are
 * deliberately separate dimensions. Collapsing them into one boolean caused a
 * healthy connector to look like a certified market, and a selectable subtype
 * to look like a certified product. Runtime, UI, Agent Test, mobile and landing
 * can all consume this JSON-safe snapshot without reinterpreting those axes.
 */
export const VERTICAL_CERTIFICATION_CONTRACT_VERSION = 1 as const;

export type VerticalCertificationStage =
    | 'defined'
    | 'contracted'
    | 'mechanically_complete'
    | 'expert_reviewed'
    | 'integrated'
    | 'evaluated'
    | 'pilot_ready'
    | 'piloted'
    | 'certified';

export type VerticalExecutionMode = 'read_write' | 'read_only_handoff';

export type VerticalCertificationReasonCode =
    | 'profile_waitlist'
    | 'profile_legacy_only'
    | 'profile_not_commercialisable'
    | 'domain_contract_incomplete'
    | 'e2e_evidence_missing'
    | 'country_not_declared'
    | 'country_pack_draft'
    | 'country_pack_fallback_only'
    | 'country_pack_pilot'
    | 'provider_required'
    | 'provider_version_missing'
    | 'provider_not_certified'
    | 'provider_capability_not_certified';

export type CertificationDimension = 'product' | 'market' | 'provider';

export interface VerticalCertificationReason {
    code: VerticalCertificationReasonCode;
    dimension: CertificationDimension;
    blocking: boolean;
}

export interface ProviderCertificationContext {
    name: string;
    /** Canonical provider class when it differs from the vendor id. */
    kind?: string | null;
    /** Exact external API/contract version. Missing is never inferred. */
    apiVersion?: string | null;
    configured?: boolean;
    healthy?: boolean;
    /** Evidence-backed capabilities, e.g. `read:menu` or `write:create_reservation`. */
    certifiedCapabilities?: readonly string[];
}

export interface VerticalCertificationSnapshotV1 {
    version: typeof VERTICAL_CERTIFICATION_CONTRACT_VERSION;
    profileId: string;
    requestedProfileId: string;
    profileVersion: number;
    manifestVersion: number;
    domainContractVersion: typeof VERTICAL_DOMAIN_CONTRACT_VERSION;
    product: {
        availability: SubtypeAvailability;
        commercialisable: boolean;
        stage: VerticalCertificationStage;
        executionMode: VerticalExecutionMode;
    };
    market: {
        operatingCountry: string | null;
        countryPackId: string;
        countryPackStatus: CountryPackStatus;
        certified: boolean;
    };
    provider: {
        boundary: SorBoundaryKind;
        requirement: 'none' | 'optional' | 'required';
        acceptedKinds: readonly string[];
        selected: string | null;
        apiVersion: string | null;
        configured: boolean;
        healthy: boolean | null;
        certifiedCapabilities: readonly string[];
        certified: boolean;
    };
    overall: {
        stage: VerticalCertificationStage;
        certified: boolean;
        deepMarketingAllowed: boolean;
    };
    reasons: readonly VerticalCertificationReason[];
}

export interface ResolveVerticalCertificationInput {
    industry: string;
    subtype?: string | null;
    operatingCountry?: string | null;
    providers?: readonly ProviderCertificationContext[];
    /** Persisted promotion evidence; absence never promotes by inference. */
    promotion?: {
        stage: VerticalCertificationStage;
        domainEvidenceComplete: boolean;
        deepMarketingApproved: boolean;
    };
    /** Reviewed market record may override the static pack catalogue. */
    countryPack?: { id: string; status: CountryPackStatus };
}

function providerRequirement(
    strategy: string,
    boundary: SorBoundaryKind,
): 'none' | 'optional' | 'required' {
    if (boundary === 'provider_required' || strategy === 'integrate') return 'required';
    if (boundary === 'conditional_provider' || strategy === 'hybrid') return 'optional';
    return 'none';
}

function selectedProvider(
    providers: readonly ProviderCertificationContext[],
    acceptedKinds: readonly string[],
): ProviderCertificationContext | undefined {
    const configured = providers.filter(provider => provider.configured === true);
    if (!configured.length) return undefined;
    if (!acceptedKinds.length) return undefined;
    return configured.find(provider => (
        acceptedKinds.includes(provider.kind || provider.name)
    ));
}

/** Pure resolver: no database, environment or tenant mutation. */
export function resolveVerticalCertificationSnapshot(
    input: ResolveVerticalCertificationInput,
): VerticalCertificationSnapshotV1 {
    const requestedProfileId = `${input.industry}/${input.subtype || '__none__'}`;
    const profile = resolveSubtypeExperienceProfile(input.industry, input.subtype);
    const domain = buildDomainContractDraft(profile.industry, profile.subtype);
    const sor = profileSystemOfRecordDeclaration(profile.id);
    const boundary: SorBoundaryKind = sor?.boundary || 'native';
    const acceptedKinds = sor?.providerKinds || [];
    const requirement = providerRequirement(profile.strategy, boundary);
    const provider = selectedProvider(input.providers || [], acceptedKinds);
    const providerHasCertificationRecord = Array.isArray(provider?.certifiedCapabilities);
    const certifiedCapabilities = Object.freeze([...(provider?.certifiedCapabilities || [])]);
    const providerCertified = requirement === 'none'
        || (requirement === 'optional' && !provider)
        || (
            !!provider?.configured
            && !!provider.apiVersion
            && certifiedCapabilities.length > 0
        );

    const country = String(input.operatingCountry || '').trim().toUpperCase() || null;
    const countryPackStatus = input.countryPack?.status || countryPackStatusFor(country);
    const countryPackCertified = countryPackStatus === 'certified';
    const reasons: VerticalCertificationReason[] = [];

    if (profile.availability === 'waitlist') {
        reasons.push({ code: 'profile_waitlist', dimension: 'product', blocking: true });
    } else if (profile.availability === 'legacy_only') {
        reasons.push({ code: 'profile_legacy_only', dimension: 'product', blocking: true });
    }
    if (!profile.commercialisable) {
        reasons.push({ code: 'profile_not_commercialisable', dimension: 'product', blocking: true });
    }
    if (domain.unresolved.length > 0) {
        reasons.push({ code: 'domain_contract_incomplete', dimension: 'product', blocking: true });
    }
    if (domain.certification.blockers.includes('e2e_evidence') && !input.promotion?.domainEvidenceComplete) {
        reasons.push({ code: 'e2e_evidence_missing', dimension: 'product', blocking: true });
    }

    if (!country) {
        reasons.push({ code: 'country_not_declared', dimension: 'market', blocking: true });
    } else if (countryPackStatus === 'fallback_only') {
        reasons.push({ code: 'country_pack_fallback_only', dimension: 'market', blocking: true });
    } else if (countryPackStatus === 'draft') {
        reasons.push({ code: 'country_pack_draft', dimension: 'market', blocking: true });
    } else if (countryPackStatus === 'pilot') {
        reasons.push({ code: 'country_pack_pilot', dimension: 'market', blocking: true });
    }

    if (requirement === 'required' && !provider?.configured) {
        reasons.push({ code: 'provider_required', dimension: 'provider', blocking: true });
    } else if (provider?.configured && !provider.apiVersion) {
        reasons.push({ code: 'provider_version_missing', dimension: 'provider', blocking: true });
    } else if (provider?.configured && provider.apiVersion && !providerHasCertificationRecord) {
        reasons.push({ code: 'provider_not_certified', dimension: 'provider', blocking: true });
    } else if (provider?.configured && provider.apiVersion && certifiedCapabilities.length === 0) {
        reasons.push({
            code: 'provider_capability_not_certified',
            dimension: 'provider',
            blocking: true,
        });
    }

    const mechanicallyComplete = profile.commercialisable && domain.unresolved.length === 0;
    const productStage: VerticalCertificationStage = input.promotion?.stage || (mechanicallyComplete
        ? 'mechanically_complete'
        : profile.commercialisable ? 'contracted' : 'defined');
    const certified = profile.commercialisable
        && domain.unresolved.length === 0
        && input.promotion?.stage === 'certified'
        && input.promotion.domainEvidenceComplete
        && !!country
        && countryPackCertified
        && providerCertified;

    return Object.freeze({
        version: VERTICAL_CERTIFICATION_CONTRACT_VERSION,
        profileId: profile.id,
        requestedProfileId,
        profileVersion: profile.version,
        manifestVersion: profile.manifestVersion,
        domainContractVersion: VERTICAL_DOMAIN_CONTRACT_VERSION,
        product: Object.freeze({
            availability: profile.availability,
            commercialisable: profile.commercialisable,
            stage: productStage,
            // Certification metadata does not silently revoke a product a
            // tenant already has. The existing availability gate remains the
            // execution boundary; market/provider dimensions govern claims and
            // provider actions independently.
            executionMode: profile.commercialisable ? 'read_write' : 'read_only_handoff',
        }),
        market: Object.freeze({
            operatingCountry: country,
            countryPackId: input.countryPack?.id || countryPackIdFor(country),
            countryPackStatus,
            certified: countryPackCertified,
        }),
        provider: Object.freeze({
            boundary,
            requirement,
            acceptedKinds: Object.freeze([...acceptedKinds]),
            selected: provider?.name || null,
            apiVersion: provider?.apiVersion || null,
            configured: provider?.configured === true,
            healthy: typeof provider?.healthy === 'boolean' ? provider.healthy : null,
            certifiedCapabilities,
            certified: providerCertified,
        }),
        overall: Object.freeze({
            stage: certified ? 'certified' : productStage,
            certified,
            deepMarketingAllowed: certified && input.promotion?.deepMarketingApproved === true,
        }),
        reasons: Object.freeze(reasons),
    });
}

export function listVerticalCertificationSnapshots(input: {
    operatingCountry?: string | null;
    providers?: readonly ProviderCertificationContext[];
    includeLegacy?: boolean;
} = {}): VerticalCertificationSnapshotV1[] {
    const ids = input.includeLegacy
        ? listSubtypeExperienceProfileIds()
        : listCanonicalSubtypeExperienceProfileIds();
    return ids.map((id) => {
        const [industry, subtype] = id.split('/');
        return resolveVerticalCertificationSnapshot({
            industry,
            subtype: subtype === '__none__' ? null : subtype,
            operatingCountry: input.operatingCountry,
            providers: input.providers,
        });
    });
}
