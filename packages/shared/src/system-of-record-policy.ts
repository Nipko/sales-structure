import { PROVIDER_PROFILE_IDS } from './provider-integration-policy';

/**
 * Executable system-of-record boundary per subtype profile.
 *
 * `native` means Parallly owns both reads and commits and must enforce
 * conflicts transactionally. `conditional_provider` keeps that native
 * boundary until an explicit tenant/resource binding proves that an external
 * system owns the object. `provider_required` is reserved for an explicit
 * product decision that forbids a native system of record.
 */
export type SorBoundaryKind = 'native' | 'conditional_provider' | 'provider_required';
export type SorFreshnessMode =
    | 'transactional'
    | 'native_or_provider_live_or_certified_mirror'
    | 'provider_live_or_certified_mirror';
export type SorConflictMode =
    | 'native_atomic'
    | 'binding_authoritative_fail_closed'
    | 'provider_authoritative_fail_closed';

export interface ProfileSystemOfRecordPolicy {
    profileId: string;
    boundary: SorBoundaryKind;
    owner: 'parallly' | 'conditional_binding' | 'external_provider';
    /** Domain reads controlled by this boundary; horizontal FAQs stay local. */
    readTools: readonly string[];
    /** Local commits that can never coexist with an external authoritative owner. */
    displacedWriters: readonly string[];
    freshness: Readonly<{
        mode: SorFreshnessMode;
        requiresSuccessfulSync: boolean;
    }>;
    conflict: SorConflictMode;
    /** Canonical provider kind; native certified connectors may use their stable provider id. */
    providerKinds: readonly string[];
}

function native(
    profileId: string,
    readTools: readonly string[],
    displacedWriters: readonly string[],
): ProfileSystemOfRecordPolicy {
    return Object.freeze({
        profileId,
        boundary: 'native' as const,
        owner: 'parallly' as const,
        readTools: Object.freeze([...readTools]),
        displacedWriters: Object.freeze([...displacedWriters]),
        freshness: Object.freeze({ mode: 'transactional' as const, requiresSuccessfulSync: false }),
        conflict: 'native_atomic' as const,
        providerKinds: Object.freeze([]),
    });
}

function providerRequired(
    profileId: string,
    providerKinds: readonly string[],
    readTools: readonly string[],
    displacedWriters: readonly string[],
): ProfileSystemOfRecordPolicy {
    return Object.freeze({
        profileId,
        boundary: 'provider_required' as const,
        owner: 'external_provider' as const,
        readTools: Object.freeze([...readTools]),
        displacedWriters: Object.freeze([...displacedWriters]),
        freshness: Object.freeze({
            mode: 'provider_live_or_certified_mirror' as const,
            requiresSuccessfulSync: true,
        }),
        conflict: 'provider_authoritative_fail_closed' as const,
        providerKinds: Object.freeze([...providerKinds]),
    });
}

/**
 * Parallly remains the native SoR until an explicit tenant/resource binding
 * proves that an external system owns the object. Merely belonging to a market
 * where PMS/DMS/PIMS products exist must never erase the native product.
 */
function conditionalProvider(
    profileId: string,
    providerKinds: readonly string[],
    readTools: readonly string[],
    displacedWriters: readonly string[],
): ProfileSystemOfRecordPolicy {
    return Object.freeze({
        profileId,
        boundary: 'conditional_provider' as const,
        owner: 'conditional_binding' as const,
        readTools: Object.freeze([...readTools]),
        displacedWriters: Object.freeze([...displacedWriters]),
        freshness: Object.freeze({
            mode: 'native_or_provider_live_or_certified_mirror' as const,
            requiresSuccessfulSync: false,
        }),
        conflict: 'binding_authoritative_fail_closed' as const,
        providerKinds: Object.freeze([...providerKinds]),
    });
}

const APPOINTMENT_READS = Object.freeze([
    'list_services', 'check_availability', 'list_customer_appointments', 'get_appointment_details',
]);
const APPOINTMENT_WRITERS = Object.freeze([
    'create_appointment', 'cancel_appointment', 'send_booking_link', 'reschedule_appointment',
]);
const CATALOG_READS = Object.freeze([
    'search_products', 'get_product', 'check_stock', 'send_product_image',
]);

export const PROFILE_SYSTEM_OF_RECORD_POLICIES: Readonly<Record<string, ProfileSystemOfRecordPolicy>> =
    Object.freeze({
        // Native by default. A certified tenant/resource binding may displace
        // only the reads/writers covered by that external system of record.
        'salud/farmacia': conditionalProvider(
            'salud/farmacia', ['pharmacy_management_system'], CATALOG_READS, ['place_catalog_order'],
        ),
        'inmobiliaria/venta': conditionalProvider(
            'inmobiliaria/venta', ['real_estate_crm'],
            [...APPOINTMENT_READS, 'search_listings', 'get_listing_details', 'send_listing_image'],
            APPOINTMENT_WRITERS,
        ),
        'inmobiliaria/arriendo': conditionalProvider(
            'inmobiliaria/arriendo', ['property_management_system'],
            [...APPOINTMENT_READS, 'search_listings', 'get_listing_details', 'send_listing_image'],
            APPOINTMENT_WRITERS,
        ),
        'automotriz/concesionario': conditionalProvider(
            'automotriz/concesionario', ['dealer_management_system'],
            [...APPOINTMENT_READS, 'search_vehicles', 'get_vehicle_details', 'send_vehicle_image'],
            [...APPOINTMENT_WRITERS, 'schedule_test_drive'],
        ),
        'automotriz/repuestos': conditionalProvider(
            'automotriz/repuestos', ['parts_management_system'], CATALOG_READS, ['place_catalog_order'],
        ),
        'turismo/agencia_viajes': conditionalProvider(
            'turismo/agencia_viajes', ['travel_reservation_system'],
            ['search_packages', 'get_package_details', 'check_package_availability', 'list_my_tour_bookings'],
            ['create_tour_booking', 'cancel_tour_booking'],
        ),
        'turismo/hotel': conditionalProvider(
            'turismo/hotel', ['property_management_system', 'channel_manager'],
            ['list_properties', 'check_property_availability', 'get_property_details',
                'get_check_in_instructions', 'list_my_property_bookings', 'send_property_image'],
            ['create_property_booking', 'cancel_property_booking'],
        ),
        'turismo/alquiler_vacacional': conditionalProvider(
            'turismo/alquiler_vacacional', ['property_management_system', 'channel_manager'],
            ['list_properties', 'check_property_availability', 'get_property_details',
                'get_check_in_instructions', 'list_my_property_bookings', 'send_property_image'],
            ['create_property_booking', 'cancel_property_booking'],
        ),
        'technology/saas': conditionalProvider(
            'technology/saas', ['customer_success_system'], APPOINTMENT_READS, APPOINTMENT_WRITERS,
        ),
        'veterinaria/clinica_general': conditionalProvider(
            'veterinaria/clinica_general', ['veterinary_practice_management_system'],
            [...APPOINTMENT_READS, 'list_pets_for_contact', 'get_vaccination_status', 'triage_pet_emergency'],
            [...APPOINTMENT_WRITERS, 'register_pet', 'update_pet'],
        ),
        'seguros/broker': conditionalProvider(
            'seguros/broker', ['policy_administration_system'],
            ['get_insurance_plans', 'check_policy_status', 'list_my_claims'],
            ['calculate_quote', 'file_claim', 'cancel_quote'],
        ),

        // Native boundaries: explicit ownership prevents a future connector
        // from silently coexisting with the local transactional record.
        'moda_belleza/estetica': native(
            'moda_belleza/estetica',
            [...APPOINTMENT_READS, 'get_treatment_plan', 'list_upcoming_sessions'],
            APPOINTMENT_WRITERS,
        ),
        'automotriz/taller': native(
            'automotriz/taller',
            [...APPOINTMENT_READS, 'search_vehicles', 'get_vehicle_details', 'send_vehicle_image'],
            [...APPOINTMENT_WRITERS, 'schedule_test_drive'],
        ),
        'education/online': native(
            'education/online',
            [...APPOINTMENT_READS, 'get_courses', 'get_course_schedule', 'list_my_enrollments'],
            [...APPOINTMENT_WRITERS, 'enroll_student', 'get_placement_test_link', 'cancel_enrollment'],
        ),
        'servicios_profesionales/abogados': native(
            'servicios_profesionales/abogados', [...APPOINTMENT_READS, 'get_case_status'], APPOINTMENT_WRITERS,
        ),
        'servicios_profesionales/contadores': native(
            'servicios_profesionales/contadores', [...APPOINTMENT_READS, 'get_case_status'], APPOINTMENT_WRITERS,
        ),
        'servicios_profesionales/consultores': native(
            'servicios_profesionales/consultores', [...APPOINTMENT_READS, 'get_case_status'], APPOINTMENT_WRITERS,
        ),
        'servicios_hogar/fumigacion': native(
            'servicios_hogar/fumigacion',
            ['list_home_services', 'check_home_service_availability',
                'check_request_status', 'list_my_requests'],
            ['create_service_request', 'cancel_service_request'],
        ),
        'fotografia/producto': native(
            'fotografia/producto', ['list_photo_packages', 'send_portfolio', 'check_date_availability'],
            ['request_photo_quote', 'cancel_photo_session'],
        ),
    });

/**
 * Contract-only declarations for profiles that are not executable yet. They
 * must inform certification and authoring without expanding the runtime
 * registry that currently owns the 19 measured policies.
 */
const FUTURE_SYSTEM_OF_RECORD_DECLARATIONS: Readonly<Record<string, ProfileSystemOfRecordPolicy>> =
    Object.freeze({
        'finanzas/pagos_recaudos': providerRequired(
            'finanzas/pagos_recaudos', ['payment_service_provider'], [], [],
        ),
        'retail/marketplace': providerRequired(
            'retail/marketplace', ['marketplace_psp'], [], [],
        ),
        'seguros/aseguradora': providerRequired(
            'seguros/aseguradora', ['policy_administration_system'], [], [],
        ),
        'seguros/salud': providerRequired(
            'seguros/salud', ['payer_core'], [], [],
        ),
        'event_planning/weddings': conditionalProvider(
            'event_planning/weddings', ['event_management_system'], [], [],
        ),
        'inmobiliaria/promotora': conditionalProvider(
            'inmobiliaria/promotora', ['real_estate_inventory_system'], [], [],
        ),
        'construccion/contratista_general': conditionalProvider(
            'construccion/contratista_general', ['construction_project_management'], [], [],
        ),
        'technology/soporte_ti_msp': conditionalProvider(
            'technology/soporte_ti_msp', ['itsm_psa'], [], [],
        ),
    });

const NATIVE_CONNECTOR_DECLARATIONS: Readonly<Record<string, ProfileSystemOfRecordPolicy>> =
    Object.freeze(Object.fromEntries([
        ...PROVIDER_PROFILE_IDS.toast.map(profileId => [
            profileId,
            conditionalProvider(
                profileId, ['toast'], ['get_restaurant_menu'], ['place_order', 'cancel_order'],
            ),
        ] as const),
        ...PROVIDER_PROFILE_IDS.mindbody.map(profileId => [
            profileId,
            conditionalProvider(
                profileId, ['mindbody'], ['get_fitness_schedule'],
                ['book_class', 'cancel_class_booking'],
            ),
        ] as const),
        ...PROVIDER_PROFILE_IDS.cliniko.map(profileId => [
            profileId,
            conditionalProvider(
                profileId, ['cliniko'],
                ['list_clinic_services', 'check_clinic_availability'],
                ['create_appointment', 'reschedule_appointment', 'cancel_appointment'],
            ),
        ] as const),
    ]));

export function profileSystemOfRecordPolicy(
    profileId: string,
): ProfileSystemOfRecordPolicy | undefined {
    return PROFILE_SYSTEM_OF_RECORD_POLICIES[profileId];
}

/**
 * Authoring/certification view: executable policy first, then approved future
 * boundary, then the conditional boundary already enforced by a native
 * connector binding. It never activates a runtime policy by itself.
 */
export function profileSystemOfRecordDeclaration(
    profileId: string,
): ProfileSystemOfRecordPolicy | undefined {
    return PROFILE_SYSTEM_OF_RECORD_POLICIES[profileId]
        || FUTURE_SYSTEM_OF_RECORD_DECLARATIONS[profileId]
        || NATIVE_CONNECTOR_DECLARATIONS[profileId];
}
