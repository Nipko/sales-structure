import { ROLE_KEYS } from "./roles";
import {
  canAccessDashboardNavigationPath,
  resolveAccessDeniedNavigation,
} from "./navigation-access";

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
