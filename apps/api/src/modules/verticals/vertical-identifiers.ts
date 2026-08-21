import { VERTICAL_REGISTRY } from './vertical-definitions';
import {
    ADMIN_CREATE_AVAILABILITY,
    SIGNUP_AVAILABILITY,
    VERTICAL_CAPABILITY_MANIFEST,
    resolveSubtypeExperienceProfile,
} from '@parallext/shared';

export interface CanonicalVerticalSelection {
    industry: string;
    subType: string | null;
}

export class InvalidVerticalSelectionError extends Error {
    constructor(
        message: string,
        readonly industry?: string,
        readonly subType?: string | null,
    ) {
        super(message);
        this.name = 'InvalidVerticalSelectionError';
    }
}

/**
 * Historical identifiers accepted at API boundaries. Internal persistence always
 * uses the registry key so feature gates, sidebar routing and bootstrap agree.
 */
export const VERTICAL_IDENTIFIER_CONTRACT_VERSION = 1 as const;

export const VERTICAL_INDUSTRY_ALIASES: Readonly<Record<string, string>> = {
    education: 'education',
    educacion: 'education',
    health: 'salud',
    healthcare: 'salud',
    restaurante: 'restaurantes',
    restaurant: 'restaurantes',
    belleza: 'moda_belleza',
    beauty: 'moda_belleza',
    real_estate: 'inmobiliaria',
    automotive: 'automotriz',
    travel: 'turismo',
    finance: 'finanzas',
    hogar: 'servicios_hogar',
    home_services: 'servicios_hogar',
    servicios_mascotas: 'pet_services',
    pet_services: 'pet_services',
    veterinary: 'veterinaria',
    gyms: 'gimnasios',
    insurance: 'seguros',
    photography: 'fotografia',
    ecommerce: 'retail',
    e_commerce: 'retail',
    tecnologia: 'technology',
    servicios_profesionales: 'servicios_profesionales',
    professional_services: 'servicios_profesionales',
    legal: 'servicios_profesionales',
    servicios: 'servicios_profesionales',
    services: 'servicios_profesionales',
    other: 'otro',
    otra: 'otro',
    otro: 'otro',
};

function normalizeIdentifier(value: unknown): string {
    return typeof value === 'string'
        ? value.trim().toLowerCase().replace(/[\s-]+/g, '_')
        : '';
}

/**
 * Superficie desde la que se elige. Decide QUÉ disponibilidades se aceptan.
 *
 * `existing` es la que hace que cerrar la puerta no rompa a nadie: un tenant
 * que ya está en un perfil cerrado sigue resolviéndolo, guardando y operando.
 * Migrarlo en silencio sería cambiarle el producto sin decírselo.
 */
export type VerticalSelectionSurface = 'signup' | 'admin_create' | 'existing';

const ALLOWED_AVAILABILITY: Readonly<Record<VerticalSelectionSurface, readonly string[] | null>> =
    Object.freeze({
        signup: SIGNUP_AVAILABILITY,
        admin_create: ADMIN_CREATE_AVAILABILITY,
        // Sin restricción: no es una elección nueva, es lo que el tenant ya es.
        existing: null,
    });

export function resolveVerticalSelection(
    rawIndustry: unknown,
    rawSubType?: unknown,
    surface: VerticalSelectionSurface = 'existing',
): CanonicalVerticalSelection {
    const requestedIndustry = normalizeIdentifier(rawIndustry);
    const requestedSubType = normalizeIdentifier(rawSubType);

    if (!requestedIndustry) {
        throw new InvalidVerticalSelectionError('La industria es obligatoria');
    }

    const industry = VERTICAL_REGISTRY[requestedIndustry]
        ? requestedIndustry
        : VERTICAL_INDUSTRY_ALIASES[requestedIndustry];

    if (!industry || !VERTICAL_REGISTRY[industry]) {
        throw new InvalidVerticalSelectionError(
            `La industria "${requestedIndustry}" no está soportada`,
            requestedIndustry,
            requestedSubType || null,
        );
    }

    // The former finanzas/seguros choice represents an insurance broker, which
    // is a complete first-class vertical. Keeping the alias prevents old drafts
    // from receiving finance prompts without insurance tools or navigation.
    if (industry === 'finanzas' && requestedSubType === 'seguros') {
        return { industry: 'seguros', subType: 'broker' };
    }

    const definition = VERTICAL_REGISTRY[industry];
    if (definition.subTypes.length === 0) {
        if (requestedSubType) {
            throw new InvalidVerticalSelectionError(
                `La industria "${industry}" no admite subtipos`,
                industry,
                requestedSubType,
            );
        }
        return { industry, subType: null };
    }

    if (!requestedSubType) {
        throw new InvalidVerticalSelectionError(
            `Debes seleccionar un subtipo válido para "${industry}"`,
            industry,
            null,
        );
    }

    const isCanonicalSubType = definition.subTypes.some((subType) => subType.key === requestedSubType);
    const isSupportedLegacySubType = (
        VERTICAL_CAPABILITY_MANIFEST[industry as keyof typeof VERTICAL_CAPABILITY_MANIFEST]
            ?.legacySubtypes || []
    ).includes(requestedSubType);
    if (!isCanonicalSubType && !isSupportedLegacySubType) {
        throw new InvalidVerticalSelectionError(
            `El subtipo "${requestedSubType}" no pertenece a la industria "${industry}"`,
            industry,
            requestedSubType,
        );
    }

    assertAvailableForSurface(industry, requestedSubType, surface);
    return { industry, subType: requestedSubType };
}

/**
 * La puerta del alta, del lado del servidor.
 *
 * Filtrar el `<select>` en el dashboard esconde la opción; no la cierra. El
 * `industry`/`subType` del alta es un string libre en el DTO, así que sin esto
 * un POST directo sigue creando un tenant sobre un perfil que no se puede
 * entregar.
 */
function assertAvailableForSurface(
    industry: string,
    subType: string | null,
    surface: VerticalSelectionSurface,
): void {
    const allowed = ALLOWED_AVAILABILITY[surface];
    if (!allowed) return;

    let availability: string;
    try {
        availability = resolveSubtypeExperienceProfile(industry, subType).availability;
    } catch {
        // Un id sin perfil ya lo rechazó la validación de pertenencia de
        // arriba; si igual llegó acá, no se inventa un permiso.
        return;
    }
    if (allowed.includes(availability)) return;

    throw new InvalidVerticalSelectionError(
        `El subtipo "${subType ?? industry}" no está disponible para nuevas cuentas`,
        industry,
        subType,
    );
}
