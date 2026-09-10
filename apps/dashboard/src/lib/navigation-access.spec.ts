import { canAccessPath, ROLE_KEYS } from "./roles";
import { NAVIGATION_ROUTES } from "./navigation-contract";
import {
  canAccessDashboardNavigationPath,
  resolveAccessDeniedNavigation,
} from "./navigation-access";

/**
 * A concrete path for a pattern. `roles.ts` matches by prefix, so what fills a
 * `:param` never matters — only that something does, since an unsubstituted
 * `:tenantId` would be matched as a literal segment.
 */
const concrete = (pattern: string) => pattern.replace(/:[A-Za-z0-9_]+/g, "x");

describe("access-denied navigation recovery", () => {
  it("returns each role to its stable product home", () => {
    expect(resolveAccessDeniedNavigation(
      "/admin/inbox",
      ROLE_KEYS.SUPER_ADMIN,
      false,
    )).toBe("/admin/tenants");

    expect(resolveAccessDeniedNavigation(
      "/admin/contacts/organizations",
      ROLE_KEYS.TENANT_AGENT,
      false,
    )).toBe("/admin/inbox");

    expect(resolveAccessDeniedNavigation(
      "/admin/feature-requests",
      ROLE_KEYS.TENANT_VIEWER,
      false,
    )).toBe("/admin/settings/profile");
  });

  it("fails closed for product surfaces outside the tenant vertical", () => {
    const hotel = {
      industry: "turismo",
      subType: "hotel",
      manifestVersion: 2,
      effectiveCapabilities: ["crm_pipeline", "faq_search", "nightly_booking"],
    };
    expect(canAccessDashboardNavigationPath(
      "/admin/properties",
      ROLE_KEYS.TENANT_ADMIN,
      false,
      hotel,
    )).toBe(true);
    expect(canAccessDashboardNavigationPath(
      "/admin/courses",
      ROLE_KEYS.TENANT_ADMIN,
      false,
      hotel,
    )).toBe(false);
    expect(resolveAccessDeniedNavigation(
      "/admin/courses",
      ROLE_KEYS.TENANT_ADMIN,
      false,
      hotel,
    )).toBe("/admin");
  });

  /**
   * The declared scope and the access rules have to be about the same audience.
   *
   * `scope` is not decoration: it decides the return target when a page has no
   * reachable parent, and it is what `sanitizeInternalReturnTo` filters on. A
   * route declared `platform` that a platform-mode super_admin cannot open names
   * the one role it excludes — which is how `/admin/channels/certification`,
   * served by the API to three tenant roles and reached through the
   * `/admin/channels` rule, came to be labelled platform.
   *
   * Both directions, because either is a lie about who the page is for.
   */
  describe("what a route says it is, and who can open it", () => {
    const openableInPlatformMode = (pattern: string) =>
      canAccessPath(concrete(pattern), ROLE_KEYS.SUPER_ADMIN, false);
    const openableByATenantRole = (pattern: string) =>
      [ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT]
        .some((role) => canAccessPath(concrete(pattern), role, false));

    it("lets a platform-mode super_admin open every route that claims platform scope", () => {
      const unreachable = NAVIGATION_ROUTES
        .filter((route) => route.scope === "platform" && !openableInPlatformMode(route.pattern))
        .map((route) => `${route.id}: ${route.pattern}`);
      expect({ unreachable }).toEqual({ unreachable: [] });
    });

    it("lets some tenant role open every route that claims tenant scope", () => {
      const unreachable = NAVIGATION_ROUTES
        .filter((route) => route.scope === "tenant" && !openableByATenantRole(route.pattern))
        .map((route) => `${route.id}: ${route.pattern}`);
      expect({ unreachable }).toEqual({ unreachable: [] });
    });
  });

  it("fails closed for vertical-only routes until tenant capabilities are known", () => {
    expect(canAccessDashboardNavigationPath(
      "/admin/courses",
      ROLE_KEYS.TENANT_ADMIN,
      false,
      null,
    )).toBe(false);
    expect(canAccessDashboardNavigationPath(
      "/admin/inbox",
      ROLE_KEYS.TENANT_ADMIN,
      false,
      null,
    )).toBe(true);
  });
});
