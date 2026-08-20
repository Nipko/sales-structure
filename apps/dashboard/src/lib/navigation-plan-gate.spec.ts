import {
  NAVIGATION_PLAN_FEATURE,
  PLAN_GATED_NAVIGATION_PATHS,
  navigationPlanDecision,
  planFeatureForPath,
} from "@parallext/shared";
import { NAVIGATION_ROUTES } from "./navigation-contract";

/**
 * Ninguna opción visible termina en 403.
 *
 * La navegación decidía por rol y por vertical, nunca por plan, mientras el
 * backend sí gatea con `@RequireFeature` y devuelve `feature_not_available`.
 * El dueño hacía clic y no llegaba a ningún lado: no aprendía que existe un
 * plan que la incluye, aprendía que la aplicación falla.
 */
describe("navigation plan gate", () => {
  it("only gates routes that actually exist in the registry", () => {
    const known = new Set(NAVIGATION_ROUTES.map((route) => route.pattern));
    expect(PLAN_GATED_NAVIGATION_PATHS.length).toBeGreaterThan(0);
    for (const path of PLAN_GATED_NAVIGATION_PATHS) {
      expect(known.has(path as `/admin${string}`)).toBe(true);
    }
  });

  it("leaves an ungated route alone", () => {
    expect(navigationPlanDecision("/admin/contacts", {})).toBe("enabled");
    expect(planFeatureForPath("/admin/contacts")).toBeNull();
  });

  it("locks a gated route when the plan says false", () => {
    expect(navigationPlanDecision("/admin/vehicles", { vehicleInventory: false })).toBe("locked");
    expect(navigationPlanDecision("/admin/settings/recall", { recall: false })).toBe("locked");
  });

  it("opens a gated route when the plan says true", () => {
    expect(navigationPlanDecision("/admin/vehicles", { vehicleInventory: true })).toBe("enabled");
  });

  /**
   * Lo desconocido NO es lo mismo que lo denegado: esconder medio menú porque
   * una consulta no volvió es peor que un clic que rebota, y el backend enforza
   * igual, así que no se abre ningún permiso.
   */
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty object", {}],
    ["a key present but null", { vehicleInventory: null }],
  ])("reports unknown, not locked, when the plan is %s", (_label, features) => {
    expect(navigationPlanDecision("/admin/vehicles", features as any)).toBe("unknown");
  });

  /** Las claves de cupo usan -1 = ilimitado y 0 = no lo tenés. */
  it("reads numeric quota keys the way the plan writes them", () => {
    const numericPath = PLAN_GATED_NAVIGATION_PATHS[0];
    const feature = NAVIGATION_PLAN_FEATURE[numericPath];
    expect(navigationPlanDecision(numericPath, { [feature]: 0 })).toBe("locked");
    expect(navigationPlanDecision(numericPath, { [feature]: -1 })).toBe("enabled");
    expect(navigationPlanDecision(numericPath, { [feature]: 3 })).toBe("enabled");
  });

  it("ignores a query string or a trailing slash", () => {
    expect(navigationPlanDecision("/admin/vehicles/", { vehicleInventory: false })).toBe("locked");
    expect(navigationPlanDecision("/admin/vehicles?tab=all", { vehicleInventory: false })).toBe("locked");
  });

  it("does not choke on a path that is not a string", () => {
    expect(navigationPlanDecision(undefined as any, { vehicleInventory: false })).toBe("enabled");
  });
});
