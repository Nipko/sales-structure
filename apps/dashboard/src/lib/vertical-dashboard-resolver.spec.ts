import {
  VERTICAL_MANIFEST_INDUSTRIES,
  listVerticalCapabilityConfigurations,
  resolveVerticalCapabilityManifest,
} from "@parallext/shared";
import type { VerticalRoutePath } from "@parallext/shared";
import {
  resolveVerticalDashboard,
  type VerticalDashboardItem,
} from "./vertical-dashboard-resolver";

const OPERATIONAL_ROUTE_ITEMS: Readonly<Partial<Record<VerticalRoutePath, VerticalDashboardItem>>> = {
  "/admin/appointments": "appointments",
  "/admin/properties": "properties",
  "/admin/tours": "tours",
  "/admin/listings": "listings",
  "/admin/vehicles": "vehicles",
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
    expect(resolveCanonical("turismo", "hotel").visibleItems).toEqual(["properties"]);
    expect(resolveCanonical("turismo", "alquiler_vacacional").visibleItems).toEqual(["properties"]);
    expect(resolveCanonical("turismo", "agencia_viajes").visibleItems).toEqual(["appointments", "tours"]);
    expect(resolveCanonical("turismo", "tours").visibleItems).toEqual(["appointments", "tours"]);
    expect(resolveCanonical("salud", "farmacia").visibleItems).toEqual(["inventory"]);
    expect(resolveCanonical("restaurantes", "dark_kitchen").visibleItems).toEqual(["menu", "foodOrders"]);
  });

  it("keeps legacy boutique inventory-only and supports manifest/industry fallbacks", () => {
    const boutique = resolveVerticalCapabilityManifest("moda_belleza", "boutique");
    expect(resolveVerticalDashboard({
      industry: "moda_belleza",
      subType: "boutique",
      effectiveCapabilities: boutique.capabilities,
    }).visibleItems).toEqual(["inventory"]);

    const resolvedFallback = resolveVerticalDashboard({ industry: "turismo", subType: "hotel" });
    expect(resolvedFallback.source).toBe("resolved_manifest_fallback");
    expect(resolvedFallback.visibleItems).toEqual(["properties"]);

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
});
