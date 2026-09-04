import {
    getActiveSettingHref,
    getVisibleSections,
    normalizeSettingsSearch,
    resolveSettingsReturnTo,
    SETTINGS_HUB_HREF,
    SETTINGS_SECTIONS,
    withSettingsReturnTo,
    type Role,
} from "./_settings-config";

const tenantAdmin: Role = {
    canManageBilling: true,
    isSupervisor: true,
    canManagePlatform: false,
    isSuperAdminPlatformMode: false,
};

const supervisor: Role = {
    canManageBilling: false,
    isSupervisor: true,
    canManagePlatform: false,
    isSuperAdminPlatformMode: false,
};

const agent: Role = {
    canManageBilling: false,
    isSupervisor: false,
    canManagePlatform: false,
    isSuperAdminPlatformMode: false,
};

describe("Settings information architecture", () => {
    it("organizes tenant-admin settings into focused, ordered sections", () => {
        expect(getVisibleSections(tenantAdmin).map((section) => section.key)).toEqual([
            "account",
            "company",
            "crmOperations",
            "conversations",
            "channelsIntegrations",
            "developer",
            "governance",
            "planBilling",
        ]);
    });

    it("keeps every destination unique and surfaces the existing billing page", () => {
        const visibleItems = getVisibleSections(tenantAdmin).flatMap((section) => section.items);
        const keys = visibleItems.map((item) => item.key);
        const hrefs = visibleItems.map((item) => item.href);

        expect(new Set(keys).size).toBe(keys.length);
        expect(new Set(hrefs).size).toBe(hrefs.length);
        // P26 removes the tenant-facing SMS notifications destination. The
        // previous count asserted the retired-product dead end. +1: the setup
        // assistant, which had no entry point anywhere in the app.
        expect(keys).toHaveLength(32);
        expect(keys).toContain("billing");
        expect(hrefs).toContain("/admin/settings/billing");
        // Closing "Conocé a tu agente" used to be irreversible.
        expect(hrefs).toContain("/admin/setup-wizard");
    });

    it("separates developer and governance destinations from business integrations", () => {
        const sections = getVisibleSections(tenantAdmin);
        const byKey = Object.fromEntries(
            sections.map((section) => [section.key, section.items.map((item) => item.key)]),
        );

        expect(byKey.channelsIntegrations).toEqual([
            "crmIntegrations",
            "webChat",
            "slack",
            "verticalIntegrations",
            "reviews",
            "payments",
            "ecommerce",
        ]);
        expect(byKey.developer).toEqual(["outboundWebhooks", "mcp", "apiKeys"]);
        expect(byKey.governance).toEqual(["policies", "alerts"]);
    });

    it("preserves role filtering while exposing supervisor alerts", () => {
        const supervisorSections = getVisibleSections(supervisor);
        expect(supervisorSections.map((section) => section.key)).toEqual([
            "account",
            "crmOperations",
            "conversations",
            "governance",
        ]);
        expect(supervisorSections.find((section) => section.key === "governance")?.items.map((item) => item.key))
            .toEqual(["alerts"]);
        expect(getVisibleSections(agent).map((section) => section.key)).toEqual(["account"]);
    });

    it("keeps platform mode isolated from tenant configuration", () => {
        const platformMode: Role = {
            canManageBilling: false,
            isSupervisor: true,
            canManagePlatform: true,
            isSuperAdminPlatformMode: true,
        };

        expect(getVisibleSections(platformMode).map((section) => section.key)).toEqual([
            "account",
            "aiAdvanced",
            "platform",
        ]);
    });

    it("does not define duplicate keys or hrefs in the source of truth", () => {
        const allItems = SETTINGS_SECTIONS.flatMap((section) => section.items);
        expect(new Set(allItems.map((item) => item.key)).size).toBe(allItems.length);
        expect(new Set(allItems.map((item) => item.href)).size).toBe(allItems.length);
    });
});

describe("Settings navigation contract", () => {
    it("selects only the longest active destination", () => {
        const sections = getVisibleSections({
            ...tenantAdmin,
            canManagePlatform: true,
        });

        expect(getActiveSettingHref("/admin/settings/platform/changelog/preview", sections))
            .toBe("/admin/settings/platform/changelog");
        expect(getActiveSettingHref(SETTINGS_HUB_HREF, sections)).toBeNull();
    });

    it("accepts only accessible internal admin return targets", () => {
        const canAccess = jest.fn((pathname: string) => pathname !== "/admin/financials");

        expect(resolveSettingsReturnTo("/admin/pipeline?view=kanban#deal", canAccess))
            .toBe("/admin/pipeline?view=kanban#deal");
        expect(canAccess).toHaveBeenLastCalledWith("/admin/pipeline");
        expect(resolveSettingsReturnTo("/admin/financials", canAccess)).toBe(SETTINGS_HUB_HREF);
    });

    it.each([
        null,
        "",
        "https://evil.example/admin",
        "//evil.example/admin",
        "/login",
        "/administrator",
        "/admin\\evil",
        "/admin/../login",
    ])("falls back safely for invalid return target %p", (value) => {
        expect(resolveSettingsReturnTo(value, () => true)).toBe(SETTINGS_HUB_HREF);
    });

    it("rejects a self-referential target", () => {
        expect(resolveSettingsReturnTo(
            "/admin/settings/profile",
            () => true,
            "/admin/settings/profile",
        )).toBe(SETTINGS_HUB_HREF);
    });

    it("carries a validated origin across Settings destinations", () => {
        expect(withSettingsReturnTo("/admin/settings/profile", "/admin/pipeline?view=kanban"))
            .toBe("/admin/settings/profile?returnTo=%2Fadmin%2Fpipeline%3Fview%3Dkanban");
        expect(withSettingsReturnTo("/admin/settings/profile", SETTINGS_HUB_HREF))
            .toBe("/admin/settings/profile");
    });

    it("normalizes case, whitespace and accents for Settings search", () => {
        expect(normalizeSettingsSearch("  CONFIGURACIÓN Electrónica  "))
            .toBe("configuracion electronica");
    });
});
