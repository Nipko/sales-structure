import {
  VERTICAL_CAPABILITY_MANIFEST_VERSION,
  VERTICAL_CAPABILITY_MANIFEST,
  resolveVerticalCapabilityManifest,
} from "@parallext/shared";
import type {
  ResolvedVerticalCapabilityManifest,
  VerticalCapability,
  VerticalRoutePath,
} from "@parallext/shared";

export const VERTICAL_DASHBOARD_ITEMS = [
  "appointments",
  // `stays` and `tourBookings` are the OPERATIONAL registers; `properties` and
  // `tours` are the catalogues that configure them. They are separate items
  // because they are separate jobs with separate permissions.
  "stays",
  "properties",
  "tourBookings",
  "tours",
  "listings",
  "vehicles",
  "resourceRentals",
  "menu",
  "foodOrders",
  "memberships",
  "classes",
  "courses",
  "insurance",
  "serviceRequests",
  "treatmentPlans",
  "pets",
  "photoSessions",
  // El catálogo de paquetes de las verticales que venden servicios sin agendar
  // franjas. Es el ítem de catálogo, no el registro operativo.
  "serviceCatalog",
  "inventory",
  "orders",
] as const;

export type VerticalDashboardItem = typeof VERTICAL_DASHBOARD_ITEMS[number];
export type VerticalDashboardResolutionSource =
  | "effective_capabilities"
  | "resolved_manifest_fallback"
  | "legacy_industry_fallback";

export interface DashboardVerticalConfigLike {
  industry?: unknown;
  subType?: unknown;
  subtype?: unknown;
  manifestVersion?: unknown;
  effectiveCapabilities?: unknown;
}

export interface VerticalDashboardResolution {
  source: VerticalDashboardResolutionSource;
  capabilities: readonly VerticalCapability[];
  visibleItems: readonly VerticalDashboardItem[];
  discoveryItems: readonly VerticalDashboardItem[];
  primaryTourItem: VerticalDashboardItem | null;
}

const CAPABILITY_ITEMS: Readonly<Partial<Record<VerticalCapability, readonly VerticalDashboardItem[]>>> = {
  appointment_booking: ["appointments"],
  catalog_search: ["inventory", "orders"],
  treatment_management: ["treatmentPlans"],
  real_estate_listings: ["listings"],
  restaurant_ordering: ["menu", "foodOrders"],
  vehicle_inventory: ["vehicles"],
  vehicle_rentals: ["resourceRentals"],
  tour_booking: ["tourBookings", "tours"],
  nightly_booking: ["stays", "properties"],
  course_enrollment: ["courses"],
  pet_records: ["pets"],
  membership_management: ["memberships", "classes"],
  insurance_operations: ["insurance"],
  service_requests: ["serviceRequests"],
  pet_services: ["pets"],
  pet_boarding: ["resourceRentals"],
  photo_sessions: ["photoSessions"],
};

const ROUTE_ITEMS: Readonly<Partial<Record<VerticalRoutePath, VerticalDashboardItem>>> = {
  "/admin/appointments": "appointments",
  "/admin/stays": "stays",
  "/admin/properties": "properties",
  "/admin/tour-bookings": "tourBookings",
  "/admin/tours": "tours",
  "/admin/listings": "listings",
  "/admin/vehicles": "vehicles",
  "/admin/resource-rentals": "resourceRentals",
  "/admin/menu": "menu",
  "/admin/food-orders": "foodOrders",
  "/admin/memberships": "memberships",
  "/admin/classes": "classes",
  "/admin/courses": "courses",
  "/admin/insurance": "insurance",
  "/admin/service-requests": "serviceRequests",
  "/admin/treatment-plans": "treatmentPlans",
  "/admin/pets": "pets",
  "/admin/photo-sessions": "photoSessions",
  "/admin/service-catalog": "serviceCatalog",
  "/admin/inventory": "inventory",
  "/admin/orders": "orders",
};

const NAVIGATION_ROUTE_ITEMS: Readonly<Record<string, VerticalDashboardItem | null>> = {
  ...ROUTE_ITEMS,
  // This legacy catalog hub is the education catalog (courses, acquisition
  // campaigns and their offers), not the cross-vertical inventory surface.
  "/admin/catalog": "courses",
  "/admin/catalog/courses": "courses",
  "/admin/catalog/campaigns": "courses",
  // Offers are intentionally cross-vertical even though their historical URL
  // lives below the education catalog hub.
  "/admin/catalog/offers": null,
  "/admin/landings": "courses",
};

/**
 * Resolve the vertical product surface owned by a dashboard path. Keeping this
 * mapping beside the capability projection lets every navigation entry point
 * (sidebar, command palette, recents and quick actions) apply the same rules.
 */
export function getVerticalDashboardItemForPath(
  pathname: string,
): VerticalDashboardItem | null {
  const normalized = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  const candidates = Object.entries(NAVIGATION_ROUTE_ITEMS)
    .sort(([left], [right]) => right.length - left.length);
  const match = candidates.find(([route]) => (
    normalized === route || normalized.startsWith(`${route}/`)
  ));
  return match?.[1] || null;
}

/** Paths outside the vertical operation surfaces remain globally navigable. */
export function isVerticalDashboardPathVisible(
  resolution: VerticalDashboardResolution,
  pathname: string,
): boolean {
  const item = getVerticalDashboardItemForPath(pathname);
  return !item || resolution.visibleItems.includes(item);
}

/** Domain-first ordering shared by setup discovery and the product tour. */
const DISCOVERY_ORDER: readonly VerticalDashboardItem[] = [
  "properties",
  "tours",
  "listings",
  "resourceRentals",
  "vehicles",
  "menu",
  "foodOrders",
  "treatmentPlans",
  "inventory",
  "orders",
  "memberships",
  "classes",
  "courses",
  "insurance",
  "serviceRequests",
  "pets",
  "photoSessions",
  "serviceCatalog",
  "appointments",
];

/**
 * Last-resort compatibility for cached/pre-manifest tenants with no subtype.
 * It intentionally mirrors the broad former sidebar instead of guessing one
 * subtype. Once effectiveCapabilities arrives this map is never consulted.
 */
const LEGACY_INDUSTRY_ITEMS: Readonly<Record<string, readonly VerticalDashboardItem[]>> = {
  salud: ["appointments", "treatmentPlans"],
  moda_belleza: ["appointments"],
  inmobiliaria: ["appointments", "listings"],
  restaurantes: ["appointments", "menu", "foodOrders", "inventory", "orders"],
  automotriz: ["appointments", "vehicles"],
  turismo: ["appointments", "properties", "tours"],
  education: ["appointments", "courses"],
  finanzas: ["appointments"],
  servicios_profesionales: ["appointments"],
  retail: ["inventory", "orders"],
  technology: ["appointments"],
  veterinaria: ["appointments", "treatmentPlans", "pets"],
  gimnasios: ["appointments", "memberships", "classes"],
  seguros: ["insurance"],
  servicios_hogar: ["appointments", "serviceRequests"],
  pet_services: ["appointments", "pets"],
  fotografia: ["appointments", "photoSessions"],
  otro: ["inventory", "orders"],
};

function normalizedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function tryResolveManifest(
  industry: string | null,
  subtype: string | null,
): ResolvedVerticalCapabilityManifest | null {
  if (!industry || !Object.prototype.hasOwnProperty.call(VERTICAL_CAPABILITY_MANIFEST, industry)) {
    return null;
  }
  const entry = VERTICAL_CAPABILITY_MANIFEST[industry as keyof typeof VERTICAL_CAPABILITY_MANIFEST];
  // A missing subtype on a subtype-bearing legacy record is ambiguous. Do not
  // silently select the base profile: preserve the broad historical fallback.
  if (entry.subtypes.length > 0 && !subtype) return null;
  try {
    return resolveVerticalCapabilityManifest(industry, subtype);
  } catch {
    return null;
  }
}

function itemsFromCapabilities(capabilities: readonly VerticalCapability[]): Set<VerticalDashboardItem> {
  const items = new Set<VerticalDashboardItem>();
  for (const capability of capabilities) {
    for (const item of CAPABILITY_ITEMS[capability] || []) items.add(item);
  }
  return items;
}

function routeItems(manifest: ResolvedVerticalCapabilityManifest | null): Set<VerticalDashboardItem> | null {
  if (!manifest) return null;
  const items = new Set<VerticalDashboardItem>();
  for (const route of manifest.routes) {
    const item = ROUTE_ITEMS[route];
    if (item) items.add(item);
  }
  return items;
}

function orderItems(items: ReadonlySet<VerticalDashboardItem>): VerticalDashboardItem[] {
  return VERTICAL_DASHBOARD_ITEMS.filter((item) => items.has(item));
}

function finishResolution(
  source: VerticalDashboardResolutionSource,
  capabilities: readonly VerticalCapability[],
  items: ReadonlySet<VerticalDashboardItem>,
): VerticalDashboardResolution {
  const visibleItems = orderItems(items);
  const discoveryItems = DISCOVERY_ORDER.filter((item) => items.has(item));
  return {
    source,
    capabilities,
    visibleItems,
    discoveryItems,
    primaryTourItem: discoveryItems[0] || null,
  };
}

/**
 * Capability-first dashboard projection.
 *
 * Effective capabilities decide WHAT is enabled. The resolved manifest routes
 * decide WHICH page represents it for the subtype (pharmacy vs retail,
 * hotel/properties vs agency/tours). No per-subtype rules live in the dashboard.
 */
export function resolveVerticalDashboard(
  input: DashboardVerticalConfigLike | null | undefined,
): VerticalDashboardResolution {
  const config = input || {};
  const industry = normalizedString(config.industry);
  const subtype = normalizedString(config.subType ?? config.subtype);
  const manifest = tryResolveManifest(industry, subtype);

  if (Array.isArray(config.effectiveCapabilities)) {
    const capabilities = [...new Set(
      config.effectiveCapabilities.filter((value): value is VerticalCapability => (
        typeof value === "string" && Object.prototype.hasOwnProperty.call(CAPABILITY_ITEMS, value)
          || value === "crm_pipeline"
          || value === "faq_search"
          || value === "professional_case_lookup"
      )),
    )];
    const items = itemsFromCapabilities(capabilities);
    // Route filtering belongs to the same versioned publication as the
    // capability list. Applying v2 routes to a stored v1 capability contract
    // can silently hide the tenant's last known-good module while migration is
    // pending (for example, legacy tourism appointments).
    const allowedRoutes = config.manifestVersion === VERTICAL_CAPABILITY_MANIFEST_VERSION
      ? routeItems(manifest)
      : null;
    if (allowedRoutes) {
      for (const item of [...items]) {
        if (!allowedRoutes.has(item)) items.delete(item);
      }
    }
    return finishResolution("effective_capabilities", capabilities, items);
  }

  if (config.manifestVersion === VERTICAL_CAPABILITY_MANIFEST_VERSION) {
    // A current-version config without its capability array is incomplete.
    // Never reconstruct and publish the contract client-side.
    return finishResolution("effective_capabilities", [], new Set());
  }

  return finishResolution(
    "legacy_industry_fallback",
    [],
    new Set(LEGACY_INDUSTRY_ITEMS[industry || ""] || []),
  );
}

export function hasVerticalDashboardItem(
  resolution: VerticalDashboardResolution,
  item: VerticalDashboardItem,
): boolean {
  return resolution.visibleItems.includes(item);
}
