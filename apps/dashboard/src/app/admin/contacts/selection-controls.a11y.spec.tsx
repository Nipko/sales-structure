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
const endpoint = "/crm/leads/11111111-1111-4111-8111-111111111111";

describe.each(["es", "en", "pt", "fr"])("contact selection accessible controls in %s", locale => {
    async function withContacts(check: (container: HTMLDivElement, messages: any) => void | Promise<void>) {
        const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../messages", locale + ".json"), "utf8"));
        for (const key of ["selectAllVisible", "selectContactForBulk"]) expect(typeof messages.contacts[key]).toBe("string");
        api.fetch.mockReset().mockImplementation(async (url: string, options?: RequestInit) => {
            if (url !== endpoint || options?.method) throw new Error("Unexpected request");
            return { success: true, data: [{ id: "synthetic-a", first_name: "QA Cobalto", stage: "nuevo" }, { id: "synthetic-b", first_name: "QA Zafiro", stage: "nuevo" }] };
        });
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        try {
            await act(async () => { root.render(<NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Bogota"><ContactsPage /></NextIntlClientProvider>); });
            await check(container, messages);
            expect(api.fetch.mock.calls).toEqual([[endpoint]]);
        } finally {
            act(() => root.unmount());
            container.remove();
        }
    }

    const buttons = (container: HTMLDivElement) => [container.querySelector<HTMLButtonElement>("thead button")!, ...container.querySelectorAll<HTMLButtonElement>("tbody tr td:first-child button")];
    const press = async (button: HTMLButtonElement) => { await act(async () => { button.click(); }); };

    it("names the visible-list and individual contact selection buttons", async () => {
        await withContacts(async (container, messages) => {
            const controls = buttons(container);
            expect(controls).toHaveLength(3);
            const cells = controls.map(button => button.parentElement!);
            const result = await axe.run({ include: cells }, { runOnly: ["button-name"] });
            expect(result.violations).toHaveLength(0);
            expect(controls.map(button => button.getAttribute("aria-label"))).toEqual([
                messages.contacts.selectAllVisible,
                messages.contacts.selectContactForBulk.replace("{name}", "QA Cobalto"),
                messages.contacts.selectContactForBulk.replace("{name}", "QA Zafiro"),
            ]);
        });
    });

    it("exposes none, partial, all and cleared selection states", async () => {
        await withContacts(async container => {
            const state = () => buttons(container).map(button => button.getAttribute("aria-pressed"));
            expect(state()).toEqual(["false", "false", "false"]);
            await press(buttons(container)[1]);
            expect(state()).toEqual(["mixed", "true", "false"]);
            await press(buttons(container)[0]);
            expect(state()).toEqual(["true", "true", "true"]);
            await press(buttons(container)[0]);
            expect(state()).toEqual(["false", "false", "false"]);
        });
    });

    it("keeps selection toggles local without applying a bulk action", async () => {
        await withContacts(async container => {
            await press(buttons(container)[1]);
            expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
            await press(buttons(container)[1]);
            expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
        });
    });
});
