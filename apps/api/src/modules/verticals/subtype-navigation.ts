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
    vehicle_rental: 'vehicles', repair_order: 'repairOrders',
});

const DAILY_WORK_NAV_ITEM: Readonly<Record<string, string>> = Object.freeze({
    appointment: 'appointments', catalog_item: 'orders', food_order: 'foodOrders',
    pet_boarding: 'resourceRentals', photo_session: 'photoSessions', professional_case: 'cases',
    property_booking: 'stays', service_request: 'serviceRequests', tour_package: 'tourBookings',
    vehicle_rental: 'resourceRentals',
    repair_order: 'repairOrders',
});

const DAILY_WORK_LABEL: Readonly<Record<string, Readonly<Record<'es' | 'en' | 'pt' | 'fr', string>>>> = Object.freeze({
    vehicle_rental: Object.freeze({
        es: 'Reservas', en: 'Reservations', pt: 'Reservas', fr: 'Réservations',
    }),
});

export const VERTICAL_ROUTE_NAV_ITEM: Readonly<Record<string, string>> = Object.freeze({
    '/admin/appointments': 'appointments', '/admin/stays': 'stays',
    '/admin/tour-bookings': 'tourBookings', '/admin/resource-rentals': 'resourceRentals',
    '/admin/repair-orders': 'repairOrders',
    '/admin/food-orders': 'foodOrders', '/admin/orders': 'orders',
    '/admin/service-requests': 'serviceRequests', '/admin/classes': 'classes',
    '/admin/photo-sessions': 'photoSessions', '/admin/pets': 'pets', '/admin/cases': 'cases',
    '/admin/memberships': 'memberships', '/admin/insurance': 'insurance',
    '/admin/properties': 'properties', '/admin/tours': 'tours', '/admin/listings': 'listings',
    '/admin/vehicles': 'vehicles', '/admin/menu': 'menu', '/admin/courses': 'courses',
    '/admin/treatment-plans': 'treatmentPlans', '/admin/service-catalog': 'serviceCatalog',
    '/admin/inventory': 'inventory',
});

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
    const verticalNavigationItems = new Set(Object.values(VERTICAL_ROUTE_NAV_ITEM));
    const compatibleExistingOrder = (config.sidebar?.itemOrder || []).filter(item => (
        !verticalNavigationItems.has(item) || declaredRouteOrder.includes(item)
    ));
    const itemOrder = [...new Set([...routeOrder, ...compatibleExistingOrder])];
    const labelOverrides = { ...(config.sidebar?.labelOverrides || {}) };
    const terms = subtypeTerminologyFor(config.industry, config.subType);
    const primaryItem = PRIMARY_OBJECT_NAV_ITEM[manifest.primaryObject];
    if (primaryItem && routeOrder.includes(primaryItem)) {
        const label = terms?.primaryObjectPlural || terms?.primaryObject;
        if (label) labelOverrides[primaryItem] = { ...label };
    }
    if (dailyWorkItem && routeOrder.includes(dailyWorkItem) && DAILY_WORK_LABEL[manifest.primaryObject]) {
        labelOverrides[dailyWorkItem] = { ...DAILY_WORK_LABEL[manifest.primaryObject] };
    }
    return {
        ...config,
        sidebar: { ...config.sidebar, labelOverrides, itemOrder },
    };
}
