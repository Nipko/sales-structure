import fs from "node:fs";
import path from "node:path";
import {
  NAVIGATION_I18N_KEYS_REQUIRED,
  NAVIGATION_ROUTES,
  buildNavigationBreadcrumbs,
  getNavigationRoute,
  isSegmentAwareNavigationMatch,
  normalizeNavigationPath,
  navigationItemKeyFromTitleKey,
  resolveNavigationDisplayLabel,
  resolveNavigationReturnTarget,
  resolveNavigationRoute,
  sanitizeInternalReturnTo,
  selectActiveNavigationTarget,
} from "./navigation-contract";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

function materializeForTest(pattern: string): string {
  return pattern.replace(/:[^/]+/g, UUID);
}

function collectAdminPagePatterns(directory: string, relative = ""): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectAdminPagePatterns(entryPath, entryRelative);
    if (!entry.isFile() || entry.name !== "page.tsx") return [];

    const directoryPart = entryRelative === "page.tsx"
      ? ""
      : entryRelative.replace(/\/page\.tsx$/, "");
    const route = directoryPart ? `/admin/${directoryPart}` : "/admin";
    return [route.replace(/\[([^\]]+)\]/g, ":$1")];
  });
}

function readLocale(locale: string): unknown {
  const file = path.resolve(__dirname, `../../messages/${locale}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function hasMessageKey(messages: unknown, key: string): boolean {
  let cursor: unknown = messages;
  for (const segment of key.split(".")) {
    if (!cursor || typeof cursor !== "object" || !(segment in cursor)) return false;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === "string";
}

describe("canonical navigation registry", () => {
  it("shares vertical terminology across navigation surfaces", () => {
    expect(navigationItemKeyFromTitleKey("nav.items.crm")).toBe("crm");
    expect(navigationItemKeyFromTitleKey("navigation.routes.contactDetail")).toBeNull();
    expect(resolveNavigationDisplayLabel("crm", "CRM", "es-CO", {
      crm: { es: "Pacientes", en: "Patients" },
    })).toBe("Pacientes");
    expect(resolveNavigationDisplayLabel("crm", "CRM", "fr", {
      crm: { es: "Pacientes" },
    })).toBe("CRM");
  });

  it("covers every current admin page exactly once", () => {
    const adminDirectory = path.resolve(__dirname, "../app/admin");
    const filesystemPatterns = collectAdminPagePatterns(adminDirectory).sort();
    const registryPatterns = NAVIGATION_ROUTES.map((route) => route.pattern).sort();

    expect(registryPatterns).toEqual(filesystemPatterns);
  });

  it("has unique identifiers and patterns", () => {
    const ids = NAVIGATION_ROUTES.map((route) => route.id);
    const patterns = NAVIGATION_ROUTES.map((route) => route.pattern);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it("keeps callback, unfinished and legacy alias routes out of discovery", () => {
    const hiddenRouteIds = [
      "channelInstagramCallback",
      "channelSms",
      "conversations",
      "catalog",
      "catalogCourses",
      "settingsCompany",
      "settingsIntegrations",
    ];

    for (const routeId of hiddenRouteIds) {
      expect(getNavigationRoute(routeId)?.discoverable).toBe(false);
    }
  });

  it("only references existing parents and fallback routes", () => {
    for (const route of NAVIGATION_ROUTES) {
      if (route.parentId) expect(getNavigationRoute(route.parentId)).not.toBeNull();
      if (route.returnFallbackId) expect(getNavigationRoute(route.returnFallbackId)).not.toBeNull();
    }
  });

  it("contains no parent cycles", () => {
    for (const route of NAVIGATION_ROUTES) {
      const visited = new Set<string>();
      let cursor = getNavigationRoute(route.id);
      while (cursor) {
        expect(visited.has(cursor.id)).toBe(false);
        visited.add(cursor.id);
        cursor = cursor.parentId ? getNavigationRoute(cursor.parentId) : null;
      }
    }
  });

  it("round-trips every static and dynamic route to its own definition", () => {
    for (const route of NAVIGATION_ROUTES) {
      expect(resolveNavigationRoute(materializeForTest(route.pattern))?.definition.id).toBe(route.id);
    }
  });

  it("uses a translated key or an explicitly declared pending key in all locales", () => {
    const locales = ["es", "en", "pt", "fr"].map(readLocale);
    const pendingKeys = new Set<string>(NAVIGATION_I18N_KEYS_REQUIRED);

    for (const route of NAVIGATION_ROUTES) {
      const translatedEverywhere = locales.every((messages) => hasMessageKey(messages, route.titleKey));
      expect(translatedEverywhere || pendingKeys.has(route.titleKey)).toBe(true);
    }

    for (const key of pendingKeys) {
      expect(NAVIGATION_ROUTES.some((route) => route.titleKey === key)).toBe(true);
    }
  });

  it("represents tenant, shared and platform surfaces", () => {
    expect(NAVIGATION_ROUTES.some((route) => route.scope === "tenant")).toBe(true);
    expect(NAVIGATION_ROUTES.some((route) => route.scope === "shared")).toBe(true);
    expect(NAVIGATION_ROUTES.some((route) => route.scope === "platform")).toBe(true);
    expect(resolveNavigationRoute("/admin/tenants")?.definition.scope).toBe("platform");
    expect(resolveNavigationRoute("/admin/inbox")?.definition.scope).toBe("tenant");
    expect(resolveNavigationRoute("/admin/settings/profile")?.definition.scope).toBe("shared");
  });
});

describe("segment-aware active matching", () => {
  it("normalizes query strings, hashes and trailing slashes", () => {
    expect(normalizeNavigationPath("/admin/inbox/?status=open#latest")).toBe("/admin/inbox");
    expect(normalizeNavigationPath("/admin")).toBe("/admin");
    expect(normalizeNavigationPath("https://example.com/admin")).toBeNull();
  });

  it("matches an exact route and its true descendants", () => {
    expect(isSegmentAwareNavigationMatch("/admin/contacts", "/admin/contacts")).toBe(true);
    expect(isSegmentAwareNavigationMatch("/admin/contacts/segments", "/admin/contacts")).toBe(true);
    expect(isSegmentAwareNavigationMatch("/admin/contacts/segments", "/admin/contacts", true)).toBe(false);
  });

  it("does not confuse similarly prefixed routes", () => {
    expect(isSegmentAwareNavigationMatch("/admin/agent-analytics", "/admin/agent")).toBe(false);
    expect(isSegmentAwareNavigationMatch("/admin/contacts-old", "/admin/contacts")).toBe(false);
    expect(isSegmentAwareNavigationMatch("/admin/settings-old", "/admin/settings")).toBe(false);
  });

  it("selects the longest matching destination", () => {
    const targets = [
      { id: "home", href: "/admin" },
      { id: "contacts", href: "/admin/contacts" },
      { id: "organizations", href: "/admin/contacts/organizations" },
    ];
    expect(selectActiveNavigationTarget("/admin/contacts/organizations", targets)?.id).toBe("organizations");
    expect(selectActiveNavigationTarget("/admin/contacts/abc", targets)?.id).toBe("contacts");
  });

  it("treats /admin as exact unless a caller explicitly opts into prefix matching", () => {
    expect(selectActiveNavigationTarget("/admin/inbox", [{ id: "home", href: "/admin" }])).toBeNull();
    expect(selectActiveNavigationTarget("/admin/inbox", [{ id: "home", href: "/admin", exact: false }])?.id).toBe("home");
  });
});

describe("route and breadcrumb resolution", () => {
  it("prefers a static route over a dynamic sibling", () => {
    expect(resolveNavigationRoute("/admin/contacts/organizations")?.definition.id).toBe("organizations");
    expect(resolveNavigationRoute("/admin/agent/quality")?.definition.id).toBe("agentQuality");
    expect(resolveNavigationRoute("/admin/agent/simulation")?.definition.id).toBe("agentSimulation");
  });

  it("extracts dynamic parameters without using them as labels", () => {
    const resolved = resolveNavigationRoute(`/admin/contacts/${UUID}`);
    expect(resolved?.params).toEqual({ leadId: UUID });

    const breadcrumbs = buildNavigationBreadcrumbs(`/admin/contacts/${UUID}`);
    expect(breadcrumbs.map(({ routeId }) => routeId)).toEqual(["contacts", "contactDetail"]);
    expect(breadcrumbs[1]).toMatchObject({
      titleKey: "navigation.routes.contactDetail",
      href: `/admin/contacts/${UUID}`,
      isCurrent: true,
    });
    expect(breadcrumbs[1].label).toBeUndefined();
  });

  it("uses a resolved entity name for dynamic breadcrumbs", () => {
    const breadcrumbs = buildNavigationBreadcrumbs(`/admin/contacts/${UUID}`, {
      dynamicLabels: { contactDetail: "Ana Pérez" },
    });
    expect(breadcrumbs[1].label).toBe("Ana Pérez");
  });

  it("refuses a raw UUID returned by a dynamic label resolver", () => {
    const breadcrumbs = buildNavigationBreadcrumbs(`/admin/contacts/${UUID}`, {
      resolveDynamicLabel: () => UUID,
    });
    expect(breadcrumbs[1].label).toBeUndefined();
    expect(breadcrumbs[1].titleKey).toBe("navigation.routes.contactDetail");
  });

  it("builds semantic Settings breadcrumbs instead of URL fragments", () => {
    const breadcrumbs = buildNavigationBreadcrumbs("/admin/settings/integrations/web-chat/triggers");
    expect(breadcrumbs.map(({ routeId }) => routeId)).toEqual([
      "settings",
      "settingsIntegrations",
      "settingsWebChat",
      "settingsWebChatTriggers",
    ]);
    expect(breadcrumbs[0].href).toBe("/admin/settings");
    expect(breadcrumbs.every(({ href }) => !href.includes("undefined"))).toBe(true);
  });

  it("materializes dynamic semantic parents for nested pages", () => {
    const breadcrumbs = buildNavigationBreadcrumbs(`/admin/agent/${UUID}/test`, {
      dynamicLabels: { agentDetail: "Sofía Ventas" },
    });
    expect(breadcrumbs.map(({ routeId }) => routeId)).toEqual(["agents", "agentDetail", "agentTest"]);
    expect(breadcrumbs[1]).toMatchObject({ href: `/admin/agent/${UUID}`, label: "Sofía Ventas" });
  });

  it("uses the platform tenant hub as the semantic parent of tenant detail", () => {
    const breadcrumbs = buildNavigationBreadcrumbs(`/admin/tenants/${UUID}`, {
      dynamicLabels: { platformTenantDetail: "Acme Colombia" },
    });
    expect(breadcrumbs).toEqual([
      {
        routeId: "platformTenants",
        href: "/admin/tenants",
        titleKey: "nav.items.tenants",
        isCurrent: false,
      },
      {
        routeId: "platformTenantDetail",
        href: `/admin/tenants/${UUID}`,
        titleKey: "navigation.routes.platformTenantDetail",
        label: "Acme Colombia",
        isCurrent: true,
      },
    ]);
  });

  it("returns no breadcrumb for an unknown route instead of exposing raw slugs", () => {
    expect(buildNavigationBreadcrumbs(`/admin/unknown/${UUID}`)).toEqual([]);
  });
});

describe("safe contextual return navigation", () => {
  it("accepts canonical internal destinations and preserves local state", () => {
    expect(sanitizeInternalReturnTo("/admin/inbox?status=open#conversation-12")).toBe(
      "/admin/inbox?status=open#conversation-12",
    );
    expect(sanitizeInternalReturnTo(`/admin/contacts/${UUID}`)).toBe(`/admin/contacts/${UUID}`);
  });

  it.each([
    "https://evil.example/admin/inbox",
    "//evil.example/admin/inbox",
    "\\\\evil.example\\admin\\inbox",
    "/admin\\inbox",
    "/admin//inbox",
    "/admin/%2e%2e/login",
    "/admin/%2F%2Fevil.example",
    "/admin/%5cinbox",
    "/admin/inbox\u0000",
    "/login",
    "/admin/not-a-real-page",
    "admin/inbox",
  ])("rejects unsafe or non-canonical returnTo: %s", (candidate) => {
    expect(sanitizeInternalReturnTo(candidate)).toBeNull();
  });

  it("supports route, scope and permission allowlists", () => {
    expect(sanitizeInternalReturnTo("/admin/inbox", { allowRouteIds: ["contacts"] })).toBeNull();
    expect(sanitizeInternalReturnTo("/admin/inbox", { allowScopes: ["platform"] })).toBeNull();
    expect(sanitizeInternalReturnTo("/admin/tenants", { allowScopes: ["platform"] })).toBe("/admin/tenants");
    expect(sanitizeInternalReturnTo("/admin/inbox", { isAllowedPath: () => false })).toBeNull();
  });

  it("prefers a valid contextual origin", () => {
    expect(resolveNavigationReturnTarget({
      currentPath: "/admin/settings/pipeline",
      returnTo: "/admin/pipeline?stage=qualified",
    })).toEqual({
      href: "/admin/pipeline?stage=qualified",
      routeId: "pipeline",
      source: "returnTo",
    });
  });

  it("falls back from Settings detail to the Settings hub", () => {
    expect(resolveNavigationReturnTarget({
      currentPath: "/admin/settings/business-info",
      returnTo: "https://evil.example",
    })).toEqual({ href: "/admin/settings", routeId: "settings", source: "semantic-parent" });
  });

  it("falls back from a dynamic detail page to its materialized parent", () => {
    expect(resolveNavigationReturnTarget({ currentPath: `/admin/agent/${UUID}/test` })).toEqual({
      href: `/admin/agent/${UUID}`,
      routeId: "agentDetail",
      source: "semantic-parent",
    });
  });

  it("uses the platform tenant hub as the platform scope home", () => {
    expect(resolveNavigationReturnTarget({ currentPath: "/admin/financials" })).toEqual({
      href: "/admin/tenants",
      routeId: "platformTenants",
      source: "scope-home",
    });
  });

  it("uses a configured contextual fallback before the registered parent", () => {
    expect(resolveNavigationReturnTarget({
      currentPath: "/admin/settings/pipeline",
      fallbackRouteId: "pipeline",
    })).toEqual({ href: "/admin/pipeline", routeId: "pipeline", source: "configured-fallback" });
  });

  it("does not return to the current page and respects access filtering on fallbacks", () => {
    expect(resolveNavigationReturnTarget({
      currentPath: "/admin/settings/profile",
      returnTo: "/admin/settings/profile?tab=security",
      isAllowedPath: (pathname) => pathname === "/admin",
    })).toEqual({ href: "/admin", routeId: "tenantHome", source: "scope-home" });
  });

  it("returns the universal authenticated home if no allowlisted fallback remains", () => {
    expect(resolveNavigationReturnTarget({
      currentPath: "/admin/settings/profile",
      allowRouteIds: [],
    })).toEqual({ href: "/admin", routeId: "tenantHome", source: "default" });
  });
});
