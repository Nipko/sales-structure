import { VERTICAL_CAPABILITY_MANIFEST_VERSION } from '@parallext/shared';

export type VerticalWorkspaceKind =
    | 'appointments'
    | 'stays'
    | 'tours'
    | 'restaurant'
    | 'orders'
    | 'classes'
    | 'education'
    | 'insurance'
    | 'service_requests'
    | 'photo_sessions'
    | 'test_drives'
    | 'vehicle_rentals'
    | 'pet_boarding'
    | 'none';

export type VerticalWorkspaceIconName =
    | 'calendar-outline'
    | 'bed-outline'
    | 'map-outline'
    | 'restaurant-outline'
    | 'bag-handle-outline'
    | 'barbell-outline'
    | 'school-outline'
    | 'shield-checkmark-outline'
    | 'construct-outline'
    | 'camera-outline'
    | 'car-sport-outline'
    | 'key-outline'
    | 'paw-outline'
    | 'ban-outline';

export type VerticalWorkspaceLabelKey =
    | 'workspace.appointments'
    | 'workspace.stays'
    | 'workspace.tours'
    | 'workspace.restaurant'
    | 'workspace.orders'
    | 'workspace.classes'
    | 'workspace.education'
    | 'workspace.insurance'
    | 'workspace.serviceRequests'
    | 'workspace.photoSessions'
    | 'workspace.testDrives'
    | 'workspace.vehicleRentals'
    | 'workspace.petBoarding'
    | 'workspace.none';

export interface VerticalWorkspaceInput {
    readonly industry?: string | null;
    readonly subType?: string | null;
    readonly bookingEnabled?: boolean | null;
    readonly manifestVersion?: number | null;
    /** Versioned, backend-resolved capabilities. Older API responses omit it. */
    readonly effectiveCapabilities?: readonly string[] | null;
}

export interface VerticalWorkspaceResolution {
    readonly kind: VerticalWorkspaceKind;
    readonly iconName: VerticalWorkspaceIconName;
    readonly labelKey: VerticalWorkspaceLabelKey;
}

export type VerticalLocale = 'es' | 'en' | 'pt' | 'fr';

export interface VerticalWorkspaceLabelInput {
    /** Tenant vertical config as the API returns it. */
    readonly verticalConfig?: {
        readonly terminology?: { readonly transactionNoun?: unknown } | null;
        readonly sidebar?: {
            readonly labelOverrides?: { readonly appointments?: unknown } | null;
        } | null;
    } | null;
    readonly workspace: VerticalWorkspaceResolution;
    readonly locale: VerticalLocale;
    readonly t: (key: string) => string;
}

function capitalizeFirst(value: string, locale: VerticalLocale): string {
    return value ? value.charAt(0).toLocaleUpperCase(locale) + value.slice(1) : '';
}

/** Reads a plain string or a {es,en,pt,fr} map, then capitalizes it. */
function pickLocalized(value: unknown, locale: VerticalLocale): string {
    if (typeof value === 'string') return capitalizeFirst(value, locale);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    const map = value as Record<string, unknown>;
    const candidate = map[locale] || map.es || map.en || map.pt || map.fr;
    return typeof candidate === 'string' ? capitalizeFirst(candidate, locale) : '';
}

/**
 * Single source of truth for the name of the operational workspace.
 *
 * The bottom tab and the header of the screen that tab opens used to resolve
 * this independently. The tab walked labelOverrides → workspace catalog →
 * transactionNoun; `AppointmentsScreen` only looked at labelOverrides and
 * otherwise fell back to `citas.title`. Any tenant that carries a
 * transactionNoun without an explicit override therefore read two different
 * names for the same section in the same view — the `technology` vertical ships
 * `transactionNoun.es = 'deal'`, so the tab said "Deal" while the header right
 * under it said "Agenda". Both call this now, so they cannot drift again.
 */
export function resolveVerticalWorkspaceLabel(input: VerticalWorkspaceLabelInput): string {
    const { verticalConfig, workspace, locale, t } = input;
    const override = pickLocalized(verticalConfig?.sidebar?.labelOverrides?.appointments, locale);
    const transactionNoun = pickLocalized(verticalConfig?.terminology?.transactionNoun, locale);

    // Tenant vocabulary wins only on the canonical agenda. The specialized kinds
    // (stays, tours, orders…) have their own translated names, which an
    // appointments-shaped override must not overwrite.
    const appointmentLabel = override || transactionNoun;
    if (workspace.kind === 'appointments' && appointmentLabel) return appointmentLabel;

    const translated = t(workspace.labelKey);
    if (translated !== workspace.labelKey) return translated;

    // Catalog miss (translation bundle older than the workspace kind): fall back
    // to the tenant's own vocabulary before the generic label.
    return transactionNoun || t('nav.citas');
}

const WORKSPACES: Record<VerticalWorkspaceKind, VerticalWorkspaceResolution> = {
    appointments: {
        kind: 'appointments',
        iconName: 'calendar-outline',
        labelKey: 'workspace.appointments',
    },
    stays: {
        kind: 'stays',
        iconName: 'bed-outline',
        labelKey: 'workspace.stays',
    },
    tours: {
        kind: 'tours',
        iconName: 'map-outline',
        labelKey: 'workspace.tours',
    },
    restaurant: {
        kind: 'restaurant',
        iconName: 'restaurant-outline',
        labelKey: 'workspace.restaurant',
    },
    orders: {
        kind: 'orders',
        iconName: 'bag-handle-outline',
        labelKey: 'workspace.orders',
    },
    classes: {
        kind: 'classes',
        iconName: 'barbell-outline',
        labelKey: 'workspace.classes',
    },
    education: {
        kind: 'education',
        iconName: 'school-outline',
        labelKey: 'workspace.education',
    },
    insurance: {
        kind: 'insurance',
        iconName: 'shield-checkmark-outline',
        labelKey: 'workspace.insurance',
    },
    service_requests: {
        kind: 'service_requests',
        iconName: 'construct-outline',
        labelKey: 'workspace.serviceRequests',
    },
    photo_sessions: {
        kind: 'photo_sessions',
        iconName: 'camera-outline',
        labelKey: 'workspace.photoSessions',
    },
    test_drives: {
        kind: 'test_drives',
        iconName: 'car-sport-outline',
        labelKey: 'workspace.testDrives',
    },
    vehicle_rentals: {
        kind: 'vehicle_rentals',
        iconName: 'key-outline',
        labelKey: 'workspace.vehicleRentals',
    },
    pet_boarding: {
        kind: 'pet_boarding',
        iconName: 'paw-outline',
        labelKey: 'workspace.petBoarding',
    },
    none: {
        kind: 'none',
        iconName: 'ban-outline',
        labelKey: 'workspace.none',
    },
};

const INDUSTRY_WORKSPACES: Readonly<Record<string, VerticalWorkspaceKind>> = {
    restaurantes: 'restaurant',
    education: 'education',
    retail: 'orders',
    gimnasios: 'classes',
    seguros: 'insurance',
    servicios_hogar: 'service_requests',
    fotografia: 'photo_sessions',
    otro: 'orders',
};

const CAPABILITY_WORKSPACES: Readonly<Record<string, VerticalWorkspaceKind>> = {
    nightly_booking: 'stays',
    tour_booking: 'tours',
    restaurant_ordering: 'restaurant',
    course_enrollment: 'education',
    membership_management: 'classes',
    insurance_operations: 'insurance',
    service_requests: 'service_requests',
    photo_sessions: 'photo_sessions',
    vehicle_rentals: 'vehicle_rentals',
    pet_boarding: 'pet_boarding',
    catalog_search: 'orders',
    appointment_booking: 'appointments',
};

const CAPABILITY_PRIORITY = [
    'nightly_booking',
    'tour_booking',
    'restaurant_ordering',
    'course_enrollment',
    'membership_management',
    'insurance_operations',
    'service_requests',
    'photo_sessions',
    'vehicle_rentals',
    'pet_boarding',
    'catalog_search',
    'appointment_booking',
] as const;

const APPOINTMENT_INDUSTRIES = new Set([
    'salud',
    'moda_belleza',
    'inmobiliaria',
    'automotriz',
    'finanzas',
    'servicios_profesionales',
    'technology',
    'veterinaria',
    'pet_services',
]);

const TOURISM_SUBTYPE_WORKSPACES: Readonly<Record<string, VerticalWorkspaceKind>> = {
    hotel: 'stays',
    alquiler_vacacional: 'stays',
    tours: 'tours',
    agencia_viajes: 'tours',
};

const AUTOMOTIVE_SUBTYPE_WORKSPACES: Readonly<Record<string, VerticalWorkspaceKind>> = {
    // Dealership visits/test drives are appointments with an inventory vehicle
    // in metadata. Keeping a second test_drives workspace split the canonical
    // agenda and bypassed appointment availability/contact handling.
    concesionario: 'appointments',
    taller: 'appointments',
    repuestos: 'orders',
    alquiler: 'vehicle_rentals',
};

const PET_SERVICES_SUBTYPE_WORKSPACES: Readonly<Record<string, VerticalWorkspaceKind>> = {
    peluqueria: 'appointments',
    guarderia: 'pet_boarding',
    hotel: 'pet_boarding',
    paseos: 'appointments',
    adiestramiento: 'appointments',
};

const TECHNOLOGY_SUBTYPE_WORKSPACES: Readonly<Record<string, VerticalWorkspaceKind>> = {
    saas: 'appointments',
    consultoria_ti: 'appointments',
    desarrollo: 'appointments',
    hardware: 'orders',
};

function normalize(value: string | null | undefined): string {
    return value?.trim().toLowerCase() ?? '';
}

/**
 * Todos los espacios operativos del perfil, en orden de prioridad.
 *
 * La app resolvía UNO solo: la primera capacidad de la lista ganaba y el resto
 * desaparecía del teléfono. Un gimnasio veía las clases y perdía la agenda; una
 * escuela de idiomas veía las inscripciones y perdía las citas de admisión; un
 * restaurante con salón veía los pedidos y perdía las reservas de mesa. Once de
 * los 76 perfiles declaran más de una operación, y en el teléfono se veía una
 * sola.
 *
 * El primero de la lista es el mismo que devolvía antes, así que nada cambia
 * para quien pide uno solo.
 */
/**
 * La resolución de un espacio concreto.
 *
 * Con el conmutador activo, la pantalla ya sabe QUÉ espacio está mostrando y no
 * tiene por qué volver a resolverlo desde la config: hacerlo devolvía siempre
 * el primero, así que el título contradecía la pestaña elegida.
 */
export function workspaceOfKind(kind: VerticalWorkspaceKind): VerticalWorkspaceResolution {
    return WORKSPACES[kind] || WORKSPACES.none;
}

export function resolveVerticalWorkspaces(
    input: VerticalWorkspaceInput,
): VerticalWorkspaceResolution[] {
    const primary = resolveVerticalWorkspace(input);
    if (primary.kind === 'none') return [primary];

    // Las rutas heredadas por sub-tipo resuelven un único espacio a propósito:
    // un tenant con configuración v1 conserva exactamente lo que tenía hasta
    // que reconcilie, y agregarle espacios sería cambiarle la app sin aviso.
    const capabilities = new Set(input.effectiveCapabilities || []);
    if (
        !Array.isArray(input.effectiveCapabilities)
        || input.manifestVersion !== VERTICAL_CAPABILITY_MANIFEST_VERSION
    ) {
        return [primary];
    }

    const resolved: VerticalWorkspaceResolution[] = [];
    const seen = new Set<VerticalWorkspaceKind>();
    for (const capability of CAPABILITY_PRIORITY) {
        if (!capabilities.has(capability)) continue;
        const kind = CAPABILITY_WORKSPACES[capability];
        if (seen.has(kind)) continue;
        seen.add(kind);
        resolved.push(WORKSPACES[kind]);
    }
    return resolved.length ? resolved : [primary];
}

/**
 * Resolves the mobile operational workspace for a tenant's vertical config.
 * Specialized data models take precedence over the generic booking flag.
 */
export function resolveVerticalWorkspace(
    input: VerticalWorkspaceInput,
): VerticalWorkspaceResolution {
    const industry = normalize(input.industry);
    const subType = normalize(input.subType);
    const hasPublishedCapabilities = Array.isArray(input.effectiveCapabilities);

    const fromCapabilities = (): VerticalWorkspaceResolution => {
        const capabilities = new Set(input.effectiveCapabilities || []);
        for (const capability of CAPABILITY_PRIORITY) {
            if (capabilities.has(capability)) {
                return WORKSPACES[CAPABILITY_WORKSPACES[capability]];
            }
        }
        return WORKSPACES.none;
    };

    // An explicit empty list is the publication fence for absent/failed v2.
    if (hasPublishedCapabilities && input.effectiveCapabilities!.length === 0) {
        return WORKSPACES.none;
    }

    if (
        input.manifestVersion === VERTICAL_CAPABILITY_MANIFEST_VERSION
        && !hasPublishedCapabilities
    ) {
        return WORKSPACES.none;
    }

    // Only a current manifest is allowed to supersede the legacy subtype
    // routing. Stored v1 configurations must keep the workspace users already
    // had until the tenant completes reconciliation.
    if (
        hasPublishedCapabilities
        && input.manifestVersion === VERTICAL_CAPABILITY_MANIFEST_VERSION
    ) {
        return fromCapabilities();
    }

    if (industry === 'turismo' && TOURISM_SUBTYPE_WORKSPACES[subType]) {
        return WORKSPACES[TOURISM_SUBTYPE_WORKSPACES[subType]];
    }

    if (industry === 'automotriz' && subType === 'concesionario') {
        return WORKSPACES.test_drives;
    }

    if (industry === 'automotriz' && AUTOMOTIVE_SUBTYPE_WORKSPACES[subType]) {
        return WORKSPACES[AUTOMOTIVE_SUBTYPE_WORKSPACES[subType]];
    }

    if (industry === 'pet_services' && PET_SERVICES_SUBTYPE_WORKSPACES[subType]) {
        const kind = PET_SERVICES_SUBTYPE_WORKSPACES[subType];
        if (kind !== 'appointments') return WORKSPACES[kind];
    }

    if (industry === 'technology' && TECHNOLOGY_SUBTYPE_WORKSPACES[subType]) {
        const kind = TECHNOLOGY_SUBTYPE_WORKSPACES[subType];
        if (kind !== 'appointments') return WORKSPACES[kind];
    }

    if (
        (industry === 'salud' && subType === 'farmacia')
        || (industry === 'moda_belleza' && subType === 'boutique')
    ) {
        return WORKSPACES.orders;
    }

    if (hasPublishedCapabilities) {
        return fromCapabilities();
    }

    const specializedKind = INDUSTRY_WORKSPACES[industry];
    if (specializedKind) {
        return WORKSPACES[specializedKind];
    }

    if (APPOINTMENT_INDUSTRIES.has(industry) && input.bookingEnabled !== false) {
        return WORKSPACES.appointments;
    }

    return WORKSPACES.none;
}
