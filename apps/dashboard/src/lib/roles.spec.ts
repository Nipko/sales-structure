import {
    ROLE_KEYS,
    canAccessPath,
    defaultLandingForRole,
} from "./roles";
import { NAVIGATION_ROUTES } from "./navigation-contract";

describe("dashboard route access contract", () => {
    it("fails closed for routes that have not declared an audience", () => {
        expect(canAccessPath("/admin/a-page-that-was-never-registered", ROLE_KEYS.TENANT_ADMIN, false)).toBe(false);
        expect(canAccessPath("/admin/a-page-that-was-never-registered", ROLE_KEYS.TENANT_AGENT, false)).toBe(false);
        expect(canAccessPath("/admin/a-page-that-was-never-registered", ROLE_KEYS.SUPER_ADMIN, false)).toBe(false);
    });

    it("keeps tenant-wide settings restricted to tenant administrators", () => {
        const adminOnlySettings = [
            "/admin/settings/business-info",
            "/admin/settings/localization",
            "/admin/settings/business-hours",
            "/admin/settings/fiscal",
            "/admin/settings/nurturing",
            "/admin/settings/integrations/webhooks",
            "/admin/settings/api-keys",
        ];

        for (const path of adminOnlySettings) {
            expect(canAccessPath(path, ROLE_KEYS.TENANT_ADMIN, false)).toBe(true);
            expect(canAccessPath(path, ROLE_KEYS.TENANT_SUPERVISOR, false)).toBe(false);
            expect(canAccessPath(path, ROLE_KEYS.TENANT_AGENT, false)).toBe(false);
        }
    });

    it("keeps operational configuration available to supervisors but not agents", () => {
        const supervisorSettings = [
            "/admin/settings/pipeline",
            "/admin/settings/scoring-config",
            "/admin/settings/custom-attributes",
            "/admin/settings/prechat",
            "/admin/settings/public-booking",
            "/admin/settings/email-templates",
            "/admin/settings/macros",
            "/admin/settings/media",
            "/admin/settings/alerts",
        ];

        for (const path of supervisorSettings) {
            expect(canAccessPath(path, ROLE_KEYS.TENANT_SUPERVISOR, false)).toBe(true);
            expect(canAccessPath(path, ROLE_KEYS.TENANT_AGENT, false)).toBe(false);
        }
    });

    it("allows agents to read knowledge without exposing team analytics or catalogs", () => {
        expect(canAccessPath("/admin/knowledge", ROLE_KEYS.TENANT_AGENT, false)).toBe(true);
        expect(canAccessPath("/admin/agent-analytics", ROLE_KEYS.TENANT_AGENT, false)).toBe(false);
        expect(canAccessPath("/admin/agent-analytics", ROLE_KEYS.TENANT_SUPERVISOR, false)).toBe(true);
        expect(canAccessPath("/admin/inventory", ROLE_KEYS.TENANT_AGENT, false)).toBe(false);
        expect(canAccessPath("/admin/vehicles", ROLE_KEYS.TENANT_AGENT, false)).toBe(false);
        expect(canAccessPath("/admin/contacts/organizations", ROLE_KEYS.TENANT_AGENT, false)).toBe(false);
        expect(canAccessPath("/admin/contacts/organizations", ROLE_KEYS.TENANT_SUPERVISOR, false)).toBe(true);
    });

    it("exposes quality read-only to supervisors without exposing the editor", () => {
        expect(canAccessPath("/admin/agent/quality", ROLE_KEYS.TENANT_ADMIN, false)).toBe(true);
        expect(canAccessPath("/admin/agent/quality", ROLE_KEYS.TENANT_SUPERVISOR, false)).toBe(true);
        expect(canAccessPath("/admin/agent/quality", ROLE_KEYS.TENANT_AGENT, false)).toBe(false);
        expect(canAccessPath("/admin/agent/example-id", ROLE_KEYS.TENANT_SUPERVISOR, false)).toBe(false);
        expect(canAccessPath("/admin/agent/quality", ROLE_KEYS.SUPER_ADMIN, false)).toBe(false);
        expect(canAccessPath("/admin/agent/quality", ROLE_KEYS.SUPER_ADMIN, true)).toBe(true);
    });

    it("gives the legacy viewer a safe personal-settings home", () => {
        expect(canAccessPath("/admin", ROLE_KEYS.TENANT_VIEWER, false)).toBe(false);
        expect(canAccessPath("/admin/settings", ROLE_KEYS.TENANT_VIEWER, false)).toBe(true);
        expect(canAccessPath("/admin/settings/profile", ROLE_KEYS.TENANT_VIEWER, false)).toBe(true);
        expect(canAccessPath("/admin/inbox", ROLE_KEYS.TENANT_VIEWER, false)).toBe(false);
        expect(canAccessPath("/admin/feature-requests", ROLE_KEYS.TENANT_VIEWER, false)).toBe(false);
        expect(defaultLandingForRole(ROLE_KEYS.TENANT_VIEWER, false)).toBe("/admin/settings/profile");
    });

    it("keeps platform pages outside tenant sessions and tenant pages behind impersonation", () => {
        expect(canAccessPath("/admin/tenants", ROLE_KEYS.SUPER_ADMIN, false)).toBe(true);
        expect(canAccessPath("/admin/tenants", ROLE_KEYS.TENANT_ADMIN, false)).toBe(false);
        expect(canAccessPath("/admin/inbox", ROLE_KEYS.SUPER_ADMIN, false)).toBe(false);
        expect(canAccessPath("/admin/inbox", ROLE_KEYS.SUPER_ADMIN, true)).toBe(true);
    });

    it("uses role-appropriate recovery destinations", () => {
        expect(defaultLandingForRole(ROLE_KEYS.SUPER_ADMIN, false)).toBe("/admin/tenants");
        expect(defaultLandingForRole(ROLE_KEYS.TENANT_ADMIN, false)).toBe("/admin");
        expect(defaultLandingForRole(ROLE_KEYS.TENANT_SUPERVISOR, false)).toBe("/admin");
        expect(defaultLandingForRole(ROLE_KEYS.TENANT_AGENT, false)).toBe("/admin/inbox");
        expect(defaultLandingForRole(ROLE_KEYS.TENANT_VIEWER, false)).toBe("/admin/settings/profile");
    });

    it("declares at least one valid audience for every registered dashboard page", () => {
        const exampleId = "00000000-0000-4000-8000-000000000001";
        const audiences = [
            { role: ROLE_KEYS.SUPER_ADMIN, impersonating: false },
            { role: ROLE_KEYS.SUPER_ADMIN, impersonating: true },
            { role: ROLE_KEYS.TENANT_ADMIN, impersonating: false },
            { role: ROLE_KEYS.TENANT_SUPERVISOR, impersonating: false },
            { role: ROLE_KEYS.TENANT_AGENT, impersonating: false },
            { role: ROLE_KEYS.TENANT_VIEWER, impersonating: false },
        ];

        const unreachable = NAVIGATION_ROUTES
            .map((route) => ({
                id: route.id,
                pathname: route.pattern.replace(/:[^/]+/g, exampleId),
            }))
            .filter(({ pathname }) => !audiences.some(({ role, impersonating }) => (
                canAccessPath(pathname, role, impersonating)
            )))
            .map(({ id, pathname }) => `${id} (${pathname})`);

        expect(unreachable).toEqual([]);
    });
});
