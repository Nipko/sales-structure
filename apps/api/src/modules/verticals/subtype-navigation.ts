import {
    resolveVerticalCapabilityManifest,
    subtypeTerminologyFor,
    type TenantVerticalConfig,
    type ResolvedVerticalCapabilityManifest,
} from '@parallext/shared';

const PRIMARY_OBJECT_NAV_ITEM: Readonly<Record<string, string>> = Object.freeze({
    appointment: 'appointments', catalog_item: 'inventory', course: 'courses',
    food_order: 'foodOrders', insurance_policy: 'insurance', membership: 'memberships',
    pet: 'pets', pet_boarding: 'resourceRentals', photo_session: 'photoSessions',
    professional_case: 'cases', property_booking: 'properties', real_estate_listing: 'listings',
    service_request: 'serviceRequests', tour_package: 'tours', vehicle: 'vehicles',
    vehicle_rental: 'vehicles',
});

const DAILY_WORK_NAV_ITEM: Readonly<Record<string, string>> = Object.freeze({
    appointment: 'appointments', catalog_item: 'orders', food_order: 'foodOrders',
    pet_boarding: 'resourceRentals', photo_session: 'photoSessions', professional_case: 'cases',
    property_booking: 'stays', service_request: 'serviceRequests', tour_package: 'tourBookings',
    vehicle_rental: 'resourceRentals',
});

export const VERTICAL_ROUTE_NAV_ITEM: Readonly<Record<string, string>> = Object.freeze({
    '/admin/appointments': 'appointments', '/admin/stays': 'stays',
    '/admin/tour-bookings': 'tourBookings', '/admin/resource-rentals': 'resourceRentals',
    '/admin/food-orders': 'foodOrders', '/admin/orders': 'orders',
    '/admin/service-requests': 'serviceRequests', '/admin/classes': 'classes',
    '/admin/photo-sessions': 'photoSessions', '/admin/pets': 'pets', '/admin/cases': 'cases',
    '/admin/memberships': 'memberships', '/admin/insurance': 'insurance',
    '/admin/properties': 'properties', '/admin/tours': 'tours', '/admin/listings': 'listings',
    '/admin/vehicles': 'vehicles', '/admin/menu': 'menu', '/admin/courses': 'courses',
    '/admin/treatment-plans': 'treatmentPlans', '/admin/service-catalog': 'serviceCatalog',
    '/admin/inventory': 'inventory',
});

// A work-order screen does not exist yet; renaming vehicle inventory would
// conceal the gap instead of fixing it.
const SUBTYPE_NAVIGATION_REVIEW = new Set(['automotriz/taller']);

/**
 * Pure subtype menu projection shared by tenant config, the authoring ledger
 * and tests. Consumers may inject the service resolver to preserve publication
 * fencing; the platform catalogue uses the canonical manifest directly.
 */
export function withSubtypeNavigation(
    config: TenantVerticalConfig,
    resolveManifest: (industry: string, subtype?: string | null) => ResolvedVerticalCapabilityManifest =
        (industry, subtype) => resolveVerticalCapabilityManifest(industry, subtype),
): TenantVerticalConfig {
    let manifest: ResolvedVerticalCapabilityManifest;
    try {
        manifest = resolveManifest(config.industry, config.subType);
    } catch {
        return config;
    }
    const declaredRouteOrder = manifest.routes
        .map(route => VERTICAL_ROUTE_NAV_ITEM[route])
        .filter((key): key is string => !!key);
    const dailyWorkItem = DAILY_WORK_NAV_ITEM[manifest.primaryObject];
    const routeOrder = dailyWorkItem && declaredRouteOrder.includes(dailyWorkItem)
        ? [dailyWorkItem, ...declaredRouteOrder.filter(item => item !== dailyWorkItem)]
        : declaredRouteOrder;
    const itemOrder = [...new Set([...routeOrder, ...(config.sidebar?.itemOrder || [])])];
    const labelOverrides = { ...(config.sidebar?.labelOverrides || {}) };
    const terms = subtypeTerminologyFor(config.industry, config.subType);
    const primaryItem = PRIMARY_OBJECT_NAV_ITEM[manifest.primaryObject];
    const profileId = `${config.industry}/${config.subType || '__none__'}`;
    if (!SUBTYPE_NAVIGATION_REVIEW.has(profileId)
        && primaryItem && routeOrder.includes(primaryItem)) {
        const label = terms?.primaryObjectPlural || terms?.primaryObject;
        if (label) labelOverrides[primaryItem] = { ...label };
    }
    return {
        ...config,
        sidebar: { ...config.sidebar, labelOverrides, itemOrder },
    };
}
