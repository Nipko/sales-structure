import type { VerticalCapability, VerticalToolGroup } from '@parallext/shared';

/**
 * Runtime-backed relation between the capability manifest and config.tools.*.
 * Kept outside the matrix runner so production creation defaults and static
 * contract checks consume the same exhaustive mapping.
 */
export const VERTICAL_TOOL_CAPABILITY: Readonly<Record<VerticalToolGroup, VerticalCapability>> = {
    faqs: 'faq_search',
    appointments: 'appointment_booking',
    catalog: 'catalog_search',
    treatments: 'treatment_management',
    realEstate: 'real_estate_listings',
    restaurants: 'restaurant_ordering',
    vehicles: 'vehicle_inventory',
    tours: 'tour_booking',
    properties: 'nightly_booking',
    education: 'course_enrollment',
    professionalServices: 'professional_case_lookup',
    pets: 'pet_records',
    gyms: 'membership_management',
    insurance: 'insurance_operations',
    homeServices: 'service_requests',
    petServices: 'pet_services',
    vehicleRentals: 'vehicle_rentals',
    petBoarding: 'pet_boarding',
    photography: 'photo_sessions',
};
