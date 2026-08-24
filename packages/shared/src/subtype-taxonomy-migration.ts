/**
 * Pure, versioned taxonomy migration contract.
 *
 * It classifies only explicit declarations. It never reads business prose,
 * guesses from tenant data or writes a tenant. That boundary is intentional:
 * P04 and P05 can legitimately produce two target workspaces, so a one-to-one
 * alias would silently change the customer's product.
 */
export const SUBTYPE_TAXONOMY_MIGRATION_VERSION = 1 as const;

export const SUBTYPE_TAXONOMY_MIGRATION_APPLY_SUPPORTED = false as const;

export type LegacySubtypeMigrationId =
    | 'finanzas/fintech'
    | 'fotografia/wedding_planner'
    | 'inmobiliaria/construccion'
    | 'technology/consultoria_ti';

export type SubtypeTaxonomyMigrationStatus =
    | 'candidate'
    | 'needs_owner'
    | 'approved'
    | 'migrated'
    | 'rejected';

export type SubtypeTaxonomyMigrationReason =
    | 'PAYMENTS_MODEL_DECLARED'
    | 'FINTECH_FAMILY_UNSUPPORTED'
    | 'WEDDING_PLANNER_RECLASSIFICATION'
    | 'DEVELOPER_MODEL_DECLARED'
    | 'CONTRACTOR_MODEL_DECLARED'
    | 'DEVELOPER_AND_CONTRACTOR_DECLARED'
    | 'MSP_MODEL_DECLARED'
    | 'PROJECT_CONSULTING_DECLARED'
    | 'MSP_AND_PROJECTS_DECLARED'
    | 'BUSINESS_MODEL_REQUIRED'
    | 'OWNER_CONSENT_REQUIRED'
    | 'OWNER_CONSENT_RECORDED';

export interface SubtypeTaxonomyMigrationContract {
    sourceId: LegacySubtypeMigrationId;
    possibleTargets: readonly string[];
    classificationField: 'business_model' | null;
    supportsMultipleTargets: boolean;
    requiresOwnerConsent: true;
    applySupported: false;
}

export const SUBTYPE_TAXONOMY_MIGRATION_CONTRACTS: Readonly<
    Record<LegacySubtypeMigrationId, SubtypeTaxonomyMigrationContract>
> = Object.freeze({
    'finanzas/fintech': Object.freeze({
        sourceId: 'finanzas/fintech',
        possibleTargets: Object.freeze(['finanzas/pagos_recaudos']),
        classificationField: 'business_model',
        supportsMultipleTargets: false,
        requiresOwnerConsent: true,
        applySupported: false,
    }),
    'fotografia/wedding_planner': Object.freeze({
        sourceId: 'fotografia/wedding_planner',
        possibleTargets: Object.freeze(['event_planning/weddings']),
        classificationField: null,
        supportsMultipleTargets: false,
        requiresOwnerConsent: true,
        applySupported: false,
    }),
    'inmobiliaria/construccion': Object.freeze({
        sourceId: 'inmobiliaria/construccion',
        possibleTargets: Object.freeze([
            'inmobiliaria/promotora',
            'construccion/contratista_general',
        ]),
        classificationField: 'business_model',
        supportsMultipleTargets: true,
        requiresOwnerConsent: true,
        applySupported: false,
    }),
    'technology/consultoria_ti': Object.freeze({
        sourceId: 'technology/consultoria_ti',
        possibleTargets: Object.freeze([
            'technology/soporte_ti_msp',
            'servicios_profesionales/consultores',
        ]),
        classificationField: 'business_model',
        supportsMultipleTargets: true,
        requiresOwnerConsent: true,
        applySupported: false,
    }),
});

export interface ClassifySubtypeTaxonomyMigrationInput {
    industry: unknown;
    subType: unknown;
    /** Explicit owner/admin declaration only; never inferred from free text. */
    businessModel?: unknown;
    /** A separately recorded consent signal. It never causes a write here. */
    ownerConsent?: boolean;
}

export interface SubtypeTaxonomyMigrationClassification {
    version: typeof SUBTYPE_TAXONOMY_MIGRATION_VERSION;
    sourceId: LegacySubtypeMigrationId;
    status: Extract<SubtypeTaxonomyMigrationStatus, 'candidate' | 'needs_owner' | 'approved'>;
    candidates: readonly string[];
    selectedTargets: readonly string[];
    reasonCodes: readonly SubtypeTaxonomyMigrationReason[];
    requiresOwnerConsent: true;
    applySupported: false;
}

function normalize(value: unknown): string {
    return typeof value === 'string'
        ? value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[\s-]+/g, '_')
        : '';
}

export function subtypeTaxonomyMigrationSourceId(
    industry: unknown,
    subType: unknown,
): LegacySubtypeMigrationId | null {
    const id = `${normalize(industry)}/${normalize(subType)}`;
    return Object.prototype.hasOwnProperty.call(SUBTYPE_TAXONOMY_MIGRATION_CONTRACTS, id)
        ? id as LegacySubtypeMigrationId
        : null;
}

function ownerStatus(ownerConsent: boolean | undefined): {
    status: 'candidate' | 'approved';
    consentReason: SubtypeTaxonomyMigrationReason;
} {
    return ownerConsent
        ? { status: 'approved', consentReason: 'OWNER_CONSENT_RECORDED' }
        : { status: 'candidate', consentReason: 'OWNER_CONSENT_REQUIRED' };
}

function declaredModel(value: unknown): string {
    const model = normalize(value);
    const aliases: Readonly<Record<string, string>> = {
        pagos: 'payments',
        payment: 'payments',
        payments: 'payments',
        recaudo: 'payments',
        recaudos: 'payments',
        payments_collections: 'payments',
        pagos_recaudos: 'payments',
        developer: 'developer',
        desarrollador: 'developer',
        promotora: 'developer',
        property_developer: 'developer',
        contractor: 'contractor',
        contratista: 'contractor',
        contratista_general: 'contractor',
        both: 'both',
        ambos: 'both',
        hibrido: 'both',
        hybrid: 'both',
        msp: 'msp',
        soporte_ti: 'msp',
        managed_services: 'msp',
        managed_service_provider: 'msp',
        consulting: 'consulting',
        consultoria: 'consulting',
        consultoria_proyectos: 'consulting',
        project_consulting: 'consulting',
        projects: 'consulting',
        proyectos: 'consulting',
        msp_and_projects: 'both',
    };
    return aliases[model] || model;
}

export function classifySubtypeTaxonomyMigration(
    input: ClassifySubtypeTaxonomyMigrationInput,
): SubtypeTaxonomyMigrationClassification | null {
    const sourceId = subtypeTaxonomyMigrationSourceId(input.industry, input.subType);
    if (!sourceId) return null;

    const base = {
        version: SUBTYPE_TAXONOMY_MIGRATION_VERSION,
        sourceId,
        requiresOwnerConsent: true as const,
        applySupported: false as const,
    };
    const model = declaredModel(input.businessModel);

    if (sourceId === 'fotografia/wedding_planner') {
        const consent = ownerStatus(input.ownerConsent);
        const candidates = ['event_planning/weddings'] as const;
        return {
            ...base,
            status: consent.status,
            candidates,
            selectedTargets: input.ownerConsent ? candidates : [],
            reasonCodes: ['WEDDING_PLANNER_RECLASSIFICATION', consent.consentReason],
        };
    }

    let candidates: readonly string[] = [];
    let reason: SubtypeTaxonomyMigrationReason | null = null;

    if (sourceId === 'finanzas/fintech') {
        if (model === 'payments') {
            candidates = ['finanzas/pagos_recaudos'];
            reason = 'PAYMENTS_MODEL_DECLARED';
        } else if (model) {
            return {
                ...base,
                status: 'needs_owner',
                candidates: [],
                selectedTargets: [],
                reasonCodes: ['FINTECH_FAMILY_UNSUPPORTED'],
            };
        }
    } else if (sourceId === 'inmobiliaria/construccion') {
        if (model === 'developer') {
            candidates = ['inmobiliaria/promotora'];
            reason = 'DEVELOPER_MODEL_DECLARED';
        } else if (model === 'contractor') {
            candidates = ['construccion/contratista_general'];
            reason = 'CONTRACTOR_MODEL_DECLARED';
        } else if (model === 'both') {
            candidates = ['inmobiliaria/promotora', 'construccion/contratista_general'];
            reason = 'DEVELOPER_AND_CONTRACTOR_DECLARED';
        }
    } else if (sourceId === 'technology/consultoria_ti') {
        if (model === 'msp') {
            candidates = ['technology/soporte_ti_msp'];
            reason = 'MSP_MODEL_DECLARED';
        } else if (model === 'consulting') {
            candidates = ['servicios_profesionales/consultores'];
            reason = 'PROJECT_CONSULTING_DECLARED';
        } else if (model === 'both') {
            candidates = ['technology/soporte_ti_msp', 'servicios_profesionales/consultores'];
            reason = 'MSP_AND_PROJECTS_DECLARED';
        }
    }

    if (!candidates.length || !reason) {
        return {
            ...base,
            status: 'needs_owner',
            candidates: [],
            selectedTargets: [],
            reasonCodes: ['BUSINESS_MODEL_REQUIRED'],
        };
    }

    const consent = ownerStatus(input.ownerConsent);
    return {
        ...base,
        status: consent.status,
        candidates,
        selectedTargets: input.ownerConsent ? candidates : [],
        reasonCodes: [reason, consent.consentReason],
    };
}
