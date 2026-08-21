import {
  VERTICAL_CAPABILITY_MANIFEST_VERSION,
  VERTICAL_MANIFEST_INDUSTRIES,
  listVerticalCapabilityConfigurations,
  resolveVerticalCapabilityManifest,
} from "@parallext/shared";
import type { VerticalRoutePath } from "@parallext/shared";
import {
  getVerticalDashboardItemForPath,
  isVerticalDashboardPathVisible,
  resolveVerticalDashboard,
  type VerticalDashboardItem,
} from "./vertical-dashboard-resolver";

const OPERATIONAL_ROUTE_ITEMS: Readonly<Partial<Record<VerticalRoutePath, VerticalDashboardItem>>> = {
  "/admin/appointments": "appointments",
  // El registro operativo va junto a su catálogo: una vertical que vende
  // estadías o salidas tiene que exponer las dos cosas, no solo la ficha.
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
  // Los casos de un estudio: el objeto PRIMARIO del rubro, que hasta ahora
  // no tenía pantalla y dejaba al equipo abriendo el embudo de ventas.
  "/admin/cases": "cases",
  "/admin/inventory": "inventory",
  "/admin/orders": "orders",
};

function resolveCanonical(industry: string, subtype: string | null) {
  const manifest = resolveVerticalCapabilityManifest(industry, subtype);
  return resolveVerticalDashboard({
    industry,
    subType: subtype,
    manifestVersion: manifest.manifestVersion,
    effectiveCapabilities: manifest.capabilities,
  });
}

describe("resolveVerticalDashboard", () => {
  it("projects all 76 canonical configurations across all 18 verticals", () => {
    const configurations = listVerticalCapabilityConfigurations();
    expect(configurations).toHaveLength(76);
    expect(VERTICAL_MANIFEST_INDUSTRIES).toHaveLength(18);
    expect(new Set(configurations.map(({ industry }) => industry))).toEqual(
      new Set(VERTICAL_MANIFEST_INDUSTRIES),
    );

    for (const manifest of configurations) {
      const result = resolveCanonical(manifest.industry, manifest.subtype);
      const expectedItems = [...new Set(
        manifest.routes
          .map((route) => OPERATIONAL_ROUTE_ITEMS[route])
          .filter((item): item is VerticalDashboardItem => !!item),
      )].sort();

      expect({ industry: manifest.industry, subtype: manifest.subtype, source: result.source }).toEqual({
        industry: manifest.industry,
        subtype: manifest.subtype,
        source: "effective_capabilities",
      });
      expect([...result.visibleItems].sort()).toEqual(expectedItems);
      if (result.primaryTourItem) {
        expect(result.visibleItems).toContain(result.primaryTourItem);
      }
    }
  });

  it("resolves subtype-sensitive tourism, pharmacy and dark-kitchen navigation", () => {
    // El registro va PRIMERO que su catálogo: es el objeto que se trabaja todos
    // los días, y encontrar una reserva no puede exigir abrir antes el producto
    // que la vende.
    expect(resolveCanonical("turismo", "hotel").visibleItems).toEqual(["stays", "properties"]);
    expect(resolveCanonical("turismo", "alquiler_vacacional").visibleItems).toEqual(["stays", "properties"]);
    expect(resolveCanonical("turismo", "agencia_viajes").visibleItems).toEqual(["tourBookings", "tours"]);
    expect(resolveCanonical("turismo", "tours").visibleItems).toEqual(["tourBookings", "tours"]);
    // Una farmacia toma pedidos: el manifiesto publicaba Inventario y omitía
    // Pedidos, así que el agente creaba la orden y el dueño no tenía dónde verla.
    expect(resolveCanonical("salud", "farmacia").visibleItems).toEqual(["inventory", "orders"]);
    expect(resolveCanonical("restaurantes", "dark_kitchen").visibleItems).toEqual(["menu", "foodOrders"]);
  });

  it("exposes the resource-rental workspace only for rental and boarding capabilities", () => {
    const vehicleRental = resolveCanonical("automotriz", "alquiler");
    expect(vehicleRental.visibleItems).toEqual(["vehicles", "resourceRentals"]);
    expect(vehicleRental.primaryTourItem).toBe("resourceRentals");

    for (const subtype of ["guarderia", "hotel"] as const) {
      const petBoarding = resolveCanonical("pet_services", subtype);
      expect(petBoarding.visibleItems).toEqual(["resourceRentals", "pets"]);
      expect(petBoarding.primaryTourItem).toBe("resourceRentals");
    }

    expect(resolveCanonical("automotriz", "concesionario").visibleItems).not.toContain("resourceRentals");
    expect(resolveCanonical("pet_services", "peluqueria").visibleItems).not.toContain("resourceRentals");
  });

  it("keeps legacy boutique inventory-only and supports manifest/industry fallbacks", () => {
    const boutique = resolveVerticalCapabilityManifest("moda_belleza", "boutique");
    expect(resolveVerticalDashboard({
      industry: "moda_belleza",
      subType: "boutique",
      manifestVersion: boutique.manifestVersion,
      effectiveCapabilities: boutique.capabilities,
    }).visibleItems).toEqual(["inventory"]);

    const resolvedFallback = resolveVerticalDashboard({ industry: "turismo", subType: "hotel" });
    expect(resolvedFallback.source).toBe("legacy_industry_fallback");
    expect(resolvedFallback.visibleItems).toEqual(["appointments", "properties", "tours"]);

    const broadLegacyFallback = resolveVerticalDashboard({ industry: "turismo" });
    expect(broadLegacyFallback.source).toBe("legacy_industry_fallback");
    expect(broadLegacyFallback.visibleItems).toEqual(["appointments", "properties", "tours"]);

    const explicitEmptyCapabilities = resolveVerticalDashboard({
      industry: "turismo",
      subType: "hotel",
      effectiveCapabilities: [],
    });
    expect(explicitEmptyCapabilities.source).toBe("effective_capabilities");
    expect(explicitEmptyCapabilities.visibleItems).toEqual([]);
  });

  it("does not filter a published v1 capability contract through v2 routes", () => {
    const legacyHotel = resolveVerticalDashboard({
      industry: "turismo",
      subType: "hotel",
      manifestVersion: 1,
      effectiveCapabilities: ["crm_pipeline", "faq_search", "appointment_booking"],
    });

    expect(legacyHotel.source).toBe("effective_capabilities");
    expect(legacyHotel.visibleItems).toEqual(["appointments"]);

    expect(resolveVerticalDashboard({
      industry: "technology",
      subType: "hardware",
      manifestVersion: 1,
      effectiveCapabilities: ["appointment_booking"],
    }).visibleItems).toEqual(["appointments"]);
    expect(resolveVerticalDashboard({
      industry: "automotriz",
      subType: "repuestos",
      manifestVersion: 1,
      effectiveCapabilities: ["appointment_booking", "vehicle_inventory"],
    }).visibleItems).toEqual(["appointments", "vehicles"]);
    expect(resolveVerticalDashboard({
      industry: "servicios_hogar",
      subType: "plomeria",
      manifestVersion: 1,
      effectiveCapabilities: ["appointment_booking", "service_requests"],
    }).visibleItems).toEqual(["appointments", "serviceRequests"]);
  });

  it("fails closed when a current manifest is missing its capability publication", () => {
    expect(resolveVerticalDashboard({
      industry: "turismo",
      subType: "hotel",
      manifestVersion: VERTICAL_CAPABILITY_MANIFEST_VERSION,
    }).visibleItems).toEqual([]);
  });

  it("applies the same vertical visibility to every navigation entry point", () => {
    const hotel = resolveCanonical("turismo", "hotel");
    expect(getVerticalDashboardItemForPath("/admin/tours/abc?tab=inventory")).toBe("tours");
    expect(isVerticalDashboardPathVisible(hotel, "/admin/properties")).toBe(true);
    expect(isVerticalDashboardPathVisible(hotel, "/admin/tours")).toBe(false);
    expect(isVerticalDashboardPathVisible(hotel, "/admin/menu")).toBe(false);
    expect(isVerticalDashboardPathVisible(hotel, "/admin/catalog")).toBe(false);
    expect(isVerticalDashboardPathVisible(hotel, "/admin/catalog/courses")).toBe(false);
    expect(isVerticalDashboardPathVisible(hotel, "/admin/landings")).toBe(false);
    expect(isVerticalDashboardPathVisible(hotel, "/admin/catalog/offers")).toBe(true);
    expect(isVerticalDashboardPathVisible(hotel, "/admin/contacts")).toBe(true);

    const education = resolveCanonical("education", "capacitacion");
    expect(isVerticalDashboardPathVisible(education, "/admin/catalog")).toBe(true);
  });
});
