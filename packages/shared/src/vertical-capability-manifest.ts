/**
 * Versioned operational contract for the 18 canonical verticals.
 *
 * This manifest deliberately describes only code-backed behaviour that exists
 * today. It is not a product roadmap: an unavailable KPI contract stays
 * unavailable and an action without an enforced identity gate is not labelled
 * as protected.
 */
export const VERTICAL_CAPABILITY_MANIFEST_VERSION = 1 as const;

export const VERTICAL_MANIFEST_INDUSTRIES = [
    'salud',
    'moda_belleza',
    'inmobiliaria',
    'restaurantes',
    'automotriz',
    'turismo',
    'education',
    'finanzas',
    'servicios_profesionales',
    'retail',
    'technology',
    'veterinaria',
    'gimnasios',
    'seguros',
    'servicios_hogar',
    'pet_services',
    'fotografia',
    'otro',
] as const;

export type VerticalManifestIndustry = typeof VERTICAL_MANIFEST_INDUSTRIES[number];

export type VerticalCapability =
    | 'crm_pipeline'
    | 'faq_search'
    | 'appointment_booking'
    | 'catalog_search'
    | 'treatment_management'
    | 'real_estate_listings'
    | 'restaurant_ordering'
    | 'vehicle_inventory'
    | 'tour_booking'
    | 'nightly_booking'
    | 'course_enrollment'
    | 'professional_case_lookup'
    | 'pet_records'
    | 'membership_management'
    | 'insurance_operations'
    | 'service_requests'
    | 'pet_services'
    | 'photo_sessions';

/** These names match the persisted `config.tools.*` keys used by the runtime. */
export type VerticalToolGroup =
    | 'faqs'
    | 'appointments'
    | 'catalog'
    | 'treatments'
    | 'realEstate'
    | 'restaurants'
    | 'vehicles'
    | 'tours'
    | 'properties'
    | 'education'
    | 'professionalServices'
    | 'pets'
    | 'gyms'
    | 'insurance'
    | 'homeServices'
    | 'petServices'
    | 'photography';

export type VerticalPrimaryObject =
    | 'lead'
    | 'appointment'
    | 'catalog_item'
    | 'treatment_plan'
    | 'real_estate_listing'
    | 'food_order'
    | 'vehicle'
    | 'tour_package'
    | 'property_booking'
    | 'course'
    | 'professional_case'
    | 'pet'
    | 'membership'
    | 'insurance_policy'
    | 'service_request'
    | 'photo_session';

export type VerticalRoutePath =
    | '/admin/inbox'
    | '/admin/contacts'
    | '/admin/pipeline'
    | '/admin/appointments'
    | '/admin/inventory'
    | '/admin/orders'
    | '/admin/treatment-plans'
    | '/admin/listings'
    | '/admin/menu'
    | '/admin/food-orders'
    | '/admin/vehicles'
    | '/admin/tours'
    | '/admin/properties'
    | '/admin/courses'
    | '/admin/memberships'
    | '/admin/classes'
    | '/admin/insurance'
    | '/admin/service-requests'
    | '/admin/pets'
    | '/admin/photo-sessions';

export type VerticalReadinessKey =
    | 'business_identity'
    | 'pipeline'
    | 'faq_content'
    | 'appointment_services'
    | 'catalog_items'
    | 'treatment_catalog'
    | 'listings'
    | 'menu_items'
    | 'vehicle_inventory'
    | 'tour_packages'
    | 'properties'
    | 'courses'
    | 'professional_cases'
    | 'pets'
    | 'membership_plans'
    | 'insurance_plans'
    | 'service_catalog'
    | 'photo_sessions';

export type VerticalDomainEvent =
    | 'lead.captured'
    | 'message.inbound'
    | 'pipeline.stage_changed'
    | 'pipeline.sla_violated'
    | 'handoff.escalated'
    | 'handoff.completed'
    | 'appointment.created'
    | 'appointment.cancelled'
    | 'appointment.completed'
    | 'appointment.rescheduled'
    | 'food_order.created'
    | 'food_order.cancelled'
    | 'service_request.created'
    | 'photo_session.requested';

export type VerticalAssuranceLevel = 'A0' | 'A1' | 'A2' | 'A3' | 'A4';

export type AssuranceConfirmationRequirement = 'never' | 'writes';
export type AssuranceApprovalRequirement = 'never' | 'writes';

/**
 * Shared, code-backed authority matrix for conversational actions.
 *
 * A level is cumulative: a caller satisfying A3 also satisfies A0-A2. The
 * `writes` controls are applied to both `write` and `conditional_write` tools;
 * reads never acquire an idempotency reservation or a confirmation challenge.
 */
export interface AssuranceLevelDefinition {
    rank: 0 | 1 | 2 | 3 | 4;
    scope:
        | 'public_information'
        | 'own_low_risk_data'
        | 'sensitive_owned_data'
        | 'signature_payment_or_high_sensitivity'
        | 'regulated_irreversible_or_financial_override';
    requiresContactContext: boolean;
    requiresStepUpIdentity: boolean;
    signedConfirmation: AssuranceConfirmationRequirement;
    idempotencyLedger: AssuranceConfirmationRequirement;
    humanApproval: AssuranceApprovalRequirement;
    examples: readonly string[];
}

export const ASSURANCE_LEVELS = ['A0', 'A1', 'A2', 'A3', 'A4'] as const;

export const ASSURANCE_LEVEL_MATRIX: Readonly<Record<VerticalAssuranceLevel, AssuranceLevelDefinition>> =
    Object.freeze({
        A0: Object.freeze({
            rank: 0,
            scope: 'public_information',
            requiresContactContext: false,
            requiresStepUpIdentity: false,
            signedConfirmation: 'never',
            idempotencyLedger: 'writes',
            humanApproval: 'never',
            examples: Object.freeze(['catalog', 'availability', 'faq', 'public_policy']),
        }),
        A1: Object.freeze({
            rank: 1,
            scope: 'own_low_risk_data',
            requiresContactContext: true,
            requiresStepUpIdentity: false,
            signedConfirmation: 'writes',
            idempotencyLedger: 'writes',
            humanApproval: 'never',
            examples: Object.freeze(['own_order', 'appointment', 'booking', 'service_request']),
        }),
        A2: Object.freeze({
            rank: 2,
            scope: 'sensitive_owned_data',
            requiresContactContext: true,
            requiresStepUpIdentity: true,
            signedConfirmation: 'writes',
            idempotencyLedger: 'writes',
            humanApproval: 'never',
            examples: Object.freeze(['policy', 'claim', 'case', 'clinical_data', 'document']),
        }),
        A3: Object.freeze({
            rank: 3,
            scope: 'signature_payment_or_high_sensitivity',
            requiresContactContext: true,
            requiresStepUpIdentity: true,
            signedConfirmation: 'writes',
            idempotencyLedger: 'writes',
            humanApproval: 'never',
            examples: Object.freeze(['payment_link', 'deposit', 'signature', 'high_sensitivity_pii']),
        }),
        A4: Object.freeze({
            rank: 4,
            scope: 'regulated_irreversible_or_financial_override',
            requiresContactContext: true,
            requiresStepUpIdentity: true,
            signedConfirmation: 'writes',
            idempotencyLedger: 'writes',
            humanApproval: 'writes',
            examples: Object.freeze(['refund', 'high_discount', 'regulated_decision', 'irreversible_action']),
        }),
    });

export function isVerticalAssuranceLevel(value: unknown): value is VerticalAssuranceLevel {
    return typeof value === 'string'
        && (ASSURANCE_LEVELS as readonly string[]).includes(value);
}

export function assuranceLevelSatisfies(
    actual: VerticalAssuranceLevel,
    required: VerticalAssuranceLevel,
): boolean {
    return ASSURANCE_LEVEL_MATRIX[actual].rank >= ASSURANCE_LEVEL_MATRIX[required].rank;
}

export interface VerticalAssuranceContract {
    minimum: VerticalAssuranceLevel;
    /** Only actions with a code-backed central gate belong here. */
    enforcedActions: Readonly<Record<string, VerticalAssuranceLevel>>;
}

export interface VerticalKpiContract {
    /** Existing tenant dashboard KPI keys from the vertical definition. */
    dashboard: readonly string[];
    verticalAnalytics: {
        availability: 'implemented' | 'unavailable';
        /** Exact keys returned by the current industry aggregator. */
        metrics: readonly string[];
    };
}

export interface VerticalReadinessContract {
    /** Current readiness is advisory; it does not block runtime execution. */
    enforcement: 'advisory';
    requirements: readonly VerticalReadinessKey[];
}

export interface VerticalCapabilityProfile {
    capabilities: readonly VerticalCapability[];
    toolGroups: readonly VerticalToolGroup[];
    primaryObject: VerticalPrimaryObject;
    routes: readonly VerticalRoutePath[];
    kpiContract: VerticalKpiContract;
    readiness: VerticalReadinessContract;
    events: readonly VerticalDomainEvent[];
    assurance: VerticalAssuranceContract;
}

export interface VerticalSubtypeCapabilityOverride {
    addCapabilities?: readonly VerticalCapability[];
    removeCapabilities?: readonly VerticalCapability[];
    addToolGroups?: readonly VerticalToolGroup[];
    removeToolGroups?: readonly VerticalToolGroup[];
    primaryObject?: VerticalPrimaryObject;
    addRoutes?: readonly VerticalRoutePath[];
    removeRoutes?: readonly VerticalRoutePath[];
    addReadiness?: readonly VerticalReadinessKey[];
    removeReadiness?: readonly VerticalReadinessKey[];
    addEvents?: readonly VerticalDomainEvent[];
    removeEvents?: readonly VerticalDomainEvent[];
    assurance?: VerticalAssuranceContract;
}

export interface VerticalCapabilityManifestEntry {
    industry: VerticalManifestIndustry;
    /** Selectable configurations in the current canonical registry. */
    subtypes: readonly string[];
    /** Read-only compatibility for already-persisted tenants; never advertised. */
    legacySubtypes?: readonly string[];
    profile: VerticalCapabilityProfile;
    subtypeOverrides?: Readonly<Record<string, VerticalSubtypeCapabilityOverride>>;
}

export type VerticalCapabilityManifest = Readonly<
    Record<VerticalManifestIndustry, VerticalCapabilityManifestEntry>
>;

export interface ResolvedVerticalCapabilityManifest extends VerticalCapabilityProfile {
    manifestVersion: typeof VERTICAL_CAPABILITY_MANIFEST_VERSION;
    industry: VerticalManifestIndustry;
    subtype: string | null;
}

const BASE_CAPABILITIES: readonly VerticalCapability[] = ['crm_pipeline', 'faq_search'];
const BASE_TOOLS: readonly VerticalToolGroup[] = ['faqs'];
const BASE_ROUTES: readonly VerticalRoutePath[] = ['/admin/inbox', '/admin/contacts', '/admin/pipeline'];
const BASE_READINESS: readonly VerticalReadinessKey[] = ['business_identity', 'pipeline', 'faq_content'];
const BASE_EVENTS: readonly VerticalDomainEvent[] = [
    'lead.captured',
    'message.inbound',
    'pipeline.stage_changed',
    'pipeline.sla_violated',
    'handoff.escalated',
    'handoff.completed',
];
const APPOINTMENT_EVENTS: readonly VerticalDomainEvent[] = [
    'appointment.created',
    'appointment.cancelled',
    'appointment.completed',
    'appointment.rescheduled',
];
const A0_ASSURANCE: VerticalAssuranceContract = { minimum: 'A0', enforcedActions: {} };

function unique<T>(values: readonly T[]): T[] {
    return [...new Set(values)];
}

function kpis(
    dashboard: readonly string[],
    metrics: readonly string[] = [],
): VerticalKpiContract {
    return {
        dashboard,
        verticalAnalytics: {
            availability: metrics.length > 0 ? 'implemented' : 'unavailable',
            metrics,
        },
    };
}

function profile(input: {
    capabilities?: readonly VerticalCapability[];
    toolGroups?: readonly VerticalToolGroup[];
    primaryObject?: VerticalPrimaryObject;
    routes?: readonly VerticalRoutePath[];
    kpiContract: VerticalKpiContract;
    readiness?: readonly VerticalReadinessKey[];
    events?: readonly VerticalDomainEvent[];
    assurance?: VerticalAssuranceContract;
}): VerticalCapabilityProfile {
    return {
        capabilities: unique([...BASE_CAPABILITIES, ...(input.capabilities || [])]),
        toolGroups: unique([...BASE_TOOLS, ...(input.toolGroups || [])]),
        primaryObject: input.primaryObject || 'lead',
        routes: unique([...BASE_ROUTES, ...(input.routes || [])]),
        kpiContract: input.kpiContract,
        readiness: {
            enforcement: 'advisory',
            requirements: unique([...BASE_READINESS, ...(input.readiness || [])]),
        },
        events: unique([...BASE_EVENTS, ...(input.events || [])]),
        assurance: input.assurance || A0_ASSURANCE,
    };
}

const APPOINTMENT_PATCH_REMOVAL: VerticalSubtypeCapabilityOverride = {
    removeCapabilities: ['appointment_booking'],
    removeToolGroups: ['appointments'],
    removeRoutes: ['/admin/appointments'],
    removeReadiness: ['appointment_services'],
    removeEvents: APPOINTMENT_EVENTS,
};

const DASH_APPOINTMENTS = ['appointmentsToday', 'leadsToday', 'noShowsWeek', 'messagesProcessed'];
const DASH_SALES = ['leadsToday', 'leadsHot', 'messagesProcessed', 'llmCostToday'];
const DASH_CONVERSION = ['leadsToday', 'appointmentsToday', 'conversionRate', 'llmCostToday'];

export const VERTICAL_CAPABILITY_MANIFEST: VerticalCapabilityManifest = {
    salud: {
        industry: 'salud',
        subtypes: ['dental', 'medica_general', 'dermatologia', 'psicologia', 'farmacia'],
        profile: profile({
            capabilities: ['appointment_booking'],
            toolGroups: ['appointments'],
            primaryObject: 'appointment',
            routes: ['/admin/appointments'],
            readiness: ['appointment_services'],
            events: APPOINTMENT_EVENTS,
            assurance: {
                minimum: 'A0',
                enforcedActions: {
                    get_treatment_plan: 'A2',
                    list_upcoming_sessions: 'A2',
                },
            },
            kpiContract: kpis(DASH_APPOINTMENTS, [
                'treatmentsActive', 'treatmentsCompleted',
                'sessionsCompletedWeek', 'sessionsScheduledWeek',
            ]),
        }),
        subtypeOverrides: {
            dental: {
                addCapabilities: ['treatment_management'],
                addToolGroups: ['treatments'],
                addRoutes: ['/admin/treatment-plans'],
                addReadiness: ['treatment_catalog'],
            },
            dermatologia: {
                addCapabilities: ['treatment_management'],
                addToolGroups: ['treatments'],
                addRoutes: ['/admin/treatment-plans'],
                addReadiness: ['treatment_catalog'],
            },
            psicologia: {
                addCapabilities: ['treatment_management'],
                addToolGroups: ['treatments'],
                addRoutes: ['/admin/treatment-plans'],
                addReadiness: ['treatment_catalog'],
            },
            farmacia: {
                ...APPOINTMENT_PATCH_REMOVAL,
                addCapabilities: ['catalog_search'],
                addToolGroups: ['catalog'],
                primaryObject: 'catalog_item',
                addRoutes: ['/admin/inventory'],
                addReadiness: ['catalog_items'],
            },
        },
    },
    moda_belleza: {
        industry: 'moda_belleza',
        subtypes: ['salon_belleza', 'barberia', 'spa', 'estetica'],
        legacySubtypes: ['boutique'],
        profile: profile({
            capabilities: ['appointment_booking'],
            toolGroups: ['appointments'],
            primaryObject: 'appointment',
            routes: ['/admin/appointments'],
            readiness: ['appointment_services'],
            events: APPOINTMENT_EVENTS,
            assurance: {
                minimum: 'A0',
                enforcedActions: {
                    get_treatment_plan: 'A2',
                    list_upcoming_sessions: 'A2',
                },
            },
            kpiContract: kpis(DASH_APPOINTMENTS, [
                'activeServices', 'appointments30d', 'completedAppointments30d',
                'noShows30d', 'appointmentsNext7d', 'uniqueCustomers30d',
                'repeatCustomers30d', 'repeatCustomerRatePct',
            ]),
        }),
        subtypeOverrides: {
            boutique: {
                ...APPOINTMENT_PATCH_REMOVAL,
                addCapabilities: ['catalog_search'],
                addToolGroups: ['catalog'],
                primaryObject: 'catalog_item',
                addRoutes: ['/admin/inventory'],
                addReadiness: ['catalog_items'],
            },
            spa: {
                addCapabilities: ['treatment_management'],
                addToolGroups: ['treatments'],
                addRoutes: ['/admin/treatment-plans'],
                addReadiness: ['treatment_catalog'],
            },
            estetica: {
                addCapabilities: ['treatment_management'],
                addToolGroups: ['treatments'],
                addRoutes: ['/admin/treatment-plans'],
                addReadiness: ['treatment_catalog'],
            },
        },
    },
    inmobiliaria: {
        industry: 'inmobiliaria',
        subtypes: ['venta', 'arriendo', 'comercial', 'construccion'],
        profile: profile({
            capabilities: ['appointment_booking', 'real_estate_listings'],
            toolGroups: ['appointments', 'realEstate'],
            primaryObject: 'real_estate_listing',
            routes: ['/admin/appointments', '/admin/listings'],
            readiness: ['appointment_services', 'listings'],
            events: APPOINTMENT_EVENTS,
            kpiContract: kpis(
                ['leadsToday', 'appointmentsToday', 'leadsHot', 'messagesProcessed'],
                ['listingsForSale', 'listingsForRent', 'soldThisMonth', 'rentedThisMonth', 'avgSalePrice', 'avgRentPrice'],
            ),
        }),
    },
    restaurantes: {
        industry: 'restaurantes',
        subtypes: ['casual_dining', 'comida_rapida', 'cafeteria', 'dark_kitchen'],
        legacySubtypes: ['delivery'],
        profile: profile({
            capabilities: ['appointment_booking', 'restaurant_ordering'],
            toolGroups: ['appointments', 'restaurants'],
            primaryObject: 'food_order',
            routes: ['/admin/appointments', '/admin/menu', '/admin/food-orders'],
            readiness: ['appointment_services', 'menu_items'],
            events: [...APPOINTMENT_EVENTS, 'food_order.created', 'food_order.cancelled'],
            kpiContract: kpis(DASH_APPOINTMENTS, [
                'menuItems', 'ordersTotal', 'gmvTotal', 'ordersWeek', 'gmvWeek',
                'activePromotions', 'kitchenInProgress',
            ]),
        }),
        subtypeOverrides: {
            dark_kitchen: APPOINTMENT_PATCH_REMOVAL,
            delivery: APPOINTMENT_PATCH_REMOVAL,
        },
    },
    automotriz: {
        industry: 'automotriz',
        subtypes: ['concesionario', 'taller', 'repuestos', 'alquiler'],
        profile: profile({
            capabilities: ['appointment_booking', 'vehicle_inventory'],
            toolGroups: ['appointments', 'vehicles'],
            primaryObject: 'vehicle',
            routes: ['/admin/appointments', '/admin/vehicles'],
            readiness: ['appointment_services', 'vehicle_inventory'],
            events: APPOINTMENT_EVENTS,
            kpiContract: kpis(
                ['leadsToday', 'testDrivesToday', 'leadsHot', 'messagesProcessed'],
                [
                    'vehiclesTotal', 'vehiclesAvailable', 'vehiclesReserved',
                    'vehiclesMaintenance', 'vehiclesSoldThisMonth',
                    'soldRevenueCentsThisMonth', 'avgAvailablePriceCents',
                    'testDrivesThisMonth', 'testDrivesNext7d',
                ],
            ),
        }),
    },
    turismo: {
        industry: 'turismo',
        subtypes: ['agencia_viajes', 'hotel', 'tours', 'alquiler_vacacional'],
        profile: profile({
            capabilities: ['appointment_booking'],
            toolGroups: ['appointments'],
            routes: ['/admin/appointments'],
            readiness: ['appointment_services'],
            events: APPOINTMENT_EVENTS,
            assurance: {
                minimum: 'A0',
                enforcedActions: { get_check_in_instructions: 'A2' },
            },
            kpiContract: kpis(
                ['leadsToday', 'tourBookingsToday', 'messagesProcessed', 'llmCostToday'],
                ['tourPackages', 'properties', 'bookingsConfirmed30d', 'bookingsReserved30d', 'gmv30d'],
            ),
        }),
        subtypeOverrides: {
            agencia_viajes: {
                addCapabilities: ['tour_booking'],
                addToolGroups: ['tours'],
                primaryObject: 'tour_package',
                addRoutes: ['/admin/tours'],
                addReadiness: ['tour_packages'],
            },
            tours: {
                addCapabilities: ['tour_booking'],
                addToolGroups: ['tours'],
                primaryObject: 'tour_package',
                addRoutes: ['/admin/tours'],
                addReadiness: ['tour_packages'],
            },
            hotel: {
                ...APPOINTMENT_PATCH_REMOVAL,
                addCapabilities: ['nightly_booking'],
                addToolGroups: ['properties'],
                primaryObject: 'property_booking',
                addRoutes: ['/admin/properties'],
                addReadiness: ['properties'],
            },
            alquiler_vacacional: {
                ...APPOINTMENT_PATCH_REMOVAL,
                addCapabilities: ['nightly_booking'],
                addToolGroups: ['properties'],
                primaryObject: 'property_booking',
                addRoutes: ['/admin/properties'],
                addReadiness: ['properties'],
            },
        },
    },
    education: {
        industry: 'education',
        subtypes: ['idiomas', 'universitaria', 'online', 'capacitacion'],
        profile: profile({
            capabilities: ['appointment_booking', 'course_enrollment'],
            toolGroups: ['appointments', 'education'],
            primaryObject: 'course',
            routes: ['/admin/appointments', '/admin/courses'],
            readiness: ['appointment_services', 'courses'],
            events: APPOINTMENT_EVENTS,
            kpiContract: kpis(
                ['leadsToday', 'enrollmentsToday', 'messagesProcessed', 'llmCostToday'],
                ['courses', 'cohortsOpen', 'cohortsFull', 'cohortsCancelled', 'cohortsFinished', 'enrollmentsTotal', 'enrollmentsPaid', 'paymentRatePct'],
            ),
        }),
    },
    finanzas: {
        industry: 'finanzas',
        subtypes: ['asesoria', 'fintech', 'creditos'],
        profile: profile({
            capabilities: ['appointment_booking'],
            toolGroups: ['appointments'],
            primaryObject: 'appointment',
            routes: ['/admin/appointments'],
            readiness: ['appointment_services'],
            events: APPOINTMENT_EVENTS,
            kpiContract: kpis(
                ['leadsToday', 'leadsReadyToClose', 'conversionRate', 'llmCostToday'],
                [
                    'applicationsOpen', 'applications30d', 'applicationsApproved30d',
                    'applicationsRejected30d', 'approvalRatePct', 'openEstimatedValue',
                    'consultationsNext7d',
                ],
            ),
        }),
    },
    servicios_profesionales: {
        industry: 'servicios_profesionales',
        subtypes: ['abogados', 'contadores', 'arquitectos', 'consultores'],
        profile: profile({
            capabilities: ['appointment_booking', 'professional_case_lookup'],
            toolGroups: ['appointments', 'professionalServices'],
            primaryObject: 'professional_case',
            routes: ['/admin/appointments'],
            readiness: ['appointment_services', 'professional_cases'],
            events: APPOINTMENT_EVENTS,
            assurance: {
                minimum: 'A0',
                enforcedActions: { get_case_status: 'A2' },
            },
            kpiContract: kpis(DASH_CONVERSION, [
                'openDeals', 'wonDeals30d', 'lostDeals30d', 'winRate30d',
                'pipelineValue', 'weightedPipelineValue', 'consultationsNext7d',
                'consultationsCompleted30d',
            ]),
        }),
    },
    retail: {
        industry: 'retail',
        subtypes: ['moda', 'electronica', 'hogar', 'marketplace'],
        profile: profile({
            capabilities: ['catalog_search'],
            toolGroups: ['catalog'],
            primaryObject: 'catalog_item',
            routes: ['/admin/inventory', '/admin/orders'],
            readiness: ['catalog_items'],
            kpiContract: kpis(DASH_SALES, [
                'productsTotal', 'productsAvailable', 'productsOutOfStock', 'stockUnits',
                'orders30d', 'paidOrders30d', 'pendingOrders30d', 'gmv30d',
                'averageOrderValue30d',
            ]),
        }),
    },
    technology: {
        industry: 'technology',
        subtypes: ['saas', 'consultoria_ti', 'desarrollo', 'hardware'],
        profile: profile({
            capabilities: ['appointment_booking'],
            toolGroups: ['appointments'],
            primaryObject: 'appointment',
            routes: ['/admin/appointments'],
            readiness: ['appointment_services'],
            events: APPOINTMENT_EVENTS,
            kpiContract: kpis(DASH_CONVERSION, [
                'companies', 'openDeals', 'wonDeals30d', 'lostDeals30d', 'winRate30d',
                'pipelineValue', 'weightedPipelineValue', 'avgSalesCycleDays30d',
                'demosNext7d',
            ]),
        }),
    },
    veterinaria: {
        industry: 'veterinaria',
        subtypes: ['clinica_general', 'hospital_24h', 'exoticos', 'peluqueria_canina'],
        profile: profile({
            capabilities: ['appointment_booking', 'pet_records'],
            toolGroups: ['appointments', 'pets'],
            primaryObject: 'pet',
            routes: ['/admin/appointments', '/admin/pets'],
            readiness: ['appointment_services', 'pets'],
            events: APPOINTMENT_EVENTS,
            assurance: {
                minimum: 'A0',
                enforcedActions: { get_vaccination_status: 'A2' },
            },
            kpiContract: kpis(
                ['leadsToday', 'appointmentsToday', 'messagesProcessed', 'llmCostToday'],
                ['pets', 'upcomingVaccinations', 'overdueVaccinations'],
            ),
        }),
    },
    gimnasios: {
        industry: 'gimnasios',
        subtypes: ['gimnasio_general', 'crossfit', 'yoga_pilates', 'cycling', 'martial_arts'],
        profile: profile({
            capabilities: ['appointment_booking', 'membership_management'],
            toolGroups: ['appointments', 'gyms'],
            primaryObject: 'membership',
            routes: ['/admin/appointments', '/admin/memberships', '/admin/classes'],
            readiness: ['appointment_services', 'membership_plans'],
            events: APPOINTMENT_EVENTS,
            kpiContract: kpis(
                ['leadsToday', 'classBookingsToday', 'messagesProcessed', 'llmCostToday'],
                ['plans', 'membersActive', 'membersFrozen', 'membersExpired', 'membersCancelled', 'classesNext7d', 'classFillRatePct', 'checkInsWeek'],
            ),
        }),
    },
    seguros: {
        industry: 'seguros',
        subtypes: ['broker', 'aseguradora', 'vida', 'auto', 'salud'],
        profile: profile({
            capabilities: ['insurance_operations'],
            toolGroups: ['insurance'],
            primaryObject: 'insurance_policy',
            routes: ['/admin/insurance'],
            readiness: ['insurance_plans'],
            assurance: {
                minimum: 'A0',
                enforcedActions: {
                    check_policy_status: 'A2',
                    file_claim: 'A2',
                    list_my_claims: 'A2',
                },
            },
            kpiContract: kpis(DASH_SALES, [
                'plans', 'quotesActive', 'quotesAccepted', 'policiesActive',
                'policiesSuspended', 'mrr', 'claimsSubmitted', 'claimsApproved', 'claimsPaid',
            ]),
        }),
    },
    servicios_hogar: {
        industry: 'servicios_hogar',
        subtypes: ['plomeria', 'electricidad', 'fumigacion', 'limpieza', 'jardineria', 'cerrajeria', 'pintura'],
        profile: profile({
            capabilities: ['appointment_booking', 'service_requests'],
            toolGroups: ['appointments', 'homeServices'],
            primaryObject: 'service_request',
            routes: ['/admin/appointments', '/admin/service-requests'],
            readiness: ['appointment_services', 'service_catalog'],
            events: [...APPOINTMENT_EVENTS, 'service_request.created'],
            kpiContract: kpis(DASH_SALES, ['requests30d', 'emergencias30d', 'pending', 'completed', 'completionRatePct']),
        }),
    },
    pet_services: {
        industry: 'pet_services',
        subtypes: ['peluqueria', 'guarderia', 'hotel', 'paseos', 'adiestramiento'],
        profile: profile({
            capabilities: ['appointment_booking', 'pet_records', 'pet_services'],
            toolGroups: ['appointments', 'petServices', 'pets'],
            primaryObject: 'pet',
            routes: ['/admin/appointments', '/admin/pets'],
            readiness: ['appointment_services', 'pets'],
            events: APPOINTMENT_EVENTS,
            kpiContract: kpis(
                ['leadsToday', 'appointmentsToday', 'messagesProcessed', 'llmCostToday'],
                [
                    'pets', 'activeServices', 'bookings30d', 'completedBookings30d',
                    'noShows30d', 'bookingsNext7d', 'petsServed30d',
                ],
            ),
        }),
    },
    fotografia: {
        industry: 'fotografia',
        subtypes: ['estudio', 'bodas', 'eventos', 'producto', 'wedding_planner'],
        profile: profile({
            capabilities: ['appointment_booking', 'photo_sessions'],
            toolGroups: ['appointments', 'photography'],
            primaryObject: 'photo_session',
            routes: ['/admin/appointments', '/admin/photo-sessions'],
            readiness: ['appointment_services', 'photo_sessions'],
            events: [...APPOINTMENT_EVENTS, 'photo_session.requested'],
            kpiContract: kpis(DASH_SALES, [
                'sessionsScheduled', 'sessionsInProgress', 'sessionsDelivered',
                'sessions30d', 'revenue30d', 'deliveriesDue7d',
            ]),
        }),
    },
    otro: {
        industry: 'otro',
        subtypes: [],
        profile: profile({
            capabilities: ['catalog_search'],
            toolGroups: ['catalog'],
            primaryObject: 'catalog_item',
            routes: ['/admin/inventory', '/admin/orders'],
            readiness: ['catalog_items'],
            kpiContract: kpis(DASH_SALES, [
                'contactsTotal', 'newContacts30d', 'conversations30d', 'openDeals',
                'pipelineValue', 'catalogProducts', 'orders30d', 'gmv30d',
            ]),
        }),
    },
};

function mergeValues<T>(
    base: readonly T[],
    additions: readonly T[] | undefined,
    removals: readonly T[] | undefined,
): T[] {
    const removed = new Set(removals || []);
    return unique([...base, ...(additions || [])]).filter((value) => !removed.has(value));
}

export function isVerticalManifestIndustry(value: string): value is VerticalManifestIndustry {
    return Object.prototype.hasOwnProperty.call(VERTICAL_CAPABILITY_MANIFEST, value);
}

/** Resolve the effective, immutable-by-convention profile for an industry/subtype pair. */
export function resolveVerticalCapabilityManifest(
    industry: string,
    subtype?: string | null,
): ResolvedVerticalCapabilityManifest {
    if (!isVerticalManifestIndustry(industry)) {
        throw new Error(`Unknown vertical capability manifest industry: ${industry}`);
    }

    const entry = VERTICAL_CAPABILITY_MANIFEST[industry];
    const normalizedSubtype = subtype || null;
    const acceptedSubtypes = [...entry.subtypes, ...(entry.legacySubtypes || [])];
    if (normalizedSubtype && !acceptedSubtypes.includes(normalizedSubtype)) {
        throw new Error(`Unknown vertical capability manifest subtype: ${industry}/${normalizedSubtype}`);
    }

    const override = normalizedSubtype
        ? entry.subtypeOverrides?.[normalizedSubtype]
        : undefined;

    return {
        manifestVersion: VERTICAL_CAPABILITY_MANIFEST_VERSION,
        industry,
        subtype: normalizedSubtype,
        capabilities: mergeValues(
            entry.profile.capabilities,
            override?.addCapabilities,
            override?.removeCapabilities,
        ),
        toolGroups: mergeValues(
            entry.profile.toolGroups,
            override?.addToolGroups,
            override?.removeToolGroups,
        ),
        primaryObject: override?.primaryObject || entry.profile.primaryObject,
        routes: mergeValues(entry.profile.routes, override?.addRoutes, override?.removeRoutes),
        kpiContract: entry.profile.kpiContract,
        readiness: {
            enforcement: 'advisory',
            requirements: mergeValues(
                entry.profile.readiness.requirements,
                override?.addReadiness,
                override?.removeReadiness,
            ),
        },
        events: mergeValues(entry.profile.events, override?.addEvents, override?.removeEvents),
        assurance: override?.assurance || entry.profile.assurance,
    };
}

/** Enumerates the 75 subtype configurations plus the subtype-less `otro`. */
export function listVerticalCapabilityConfigurations(): ResolvedVerticalCapabilityManifest[] {
    const configurations: ResolvedVerticalCapabilityManifest[] = [];
    for (const industry of VERTICAL_MANIFEST_INDUSTRIES) {
        const entry = VERTICAL_CAPABILITY_MANIFEST[industry];
        if (entry.subtypes.length === 0) {
            configurations.push(resolveVerticalCapabilityManifest(industry, null));
            continue;
        }
        for (const subtype of entry.subtypes) {
            configurations.push(resolveVerticalCapabilityManifest(industry, subtype));
        }
    }
    return configurations;
}
