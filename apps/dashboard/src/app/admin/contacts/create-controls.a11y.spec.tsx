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
const keys = ["firstName", "lastName", "phone", "email", "stage"];

describe.each(["es", "en", "pt", "fr"])("contact create control names in %s", locale => {
    async function withModal(check: (modal: HTMLElement, messages: any) => void | Promise<void>) {
        const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../messages", locale + ".json"), "utf8"));
        for (const key of [...keys, "title", "close"]) expect(typeof messages.contacts.createModal[key]).toBe("string");
        api.fetch.mockReset().mockImplementation(async (url: string, options?: RequestInit) => {
            if (url !== endpoint || options?.method) throw new Error("Unexpected API request");
            return { success: true, data: [] };
        });
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        try {
            await act(async () => { root.render(<NextIntlClientProvider locale={locale} messages={messages} timeZone="America/Bogota"><ContactsPage /></NextIntlClientProvider>); });
            const create = Array.from(container.querySelectorAll("button")).filter(button => button.textContent?.trim() === messages.common.create);
            expect(create).toHaveLength(1);
            await act(async () => { create[0].click(); });
            const heading = Array.from(container.querySelectorAll("h2")).find(node => node.textContent === messages.contacts.createModal.title);
            expect(heading).toBeDefined();
            const modal = heading!.parentElement!.parentElement!;
            expect(modal.querySelectorAll("input, select")).toHaveLength(5);
            await check(modal, messages);
            expect(api.fetch.mock.calls).toEqual([[endpoint]]);
        } finally {
            act(() => root.unmount());
            container.remove();
        }
    }

    it("associates all five translated field labels with unique controls", async () => {
        await withModal(async (modal, messages) => {
            const controls = Array.from(modal.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select"));
            const result = await axe.run(controls, { runOnly: ["label", "select-name"] });
            expect(result.violations).toEqual([]);
            expect(controls.map(control => Array.from(control.labels || []).map(label => label.textContent?.trim()).join(" ")))
                .toEqual(keys.map(key => messages.contacts.createModal[key] + (key === "phone" ? " *" : "")));
            expect(new Set(controls.map(control => control.id)).size).toBe(5);
            for (const control of controls) expect(document.querySelectorAll('[id="' + control.id + '"]')).toHaveLength(1);
        });
    });

    it("gives the icon close button its translated action name", async () => {
        await withModal(async (modal, messages) => {
            const header = modal.querySelector("h2")!.parentElement!;
            const result = await axe.run(header, { runOnly: ["button-name"] });
            expect(result.violations).toEqual([]);
            expect(header.querySelector("button")!.getAttribute("aria-label")).toBe(messages.contacts.createModal.close);
        });
    });

    it("preserves empty defaults, the disabled submit and cancel without a write", async () => {
        await withModal(async (modal, messages) => {
            const controls = Array.from(modal.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select"));
            expect(controls.map(control => control.value)).toEqual(["", "", "", "", "nuevo"]);
            expect(controls.map(control => control.type)).toEqual(["text", "text", "tel", "email", "select-one"]);
            const submit = Array.from(modal.querySelectorAll("button")).find(button => button.textContent?.trim() === messages.contacts.createModal.create)!;
            expect(submit.disabled).toBe(true);
            const cancel = Array.from(modal.querySelectorAll("button")).find(button => button.textContent?.trim() === messages.common.cancel)!;
            await act(async () => { cancel.click(); });
            expect(document.body.contains(modal)).toBe(false);
        });
    });
});
