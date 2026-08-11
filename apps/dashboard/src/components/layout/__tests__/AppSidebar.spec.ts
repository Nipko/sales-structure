jest.mock("next/link", () => "a");
jest.mock("next/navigation", () => ({ usePathname: () => "/admin" }));
jest.mock("next-intl", () => ({
  useLocale: () => "es",
  useTranslations: () => Object.assign((key: string) => key, { has: () => false }),
}));
jest.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: unknown }) => children,
  motion: new Proxy({}, { get: (_target, element) => element }),
}));
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, verticalConfig: null }),
}));
jest.mock("@/hooks/useRole", () => ({
  useRole: () => ({ isSuperAdmin: false, impersonating: false }),
}));
jest.mock("@/hooks/useNavigationPreferences", () => ({
  useNavigationPreferences: () => ({ favorites: [] }),
}));
jest.mock("@/lib/api", () => ({ api: {} }));
jest.mock("@/lib/vertical-dashboard-resolver", () => ({
  hasVerticalDashboardItem: () => true,
  resolveVerticalDashboard: () => ({}),
}));
jest.mock("@/components/ui/sheet", () => ({
  Sheet: "div",
  SheetContent: "div",
  SheetTitle: "div",
}));
jest.mock("@/components/ui/tooltip", () => ({
  Tooltip: "div",
  TooltipContent: "div",
  TooltipProvider: "div",
  TooltipTrigger: "div",
}));

import {
  buildSettingsNavigationHref,
  isSegmentAwareNavMatch,
  resolveActiveNavHref,
  resolveVisibleFavoriteRoutes,
} from "../AppSidebar";

describe("AppSidebar route matching", () => {
  it("matches complete route segments and dynamic descendants", () => {
    expect(isSegmentAwareNavMatch("/admin/contacts", "/admin/contacts")).toBe(true);
    expect(isSegmentAwareNavMatch("/admin/contacts/123", "/admin/contacts")).toBe(true);
    expect(isSegmentAwareNavMatch("/admin/contacts/", "/admin/contacts")).toBe(true);
  });

  it("does not activate destinations that only share a string prefix", () => {
    expect(isSegmentAwareNavMatch("/admin/agent-analytics", "/admin/agent")).toBe(false);
    expect(isSegmentAwareNavMatch("/admin/settings-old", "/admin/settings")).toBe(false);
  });

  it("treats the dashboard as an exact root destination", () => {
    expect(isSegmentAwareNavMatch("/admin", "/admin")).toBe(true);
    expect(isSegmentAwareNavMatch("/admin/inbox", "/admin")).toBe(false);
  });

  it("selects only the most specific visible destination", () => {
    expect(resolveActiveNavHref("/admin/contacts/organizations/123", [
      "/admin",
      "/admin/contacts",
      "/admin/contacts/organizations",
    ])).toBe("/admin/contacts/organizations");

    expect(resolveActiveNavHref("/admin/settings/billing", [
      "/admin/settings",
      "/admin/settings/billing",
    ])).toBe("/admin/settings/billing");
  });

  it("returns undefined when no visible destination owns the route", () => {
    expect(resolveActiveNavHref("/admin/unknown", ["/admin", "/admin/inbox"])).toBeUndefined();
  });
});

describe("AppSidebar contextual settings link", () => {
  it("preserves a normalized internal origin", () => {
    expect(buildSettingsNavigationHref("/admin/inbox")).toBe(
      "/admin/settings?returnTo=%2Fadmin%2Finbox",
    );
    expect(buildSettingsNavigationHref("/admin/contacts/abc/")).toBe(
      "/admin/settings?returnTo=%2Fadmin%2Fcontacts%2Fabc",
    );
    expect(buildSettingsNavigationHref("/admin/pipeline?stage=qualified#forecast")).toBe(
      "/admin/settings?returnTo=%2Fadmin%2Fpipeline%3Fstage%3Dqualified%23forecast",
    );
  });

  it("does not create a self-referential return inside Settings", () => {
    expect(buildSettingsNavigationHref("/admin/settings")).toBe("/admin/settings");
    expect(buildSettingsNavigationHref("/admin/settings/profile")).toBe("/admin/settings");
  });

  it("rejects external or malformed origins", () => {
    expect(buildSettingsNavigationHref("https://example.com/admin")).toBe("/admin/settings");
    expect(buildSettingsNavigationHref("//example.com/admin")).toBe("/admin/settings");
    expect(buildSettingsNavigationHref("/outside")).toBe("/admin/settings");
  });
});

describe("AppSidebar visible favorites", () => {
  it("intersects canonical preferences with destinations visible after gating", () => {
    expect(resolveVisibleFavoriteRoutes(
      ["inbox", "analytics", "settings"],
      ["/admin/inbox", "/admin/settings"],
    )).toEqual([
      { routeId: "inbox", href: "/admin/inbox" },
      { routeId: "settings", href: "/admin/settings" },
    ]);
  });

  it("drops dynamic, unknown and duplicated favorite destinations", () => {
    expect(resolveVisibleFavoriteRoutes(
      ["agentDetail", "unknown-route", "inbox", "inbox"],
      ["/admin/agent/:agentId", "/admin/inbox"],
    )).toEqual([{ routeId: "inbox", href: "/admin/inbox" }]);
  });
});
