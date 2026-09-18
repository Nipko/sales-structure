import * as fs from "node:fs";
import * as path from "node:path";
import { ROLE_KEYS, canAccessPath } from "@/lib/roles";
import { getNavigationRoute, resolveNavigationRoute } from "@/lib/navigation-contract";
import { DEMO_ALLOWANCE_ENDPOINT, canSaveDemoAllowance, demoAllowanceFieldProblem, readDemoAllowanceSnapshot } from "./demo-allowance";

/**
 * Where the platform owner changes what every account's public link costs
 * (audit #47). `roles.ts` is deny-by-default, so the page exists for exactly
 * one role only because a rule says so; a platform cost is never reachable by
 * impersonating a tenant, and never by a tenant's own people.
 */
describe("the demo allowance screen belongs to the platform", () => {
    it("opens for the super_admin only, impersonating or not", () => {
        expect(canAccessPath("/admin/demo-allowance", ROLE_KEYS.SUPER_ADMIN, false)).toBe(true);
        for (const role of [ROLE_KEYS.TENANT_ADMIN, ROLE_KEYS.TENANT_SUPERVISOR, ROLE_KEYS.TENANT_AGENT, ROLE_KEYS.TENANT_VIEWER]) {
            expect(canAccessPath("/admin/demo-allowance", role, false)).toBe(false);
            expect(canAccessPath("/admin/demo-allowance", role, true)).toBe(false);
        }
    });

    it("is a platform route of the navigation registry, with a translated title", () => {
        expect(getNavigationRoute("platformDemoAllowance")).toMatchObject({
            pattern: "/admin/demo-allowance", scope: "platform", titleKey: "nav.items.demoAllowance",
        });
        expect(resolveNavigationRoute("/admin/demo-allowance")?.definition.id).toBe("platformDemoAllowance");
        for (const locale of ["es", "en", "pt", "fr"]) {
            const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../../../messages/${locale}.json`), "utf8"));
            expect(typeof messages.nav.items.demoAllowance).toBe("string");
        }
    });

    it("sits in the platform navigation next to the other things the platform gives away", () => {
        const sidebar = fs.readFileSync(path.resolve(__dirname, "../../../components/layout/AppSidebar.tsx"), "utf8");
        expect(sidebar).toMatch(/labelKey: "coupons", href: "\/admin\/coupons"[\s\S]{0,300}labelKey: "demoAllowance", href: "\/admin\/demo-allowance"/);
    });
});

describe("the screen's contract with the API", () => {
    const valid = {
        success: true,
        data: {
            allowance: { enabled: false, messagesPerTenant: 0, dailyCapPerPage: 1 },
            source: "stored",
            defaults: { enabled: true, messagesPerTenant: 200, dailyCapPerPage: 60 },
            limits: { messagesPerTenant: { min: 0, max: 10000 }, dailyCapPerPage: { min: 1, max: 1000 } },
        },
    };

    it("talks to the audited super_admin endpoint", () => {
        expect(DEMO_ALLOWANCE_ENDPOINT).toBe("/platform/demo-allowance");
    });

    it("accepts the whole snapshot and nothing partial", () => {
        expect(readDemoAllowanceSnapshot(valid)).toEqual(valid.data);
        expect(readDemoAllowanceSnapshot({ ...valid, success: false })).toBeNull();
        expect(readDemoAllowanceSnapshot({ success: true, data: { ...valid.data, limits: undefined } })).toBeNull();
        expect(readDemoAllowanceSnapshot({ success: true, data: { ...valid.data, allowance: { enabled: "yes", messagesPerTenant: 1, dailyCapPerPage: 1 } } })).toBeNull();
        expect(readDemoAllowanceSnapshot(null)).toBeNull();
    });

    it("never guesses where the numbers came from", () => {
        // F0: stand-in defaults served while the database was down looked
        // exactly like the stored values. A snapshot that does not say which
        // they are is not trusted.
        for (const source of ["stored", "default", "fallback"]) {
            expect(readDemoAllowanceSnapshot({ success: true, data: { ...valid.data, source } })?.source).toBe(source);
        }
        const { source: _dropped, ...withoutSource } = valid.data;
        expect(readDemoAllowanceSnapshot({ success: true, data: withoutSource })).toBeNull();
        expect(readDemoAllowanceSnapshot({ success: true, data: { ...valid.data, source: "cache" } })).toBeNull();
    });

    it("offers to save only values known to be the ones in force", () => {
        expect(canSaveDemoAllowance({ source: "stored" })).toBe(true);
        expect(canSaveDemoAllowance({ source: "default" })).toBe(true);
        expect(canSaveDemoAllowance({ source: "fallback" })).toBe(false);
    });

    it("refuses before sending what the API would refuse", () => {
        const bounds = { min: 1, max: 1000 };
        expect(demoAllowanceFieldProblem("60", bounds)).toBeNull();
        expect(demoAllowanceFieldProblem(" 60 ", bounds)).toBeNull();
        expect(demoAllowanceFieldProblem("", bounds)).toBe("integer");
        expect(demoAllowanceFieldProblem("1.5", bounds)).toBe("integer");
        expect(demoAllowanceFieldProblem("-3", bounds)).toBe("integer");
        expect(demoAllowanceFieldProblem("0", bounds)).toBe("min");
        expect(demoAllowanceFieldProblem("1001", bounds)).toBe("max");
    });
});
