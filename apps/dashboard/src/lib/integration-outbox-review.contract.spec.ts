import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const page = fs.readFileSync(
    path.resolve(ROOT, "app/admin/ops/integrations/page.tsx"),
    "utf8",
);
const ops = fs.readFileSync(path.resolve(ROOT, "app/admin/ops/page.tsx"), "utf8");
const sidebar = fs.readFileSync(path.resolve(ROOT, "components/layout/AppSidebar.tsx"), "utf8");
const api = fs.readFileSync(path.resolve(ROOT, "lib/api.ts"), "utf8");
const navigation = fs.readFileSync(path.resolve(ROOT, "lib/navigation-contract.ts"), "utf8");

function messageAt(locale: string, key: string): unknown {
    const messages = JSON.parse(fs.readFileSync(
        path.resolve(ROOT, `../messages/${locale}.json`),
        "utf8",
    ));
    return key.split(".").reduce<unknown>((value, segment) => (
        value && typeof value === "object"
            ? (value as Record<string, unknown>)[segment]
            : undefined
    ), messages);
}

describe("integration outbox operations review", () => {
    it("is reachable from both platform navigation surfaces", () => {
        expect(sidebar).toContain('href: "/admin/ops/integrations"');
        expect(ops).toContain('href: "/admin/ops/integrations"');
        expect(navigation).toContain('pattern: "/admin/ops/integrations"');
        expect(navigation).toContain('titleKey: "nav.items.integrationOutbox"');
    });

    it("loads rail and aggregate review without rendering sensitive payloads", () => {
        expect(api).toContain('apiGet<IntegrationRailStatus>("/integrations/rail")');
        expect(api).toContain('apiGet<IntegrationOutboxOverview>("/integrations/outbox")');
        expect(page).toContain("api.getIntegrationRail()");
        expect(page).toContain("api.getIntegrationOutboxOverview()");
        expect(page).not.toMatch(/\b(item|tenant|attention)\.payload\b/);
        expect(page).not.toContain("idempotencyKey");
    });

    it.each(["es", "en", "pt", "fr"])("has complete %s operations copy", locale => {
        for (const key of [
            "nav.items.integrationOutbox",
            "integrationOutbox.title",
            "integrationOutbox.scopeNote",
            "integrationOutbox.mismatchWarning",
            "integrationOutbox.statuses.suppressed",
            "integrationOutbox.statuses.expired",
        ]) {
            expect(typeof messageAt(locale, key)).toBe("string");
        }
    });
});
