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
    /** Versioned, backend-resolved capabilities. Older API responses omit it. */
    readonly effectiveCapabilities?: readonly string[] | null;
}

export interface VerticalWorkspaceResolution {
    readonly kind: VerticalWorkspaceKind;
    readonly iconName: VerticalWorkspaceIconName;
    readonly labelKey: VerticalWorkspaceLabelKey;
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
    concesionario: 'test_drives',
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
 * Resolves the mobile operational workspace for a tenant's vertical config.
 * Specialized data models take precedence over the generic booking flag.
 */
export function resolveVerticalWorkspace(
    input: VerticalWorkspaceInput,
): VerticalWorkspaceResolution {
    const industry = normalize(input.industry);
    const subType = normalize(input.subType);

    if (industry === 'turismo' && TOURISM_SUBTYPE_WORKSPACES[subType]) {
        return WORKSPACES[TOURISM_SUBTYPE_WORKSPACES[subType]];
    }

    if (industry === 'automotriz' && AUTOMOTIVE_SUBTYPE_WORKSPACES[subType]) {
        const kind = AUTOMOTIVE_SUBTYPE_WORKSPACES[subType];
        if (kind !== 'appointments') return WORKSPACES[kind];
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

    // Prefer the versioned server contract when available. An empty array is a
    // deliberate "no operational module" decision, not a cue to fall back to
    // generic appointments.
    if (Array.isArray(input.effectiveCapabilities)) {
        const capabilities = new Set(input.effectiveCapabilities);
        for (const capability of CAPABILITY_PRIORITY) {
            if (capabilities.has(capability)) {
                return WORKSPACES[CAPABILITY_WORKSPACES[capability]];
            }
        }
        return WORKSPACES.none;
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
