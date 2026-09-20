import { existsSync } from "node:fs";
import { join } from "node:path";
import { listVerticalCapabilityConfigurations } from "@parallext/shared";
import { resolveVerticalDashboard } from "@/lib/vertical-dashboard-resolver";
import { recipeOfferHref, recipePurchaseTool } from "./recipe-navigation";
import type { SetupRecipe } from "./setup-recipe";

const recipe: SetupRecipe = {
    source: "registry", mainInstructions: "", whenUnsure: [], handoffReasons: [],
    purchaseModes: ["inform"], questions: [], testQuestions: [], services: [], businessHours: {},
};

describe("setup recipe navigation across published business profiles", () => {
    it("opens an existing offer screen that the profile actually exposes", () => {
        for (const manifest of listVerticalCapabilityConfigurations()) {
            const config = {
                industry: manifest.industry, subType: manifest.subtype,
                manifestVersion: manifest.manifestVersion, effectiveCapabilities: manifest.capabilities,
            };
            const { visibleItems } = resolveVerticalDashboard(config);
            const href = recipeOfferHref(recipe, config);
            const pathname = href.split("?")[0];
            expect(existsSync(join(__dirname, "..", pathname.replace(/^\/admin\//, ""), "page.tsx"))).toBe(true);
            if (!visibleItems.includes("appointments")) {
                expect(pathname).not.toBe("/admin/appointments");
            }
        }
    });

    it.each([
        ["restaurantes", ["order", "table"], "restaurants"],
        ["retail", ["order", "inform"], "ecommerce"],
        ["education", ["class", "appointment"], "education"],
        ["servicios_hogar", ["quote", "appointment"], "homeServices"],
        ["salud", ["appointment", "inform"], "appointments"],
    ] as const)("opens the relevant agent tool for %s", (industry, modes, expectedTool) => {
        expect(recipePurchaseTool({ ...recipe, purchaseModes: [...modes] }, { industry })).toBe(expectedTool);
    });
});
