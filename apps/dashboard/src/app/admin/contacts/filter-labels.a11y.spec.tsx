import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import axe from "axe-core";
import * as fs from "fs";
import * as path from "path";
import ContactsPage from "./page";

jest.mock("@/lib/api", () => ({ api: { fetch: jest.fn() } }));
jest.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ activeTenantId: "11111111-1111-4111-8111-111111111111" }) }));
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "qa", role: "tenant_admin" }, verticalConfig: null }) }));
jest.mock("@/hooks/usePlanLimits", () => ({ usePlanLimits: () => ({ canCreate: () => true, getLimit: () => Infinity }) }));
const { api } = jest.requireMock("@/lib/api") as { api: { fetch: jest.Mock } };
const keys = ["scoreMin", "scoreMax", "dateFrom", "dateTo", "filterByTags"];

beforeEach(() => {
    api.fetch.mockReset().mockImplementation(async (endpoint: string, options?: RequestInit) => {
        if (endpoint.startsWith("/crm/leads/") && !options?.method) return { success: true, data: [] };
        throw new Error("Unexpected API call: " + endpoint);
    });
});

describe.each(["es", "en", "pt", "fr"])("contact advanced filter names in %s", locale => {
    async function withDrawer(check: (inputs: HTMLInputElement[], messages: any) => void | Promise<void>) {
        const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../messages", locale + ".json"), "utf8"));
        for (const key of keys) expect(typeof messages.contacts[key]).toBe("string");
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        try {
            await act(async () => { root.render(<NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Bogota"><ContactsPage /></NextIntlClientProvider>); });
            const buttons = Array.from(container.querySelectorAll("button")).filter(button => button.textContent?.trim() === messages.contacts.advancedFilters);
            expect(buttons).toHaveLength(1);
            await act(async () => { buttons[0].click(); });
            const heading = Array.from(container.querySelectorAll("h3")).find(node => node.textContent === messages.contacts.advancedFilters);
            expect(heading).toBeDefined();
            const drawer = heading!.parentElement!.parentElement!;
            expect(drawer.parentElement!.className).toContain("translate-x-0");
            const inputs = Array.from(drawer.querySelectorAll<HTMLInputElement>("input"));
            expect(inputs).toHaveLength(5);
            await check(inputs, messages);
            expect(api.fetch).toHaveBeenCalledTimes(1);
            expect(api.fetch.mock.calls[0]).toEqual(["/crm/leads/11111111-1111-4111-8111-111111111111"]);
        } finally {
            act(() => root.unmount());
            container.remove();
        }
    }

    it("gives all five fields their translated accessible labels", async () => {
        await withDrawer(async (inputs, messages) => {
            const result = await axe.run(inputs, { runOnly: { type: "rule", values: ["label"] } });
            expect(result.violations).toEqual([]);
            expect(inputs.map(input => Array.from(input.labels || []).map(label => label.textContent?.trim()).join(" ")))
                .toEqual(keys.map(key => messages.contacts[key]));
            expect(new Set(inputs.map(input => input.id)).size).toBe(5);
        });
    });

    it("opens without changing values, bounds or making a filter request", async () => {
        await withDrawer(inputs => {
            expect(inputs.map(input => input.value)).toEqual(["", "", "", "", ""]);
            expect(inputs.map(input => input.type)).toEqual(["number", "number", "date", "date", "text"]);
            expect(inputs.slice(0, 2).map(input => [input.min, input.max])).toEqual([["1", "10"], ["1", "10"]]);
        });
    });
});
