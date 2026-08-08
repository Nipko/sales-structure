import {
    VERTICAL_MANIFEST_INDUSTRIES,
    type VerticalManifestIndustry,
} from './vertical-capability-manifest';

export const VERTICAL_PRODUCT_POLICY_VERSION = 1 as const;

/**
 * First certification cohort. These are deliberately non-regulated and cover
 * the three core operating models we need to prove first: transactional
 * ordering, date-range capacity and field-service dispatch.
 */
export const VERTICAL_CERTIFICATION_ANCHORS = [
    'restaurantes',
    'turismo',
    'servicios_hogar',
] as const satisfies readonly VerticalManifestIndustry[];

/** Public landing slugs mapped once to the canonical runtime industries. */
export const PUBLIC_VERTICAL_INDUSTRY_BY_SLUG = Object.freeze({
    salud: 'salud',
    restaurantes: 'restaurantes',
    inmobiliaria: 'inmobiliaria',
    belleza: 'moda_belleza',
    gimnasios: 'gimnasios',
    turismo: 'turismo',
    educacion: 'education',
    seguros: 'seguros',
    veterinaria: 'veterinaria',
    fotografia: 'fotografia',
    automotriz: 'automotriz',
    hogar: 'servicios_hogar',
    finanzas: 'finanzas',
    'servicios-profesionales': 'servicios_profesionales',
    tecnologia: 'technology',
    retail: 'retail',
    'pet-services': 'pet_services',
    otro: 'otro',
} as const satisfies Readonly<Record<string, VerticalManifestIndustry>>);

export type PublicVerticalSlug = keyof typeof PUBLIC_VERTICAL_INDUSTRY_BY_SLUG;

export type VerticalProductMode =
    | 'certification_anchor'
    | 'vertical_product'
    | 'horizontal_preset'
    | 'generic_fallback';

export type VerticalCertificationState = 'implemented_not_certified' | 'certified';

export interface VerticalProductPolicyEntry {
    industry: VerticalManifestIndustry;
    mode: VerticalProductMode;
    certificationState: VerticalCertificationState;
    deepMarketingAllowed: boolean;
    rationale: string;
    nextCertificationGate: string;
}

const HORIZONTAL_PRESETS = new Set<VerticalManifestIndustry>([
    'finanzas',
    'technology',
    'servicios_profesionales',
]);
const ANCHORS = new Set<VerticalManifestIndustry>(VERTICAL_CERTIFICATION_ANCHORS);

export const VERTICAL_PRODUCT_POLICY = Object.freeze(Object.fromEntries(
    VERTICAL_MANIFEST_INDUSTRIES.map((industry): [VerticalManifestIndustry, VerticalProductPolicyEntry] => {
        const mode: VerticalProductMode = industry === 'otro'
            ? 'generic_fallback'
            : HORIZONTAL_PRESETS.has(industry)
                ? 'horizontal_preset'
                : ANCHORS.has(industry)
                    ? 'certification_anchor'
                    : 'vertical_product';

        const rationale = mode === 'certification_anchor'
            ? 'First cohort selected to prove ordering, date-range capacity and dispatch without regulated-decision scope.'
            : mode === 'horizontal_preset'
                ? 'CRM, knowledge and scheduling preset until its regulated/domain lifecycle is explicitly implemented.'
                : mode === 'generic_fallback'
                    ? 'Stable generic CRM/catalog fallback; the declarative builder is a separate future product.'
                    : 'Code-backed vertical product that remains in implemented, not certified, state.';

        return [industry, Object.freeze({
            industry,
            mode,
            certificationState: 'implemented_not_certified',
            deepMarketingAllowed: false,
            rationale,
            nextCertificationGate: mode === 'certification_anchor'
                ? 'Complete PostgreSQL/Redis/BullMQ/provider E2E evidence package.'
                : 'Remain honest-mode until selected into a funded certification cohort.',
        })];
    }),
)) as Readonly<Record<VerticalManifestIndustry, VerticalProductPolicyEntry>>;

export function resolveVerticalProductPolicy(industry: string): VerticalProductPolicyEntry {
    const entry = (VERTICAL_PRODUCT_POLICY as Readonly<Record<string, VerticalProductPolicyEntry>>)[industry];
    if (!entry) throw new Error(`Unknown vertical product policy industry: ${industry}`);
    return entry;
}

export function resolvePublicVerticalProductPolicy(slug: string): VerticalProductPolicyEntry {
    const industry = (PUBLIC_VERTICAL_INDUSTRY_BY_SLUG as Readonly<Record<string, VerticalManifestIndustry>>)[slug];
    if (!industry) throw new Error(`Unknown public vertical slug: ${slug}`);
    return resolveVerticalProductPolicy(industry);
}
